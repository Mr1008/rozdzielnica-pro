import { describe, expect, it } from "vitest";
import type { CircuitInput, RcdGroupInput } from "./circuit-params";
import { matchDevices, type DeviceSpecWithId, type MatchInput, type Selection } from "./device-matching";
import { parseDeviceSpec, polesCarryN } from "./device-spec";
import type { PricingProfile } from "./pricing-profile";
import { computeQuoteView, type QuoteInput } from "./quote";
import type { SupplyParams } from "./supply-params";

/*
 * Quote worked examples (test-plan risk #5, "the device count is the list length"): small projects run
 * through the real matcher into the quote, checked against a bill of materials counted by hand.
 * `quote.test.ts` proves the arithmetic on rows it writes itself; here the rows come from
 * `matchDevices`, so a matcher that emits a row too many or too few, or a quote that counts or prices
 * rows differently from what an electrician mounts and buys, fails.
 *
 * Every expected number is a literal worked out by hand from the PRD (`## Business Logic`: device count
 * × mount minutes + overhead = minutes; minutes × hourly rate = labour; catalog prices = material) and
 * the archived decisions: catalog PE/N bars are devices; each comb busbar segment is a device in labour
 * but a bought piece is priced once; the cabinet is its own material line, never a device; labour cost
 * rounds half-up in whole grosze. Nothing below re-derives a number through `quote.ts`.
 *
 * The only adapter is selection → quote row by catalog id, which is what the snapshot trigger copies.
 */

const common = { width_mm: 17.5, height_mm: 85, depth_mm: 70 };

function device(id: string, row: Record<string, unknown>): DeviceSpecWithId {
  const parsed = parseDeviceSpec({
    name: id,
    manufacturer: "Alfa",
    model: id,
    ...common,
    n_terminal_side: polesCarryN(row.poles) ? "left" : null,
    ...row,
  });
  if (!parsed.ok) throw new Error(`fixture ${id} does not parse: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, id };
}

const fr = (id: string, rated: number, price: number) =>
  device(id, { kind: "switch_disconnector", rated_current_a: rated, poles: "2P", width_mm: 35, price_grosze: price });
const mcb = (id: string, rated: number, price: number) =>
  device(id, { kind: "mcb_b", rated_current_a: rated, poles: "1P", breaking_capacity_ka: 6, price_grosze: price });
const rcd = (id: string, rated: number, type: string, price: number) =>
  device(id, {
    kind: "rcd",
    rated_current_a: rated,
    residual_current_ma: 30,
    rcd_type: type,
    poles: "2P",
    width_mm: 35,
    price_grosze: price,
  });
const rcbo = (id: string, rated: number, price: number) =>
  device(id, {
    kind: "rcbo",
    rated_current_a: rated,
    residual_current_ma: 30,
    rcd_type: "A",
    poles: "1P+N",
    breaking_capacity_ka: 6,
    width_mm: 35,
    price_grosze: price,
  });
const bar = (id: string, kind: "pe_bar" | "n_bar", terminals: number, price: number) =>
  device(id, { kind, terminal_groups: [{ count: terminals, minMm2: 1.5, maxMm2: 16 }], price_grosze: price });
const busbar = (id: string, rated: number, pins: number, price: number) =>
  device(id, {
    kind: "comb_busbar",
    poles: "1P",
    rated_current_a: rated,
    width_mm: pins * 17.5,
    height_mm: 20,
    depth_mm: 20,
    price_grosze: price,
  });

/**
 * The catalog. Prices in grosze. Each role has a cheaper device that fails the circuit, so a matcher
 * that priced before filtering would change both the bill and these totals.
 */
const FR_40 = fr("fr-40-2p", 40, 6_990); // 69,90 zł
const FR_20 = fr("fr-20-2p", 20, 3_990); // decoy: below the 25 A pre-meter protection
const RCD_63_A = rcd("rcd-63-a", 63, "A", 21_450); // 214,50 zł
const RCD_40_A = rcd("rcd-40-a", 40, "A", 15_900); // 159,00 zł
const RCD_63_AC = rcd("rcd-63-ac", 63, "AC", 13_900); // decoy: type AC below the required A
const B16 = mcb("b16", 16, 1_449); // 14,49 zł
const B10 = mcb("b10", 10, 1_399); // 13,99 zł
const B20 = mcb("b20", 20, 1_590); // 15,90 zł
const B13 = mcb("b13", 13, 999); // decoy: no circuit is 13 A
const RCBO_20 = rcbo("rcbo-20", 20, 12_900); // 129,00 zł
const RCBO_16 = rcbo("rcbo-16", 16, 9_900); // decoy: wrong In for the 20 A circuit
const PE_BAR = bar("pe-12", "pe_bar", 12, 2_290); // 22,90 zł
const N_BAR = bar("n-12", "n_bar", 12, 2_190); // 21,90 zł
const PE_BAR_SHORT = bar("pe-2", "pe_bar", 2, 990); // decoy: 2 terminals for 5 conductors
const BUSBAR_12 = busbar("busbar-63-12", 63, 12, 3_480); // 34,80 zł, 12 pins
const BUSBAR_6 = busbar("busbar-63-6", 63, 6, 1_990); // 19,90 zł, 6 pins
const BUSBAR_40_12 = busbar("busbar-40-12", 40, 12, 1_790); // decoy for the 63 A group: rated below its RCD

const BASE_CATALOG = [FR_40, FR_20, RCD_63_A, RCD_40_A, RCD_63_AC, B16, B10, B20, B13, RCBO_20, RCBO_16];

const SUPPLY: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-S",
  phase_count: 1,
  wlz_length_m: 10,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

function circuit(id: string, rated: CircuitInput["rated_current_a"], groupId: string): CircuitInput {
  return {
    id,
    rcd_group_id: groupId,
    name: id,
    rated_current_a: rated,
    phase_count: 1,
    cross_section_mm2: 2.5,
    installation: "conduit_flush",
    entry_side: "top",
  };
}

function group(id: string): RcdGroupInput {
  return { id, label: id, residual_current_ma: 30, min_rcd_type: "A", rcd_margin_percent: 15 };
}

/** 73,50 zł/h, 18 min per device, 75 min per project. 7 350 / 60 = 122,5 gr per minute. */
const PROFILE: PricingProfile = {
  hourly_rate_grosze: 7_350,
  mount_minutes_per_device: 18,
  project_overhead_minutes: 75,
};

/** A cabinet of 189,99 zł — its own material line, never a device. */
const CABINET = { name: "Szafka testowa", priceGrosze: 18_999 };

/**
 * Project A's circuits: group "kuchnia" of three circuits (16 + 16 + 10 = 42 A, × 1,15 = 48,3 A, so the
 * RCD must be ≥ 48,3 A: 63 A, not 40 A) and group "łazienka" of one 20 A circuit (an RCBO).
 */
const PROJECT_A_CIRCUITS = {
  groups: [group("kuchnia"), group("lazienka")],
  circuits: [
    circuit("k1", 16, "kuchnia"),
    circuit("k2", 16, "kuchnia"),
    circuit("k3", 10, "kuchnia"),
    circuit("l1", 20, "lazienka"),
  ],
};

function selectionsOf(input: MatchInput, catalog: readonly DeviceSpecWithId[]): Selection[] {
  const result = matchDevices(input, catalog);
  if (result.status !== "matched") throw new Error(`expected matched, got ${JSON.stringify(result)}`);
  return result.selections;
}

/** What the snapshot trigger copies: the catalog row behind each selection. */
function rowsOf(selections: readonly Selection[], catalog: readonly DeviceSpecWithId[]) {
  return selections.map((selection) => {
    const entry = catalog.find((d) => d.id === selection.deviceId);
    if (entry === undefined) throw new Error(`unknown device ${selection.deviceId}`);
    return {
      role: selection.role,
      device_id: entry.id,
      price_grosze: entry.price_grosze,
      busbar_piece: selection.busbarPiece,
    };
  });
}

function quote(
  input: MatchInput,
  catalog: readonly DeviceSpecWithId[],
  extra: Partial<Pick<QuoteInput, "profile" | "override">> = {},
) {
  const snapshot = rowsOf(selectionsOf(input, catalog), catalog);
  return {
    snapshot,
    view: computeQuoteView({
      matchView: { state: "current", snapshot },
      cabinet: CABINET,
      profile: PROFILE,
      override: null,
      ...extra,
    }),
  };
}

const devicesOf = (snapshot: readonly { device_id: string }[]) => snapshot.map((row) => row.device_id).sort();

describe("quote worked examples — a hand-counted bill of materials through the matcher", () => {
  /*
   * Project A — built-in PE and N bars, no busbars.
   *
   *   FR 40 A 2P                         6 990
   *   RCD 63 A 30 mA A ("kuchnia")      21 450
   *   B16 (k1)                           1 449
   *   B16 (k2)                           1 449
   *   B10 (k3)                           1 399
   *   RCBO 20 A ("łazienka", one circuit) 12 900
   *   ----------------------------------------
   *   6 devices                         45 637 gr
   *
   *   material = 45 637 + cabinet 18 999 = 64 636 gr
   *   minutes  = 6 × 18 + 75 = 183 (3 h 03 min)
   *   labour   = 183 × 7 350 / 60 = 1 345 050 / 60 = 22 417,5 gr → half-up 22 418 gr
   *   total    = 64 636 + 22 418 = 87 054 gr
   */
  const projectA: MatchInput = { supply: SUPPLY, ...PROJECT_A_CIRCUITS, cabinetBarKinds: ["PE", "N"] };

  it("A: one RCBO for a single-circuit group, built-in bars not counted — 6 devices", () => {
    const { snapshot, view } = quote(projectA, BASE_CATALOG);
    expect(devicesOf(snapshot)).toEqual(["b10", "b16", "b16", "fr-40-2p", "rcbo-20", "rcd-63-a"]);
    expect(view).toMatchObject({
      state: "ready",
      deviceCount: 6,
      devicesGrosze: 45_637,
      materialGrosze: 64_636,
      estimateMinutes: 183,
      labourMinutes: 183,
      labourGrosze: 22_418,
      totalGrosze: 87_054,
    });
  });

  /*
   * Project B — project A on a catalog with no 20 A RCBO: the single group becomes RCD + MCB.
   * The RCD needs ≥ 20 × 1,15 = 23 A, type A: 40 A at 15 900 (the 63 A AC is cheaper but type AC).
   *
   *   project A without the RCBO        45 637 − 12 900 = 32 737
   *   RCD 40 A 30 mA A ("łazienka")    15 900
   *   B20 (l1)                           1 590
   *   ----------------------------------------
   *   7 devices                         50 227 gr
   *
   *   material = 50 227 + 18 999 = 69 226 gr
   *   minutes  = 7 × 18 + 75 = 201
   *   labour   = 201 × 7 350 / 60 = 1 477 350 / 60 = 24 622,5 gr → 24 623 gr
   *   total    = 69 226 + 24 623 = 93 849 gr
   */
  it("B: the RCD + MCB fallback is two devices, not one — 7 devices", () => {
    const catalog = BASE_CATALOG.filter((d) => d !== RCBO_20);
    const { snapshot, view } = quote(projectA, catalog);
    expect(devicesOf(snapshot)).toEqual(["b10", "b16", "b16", "b20", "fr-40-2p", "rcd-40-a", "rcd-63-a"]);
    expect(view).toMatchObject({
      deviceCount: 7,
      devicesGrosze: 50_227,
      materialGrosze: 69_226,
      estimateMinutes: 201,
      labourGrosze: 24_623,
      totalGrosze: 93_849,
    });
  });

  /*
   * Project C — project A in a cabinet without built-in bars: a PE bar and an N bar from the catalog.
   * Each bar takes 5 conductors (four 2,5 mm² circuits + the 10 mm² WLZ), so the 2-terminal PE bar,
   * though cheaper, does not fit.
   *
   *   project A                         45 637
   *   PE bar, 12 terminals               2 290
   *   N bar, 12 terminals                2 190
   *   ----------------------------------------
   *   8 devices                         50 117 gr
   *
   *   material = 50 117 + 18 999 = 69 116 gr (the cabinet is still one line, not a device)
   *   minutes  = 8 × 18 + 75 = 219
   *   labour   = 219 × 7 350 / 60 = 1 609 650 / 60 = 26 827,5 gr → 26 828 gr
   *   total    = 69 116 + 26 828 = 95 944 gr
   */
  it("C: catalog PE and N bars are mounted devices — 8 devices", () => {
    const catalog = [...BASE_CATALOG, PE_BAR, N_BAR, PE_BAR_SHORT];
    const { snapshot, view } = quote({ ...projectA, cabinetBarKinds: [] }, catalog);
    expect(devicesOf(snapshot)).toEqual(["b10", "b16", "b16", "fr-40-2p", "n-12", "pe-12", "rcbo-20", "rcd-63-a"]);
    expect(view).toMatchObject({
      deviceCount: 8,
      devicesGrosze: 50_117,
      materialGrosze: 69_116,
      estimateMinutes: 219,
      labourGrosze: 26_828,
      totalGrosze: 95_944,
    });
  });

  /*
   * Project D — two multi-circuit groups fed by comb busbars, rails 210 mm (12 modules).
   *   "kuchnia": 16 + 16 + 10 A → RCD 63 A; width 35 + 3 × 17,5 = 87,5 mm = 5 pins.
   *   "pokoje":  16 + 10 A = 26 A × 1,15 = 29,9 A → RCD 40 A; width 35 + 2 × 17,5 = 70 mm = 4 pins.
   * A busbar must be rated at least its group's RCD, so the 40 A busbar cannot feed "kuchnia".
   *
   *   FR 40 A 2P                         6 990
   *   RCD 63 A + B16 + B16 + B10        21 450 + 1 449 + 1 449 + 1 399 = 25 747
   *   RCD 40 A + B16 + B10              15 900 + 1 449 + 1 399 = 18 748
   *   devices without busbars: 8         51 485
   *
   * Profile here: 73,33 zł/h (7 333 gr), so the labour cost rounds down.
   */
  const projectD: MatchInput = {
    supply: SUPPLY,
    groups: [group("kuchnia"), group("pokoje")],
    circuits: [
      circuit("k1", 16, "kuchnia"),
      circuit("k2", 16, "kuchnia"),
      circuit("k3", 10, "kuchnia"),
      circuit("p1", 16, "pokoje"),
      circuit("p2", 10, "pokoje"),
    ],
    cabinetBarKinds: ["PE", "N"],
    maxRailMm: 12 * 17.5,
  };
  const profileD: PricingProfile = { ...PROFILE, hourly_rate_grosze: 7_333 };

  /*
   * D1 — one 12-pin busbar is bought (5 pins for "kuchnia"); "pokoje" (4 pins) is cut from the 7 left.
   *   10 devices: 8 + 2 segments; material prices the one piece once.
   *   devices  = 51 485 + 3 480 = 54 965 gr; material = 54 965 + 18 999 = 73 964 gr
   *   minutes  = 10 × 18 + 75 = 255
   *   labour   = 255 × 7 333 / 60 = 1 869 915 / 60 = 31 165,25 gr → 31 165 gr
   *   total    = 73 964 + 31 165 = 105 129 gr
   */
  it("D1: two busbar segments from one piece — both counted in labour, the piece priced once", () => {
    const catalog = [...BASE_CATALOG, BUSBAR_12, BUSBAR_40_12];
    const { snapshot, view } = quote(projectD, catalog, { profile: profileD });
    expect(snapshot.filter((row) => row.role === "busbar")).toEqual([
      { role: "busbar", device_id: "busbar-63-12", price_grosze: 3_480, busbar_piece: 0 },
      { role: "busbar", device_id: "busbar-63-12", price_grosze: 3_480, busbar_piece: 0 },
    ]);
    expect(view).toMatchObject({
      deviceCount: 10,
      devicesGrosze: 54_965,
      materialGrosze: 73_964,
      estimateMinutes: 255,
      labourGrosze: 31_165,
      totalGrosze: 105_129,
    });
  });

  /*
   * D2 — only a 6-pin busbar: "kuchnia" takes 5 pins of piece 0, the 1 pin left cannot hold "pokoje"
   * (4 pins), so a second piece is bought.
   *   devices  = 51 485 + 2 × 1 990 = 55 465 gr; material = 55 465 + 18 999 = 74 464 gr
   *   minutes and labour as D1: 255 min, 31 165 gr; total = 74 464 + 31 165 = 105 629 gr
   */
  it("D2: two busbar segments from two pieces — both pieces priced", () => {
    const catalog = [...BASE_CATALOG, BUSBAR_6];
    const { snapshot, view } = quote(projectD, catalog, { profile: profileD });
    expect(snapshot.filter((row) => row.role === "busbar").map((row) => row.busbar_piece)).toEqual([0, 1]);
    expect(view).toMatchObject({
      deviceCount: 10,
      devicesGrosze: 55_465,
      materialGrosze: 74_464,
      estimateMinutes: 255,
      labourGrosze: 31_165,
      totalGrosze: 105_629,
    });
  });
});

describe("quote worked examples — profile and override on project A", () => {
  const projectA: MatchInput = { supply: SUPPLY, ...PROJECT_A_CIRCUITS, cabinetBarKinds: ["PE", "N"] };

  it("blocks without a pricing profile — no invented defaults", () => {
    expect(quote(projectA, BASE_CATALOG, { profile: null }).view).toEqual({ state: "no_profile" });
  });

  /*
   * The electrician overrides 3 h 03 min with 3 h 00 min = 180 min, set against today's estimate (183).
   *   labour = 180 × 7 350 / 60 = 22 050 gr exactly; total = 64 636 + 22 050 = 86 686 gr
   */
  it("an override replaces the estimate in the labour cost", () => {
    const { view } = quote(projectA, BASE_CATALOG, { override: { minutes: 180, baseMinutes: 183 } });
    expect(view).toMatchObject({
      estimateMinutes: 183,
      override: { minutes: 180, baseMinutes: 183, outdated: false },
      labourMinutes: 180,
      labourGrosze: 22_050,
      totalGrosze: 86_686,
    });
  });

  /*
   * The profile's mount time then changes to 20 min: today's estimate is 6 × 20 + 75 = 195 ≠ 183, so
   * the override is outdated — and still used: labour stays 22 050 gr.
   */
  it("a profile change makes the override outdated, and it still sets the labour", () => {
    const profile = { ...PROFILE, mount_minutes_per_device: 20 };
    const { view } = quote(projectA, BASE_CATALOG, { profile, override: { minutes: 180, baseMinutes: 183 } });
    expect(view).toMatchObject({
      estimateMinutes: 195,
      override: { minutes: 180, baseMinutes: 183, outdated: true },
      labourMinutes: 180,
      labourGrosze: 22_050,
    });
  });
});
