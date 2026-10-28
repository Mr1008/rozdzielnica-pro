import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { PricingProfile } from "./pricing-profile";
import { computeQuoteView, labourCostGrosze, type QuoteInput, type ReadyQuote } from "./quote";

/*
 * Property test for the quote (test-plan risk #5). Two kinds of oracle, neither taken from `quote.ts`:
 *
 * 1. Rounding: labour cost is minutes × hourly rate / 60 rounded half-up to a whole grosz. By the
 *    definition of half-up rounding, c is that rounding exactly when m·r − 30 < 60·c ≤ m·r + 30 —
 *    checked in BigInt, so no float and no `+ 30 div 60` from the implementation is involved.
 * 2. Metamorphic relations from the PRD formula and the archived decisions: one more mounted device
 *    adds exactly one mount time and its price; one more segment of an already-bought busbar piece
 *    adds a mount time and no material; the order of the rows changes nothing; an override sets the
 *    labour time whatever the rows.
 */

/** The half-up rounding of m·r / 60, by definition. */
function isHalfUpOfMinutesTimesRate(cost: number, minutes: number, rate: number): boolean {
  const exact = BigInt(minutes) * BigInt(rate);
  const sixty = 60n * BigInt(cost);
  return exact - 30n < sixty && sixty <= exact + 30n;
}

describe("labourCostGrosze — rounding by definition", () => {
  it("is minutes × rate / 60 rounded half-up, over the whole stored range", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 59_999 }), fc.integer({ min: 0, max: 2_147_483_647 }), (minutes, rate) => {
        const cost = labourCostGrosze(minutes, rate);
        expect(Number.isSafeInteger(cost)).toBe(true);
        expect(isHalfUpOfMinutesTimesRate(cost, minutes, rate)).toBe(true);
      }),
      { numRuns: 2_000 },
    );
  });

  it("rounds an exact half up, on rates where m·r is 30 mod 60", () => {
    // Odd minutes × a rate ≡ 30 (mod 60) lands exactly on ,5 gr: the boundary the rule is about.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 29_999 }), fc.integer({ min: 0, max: 1_000_000 }), (half, k) => {
        const minutes = 2 * half + 1;
        const rate = 60 * k + 30;
        const cost = labourCostGrosze(minutes, rate);
        expect(60n * BigInt(cost)).toBe(BigInt(minutes) * BigInt(rate) + 30n);
      }),
    );
  });
});

type Row = QuoteInput["matchView"]["snapshot"][number];

const ROLES = ["main_switch", "rcd", "rcbo", "mcb", "pe_bar", "n_bar"] as const;

const plainRowArb: fc.Arbitrary<Row> = fc.record({
  role: fc.constantFrom(...ROLES),
  device_id: fc.constantFrom("d1", "d2", "d3", "d4"),
  price_grosze: fc.integer({ min: 0, max: 1_000_000 }),
  busbar_piece: fc.constant(null),
});

/** A busbar segment: a few models and piece numbers, so pieces repeat and models share numbers. */
const busbarRowArb: fc.Arbitrary<Row> = fc.record({
  role: fc.constant("busbar" as const),
  device_id: fc.constantFrom("bb1", "bb2"),
  price_grosze: fc.integer({ min: 0, max: 100_000 }),
  busbar_piece: fc.integer({ min: 0, max: 2 }),
});

/**
 * Snapshot rows as the matcher stores them: every segment of one `(device_id, busbar_piece)` carries
 * the same catalog price, because it is the same catalog row.
 */
const rowsArb = fc.array(fc.oneof(plainRowArb, busbarRowArb), { maxLength: 30 }).map((rows) => {
  const priceOfPiece = new Map<string, number>();
  return rows.map((row) => {
    if (row.role !== "busbar") return row;
    const key = `${row.device_id}|${String(row.busbar_piece)}`;
    const price = priceOfPiece.get(key) ?? row.price_grosze;
    priceOfPiece.set(key, price);
    return { ...row, price_grosze: price };
  });
});

const profileArb: fc.Arbitrary<PricingProfile> = fc.record({
  hourly_rate_grosze: fc.integer({ min: 1, max: 100_000 }),
  mount_minutes_per_device: fc.integer({ min: 1, max: 120 }),
  project_overhead_minutes: fc.integer({ min: 0, max: 600 }),
});

const cabinetArb = fc.record({ name: fc.constant("Szafka"), priceGrosze: fc.integer({ min: 0, max: 500_000 }) });

function ready(
  rows: readonly Row[],
  profile: PricingProfile,
  cabinet: QuoteInput["cabinet"],
  override = null as QuoteInput["override"],
): ReadyQuote {
  const view = computeQuoteView({ matchView: { state: "current", snapshot: rows }, cabinet, profile, override });
  if (view.state !== "ready") throw new Error(`expected ready, got ${view.state}`);
  return view;
}

describe("computeQuoteView — metamorphic relations", () => {
  it("one more mounted device adds exactly one mount time and its price", () => {
    fc.assert(
      fc.property(rowsArb, plainRowArb, profileArb, cabinetArb, (rows, extra, profile, cabinet) => {
        const before = ready(rows, profile, cabinet);
        const after = ready([...rows, extra], profile, cabinet);
        expect(after.deviceCount).toBe(before.deviceCount + 1);
        expect(after.estimateMinutes).toBe(before.estimateMinutes + profile.mount_minutes_per_device);
        expect(after.devicesGrosze).toBe(before.devicesGrosze + extra.price_grosze);
      }),
    );
  });

  it("one more segment of an already-bought piece adds a mount time and no material", () => {
    fc.assert(
      fc.property(rowsArb, busbarRowArb, profileArb, cabinetArb, (rows, segment, profile, cabinet) => {
        const withPiece = [
          ...rows.filter((r) => !(r.device_id === segment.device_id && r.busbar_piece === segment.busbar_piece)),
          segment,
        ];
        const before = ready(withPiece, profile, cabinet);
        const after = ready([...withPiece, segment], profile, cabinet);
        expect(after.deviceCount).toBe(before.deviceCount + 1);
        expect(after.estimateMinutes).toBe(before.estimateMinutes + profile.mount_minutes_per_device);
        expect(after.devicesGrosze).toBe(before.devicesGrosze);
      }),
    );
  });

  it("prices plain rows at their sum, and the order of rows changes nothing", () => {
    fc.assert(
      fc.property(fc.array(plainRowArb, { maxLength: 30 }), profileArb, cabinetArb, (rows, profile, cabinet) => {
        expect(ready(rows, profile, cabinet).devicesGrosze).toBe(rows.reduce((sum, r) => sum + r.price_grosze, 0));
      }),
    );
    fc.assert(
      fc.property(rowsArb, fc.nat(), profileArb, cabinetArb, (rows, shift, profile, cabinet) => {
        const k = rows.length === 0 ? 0 : shift % rows.length;
        const rotated = [...rows.slice(k), ...rows.slice(0, k)].reverse();
        expect(ready(rotated, profile, cabinet)).toEqual(ready(rows, profile, cabinet));
      }),
    );
  });

  it("totals add up: material = cabinet + devices, total = material + labour, labour rounded half-up", () => {
    fc.assert(
      fc.property(rowsArb, profileArb, cabinetArb, (rows, profile, cabinet) => {
        const view = ready(rows, profile, cabinet);
        expect(view.deviceCount).toBe(rows.length);
        expect(view.estimateMinutes).toBe(
          rows.length * profile.mount_minutes_per_device + profile.project_overhead_minutes,
        );
        expect(view.materialGrosze).toBe(cabinet.priceGrosze + view.devicesGrosze);
        expect(view.totalGrosze).toBe(view.materialGrosze + view.labourGrosze);
        expect(isHalfUpOfMinutesTimesRate(view.labourGrosze, view.labourMinutes, profile.hourly_rate_grosze)).toBe(
          true,
        );
      }),
    );
  });

  it("an override sets the labour time whatever the rows; outdated means its base differs from the estimate", () => {
    fc.assert(
      fc.property(
        rowsArb,
        profileArb,
        cabinetArb,
        fc.integer({ min: 1, max: 59_999 }),
        fc.integer({ min: 0, max: 59_999 }),
        (rows, profile, cabinet, minutes, baseMinutes) => {
          const view = ready(rows, profile, cabinet, { minutes, baseMinutes });
          expect(view.labourMinutes).toBe(minutes);
          expect(isHalfUpOfMinutesTimesRate(view.labourGrosze, minutes, profile.hourly_rate_grosze)).toBe(true);
          expect(view.override?.outdated).toBe(baseMinutes !== view.estimateMinutes);
          expect(view.estimateMinutes).toBe(ready(rows, profile, cabinet).estimateMinutes);
        },
      ),
    );
  });
});
