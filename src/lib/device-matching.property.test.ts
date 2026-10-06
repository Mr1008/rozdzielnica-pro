import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  CIRCUIT_RATED_CURRENTS_A,
  RCD_MARGINS_PERCENT,
  RESIDUAL_CURRENTS_MA,
  type CircuitInput,
  type CircuitRatedCurrentA,
  type RcdGroupInput,
} from "./circuit-params";
import { matchDevices } from "./device-matching";
import type { CatalogGap, DeviceSpecWithId, MatchInput, MatchResult, Selection } from "./device-matching";
import { parseDeviceSpec, polesCarryN, POLES_BY_KIND, RCD_TYPES, type PoleConfig, type RcdType } from "./device-spec";
import { EARTHING_SYSTEMS, PHASE_COUNTS, PREMETER_PROTECTIONS_A, type SupplyParams } from "./supply-params";

/*
 * Property test for the device matcher (risk #1). Generators draw supplies, RCD groups, circuits and
 * catalogs; an independent oracle, written here from the S-04 rule table, says what the result must
 * be. Nothing from `./device-matching` is imported except `matchDevices` and its types: the type
 * rank and the per-role pole sets below are literals, never the matcher's helpers.
 */

// ---------------------------------------------------------------------------------------------
// The oracle — the S-04 rule table, written out
// ---------------------------------------------------------------------------------------------

/** AC < A < F < B. */
const TYPE_RANK: Record<RcdType, number> = { AC: 0, A: 1, F: 2, B: 3 };

/** Main switch: 1-phase → 2P (1P in TN-C); 3-phase → 4P (3P in TN-C). */
function frPoles(supply: SupplyParams): readonly PoleConfig[] {
  const tnC = supply.earthing_system === "TN-C";
  if (supply.phase_count === 1) return tnC ? ["1P"] : ["2P"];
  return tnC ? ["3P"] : ["4P"];
}

/** Circuit protection: {1P, 1P+N, 2P} or {3P, 3P+N, 4P}; in TN-C only 1P / 3P. */
function mcbPolesFor(circuit: CircuitInput, supply: SupplyParams): readonly PoleConfig[] {
  const tnC = supply.earthing_system === "TN-C";
  if (circuit.phase_count === 1) return tnC ? ["1P"] : ["1P", "1P+N", "2P"];
  return tnC ? ["3P"] : ["3P", "3P+N", "4P"];
}

/** Group RCD: 4P if any circuit is three-phase, else {2P, 4P}. */
function rcdPolesFor(members: readonly CircuitInput[]): readonly PoleConfig[] {
  return members.some((c) => c.phase_count === 3) ? ["4P"] : ["2P", "4P"];
}

/** RCBO: {1P+N, 2P} single-phase, {3P+N, 4P} three-phase. */
function rcboPolesFor(circuit: CircuitInput): readonly PoleConfig[] {
  return circuit.phase_count === 1 ? ["1P+N", "2P"] : ["3P+N", "4P"];
}

type Device = DeviceSpecWithId;

function compliantFr(catalog: readonly Device[], supply: SupplyParams): Device[] {
  const poles = frPoles(supply);
  return catalog.filter(
    (d) =>
      d.kind === "switch_disconnector" && d.rated_current_a >= supply.premeter_protection_a && poles.includes(d.poles),
  );
}

function compliantMcb(catalog: readonly Device[], circuit: CircuitInput, supply: SupplyParams): Device[] {
  const poles = mcbPolesFor(circuit, supply);
  return catalog.filter(
    (d) => d.kind === "mcb_b" && d.rated_current_a === circuit.rated_current_a && poles.includes(d.poles),
  );
}

function compliantRcd(catalog: readonly Device[], group: RcdGroupInput, members: readonly CircuitInput[]): Device[] {
  const poles = rcdPolesFor(members);
  // In ≥ ΣIn × (1 + margin), stated in integers so the oracle has no float rounding of its own.
  const sum = members.reduce((total, c) => total + c.rated_current_a, 0);
  return catalog.filter(
    (d) =>
      d.kind === "rcd" &&
      d.rated_current_a * 100 >= sum * (100 + group.rcd_margin_percent) &&
      d.residual_current_ma === group.residual_current_ma &&
      TYPE_RANK[d.rcd_type] >= TYPE_RANK[group.min_rcd_type] &&
      poles.includes(d.poles),
  );
}

function compliantRcbo(catalog: readonly Device[], group: RcdGroupInput, circuit: CircuitInput): Device[] {
  const poles = rcboPolesFor(circuit);
  return catalog.filter(
    (d) =>
      d.kind === "rcbo" &&
      d.rated_current_a === circuit.rated_current_a &&
      d.residual_current_ma === group.residual_current_ma &&
      TYPE_RANK[d.rcd_type] >= TYPE_RANK[group.min_rcd_type] &&
      poles.includes(d.poles),
  );
}

/** The block codes the rule table expects; empty when matching must be attempted. */
function expectedBlockCodes(input: MatchInput): Set<string> {
  const codes = new Set<string>();
  const groupIds = new Set(input.groups.map((g) => g.id));
  if (input.supply === null) codes.add("supply_missing");
  if (input.circuits.length === 0) codes.add("no_circuits");
  if (input.circuits.some((c) => c.rcd_group_id !== null && !groupIds.has(c.rcd_group_id))) {
    codes.add("circuit_group_unknown");
  }
  if (input.supply !== null) {
    const grouped = input.circuits.some((c) => c.rcd_group_id !== null && groupIds.has(c.rcd_group_id));
    if (input.supply.earthing_system === "TN-C" && grouped) codes.add("tn_c_with_rcd");
    if (input.supply.phase_count === 1 && input.circuits.some((c) => c.phase_count === 3)) {
      codes.add("circuit_phase_exceeds_supply");
    }
  }
  return codes;
}

/** A requirement with its compliant set. The single-circuit group carries its RCBO and both fallback sets. */
type Requirement =
  | { kind: "main"; set: Device[] }
  | { kind: "group_rcd"; groupId: string; set: Device[] }
  | { kind: "group_mcb"; groupId: string; circuitId: string; set: Device[] }
  | { kind: "ungrouped_mcb"; circuitId: string; set: Device[] }
  | { kind: "single"; groupId: string; circuitId: string; rcbo: Device[]; rcd: Device[]; mcb: Device[] };

function requirements(input: MatchInput & { supply: SupplyParams }, catalog: readonly Device[]): Requirement[] {
  const { supply } = input;
  const reqs: Requirement[] = [{ kind: "main", set: compliantFr(catalog, supply) }];
  for (const group of input.groups) {
    const members = input.circuits.filter((c) => c.rcd_group_id === group.id);
    if (members.length === 0) continue; // An empty group protects nothing.
    if (members.length === 1) {
      const circuit = members[0];
      reqs.push({
        kind: "single",
        groupId: group.id,
        circuitId: circuit.id,
        rcbo: compliantRcbo(catalog, group, circuit),
        rcd: compliantRcd(catalog, group, members),
        mcb: compliantMcb(catalog, circuit, supply),
      });
      continue;
    }
    reqs.push({ kind: "group_rcd", groupId: group.id, set: compliantRcd(catalog, group, members) });
    for (const circuit of members) {
      reqs.push({
        kind: "group_mcb",
        groupId: group.id,
        circuitId: circuit.id,
        set: compliantMcb(catalog, circuit, supply),
      });
    }
  }
  for (const circuit of input.circuits) {
    if (circuit.rcd_group_id === null) {
      reqs.push({ kind: "ungrouped_mcb", circuitId: circuit.id, set: compliantMcb(catalog, circuit, supply) });
    }
  }
  return reqs;
}

function satisfied(req: Requirement): boolean {
  if (req.kind === "single") return req.rcbo.length > 0 || (req.rcd.length > 0 && req.mcb.length > 0);
  return req.set.length > 0;
}

/** One expected selection: its key, its compliant set and its notes. */
interface ExpectedSelection {
  key: string;
  set: Device[];
  notes: string[];
}

function selectionKey(role: string, groupId: string | null, circuitId: string | null): string {
  return `${role}|${groupId ?? "-"}|${circuitId ?? "-"}`;
}

/** What a matched result must contain, one entry per device, derived from satisfied requirements. */
function expectedSelections(reqs: readonly Requirement[]): ExpectedSelection[] {
  const out: ExpectedSelection[] = [];
  for (const req of reqs) {
    switch (req.kind) {
      case "main":
        out.push({ key: selectionKey("main_switch", null, null), set: req.set, notes: [] });
        break;
      case "group_rcd":
        out.push({ key: selectionKey("rcd", req.groupId, null), set: req.set, notes: [] });
        break;
      case "group_mcb":
        out.push({ key: selectionKey("mcb", req.groupId, req.circuitId), set: req.set, notes: [] });
        break;
      case "ungrouped_mcb":
        out.push({ key: selectionKey("mcb", null, req.circuitId), set: req.set, notes: ["no_rcd"] });
        break;
      case "single":
        // The RCBO is the rule; the RCD + MCB pair only when no RCBO qualifies.
        if (req.rcbo.length > 0) {
          out.push({ key: selectionKey("rcbo", req.groupId, req.circuitId), set: req.rcbo, notes: [] });
        } else {
          out.push({ key: selectionKey("rcd", req.groupId, null), set: req.rcd, notes: ["rcbo_fallback"] });
          out.push({ key: selectionKey("mcb", req.groupId, req.circuitId), set: req.mcb, notes: ["rcbo_fallback"] });
        }
        break;
    }
  }
  return out;
}

/** The gaps a `gaps` result must list: every unsatisfied requirement, and for a single-circuit group every failing fallback part. */
function expectedGapKeys(reqs: readonly Requirement[]): string[] {
  const keys: string[] = [];
  for (const req of reqs) {
    if (satisfied(req)) continue;
    switch (req.kind) {
      case "main":
        keys.push("main_switch");
        break;
      case "group_rcd":
        keys.push(`rcd|${req.groupId}|fallback:false`);
        break;
      case "group_mcb":
        keys.push(`mcb|${req.groupId}|${req.circuitId}|fallback:false`);
        break;
      case "ungrouped_mcb":
        keys.push(`mcb|-|${req.circuitId}|fallback:false`);
        break;
      case "single":
        keys.push(`rcbo|${req.groupId}|${req.circuitId}`);
        if (req.rcd.length === 0) keys.push(`rcd|${req.groupId}|fallback:true`);
        if (req.mcb.length === 0) keys.push(`mcb|${req.groupId}|${req.circuitId}|fallback:true`);
        break;
    }
  }
  return keys;
}

function gapKey(gap: CatalogGap): string {
  switch (gap.role) {
    case "main_switch":
      return "main_switch";
    case "rcd":
      return `rcd|${gap.groupId}|fallback:${String(gap.fallback)}`;
    case "rcbo":
      return `rcbo|${gap.groupId}|${gap.circuitId}`;
    case "mcb":
      return `mcb|${gap.groupId ?? "-"}|${gap.circuitId}|fallback:${String(gap.fallback)}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------------------------

const uuid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const groupId = (n: number) => uuid("aaaaaaaa", n);
const circuitId = (n: number) => uuid("cccccccc", n);
const deviceId = (n: number) => uuid("dddddddd", n);
/** A well-formed id no group has: the circuit_group_unknown blocker. */
const GHOST_GROUP = uuid("eeeeeeee", 0);

/** A value of a discrete list together with its list neighbours. */
function withNeighbours<T>(list: readonly T[], value: T): T[] {
  const i = list.indexOf(value);
  return list.filter((_, j) => Math.abs(j - i) <= 1);
}

const supplyArb: fc.Arbitrary<SupplyParams> = fc.record({
  premeter_protection_a: fc.constantFrom(...PREMETER_PROTECTIONS_A),
  // TN-C blocks every grouped circuit, so it gets a lower weight to keep matched/gaps frequent.
  earthing_system: fc.oneof(
    { weight: 1, arbitrary: fc.constant("TN-C" as const) },
    { weight: 6, arbitrary: fc.constantFrom(...EARTHING_SYSTEMS.filter((s) => s !== "TN-C")) },
  ),
  phase_count: fc.constantFrom(...PHASE_COUNTS),
  wlz_length_m: fc.constant(10),
  wlz_cross_section_mm2: fc.constant(10 as const),
  wlz_material: fc.constant("Cu" as const),
  wlz_installation: fc.constant("conduit_flush" as const),
});

const groupSpecArb = fc.record({
  residual_current_ma: fc.constantFrom(...RESIDUAL_CURRENTS_MA),
  min_rcd_type: fc.constantFrom(...RCD_TYPES),
  rcd_margin_percent: fc.constantFrom(...RCD_MARGINS_PERCENT),
});

const circuitSpecArb = fc.record({
  rated_current_a: fc.constantFrom(...CIRCUIT_RATED_CURRENTS_A),
  /** Mapped below: a three-phase circuit is rare on a single-phase supply. */
  phaseRoll: fc.integer({ min: 0, max: 19 }),
  /** 0–7 → a group index (modulo the group count), 8–12 → ungrouped, 13 → unknown group. */
  groupRoll: fc.integer({ min: 0, max: 13 }),
});

const inputArb: fc.Arbitrary<MatchInput> = fc
  .record({
    supply: fc.option(supplyArb, { freq: 25, nil: null }),
    groups: fc.array(groupSpecArb, { maxLength: 3 }),
    circuits: fc.oneof(
      { weight: 1, arbitrary: fc.array(circuitSpecArb, { maxLength: 0 }) },
      { weight: 30, arbitrary: fc.array(circuitSpecArb, { minLength: 1, maxLength: 5 }) },
    ),
    ghostRoll: fc.integer({ min: 0, max: 9 }),
  })
  .map(({ supply, groups: groupSpecs, circuits: circuitSpecs, ghostRoll }) => {
    const groups: RcdGroupInput[] = groupSpecs.map((spec, i) => ({ id: groupId(i), label: `G${String(i)}`, ...spec }));
    const threePhaseSupply = supply?.phase_count === 3;
    const circuits: CircuitInput[] = circuitSpecs.map((spec, i) => {
      let rcdGroupId: string | null = null;
      if (spec.groupRoll <= 7 && groups.length > 0) rcdGroupId = groups[spec.groupRoll % groups.length].id;
      // The unknown-group blocker only on a small share of runs, not on every roll of 13.
      else if (spec.groupRoll === 13 && ghostRoll === 0) rcdGroupId = GHOST_GROUP;
      const phase = threePhaseSupply ? (spec.phaseRoll < 10 ? 1 : 3) : spec.phaseRoll === 0 ? 3 : 1;
      return {
        id: circuitId(i),
        rcd_group_id: rcdGroupId,
        name: `C${String(i)}`,
        rated_current_a: spec.rated_current_a,
        phase_count: phase,
        cross_section_mm2: 2.5,
        installation: "conduit_flush",
        entry_side: "top",
      };
    });
    return { supply, groups, circuits };
  });

const common = { width_mm: 17.5, height_mm: 85, depth_mm: 70 };

function buildDevice(id: string, row: Record<string, unknown>): Device {
  // The N side never affects matching; every generated N-carrying device gets one so it parses.
  const nTerminalSide = polesCarryN(row.poles) ? "left" : null;
  const parsed = parseDeviceSpec({
    name: id,
    manufacturer: "Alfa",
    model: id,
    ...common,
    n_terminal_side: nTerminalSide,
    ...row,
  });
  if (!parsed.ok) throw new Error(`generated device ${id} does not parse: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, id };
}

/**
 * A catalog biased toward the input's requirements and their list neighbours: ratings are drawn from
 * the circuit currents, the groups' required RCD ratings and the pre-meter protection (each with the list
 * values beside it), and IΔn mostly from the groups — so compliant, near-miss and cheaper-but-wrong
 * devices all show up next to each other.
 */
function catalogArb(input: MatchInput): fc.Arbitrary<Device[]> {
  const circuitIns = input.circuits.map((c) => c.rated_current_a);
  const nearCircuit = [
    ...new Set(circuitIns.flatMap((v) => withNeighbours(CIRCUIT_RATED_CURRENTS_A, v))),
  ] as CircuitRatedCurrentA[];
  const mcbIns = nearCircuit.length > 0 ? nearCircuit : [...CIRCUIT_RATED_CURRENTS_A];
  // The whole amperes on either side of each group's required RCD rating (ΣIn × (1 + margin)), so the
  // exact boundary and its near misses both show up.
  const groupNeeds = input.groups.flatMap((g) => {
    const sum = input.circuits.filter((c) => c.rcd_group_id === g.id).reduce((t, c) => t + c.rated_current_a, 0);
    if (sum === 0) return [];
    const required = (sum * (100 + g.rcd_margin_percent)) / 100;
    const [below, above] = [Math.floor(required), Math.ceil(required)];
    return [below - 1, below, above, above + 1].filter((v) => v > 0);
  });
  const rcdIns = [...new Set([...groupNeeds, ...mcbIns])];
  const premeter = input.supply?.premeter_protection_a ?? 25;
  const frIns = withNeighbours(PREMETER_PROTECTIONS_A, premeter);
  const groupMas = input.groups.map((g) => g.residual_current_ma);
  const maArb =
    groupMas.length > 0
      ? fc.oneof(
          { weight: 3, arbitrary: fc.constantFrom(...groupMas) },
          { weight: 2, arbitrary: fc.constantFrom(...RESIDUAL_CURRENTS_MA) },
        )
      : fc.constantFrom(...RESIDUAL_CURRENTS_MA);
  const price = fc.integer({ min: 1, max: 10_000 });
  // Exact circuit currents three times as often as their neighbours, so exact matches are common.
  const exactOrNear = fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...(circuitIns.length > 0 ? circuitIns : mcbIns)) },
    { weight: 1, arbitrary: fc.constantFrom(...mcbIns) },
  );
  // Poles the rule table accepts for this input, three times as often as any pole of the kind.
  const supply = input.supply;
  const preferMcb = supply === null ? [] : input.circuits.flatMap((c) => mcbPolesFor(c, supply));
  const preferRcbo = input.circuits.flatMap((c) => rcboPolesFor(c));
  const preferFr = supply === null ? [] : frPoles(supply);
  const poleArb = (all: readonly PoleConfig[], preferred: readonly PoleConfig[]) => {
    const inKind = all.filter((p) => preferred.includes(p));
    return inKind.length === 0
      ? fc.constantFrom(...all)
      : fc.oneof(
          { weight: 3, arbitrary: fc.constantFrom(...inKind) },
          { weight: 1, arbitrary: fc.constantFrom(...all) },
        );
  };

  const fr = fc.record({
    kind: fc.constant("switch_disconnector"),
    rated_current_a: fc.constantFrom(...frIns),
    poles: poleArb(POLES_BY_KIND.switch_disconnector, preferFr),
    price_grosze: price,
  });
  const mcb = fc.record({
    kind: fc.constant("mcb_b"),
    rated_current_a: exactOrNear,
    poles: poleArb(POLES_BY_KIND.mcb_b, preferMcb),
    breaking_capacity_ka: fc.constant(6),
    price_grosze: price,
  });
  const rcd = fc.record({
    kind: fc.constant("rcd"),
    rated_current_a: fc.constantFrom(...rcdIns),
    residual_current_ma: maArb,
    rcd_type: fc.constantFrom(...RCD_TYPES),
    poles: fc.constantFrom(...POLES_BY_KIND.rcd),
    price_grosze: price,
  });
  const rcbo = fc.record({
    kind: fc.constant("rcbo"),
    rated_current_a: exactOrNear,
    residual_current_ma: maArb,
    rcd_type: fc.constantFrom(...RCD_TYPES),
    poles: poleArb(POLES_BY_KIND.rcbo, preferRcbo),
    breaking_capacity_ka: fc.constant(6),
    price_grosze: price,
  });
  const row = fc.oneof(
    { weight: 2, arbitrary: fc.oneof(fr) },
    { weight: 5, arbitrary: fc.oneof(mcb) },
    { weight: 3, arbitrary: fc.oneof(rcd) },
    { weight: 2, arbitrary: fc.oneof(rcbo) },
  );
  return fc
    .array(row as fc.Arbitrary<Record<string, unknown>>, { minLength: 0, maxLength: 15, size: "max" })
    .map((rows) => rows.map((r, i) => buildDevice(deviceId(i), r)));
}

const scenarioArb = inputArb.chain((input) => catalogArb(input).map((catalog) => ({ input, catalog })));

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

function minPrice(set: readonly Device[]): number {
  return Math.min(...set.map((d) => d.price_grosze));
}

function checkScenario(input: MatchInput, catalog: readonly Device[], result: MatchResult): void {
  const blockCodes = expectedBlockCodes(input);

  // 1. A failed precondition blocks, with no matching attempted.
  if (blockCodes.size > 0 || input.supply === null) {
    expect(result.status).toBe("blocked");
    expect("selections" in result).toBe(false);
    if (result.status === "blocked") expect(new Set(result.reasons.map((r) => r.code))).toEqual(blockCodes);
    return;
  }

  const reqs = requirements({ ...input, supply: input.supply }, catalog);
  const byId = new Map(catalog.map((d) => [d.id, d]));

  // 2. Every requirement has a compliant device → matched, each pick compliant and cheapest.
  if (reqs.every(satisfied)) {
    expect(result.status).toBe("matched");
    if (result.status !== "matched") return;
    const expected = expectedSelections(reqs);
    const keyOf = (s: Selection) => selectionKey(s.role, s.groupId, s.circuitId);
    expect(result.selections.map(keyOf).sort()).toEqual(expected.map((e) => e.key).sort());
    for (const selection of result.selections) {
      const want = expected.find((e) => e.key === keyOf(selection));
      expect(want).toBeDefined();
      if (want === undefined) return;
      const device = byId.get(selection.deviceId);
      expect(device).toBeDefined();
      if (device === undefined) return;
      expect(want.set.map((d) => d.id)).toContain(device.id);
      expect(device.price_grosze).toBe(minPrice(want.set));
      expect(selection.notes).toEqual(want.notes);
      if (selection.role !== "main_switch") expect(device.kind).not.toBe("switch_disconnector");
    }
    return;
  }

  // 3. Otherwise gaps: nothing selected, and exactly the unmet requirements are listed.
  expect(result.status).toBe("gaps");
  expect("selections" in result).toBe(false);
  if (result.status !== "gaps") return;
  expect(result.gaps.length).toBeGreaterThan(0);
  expect(result.gaps.map(gapKey).sort()).toEqual(expectedGapKeys(reqs).sort());
}

describe("matchDevices — property: the result follows the S-04 rule table", () => {
  it("is blocked, matched with the cheapest compliant devices, or lists exactly the unmet requirements", () => {
    const seen = { blocked: 0, matched: 0, gaps: 0 };
    fc.assert(
      fc.property(scenarioArb, ({ input, catalog }) => {
        const result = matchDevices(input, catalog);
        seen[result.status] += 1;
        checkScenario(input, catalog, result);
      }),
      { numRuns: 1000 },
    );
    // Distribution guard: a generator drift that only yields one status must fail, not pass vacuously.
    expect(seen.blocked).toBeGreaterThan(0);
    expect(seen.matched).toBeGreaterThan(0);
    expect(seen.gaps).toBeGreaterThan(0);
  });
});
