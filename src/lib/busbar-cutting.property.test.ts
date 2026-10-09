import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { demandPins, planBusbarCuts, type BusbarDemand, type PickCheapest } from "./busbar-cutting";
import type { DeviceSpecWithId } from "./device-matching";
import { busbarPins, parseDeviceSpec } from "./device-spec";

/*
 * Property test for the busbar cutter (the plan's guardrail): whatever the catalog and the groups,
 * a segment never comes from a busbar below its group RCD's rated current, never from the wrong
 * phase count, a piece is never over-cut, and the plan is deterministic.
 */

const PINS_CHOICES = [12, 24, 54] as const;
const RATED_CHOICES = [16, 25, 40, 63] as const;

interface BusbarRow {
  poles: "1P" | "3P";
  rated: number;
  pins: number;
  price: number;
}

function toDevice(row: BusbarRow, index: number): DeviceSpecWithId {
  const id = `bb-${String(index)}`;
  const parsed = parseDeviceSpec({
    kind: "comb_busbar",
    name: id,
    manufacturer: "Alfa",
    model: id,
    price_grosze: row.price,
    width_mm: row.pins * 17.5,
    height_mm: 20,
    depth_mm: 20,
    poles: row.poles,
    rated_current_a: row.rated,
  });
  if (!parsed.ok) throw new Error(`fixture does not parse: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, id };
}

const pick: PickCheapest = (candidates) =>
  [...candidates].sort((a, b) => a.price_grosze - b.price_grosze || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).at(0) ??
  null;

const busbarRow = fc.record({
  poles: fc.constantFrom("1P", "3P"),
  rated: fc.constantFrom(...RATED_CHOICES),
  pins: fc.constantFrom(...PINS_CHOICES),
  price: fc.integer({ min: 100, max: 20_000 }),
});

const demandRow = fc.record({
  mcbCount: fc.integer({ min: 1, max: 8 }),
  phases: fc.constantFrom(1, 3),
  minRatedA: fc.constantFrom(...RATED_CHOICES),
  pins: fc.integer({ min: 3, max: 40 }),
});

const MAX_RAIL_MM = 45 * 17.5;

function toDemands(rows: readonly { mcbCount: number; phases: 1 | 3; minRatedA: number; pins: number }[]) {
  return rows.map((row, i): BusbarDemand => ({
    groupId: `g${String(i)}`,
    mcbCount: row.mcbCount,
    phases: row.phases,
    minRatedA: row.minRatedA,
    groupWidthMm: row.pins * 17.5,
  }));
}

describe("planBusbarCuts properties", () => {
  it("never takes an under-rated or wrong-phase busbar, and never over-cuts a piece", () => {
    fc.assert(
      fc.property(
        fc.array(busbarRow, { maxLength: 6 }),
        fc.array(demandRow, { maxLength: 8 }),
        (busbarRows, demandRows) => {
          const catalog = busbarRows.map(toDevice);
          const demands = toDemands(demandRows);
          const plan = planBusbarCuts(demands, catalog, MAX_RAIL_MM, pick);
          const byId = new Map(catalog.map((device) => [device.id, device]));
          const used = new Map<number, { deviceId: string; pins: number }>();
          for (const segment of plan.segments) {
            const demand = demands.find((d) => d.groupId === segment.groupId);
            const device = byId.get(segment.deviceId);
            if (demand === undefined || device?.kind !== "comb_busbar") {
              throw new Error("segment names an unknown group or device");
            }
            // The guardrail.
            expect(device.rated_current_a).toBeGreaterThanOrEqual(demand.minRatedA);
            expect(device.poles === "3P" ? 3 : 1).toBe(demand.phases);
            // A piece is one device, and its segments never exceed its length.
            const piece = used.get(segment.piece) ?? { deviceId: segment.deviceId, pins: 0 };
            expect(piece.deviceId).toBe(segment.deviceId);
            piece.pins += demandPins(demand.groupWidthMm);
            used.set(segment.piece, piece);
            expect(piece.pins).toBeLessThanOrEqual(busbarPins(device.width_mm));
          }
          // A group is cut or named in a reason, never both; only a single-MCB miss is silent.
          for (const demand of demands) {
            const cut = plan.segments.some((s) => s.groupId === demand.groupId);
            const reasoned = plan.reasons.some((r) => r.groupId === demand.groupId);
            expect(cut && reasoned).toBe(false);
            if (!cut && !reasoned) expect(demand.mcbCount).toBeLessThan(2);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(
        fc.array(busbarRow, { maxLength: 5 }),
        fc.array(demandRow, { maxLength: 6 }),
        (busbarRows, demandRows) => {
          const catalog = busbarRows.map(toDevice);
          const demands = toDemands(demandRows);
          expect(planBusbarCuts(demands, catalog, MAX_RAIL_MM, pick)).toEqual(
            planBusbarCuts(demands, [...catalog], MAX_RAIL_MM, pick),
          );
        },
      ),
      { numRuns: 100 },
    );
  });
});
