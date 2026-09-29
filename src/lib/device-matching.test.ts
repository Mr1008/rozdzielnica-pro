import { describe, expect, it } from "vitest";
import {
  CIRCUIT_RATED_CURRENTS_A,
  RESIDUAL_CURRENTS_MA,
  type CircuitInput,
  type RcdGroupInput,
} from "./circuit-params";
import {
  activeCatalog,
  blockReasonMessage,
  catalogGapMessage,
  matchDevices,
  rcdTypeRank,
  sameSelection,
  selectionNoteMessage,
  selectionRoleLabel,
  type BlockReason,
  type CatalogGap,
  type DeviceSpecWithId,
  type MatchInput,
  type MatchResult,
  type Selection,
} from "./device-matching";
import { parseDeviceSpec, POLES_BY_KIND, RCD_TYPES } from "./device-spec";
import { PREMETER_PROTECTIONS_A, type SupplyParams } from "./supply-params";

const common = { width_mm: 17.5, height_mm: 85, depth_mm: 70 };

function device(id: string, row: Record<string, unknown>): DeviceSpecWithId {
  const parsed = parseDeviceSpec({
    name: id,
    manufacturer: "Alfa",
    model: id,
    price_grosze: 1000,
    ...common,
    ...row,
  });
  if (!parsed.ok) throw new Error(`fixture ${id} does not parse: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, id };
}

const fr = (id: string, rated: number, poles: string, extra: Record<string, unknown> = {}) =>
  device(id, { kind: "switch_disconnector", rated_current_a: rated, poles, ...extra });
const mcb = (id: string, rated: number, poles: string, extra: Record<string, unknown> = {}) =>
  device(id, { kind: "mcb_b", rated_current_a: rated, poles, breaking_capacity_ka: 6, ...extra });
const rcd = (id: string, rated: number, ma: number, type: string, poles: string, extra: Record<string, unknown> = {}) =>
  device(id, { kind: "rcd", rated_current_a: rated, residual_current_ma: ma, rcd_type: type, poles, ...extra });
const rcbo = (
  id: string,
  rated: number,
  ma: number,
  type: string,
  poles: string,
  extra: Record<string, unknown> = {},
) =>
  device(id, {
    kind: "rcbo",
    rated_current_a: rated,
    residual_current_ma: ma,
    rcd_type: type,
    poles,
    breaking_capacity_ka: 6,
    ...extra,
  });

const TN_S_1F: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-S",
  phase_count: 1,
  wlz_length_m: 10,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};
const TN_C_S_3F: SupplyParams = { ...TN_S_1F, earthing_system: "TN-C-S", phase_count: 3 };
const TN_C_1F: SupplyParams = { ...TN_S_1F, earthing_system: "TN-C" };
const TN_C_3F: SupplyParams = { ...TN_S_1F, earthing_system: "TN-C", phase_count: 3 };

function circuit(id: string, rated: CircuitInput["rated_current_a"], extra: Partial<CircuitInput> = {}): CircuitInput {
  return {
    id,
    rcd_group_id: null,
    name: id,
    rated_current_a: rated,
    phase_count: 1,
    cross_section_mm2: 2.5,
    installation: "conduit_flush",
    entry_side: "top",
    ...extra,
  };
}

function group(id: string, extra: Partial<RcdGroupInput> = {}): RcdGroupInput {
  return { id, label: id, residual_current_ma: 30, min_rcd_type: "A", ...extra };
}

/** A catalog with one of everything a simple single-phase TN-S project needs. */
const BASE: DeviceSpecWithId[] = [
  fr("fr-40-2p", 40, "2P"),
  fr("fr-40-4p", 40, "4P"),
  mcb("b10-1p", 10, "1P"),
  mcb("b16-1p", 16, "1P"),
  mcb("b20-1p", 20, "1P"),
  rcd("rcd-40-30-a-2p", 40, 30, "A", "2P"),
];

function matched(result: MatchResult): Selection[] {
  if (result.status !== "matched") throw new Error(`expected matched, got ${JSON.stringify(result)}`);
  return result.selections;
}
function gapsOf(result: MatchResult): CatalogGap[] {
  if (result.status !== "gaps") throw new Error(`expected gaps, got ${JSON.stringify(result)}`);
  return result.gaps;
}
function reasonsOf(result: MatchResult): BlockReason[] {
  if (result.status !== "blocked") throw new Error(`expected blocked, got ${JSON.stringify(result)}`);
  return result.reasons;
}
function deviceFor(selections: Selection[], role: Selection["role"], key: { circuitId?: string; groupId?: string }) {
  return selections.find(
    (s) =>
      s.role === role &&
      (key.circuitId === undefined || s.circuitId === key.circuitId) &&
      (key.groupId === undefined || s.groupId === key.groupId),
  )?.deviceId;
}

const ungrouped = (supply: SupplyParams | null, circuits: CircuitInput[]): MatchInput => ({
  supply,
  groups: [],
  circuits,
});

describe("rcdTypeRank", () => {
  it("orders AC < A < F < B", () => {
    expect(rcdTypeRank("AC")).toBeLessThan(rcdTypeRank("A"));
    expect(rcdTypeRank("A")).toBeLessThan(rcdTypeRank("F"));
    expect(rcdTypeRank("F")).toBeLessThan(rcdTypeRank("B"));
  });
});

describe("matchDevices — blockers", () => {
  it("blocks on a null supply without matching", () => {
    expect(reasonsOf(matchDevices(ungrouped(null, [circuit("c1", 16)]), BASE))).toEqual([{ code: "supply_missing" }]);
  });

  it("blocks with no circuits", () => {
    expect(reasonsOf(matchDevices(ungrouped(TN_S_1F, []), BASE))).toEqual([{ code: "no_circuits" }]);
  });

  it("collects every applicable reason; supply_missing skips the supply-dependent ones", () => {
    expect(reasonsOf(matchDevices(ungrouped(null, []), BASE))).toEqual([
      { code: "supply_missing" },
      { code: "no_circuits" },
    ]);
    const threePhase = circuit("c3", 16, { phase_count: 3 });
    expect(reasonsOf(matchDevices(ungrouped(null, [threePhase]), BASE))).toEqual([{ code: "supply_missing" }]);
  });

  it("blocks TN-C with a group that has a circuit", () => {
    const input: MatchInput = {
      supply: TN_C_1F,
      groups: [group("g1")],
      circuits: [circuit("c1", 16, { rcd_group_id: "g1" })],
    };
    expect(reasonsOf(matchDevices(input, BASE))).toEqual([{ code: "tn_c_with_rcd" }]);
  });

  it("does not block TN-C for an empty group", () => {
    const input: MatchInput = { supply: TN_C_1F, groups: [group("g1")], circuits: [circuit("c1", 16)] };
    expect(matchDevices(input, [fr("fr-1p", 40, "1P"), mcb("b16", 16, "1P")]).status).toBe("matched");
  });

  it("blocks each three-phase circuit on a single-phase supply", () => {
    const input = ungrouped(TN_S_1F, [
      circuit("c1", 16, { phase_count: 3, name: "Piec" }),
      circuit("c2", 16),
      circuit("c3", 20, { phase_count: 3, name: "Pompa" }),
    ]);
    expect(reasonsOf(matchDevices(input, BASE))).toEqual([
      { code: "circuit_phase_exceeds_supply", circuitId: "c1", circuitName: "Piec" },
      { code: "circuit_phase_exceeds_supply", circuitId: "c3", circuitName: "Pompa" },
    ]);
  });

  it("blocks a circuit that points at a group that does not exist, instead of dropping its RCD", () => {
    const input = ungrouped(TN_S_1F, [circuit("c1", 16, { rcd_group_id: "ghost", name: "Łazienka" })]);
    expect(reasonsOf(matchDevices(input, BASE))).toEqual([
      { code: "circuit_group_unknown", circuitId: "c1", circuitName: "Łazienka" },
    ]);
  });
});

describe("matchDevices — MCB", () => {
  it("never picks a B20 for a B16 circuit, even when the B20 is cheaper", () => {
    const catalog = [
      fr("fr", 40, "2P"),
      mcb("b20", 20, "1P", { price_grosze: 100 }),
      mcb("b16", 16, "1P", { price_grosze: 5000 }),
    ];
    const selections = matched(matchDevices(ungrouped(TN_S_1F, [circuit("c1", 16)]), catalog));
    expect(deviceFor(selections, "mcb", { circuitId: "c1" })).toBe("b16");
  });

  it("the cheaper B16 from the second manufacturer wins", () => {
    const catalog = [
      fr("fr", 40, "2P"),
      mcb("alfa-b16", 16, "1P", { manufacturer: "Alfa", price_grosze: 1590 }),
      mcb("beta-b16", 16, "1P", { manufacturer: "Beta", price_grosze: 1290 }),
    ];
    const selections = matched(matchDevices(ungrouped(TN_S_1F, [circuit("c1", 16)]), catalog));
    expect(deviceFor(selections, "mcb", { circuitId: "c1" })).toBe("beta-b16");
  });

  it("a B40 circuit with only B32 and B50 in the catalog is a gap, never a B32 or B50", () => {
    const catalog = [fr("fr", 40, "2P"), mcb("b32", 32, "1P"), mcb("b50", 50, "1P")];
    const gaps = gapsOf(matchDevices(ungrouped(TN_S_1F, [circuit("c1", 40, { name: "Piekarnik" })]), catalog));
    expect(gaps).toEqual([
      {
        role: "mcb",
        kind: "mcb_b",
        poles: ["1P", "1P+N", "2P"],
        ratedCurrentA: 40,
        groupId: null,
        circuitId: "c1",
        circuitName: "Piekarnik",
        fallback: false,
      },
    ]);
  });

  it("accepts only 1P in TN-C for a single-phase circuit (a catalog with only 1P+N is a gap)", () => {
    const catalog = [fr("fr", 40, "1P"), mcb("b16-1pn", 16, "1P+N"), mcb("b16-2p", 16, "2P")];
    const gaps = gapsOf(matchDevices(ungrouped(TN_C_1F, [circuit("c1", 16)]), catalog));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ role: "mcb", poles: ["1P"] });
    const withOneP = [...catalog, mcb("b16-1p", 16, "1P", { price_grosze: 9999 })];
    expect(deviceFor(matched(matchDevices(ungrouped(TN_C_1F, [circuit("c1", 16)]), withOneP)), "mcb", {})).toBe(
      "b16-1p",
    );
  });

  it("accepts only 3P in TN-C for a three-phase circuit", () => {
    const catalog = [fr("fr", 40, "3P"), mcb("b16-4p", 16, "4P", { price_grosze: 1 }), mcb("b16-3p", 16, "3P")];
    const selections = matched(matchDevices(ungrouped(TN_C_3F, [circuit("c1", 16, { phase_count: 3 })]), catalog));
    expect(deviceFor(selections, "mcb", {})).toBe("b16-3p");
  });

  it("never uses a single-pole MCB for a three-phase circuit", () => {
    const catalog = [fr("fr", 40, "4P"), mcb("b16-1p", 16, "1P")];
    expect(
      gapsOf(matchDevices(ungrouped(TN_C_S_3F, [circuit("c1", 16, { phase_count: 3 })]), catalog))[0],
    ).toMatchObject({
      role: "mcb",
      poles: ["3P", "3P+N", "4P"],
    });
  });

  it("gives an ungrouped circuit a no_rcd note", () => {
    const selections = matched(matchDevices(ungrouped(TN_S_1F, [circuit("c1", 16)]), BASE));
    expect(selections.find((s) => s.role === "mcb")?.notes).toEqual(["no_rcd"]);
  });
});

describe("matchDevices — main switch (FR)", () => {
  const c1 = [circuit("c1", 16)];
  const mcbs3 = [mcb("b16-3p", 16, "3P"), mcb("b16-1p", 16, "1P")];

  it("requires In ≥ the pre-meter protection", () => {
    const catalog = [
      fr("fr-20", 20, "2P", { price_grosze: 1 }),
      fr("fr-25", 25, "2P", { price_grosze: 500 }),
      ...BASE.slice(2),
    ];
    expect(deviceFor(matched(matchDevices(ungrouped(TN_S_1F, c1), catalog)), "main_switch", {})).toBe("fr-25");
    const tooSmall = [fr("fr-20", 20, "2P"), ...BASE.slice(2)];
    expect(gapsOf(matchDevices(ungrouped(TN_S_1F, c1), tooSmall))).toEqual([
      { role: "main_switch", kind: "switch_disconnector", poles: ["2P"], minRatedCurrentA: 25 },
    ]);
  });

  it.each([
    ["single-phase TN-S", TN_S_1F, "2P"],
    ["single-phase TN-C", TN_C_1F, "1P"],
    ["three-phase TN-C-S", TN_C_S_3F, "4P"],
    ["three-phase TN-C", TN_C_3F, "3P"],
  ] as const)("picks the %s pole configuration", (_label, supply, poles) => {
    const catalog = [
      fr("fr-1p", 40, "1P", { price_grosze: 100 }),
      fr("fr-2p", 40, "2P", { price_grosze: 200 }),
      fr("fr-3p", 40, "3P", { price_grosze: 300 }),
      fr("fr-4p", 40, "4P", { price_grosze: 400 }),
      ...mcbs3,
    ];
    const selections = matched(matchDevices(ungrouped(supply, c1), catalog));
    expect(deviceFor(selections, "main_switch", {})).toBe(`fr-${poles.toLowerCase()}`);
  });

  describe("never uses an FR as circuit, RCD or RCBO protection", () => {
    const frs = [
      fr("fr-16-1p", 16, "1P", { price_grosze: 1 }),
      fr("fr-16-2p", 16, "2P", { price_grosze: 1 }),
      fr("fr-40-2p", 40, "2P"),
      fr("fr-40-4p", 40, "4P", { price_grosze: 1 }),
    ];
    const input: MatchInput = {
      supply: TN_S_1F,
      groups: [group("g1"), group("g2")],
      circuits: [
        circuit("a", 16, { rcd_group_id: "g1" }),
        circuit("b", 16, { rcd_group_id: "g1" }),
        circuit("c", 16, { rcd_group_id: "g2" }),
        circuit("d", 16),
      ],
    };
    /** The rule table's kind per role, written out here — never read from the matcher. */
    const KIND_FOR_ROLE = { main_switch: "switch_disconnector", rcd: "rcd", rcbo: "rcbo", mcb: "mcb_b" } as const;

    it("with only FRs in the catalog, every protection role is a gap and the main switch is not", () => {
      const roles = gapsOf(matchDevices(input, frs)).map((gap) => gap.role);
      expect(roles).not.toContain("main_switch");
      // Order-independent: two MCBs in g1, one RCBO for g2 (single circuit), one ungrouped MCB, and
      // RCD + MCB fallback gaps for g2's missing RCBO.
      expect([...roles].sort()).toEqual(["mcb", "mcb", "mcb", "mcb", "rcbo", "rcd", "rcd"]);
    });

    it("in a matched result an FR appears only as the main switch, and each role has its own kind", () => {
      // Cheap FRs rated 16 A sit next to pricier compliant protection devices: price must not pull
      // an FR into any protection role.
      const catalog = [
        ...frs,
        rcd("rcd-40-30-a-2p", 40, 30, "A", "2P", { price_grosze: 5000 }),
        rcbo("rcbo-16-30-a-1pn", 16, 30, "A", "1P+N", { price_grosze: 5000 }),
        mcb("b16-1p", 16, "1P", { price_grosze: 5000 }),
      ];
      const selections = matched(matchDevices(input, catalog));
      const kindOf = new Map(catalog.map((d) => [d.id, d.kind]));
      expect(selections.length).toBeGreaterThan(0);
      for (const selection of selections) {
        const kind = kindOf.get(selection.deviceId);
        expect(kind).toBe(KIND_FOR_ROLE[selection.role]);
        expect(selection.role === "main_switch").toBe(kind === "switch_disconnector");
      }
      expect(new Set(selections.map((s) => s.role))).toEqual(new Set(["main_switch", "rcd", "rcbo", "mcb"]));
    });
  });
});

describe("matchDevices — group RCD", () => {
  const twoCircuits = (extra: Partial<CircuitInput> = {}): MatchInput => ({
    supply: TN_S_1F,
    groups: [group("g1")],
    circuits: [circuit("c1", 16, { rcd_group_id: "g1" }), circuit("c2", 20, { rcd_group_id: "g1", ...extra })],
  });

  it("never picks a type AC RCD when type A is required", () => {
    const catalog = [
      ...BASE.filter((d) => d.kind !== "rcd"),
      rcd("ac", 40, 30, "AC", "2P", { price_grosze: 1 }),
      rcd("a", 40, 30, "A", "2P"),
    ];
    expect(deviceFor(matched(matchDevices(twoCircuits(), catalog)), "rcd", { groupId: "g1" })).toBe("a");
  });

  it("accepts a higher type than the minimum", () => {
    const catalog = [...BASE.filter((d) => d.kind !== "rcd"), rcd("f", 40, 30, "F", "2P")];
    expect(deviceFor(matched(matchDevices(twoCircuits(), catalog)), "rcd", { groupId: "g1" })).toBe("f");
  });

  it("requires IΔn exactly — a 100 mA RCD is never used for a 30 mA group", () => {
    const catalog = [
      ...BASE.filter((d) => d.kind !== "rcd"),
      rcd("100", 40, 100, "A", "2P"),
      rcd("10", 40, 10, "A", "2P"),
    ];
    expect(gapsOf(matchDevices(twoCircuits(), catalog))).toEqual([
      {
        role: "rcd",
        kind: "rcd",
        poles: ["2P", "4P"],
        minRatedCurrentA: 20,
        residualCurrentMa: 30,
        minRcdType: "A",
        groupId: "g1",
        groupLabel: "g1",
        fallback: false,
      },
    ]);
  });

  it("rejects an RCD whose In is below the largest MCB in the group", () => {
    const catalog = [
      ...BASE.filter((d) => d.kind !== "rcd"),
      rcd("16", 16, 30, "A", "2P", { price_grosze: 1 }),
      rcd("25", 25, 30, "A", "2P"),
    ];
    expect(deviceFor(matched(matchDevices(twoCircuits(), catalog)), "rcd", { groupId: "g1" })).toBe("25");
    const onlySmall = [...BASE.filter((d) => d.kind !== "rcd"), rcd("16", 16, 30, "A", "2P")];
    expect(gapsOf(matchDevices(twoCircuits(), onlySmall))[0]).toMatchObject({ role: "rcd", minRatedCurrentA: 20 });
  });

  it("requires a 4P RCD when any circuit of the group is three-phase", () => {
    const input: MatchInput = {
      supply: TN_C_S_3F,
      groups: [group("g1")],
      circuits: [circuit("c1", 16, { rcd_group_id: "g1" }), circuit("c2", 16, { rcd_group_id: "g1", phase_count: 3 })],
    };
    const catalog = [
      fr("fr", 40, "4P"),
      mcb("b16-1p", 16, "1P"),
      mcb("b16-3p", 16, "3P"),
      rcd("2p", 40, 30, "A", "2P", { price_grosze: 1 }),
      rcd("4p", 40, 30, "A", "4P"),
    ];
    expect(deviceFor(matched(matchDevices(input, catalog)), "rcd", { groupId: "g1" })).toBe("4p");
    expect(
      gapsOf(
        matchDevices(
          input,
          catalog.filter((d) => d.id !== "4p"),
        ),
      )[0],
    ).toMatchObject({ role: "rcd", poles: ["4P"] });
  });

  it("skips an empty group", () => {
    const input: MatchInput = { supply: TN_S_1F, groups: [group("empty")], circuits: [circuit("c1", 16)] };
    const selections = matched(matchDevices(input, [fr("fr", 40, "2P"), mcb("b16", 16, "1P")]));
    expect(selections.map((s) => s.role)).toEqual(["main_switch", "mcb"]);
  });
});

describe("matchDevices — single-circuit group (RCBO)", () => {
  const single: MatchInput = {
    supply: TN_S_1F,
    groups: [group("g1")],
    circuits: [circuit("c1", 16, { rcd_group_id: "g1", name: "Łazienka" })],
  };

  it("uses an RCBO with exact In, exact IΔn and a sufficient type", () => {
    const catalog = [
      ...BASE,
      rcbo("rcbo-20", 20, 30, "A", "1P+N", { price_grosze: 1 }),
      rcbo("rcbo-16-ac", 16, 30, "AC", "1P+N", { price_grosze: 1 }),
      rcbo("rcbo-16-100", 16, 100, "A", "1P+N", { price_grosze: 1 }),
      rcbo("rcbo-16", 16, 30, "A", "1P+N"),
    ];
    const selections = matched(matchDevices(single, catalog));
    expect(selections).toEqual([
      { role: "main_switch", deviceId: "fr-40-2p", groupId: null, circuitId: null, notes: [] },
      { role: "rcbo", deviceId: "rcbo-16", groupId: "g1", circuitId: "c1", notes: [] },
    ]);
  });

  it("falls back to a compliant RCD + MCB pair, both flagged rcbo_fallback", () => {
    const selections = matched(matchDevices(single, [...BASE, rcbo("rcbo-20", 20, 30, "A", "1P+N")]));
    expect(selections).toEqual([
      { role: "main_switch", deviceId: "fr-40-2p", groupId: null, circuitId: null, notes: [] },
      { role: "rcd", deviceId: "rcd-40-30-a-2p", groupId: "g1", circuitId: null, notes: ["rcbo_fallback"] },
      { role: "mcb", deviceId: "b16-1p", groupId: "g1", circuitId: "c1", notes: ["rcbo_fallback"] },
    ]);
  });

  it("reports the RCBO gap and every failing part of the fallback", () => {
    const gaps = gapsOf(matchDevices(single, [fr("fr", 40, "2P")]));
    expect(gaps.map((gap) => [gap.role, "fallback" in gap ? gap.fallback : null])).toEqual([
      ["rcbo", null],
      ["rcd", true],
      ["mcb", true],
    ]);
    expect(gaps[0]).toEqual({
      role: "rcbo",
      kind: "rcbo",
      poles: ["1P+N", "2P"],
      ratedCurrentA: 16,
      residualCurrentMa: 30,
      minRcdType: "A",
      groupId: "g1",
      groupLabel: "g1",
      circuitId: "c1",
      circuitName: "Łazienka",
    });
    // With the MCB present, only the RCD half of the fallback is missing.
    expect(gapsOf(matchDevices(single, [fr("fr", 40, "2P"), mcb("b16", 16, "1P")])).map((g) => g.role)).toEqual([
      "rcbo",
      "rcd",
    ]);
  });
});

describe("matchDevices — result shape", () => {
  // Output-contract pin, not guardrail evidence: the emission order the page and the snapshot rely on.
  it("orders selections: main switch, each group (RCD, then its MCBs in circuit order), then ungrouped", () => {
    const input: MatchInput = {
      supply: TN_S_1F,
      groups: [group("g1"), group("g2")],
      circuits: [
        circuit("u1", 10),
        circuit("a2", 20, { rcd_group_id: "g1" }),
        circuit("s1", 16, { rcd_group_id: "g2" }),
        circuit("a1", 16, { rcd_group_id: "g1" }),
      ],
    };
    const selections = matched(matchDevices(input, [...BASE, rcbo("rcbo-16", 16, 30, "A", "2P")]));
    expect(selections.map((s) => [s.role, s.groupId, s.circuitId])).toEqual([
      ["main_switch", null, null],
      ["rcd", "g1", null],
      ["mcb", "g1", "a2"],
      ["mcb", "g1", "a1"],
      ["rcbo", "g2", "s1"],
      ["mcb", null, "u1"],
    ]);
  });

  it("lists every gap and returns no partial selection", () => {
    const input = ungrouped(TN_S_1F, [circuit("c1", 16), circuit("c2", 40), circuit("c3", 63)]);
    const result = matchDevices(input, BASE);
    expect(result.status).toBe("gaps");
    expect(gapsOf(result).map((gap) => (gap.role === "mcb" ? gap.circuitId : gap.role))).toEqual(["c2", "c3"]);
    expect("selections" in result).toBe(false);
  });

  // Output-contract pin, not guardrail evidence: equal-priced compliant devices are interchangeable.
  it("breaks price ties by manufacturer, then model, then id", () => {
    const at = (id: string, manufacturer: string, model: string) =>
      mcb(id, 16, "1P", { manufacturer, model, price_grosze: 1500 });
    const pick = (catalog: DeviceSpecWithId[]) =>
      deviceFor(
        matched(matchDevices(ungrouped(TN_S_1F, [circuit("c1", 16)]), [fr("fr", 40, "2P"), ...catalog])),
        "mcb",
        {},
      );
    expect(pick([at("z", "Beta", "A"), at("y", "Alfa", "Z")])).toBe("y");
    expect(pick([at("z", "Alfa", "B"), at("y", "Alfa", "A")])).toBe("y");
    expect(pick([at("b", "Alfa", "A"), at("a", "Alfa", "A")])).toBe("a");
    expect(pick([at("a", "Alfa", "A"), at("b", "Alfa", "A")])).toBe("a");
  });
});

/*
 * Boundary tables (risk #1). Every expected id below follows from the S-04 rule table alone; the
 * type rank and per-role pole sets are written out here as literals, never read from the matcher.
 * Each catalog puts the exact/threshold device next to its list neighbours, with a cheaper
 * non-compliant device present, so a passing test proves the filter rather than the fixture.
 */

/** Every inner value of a discrete list with its two list neighbours: [below, value, above]. */
function neighbourTriples<T>(list: readonly T[]): [T, T, T][] {
  const triples: [T, T, T][] = [];
  for (let i = 1; i < list.length - 1; i++) triples.push([list[i - 1], list[i], list[i + 1]]);
  return triples;
}

/** The rule table's residual-current type order, AC < A < F < B, as a literal. */
const TYPE_RANK = { AC: 0, A: 1, F: 2, B: 3 } as const;

describe("boundaries — MCB rated current is exact", () => {
  it.each(neighbourTriples(CIRCUIT_RATED_CURRENTS_A))(
    "picks the exact MCB between cheaper list neighbours (below B%i, exact B%i, above B%i)",
    (below, exact, above) => {
      // Both neighbours are cheaper than the exact device; In = circuit In exactly picks the exact one.
      const catalog = [
        fr("fr", 40, "2P"),
        mcb("mcb-below", below, "1P", { price_grosze: 100 }),
        mcb("mcb-exact", exact, "1P", { price_grosze: 5000 }),
        mcb("mcb-above", above, "1P", { price_grosze: 200 }),
      ];
      const selections = matched(matchDevices(ungrouped(TN_S_1F, [circuit("c1", exact)]), catalog));
      expect(deviceFor(selections, "mcb", { circuitId: "c1" })).toBe("mcb-exact");
    },
  );
});

describe("boundaries — RCBO rated current is exact", () => {
  it.each(neighbourTriples(CIRCUIT_RATED_CURRENTS_A))(
    "picks the exact RCBO between cheaper list neighbours (below B%i, exact B%i, above B%i)",
    (below, exact, above) => {
      const input: MatchInput = {
        supply: TN_S_1F,
        groups: [group("g1")],
        circuits: [circuit("c1", exact, { rcd_group_id: "g1" })],
      };
      const catalog = [
        fr("fr", 40, "2P"),
        rcbo("rcbo-below", below, 30, "A", "1P+N", { price_grosze: 100 }),
        rcbo("rcbo-exact", exact, 30, "A", "1P+N", { price_grosze: 5000 }),
        rcbo("rcbo-above", above, 30, "A", "1P+N", { price_grosze: 200 }),
      ];
      const selections = matched(matchDevices(input, catalog));
      expect(deviceFor(selections, "rcbo", { circuitId: "c1" })).toBe("rcbo-exact");
    },
  );
});

describe("boundaries — group RCD", () => {
  it.each(neighbourTriples(CIRCUIT_RATED_CURRENTS_A))(
    "accepts In equal to the largest circuit In; a cheaper one a step below is not chosen (below %i, largest %i, above %i)",
    (below, largest, above) => {
      // Group of two circuits whose largest In is `largest`. The RCD rated exactly `largest` is the
      // cheapest compliant one (In ≥ max circuit In): the one below fails, the one above costs more.
      const input: MatchInput = {
        supply: TN_S_1F,
        groups: [group("g1")],
        circuits: [circuit("c1", below, { rcd_group_id: "g1" }), circuit("c2", largest, { rcd_group_id: "g1" })],
      };
      const catalog = [
        fr("fr", 40, "2P"),
        mcb("mcb-below", below, "1P"),
        mcb("mcb-largest", largest, "1P"),
        rcd("rcd-below", below, 30, "A", "2P", { price_grosze: 1 }),
        rcd("rcd-exact", largest, 30, "A", "2P", { price_grosze: 3000 }),
        rcd("rcd-above", above, 30, "A", "2P", { price_grosze: 5000 }),
      ];
      expect(deviceFor(matched(matchDevices(input, catalog)), "rcd", { groupId: "g1" })).toBe("rcd-exact");
    },
  );

  it.each(RESIDUAL_CURRENTS_MA.map((ma) => [ma] as const))(
    "requires IΔn exactly: a %i mA group ignores every cheaper RCD of another IΔn",
    (groupMa) => {
      const input: MatchInput = {
        supply: TN_S_1F,
        groups: [group("g1", { residual_current_ma: groupMa })],
        circuits: [circuit("c1", 16, { rcd_group_id: "g1" }), circuit("c2", 16, { rcd_group_id: "g1" })],
      };
      const catalog = [
        fr("fr", 40, "2P"),
        mcb("b16", 16, "1P"),
        ...RESIDUAL_CURRENTS_MA.map((ma) =>
          rcd(`rcd-${String(ma)}`, 40, ma, "A", "2P", { price_grosze: ma === groupMa ? 9000 : 1 }),
        ),
      ];
      expect(deviceFor(matched(matchDevices(input, catalog)), "rcd", { groupId: "g1" })).toBe(`rcd-${String(groupMa)}`);
    },
  );

  it("documents today's accepted rule: on a single-phase group a cheaper 4P RCD beats the cheapest 2P", () => {
    // The rule table allows {2P, 4P} for a group with no three-phase circuit, so the cheapest wins.
    // Whether 1F should prefer 2P is a candidate rule change handed to S-04, not decided here.
    const input: MatchInput = {
      supply: TN_S_1F,
      groups: [group("g1")],
      circuits: [circuit("c1", 16, { rcd_group_id: "g1" }), circuit("c2", 20, { rcd_group_id: "g1" })],
    };
    const catalog = [
      fr("fr", 40, "2P"),
      mcb("b16", 16, "1P"),
      mcb("b20", 20, "1P"),
      rcd("rcd-2p", 40, 30, "A", "2P", { price_grosze: 3000 }),
      rcd("rcd-4p", 40, 30, "A", "4P", { price_grosze: 2000 }),
    ];
    expect(deviceFor(matched(matchDevices(input, catalog)), "rcd", { groupId: "g1" })).toBe("rcd-4p");
  });
});

describe("boundaries — FR main switch", () => {
  it.each(neighbourTriples(PREMETER_PROTECTIONS_A))(
    "accepts In equal to the pre-meter protection; a cheaper one a step below is not chosen (below %i, protection %i, above %i)",
    (below, protection, above) => {
      // In ≥ pre-meter: the one below fails, the exact one is cheaper than the one above.
      const supply: SupplyParams = { ...TN_S_1F, premeter_protection_a: protection };
      const catalog = [
        fr("fr-below", below, "2P", { price_grosze: 1 }),
        fr("fr-exact", protection, "2P", { price_grosze: 3000 }),
        fr("fr-above", above, "2P", { price_grosze: 5000 }),
        mcb("b16", 16, "1P"),
      ];
      const selections = matched(matchDevices(ungrouped(supply, [circuit("c1", 16)]), catalog));
      expect(deviceFor(selections, "main_switch", {})).toBe("fr-exact");
    },
  );
});

describe("boundaries — residual-current type rank (AC < A < F < B)", () => {
  it("the literal rank covers exactly the device RCD types", () => {
    expect(Object.keys(TYPE_RANK).sort()).toEqual([...RCD_TYPES].sort());
  });

  // All 16 (minimum, device) pairs, including the plan's four named ones: F rejected for a B
  // minimum, B accepted for A, AC accepted for AC, AC rejected for A.
  const pairs = RCD_TYPES.flatMap((minimum) =>
    RCD_TYPES.map((deviceType) => [minimum, deviceType, TYPE_RANK[deviceType] >= TYPE_RANK[minimum]] as const),
  );

  it.each(pairs)("group RCD: minimum %s, device type %s → accepted: %s", (minimum, deviceType, accepted) => {
    const input: MatchInput = {
      supply: TN_S_1F,
      groups: [group("g1", { min_rcd_type: minimum })],
      circuits: [circuit("c1", 16, { rcd_group_id: "g1" }), circuit("c2", 16, { rcd_group_id: "g1" })],
    };
    const catalog = [fr("fr", 40, "2P"), mcb("b16", 16, "1P"), rcd("rcd", 40, 30, deviceType, "2P")];
    const result = matchDevices(input, catalog);
    if (accepted) {
      expect(deviceFor(matched(result), "rcd", { groupId: "g1" })).toBe("rcd");
    } else {
      expect(gapsOf(result).map((gap) => gap.role)).toEqual(["rcd"]);
    }
  });

  it.each(pairs)("RCBO: minimum %s, device type %s → accepted: %s", (minimum, deviceType, accepted) => {
    const input: MatchInput = {
      supply: TN_S_1F,
      groups: [group("g1", { min_rcd_type: minimum })],
      circuits: [circuit("c1", 16, { rcd_group_id: "g1" })],
    };
    const catalog = [fr("fr", 40, "2P"), rcbo("rcbo", 16, 30, deviceType, "1P+N")];
    const result = matchDevices(input, catalog);
    if (accepted) {
      expect(deviceFor(matched(result), "rcbo", { circuitId: "c1" })).toBe("rcbo");
    } else {
      // No RCD or MCB in the catalog either, so the fallback fails too.
      expect(gapsOf(result).map((gap) => gap.role)).toContain("rcbo");
    }
  });
});

describe("boundaries — three-phase single-circuit group", () => {
  const input: MatchInput = {
    supply: TN_C_S_3F,
    groups: [group("g1")],
    circuits: [circuit("c1", 16, { rcd_group_id: "g1", phase_count: 3 })],
  };
  /** Rule table: a three-phase RCBO is 3P+N or 4P. */
  const ACCEPTED_3F_RCBO_POLES: readonly string[] = ["3P+N", "4P"];

  it.each(POLES_BY_KIND.rcbo.map((poles) => [poles, ACCEPTED_3F_RCBO_POLES.includes(poles)] as const))(
    "RCBO %s → accepted: %s",
    (poles, accepted) => {
      const result = matchDevices(input, [fr("fr", 40, "4P"), rcbo("rcbo", 16, 30, "A", poles)]);
      if (accepted) {
        expect(deviceFor(matched(result), "rcbo", { circuitId: "c1" })).toBe("rcbo");
      } else {
        expect(gapsOf(result).find((gap) => gap.role === "rcbo")).toMatchObject({ poles: ["3P+N", "4P"] });
      }
    },
  );

  it("cheaper 1P+N and 2P RCBOs are not chosen over a 3P+N", () => {
    const catalog = [
      fr("fr", 40, "4P"),
      rcbo("rcbo-1pn", 16, 30, "A", "1P+N", { price_grosze: 1 }),
      rcbo("rcbo-2p", 16, 30, "A", "2P", { price_grosze: 1 }),
      rcbo("rcbo-3pn", 16, 30, "A", "3P+N", { price_grosze: 5000 }),
    ];
    expect(deviceFor(matched(matchDevices(input, catalog)), "rcbo", { circuitId: "c1" })).toBe("rcbo-3pn");
  });

  it.each(["3P", "3P+N", "4P"] as const)(
    "falls back to a 4P RCD and a %s MCB, never the cheaper single-phase parts",
    (mcbPoles) => {
      // No RCBO at all. The RCD must be 4P (the group has a three-phase circuit); the MCB must be
      // one of {3P, 3P+N, 4P}. Every single-phase part is cheaper and must be ignored.
      const catalog = [
        fr("fr", 40, "4P"),
        rcd("rcd-2p", 40, 30, "A", "2P", { price_grosze: 1 }),
        rcd("rcd-4p", 40, 30, "A", "4P", { price_grosze: 5000 }),
        mcb("mcb-1p", 16, "1P", { price_grosze: 1 }),
        mcb("mcb-1pn", 16, "1P+N", { price_grosze: 1 }),
        mcb("mcb-2p", 16, "2P", { price_grosze: 1 }),
        mcb("mcb-3f", 16, mcbPoles, { price_grosze: 5000 }),
      ];
      const selections = matched(matchDevices(input, catalog));
      expect(selections).toHaveLength(3);
      expect(selections).toContainEqual({
        role: "main_switch",
        deviceId: "fr",
        groupId: null,
        circuitId: null,
        notes: [],
      });
      expect(selections).toContainEqual({
        role: "rcd",
        deviceId: "rcd-4p",
        groupId: "g1",
        circuitId: null,
        notes: ["rcbo_fallback"],
      });
      expect(selections).toContainEqual({
        role: "mcb",
        deviceId: "mcb-3f",
        groupId: "g1",
        circuitId: "c1",
        notes: ["rcbo_fallback"],
      });
    },
  );
});

describe("boundaries — RCBO fallback with only the MCB half missing", () => {
  it("is a gap: the RCBO gap plus the MCB gap marked fallback, and no selections", () => {
    const input: MatchInput = {
      supply: TN_S_1F,
      groups: [group("g1")],
      circuits: [circuit("c1", 16, { rcd_group_id: "g1", name: "Łazienka" })],
    };
    // A compliant RCD is present; the only MCB is a B20, which a B16 circuit must never get.
    const catalog = [fr("fr", 40, "2P"), rcd("rcd", 40, 30, "A", "2P"), mcb("b20", 20, "1P", { price_grosze: 1 })];
    const result = matchDevices(input, catalog);
    const gaps = gapsOf(result);
    expect("selections" in result).toBe(false);
    expect(gaps).toHaveLength(2);
    expect(gaps).toContainEqual({
      role: "rcbo",
      kind: "rcbo",
      poles: ["1P+N", "2P"],
      ratedCurrentA: 16,
      residualCurrentMa: 30,
      minRcdType: "A",
      groupId: "g1",
      groupLabel: "g1",
      circuitId: "c1",
      circuitName: "Łazienka",
    });
    expect(gaps).toContainEqual({
      role: "mcb",
      kind: "mcb_b",
      poles: ["1P", "1P+N", "2P"],
      ratedCurrentA: 16,
      groupId: "g1",
      circuitId: "c1",
      circuitName: "Łazienka",
      fallback: true,
    });
  });
});

describe("activeCatalog", () => {
  const ID1 = "11111111-1111-4111-8111-111111111111";
  const ID2 = "22222222-2222-4222-8222-222222222222";
  const ID3 = "33333333-3333-4333-8333-333333333333";
  const ID4 = "44444444-4444-4444-8444-444444444444";
  const row = (id: unknown, extra: Record<string, unknown> = {}) => ({
    id,
    archived_at: null,
    kind: "mcb_b",
    name: "B16",
    manufacturer: "Alfa",
    model: String(id),
    price_grosze: 1000,
    ...common,
    poles: "1P",
    rated_current_a: 16,
    residual_current_ma: null,
    rcd_type: null,
    breaking_capacity_ka: 6,
    terminal_groups: null,
    ...extra,
  });

  it("drops archived, unparseable and id-less rows, never guessing", () => {
    const rows = [
      row(ID1, { price_grosze: 100, archived_at: "2026-09-01T00:00:00Z" }),
      row(ID2, { price_grosze: 100, rated_current_a: 16.5 }),
      row("not-a-uuid", { price_grosze: 100 }),
      row(undefined, { price_grosze: 100 }),
      row(ID3, { price_grosze: 100, residual_current_ma: 30 }),
      null,
      "row",
      row(ID4, { price_grosze: 2000 }),
    ];
    const catalog = activeCatalog(rows);
    expect(catalog.map((d) => d.id)).toEqual([ID4]);
    const selections = matched(matchDevices(ungrouped(TN_S_1F, [circuit("c1", 16)]), [fr("fr", 40, "2P"), ...catalog]));
    expect(deviceFor(selections, "mcb", {})).toBe(ID4);
  });
});

describe("sameSelection", () => {
  const a: Selection[] = [
    { role: "main_switch", deviceId: "fr", groupId: null, circuitId: null, notes: [] },
    { role: "mcb", deviceId: "b16", groupId: null, circuitId: "c1", notes: ["no_rcd"] },
  ];

  it("is true for equal lists", () => {
    expect(sameSelection(a, structuredClone(a))).toBe(true);
    expect(sameSelection([], [])).toBe(true);
  });

  it.each<[string, Partial<Selection>]>([
    ["device", { deviceId: "b16-other" }],
    ["role", { role: "rcbo" }],
    ["group", { groupId: "g1" }],
    ["circuit", { circuitId: "c2" }],
    ["notes", { notes: [] }],
  ])("is false when the %s differs", (_label, change) => {
    const b = structuredClone(a);
    b[1] = { ...b[1], ...change };
    expect(sameSelection(a, b)).toBe(false);
  });

  it("is false for a different length or order", () => {
    expect(sameSelection(a, a.slice(0, 1))).toBe(false);
    expect(sameSelection(a, [...a].reverse())).toBe(false);
  });
});

describe("messages", () => {
  const gaps: CatalogGap[] = [
    { role: "main_switch", kind: "switch_disconnector", poles: ["2P"], minRatedCurrentA: 25 },
    {
      role: "rcd",
      kind: "rcd",
      poles: ["2P", "4P"],
      minRatedCurrentA: 20,
      residualCurrentMa: 30,
      minRcdType: "A",
      groupId: "g1",
      groupLabel: "RCD 1",
      fallback: false,
    },
    {
      role: "rcbo",
      kind: "rcbo",
      poles: ["1P+N", "2P"],
      ratedCurrentA: 16,
      residualCurrentMa: 30,
      minRcdType: "A",
      groupId: "g1",
      groupLabel: "RCD 1",
      circuitId: "c1",
      circuitName: "Łazienka",
    },
    {
      role: "mcb",
      kind: "mcb_b",
      poles: ["1P", "1P+N", "2P"],
      ratedCurrentA: 40,
      groupId: null,
      circuitId: "c1",
      circuitName: "Piekarnik",
      fallback: false,
    },
  ];

  it("names exactly what is missing and asks to contact the admin", () => {
    const texts = gaps.map(catalogGapMessage);
    for (const text of texts) expect(text).toContain("administratorem");
    expect(texts[0]).toContain("25 A");
    expect(texts[0]).toContain("2P");
    expect(texts[1]).toContain("30 mA");
    expect(texts[1]).toContain("typ A");
    expect(texts[1]).toContain('„RCD 1"');
    expect(texts[2]).toContain("B16");
    expect(texts[2]).toContain("1P+N / 2P");
    expect(texts[3]).toContain("B40");
    expect(texts[3]).toContain("1P / 1P+N / 2P");
    expect(texts[3]).toContain('obwód: „Piekarnik"');
  });

  it("marks a fallback gap as the alternative to the RCBO", () => {
    const plain = catalogGapMessage(gaps[3]);
    const fallback = catalogGapMessage({ ...(gaps[3] as Extract<CatalogGap, { role: "mcb" }>), fallback: true });
    expect(fallback).not.toBe(plain);
    expect(fallback).toContain("RCBO");
  });

  it("has a non-empty Polish message for every block reason", () => {
    const reasons: BlockReason[] = [
      { code: "supply_missing" },
      { code: "no_circuits" },
      { code: "tn_c_with_rcd" },
      { code: "circuit_phase_exceeds_supply", circuitId: "c1", circuitName: "Piec" },
      { code: "circuit_group_unknown", circuitId: "c1", circuitName: "Piec" },
    ];
    const texts = reasons.map(blockReasonMessage);
    for (const text of texts) expect(text.length).toBeGreaterThan(0);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts[3]).toContain("Piec");
  });

  it("labels every role and note", () => {
    for (const role of ["main_switch", "rcd", "rcbo", "mcb"] as const) expect(selectionRoleLabel(role)).not.toBe("");
    for (const note of ["rcbo_fallback", "no_rcd"] as const) expect(selectionNoteMessage(note)).not.toBe("");
  });
});
