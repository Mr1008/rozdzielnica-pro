import { describe, expect, it } from "vitest";
import type { MatchViewState, SnapshotRow } from "./device-matching-server";
import type { PricingProfile } from "./pricing-profile";
import {
  computeQuoteView,
  estimateLabourMinutes,
  labourCostGrosze,
  MAX_LABOUR_OVERRIDE_HOURS,
  MAX_LABOUR_OVERRIDE_MINUTES,
  MIN_LABOUR_OVERRIDE_MINUTES,
  parseLabourOverrideForm,
  QUOTE_FIELDS,
  RATE_WARNING_THRESHOLD_GROSZE,
  rateWarning,
  splitMinutes,
  type QuoteInput,
} from "./quote";

/**
 * Every expected number below is worked out by hand in grosze and whole minutes — never re-derived
 * through the module's own formula (test-plan risk #5). The running example: 11 devices × 15 min +
 * 90 min = 255 min (4 h 15 min); at 120,50 zł/h that is 255 × 12 050 / 60 = 51 212,5 gr → 51 213 gr.
 */

const PROFILE: PricingProfile = {
  hourly_rate_grosze: 12_050,
  mount_minutes_per_device: 15,
  project_overhead_minutes: 90,
};

/** A cabinet of 249,99 zł. */
const CABINET = { name: "Szafka testowa", priceGrosze: 24_999 };

type Row = Pick<SnapshotRow, "role" | "price_grosze" | "device_id" | "busbar_piece">;

/** 11 MCBs at 10,00 zł each: 11 000 gr. */
const ELEVEN_DEVICES: Row[] = Array.from({ length: 11 }, () => ({
  role: "mcb",
  price_grosze: 1_000,
  device_id: "mcb-b16",
  busbar_piece: null,
}));

function input(overrides: Partial<QuoteInput> = {}, state: MatchViewState = "current", rows = ELEVEN_DEVICES) {
  return {
    matchView: { state, snapshot: rows },
    cabinet: CABINET,
    profile: PROFILE,
    override: null,
    ...overrides,
  } satisfies QuoteInput;
}

describe("override bounds", () => {
  it("match the projects_labour_override_range CHECK", () => {
    expect([MIN_LABOUR_OVERRIDE_MINUTES, MAX_LABOUR_OVERRIDE_HOURS, MAX_LABOUR_OVERRIDE_MINUTES]).toEqual([
      1, 999, 59_999,
    ]);
  });
});

describe("estimateLabourMinutes", () => {
  it("is device count × mount minutes + overhead", () => {
    expect(estimateLabourMinutes(11, PROFILE)).toBe(255);
    expect(estimateLabourMinutes(0, PROFILE)).toBe(90);
  });
});

describe("labourCostGrosze", () => {
  it.each([
    { minutes: 255, rate: 12_050, expected: 51_213 }, // 51 212,5 gr → up
    { minutes: 125, rate: 12_050, expected: 25_104 }, // 25 104,17 gr → down
    { minutes: 270, rate: 12_050, expected: 54_225 }, // exact
    { minutes: 1, rate: 1, expected: 0 }, // 0,0167 gr → down
    { minutes: 1, rate: 30, expected: 1 }, // 0,5 gr → up
    { minutes: 59_999, rate: 2_147_483_647, expected: 2_147_447_855_606 }, // 2 147 447 855 605,88 gr → up; int4 rate, still exact
  ])("$minutes min at $rate gr/h → $expected gr", ({ minutes, rate, expected }) => {
    expect(labourCostGrosze(minutes, rate)).toBe(expected);
  });
});

describe("splitMinutes", () => {
  it("splits into whole hours and the remaining minutes", () => {
    expect(splitMinutes(255)).toEqual({ hours: 4, minutes: 15 });
    expect(splitMinutes(59)).toEqual({ hours: 0, minutes: 59 });
    expect(splitMinutes(60)).toEqual({ hours: 1, minutes: 0 });
    expect(splitMinutes(59_999)).toEqual({ hours: 999, minutes: 59 });
  });
});

describe("rateWarning", () => {
  it("warns only above 500 zł/h — equality never warns", () => {
    expect(RATE_WARNING_THRESHOLD_GROSZE).toBe(50_000);
    expect(rateWarning(50_000)).toBe(false);
    expect(rateWarning(50_001)).toBe(true);
  });
});

describe("computeQuoteView", () => {
  it("quotes material and labour for a current match with the estimate", () => {
    expect(computeQuoteView(input())).toEqual({
      state: "ready",
      deviceCount: 11,
      devicesGrosze: 11_000,
      cabinet: { name: "Szafka testowa", priceGrosze: 24_999 },
      materialGrosze: 35_999,
      mountMinutesPerDevice: 15,
      overheadMinutes: 90,
      estimateMinutes: 255,
      override: null,
      labourMinutes: 255,
      rateGrosze: 12_050,
      labourGrosze: 51_213,
      totalGrosze: 87_212,
      rateWarning: false,
    });
  });

  it("sums mixed device prices on top of the cabinet", () => {
    const rows: Row[] = [
      { role: "main_switch", price_grosze: 4_999, device_id: "main_switch", busbar_piece: null },
      { role: "rcd", price_grosze: 12_000, device_id: "rcd", busbar_piece: null },
      { role: "mcb", price_grosze: 1_250, device_id: "mcb", busbar_piece: null },
    ];
    const view = computeQuoteView(input({}, "current", rows));
    expect(view).toMatchObject({ deviceCount: 3, devicesGrosze: 18_249, materialGrosze: 43_248 });
  });

  it("counts and prices catalog PE/N bars like any device", () => {
    const rows: Row[] = [
      { role: "mcb", price_grosze: 1_000, device_id: "mcb", busbar_piece: null },
      { role: "pe_bar", price_grosze: 3_500, device_id: "pe_bar", busbar_piece: null },
      { role: "n_bar", price_grosze: 3_500, device_id: "n_bar", busbar_piece: null },
    ];
    // 3 × 15 + 90 = 135 min; 135 × 12 050 / 60 = 27 112,5 gr → 27 113 gr.
    expect(computeQuoteView(input({}, "current", rows))).toMatchObject({
      deviceCount: 3,
      devicesGrosze: 8_000,
      materialGrosze: 32_999,
      estimateMinutes: 135,
      labourGrosze: 27_113,
      totalGrosze: 60_112,
    });
  });

  it("prices a busbar piece once however many segments it feeds, and counts every segment in labour", () => {
    // Two segments cut from piece 0 (one 50,00 zł busbar) and one from a second piece of the same
    // model: 2 pieces = 10 000 gr. Hand-worked: 1 000 + 5 000 + 5 000 = 11 000 gr; 4 rows × 15 + 90 = 150 min.
    const rows: Row[] = [
      { role: "mcb", price_grosze: 1_000, device_id: "mcb-b16", busbar_piece: null },
      { role: "busbar", price_grosze: 5_000, device_id: "busbar-1f", busbar_piece: 0 },
      { role: "busbar", price_grosze: 5_000, device_id: "busbar-1f", busbar_piece: 0 },
      { role: "busbar", price_grosze: 5_000, device_id: "busbar-1f", busbar_piece: 1 },
    ];
    expect(computeQuoteView(input({}, "current", rows))).toMatchObject({
      deviceCount: 4,
      devicesGrosze: 11_000,
      materialGrosze: 35_999,
      estimateMinutes: 150,
    });
  });

  it("prices two different busbar models sharing a piece number separately", () => {
    const rows: Row[] = [
      { role: "busbar", price_grosze: 5_000, device_id: "busbar-1f", busbar_piece: 0 },
      { role: "busbar", price_grosze: 9_000, device_id: "busbar-3f", busbar_piece: 0 },
    ];
    expect(computeQuoteView(input({}, "current", rows))).toMatchObject({ deviceCount: 2, devicesGrosze: 14_000 });
  });

  it("blocks on a missing profile first, even when the match is not current", () => {
    expect(computeQuoteView(input({ profile: null }, "stale"))).toEqual({ state: "no_profile" });
    expect(computeQuoteView(input({ profile: null }))).toEqual({ state: "no_profile" });
  });

  it.each(["stale", "cleared", "gaps", "blocked"] as const)("blocks a %s match as not_current", (state) => {
    expect(computeQuoteView(input({}, state))).toEqual({ state: "not_current" });
  });

  it("uses an override set against today's estimate, not outdated", () => {
    expect(computeQuoteView(input({ override: { minutes: 270, baseMinutes: 255 } }))).toMatchObject({
      estimateMinutes: 255,
      override: { minutes: 270, baseMinutes: 255, outdated: false },
      labourMinutes: 270,
      labourGrosze: 54_225,
      totalGrosze: 90_224,
    });
  });

  it("flags an override whose base differs from today's estimate, and still uses it", () => {
    expect(computeQuoteView(input({ override: { minutes: 270, baseMinutes: 240 } }))).toMatchObject({
      estimateMinutes: 255,
      override: { minutes: 270, baseMinutes: 240, outdated: true },
      labourMinutes: 270,
      labourGrosze: 54_225,
    });
  });

  it("falls back to the estimate once the override is cleared", () => {
    expect(computeQuoteView(input({ override: null }))).toMatchObject({ labourMinutes: 255, labourGrosze: 51_213 });
  });

  it("carries the rate warning", () => {
    const profile = { ...PROFILE, hourly_rate_grosze: 60_000 };
    // 255 × 60 000 / 60 = 255 000 gr exactly.
    expect(computeQuoteView(input({ profile }))).toMatchObject({ rateWarning: true, labourGrosze: 255_000 });
  });
});

describe("parseLabourOverrideForm", () => {
  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  }
  const set = (hours: string, minutes: string) =>
    form({ [QUOTE_FIELDS.intent]: "set", [QUOTE_FIELDS.hours]: hours, [QUOTE_FIELDS.minutes]: minutes });

  it("uses the agreed field names", () => {
    expect(QUOTE_FIELDS).toEqual({ intent: "intent", hours: "labour_hours", minutes: "labour_minutes" });
  });

  it.each([
    { hours: "4", minutes: "30", expected: 270 },
    { hours: "0", minutes: "1", expected: 1 },
    { hours: "999", minutes: "59", expected: 59_999 },
    { hours: " 4 ", minutes: "30.0", expected: 270 },
  ])("accepts $hours h $minutes min → $expected min", ({ hours, minutes, expected }) => {
    expect(parseLabourOverrideForm(set(hours, minutes))).toEqual({ ok: true, intent: "set", minutes: expected });
  });

  it.each([
    ["0", "0"],
    ["1000", "0"],
    ["1", "60"],
    ["-1", "0"],
    ["0", "-1"],
    ["1,5", "0"],
    ["1.5", "0"],
    ["1e2", "0"],
    ["", "30"],
    ["4", ""],
  ])("rejects %s h %s min", (hours, minutes) => {
    expect(parseLabourOverrideForm(set(hours, minutes))).toEqual({ ok: false, code: "invalid_input" });
  });

  it("rejects a missing field, a missing intent and an unknown intent", () => {
    const invalid = { ok: false, code: "invalid_input" };
    expect(parseLabourOverrideForm(form({ [QUOTE_FIELDS.intent]: "set", [QUOTE_FIELDS.hours]: "4" }))).toEqual(invalid);
    expect(parseLabourOverrideForm(form({ [QUOTE_FIELDS.hours]: "4", [QUOTE_FIELDS.minutes]: "30" }))).toEqual(invalid);
    expect(
      parseLabourOverrideForm(
        form({ [QUOTE_FIELDS.intent]: "delete", [QUOTE_FIELDS.hours]: "4", [QUOTE_FIELDS.minutes]: "30" }),
      ),
    ).toEqual(invalid);
  });

  it("clears regardless of the hours and minutes fields", () => {
    const clear = { ok: true, intent: "clear" };
    expect(parseLabourOverrideForm(form({ [QUOTE_FIELDS.intent]: "clear" }))).toEqual(clear);
    expect(
      parseLabourOverrideForm(
        form({ [QUOTE_FIELDS.intent]: "clear", [QUOTE_FIELDS.hours]: "-1", [QUOTE_FIELDS.minutes]: "abc" }),
      ),
    ).toEqual(clear);
  });
});
