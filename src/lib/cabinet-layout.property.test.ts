import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CabinetGeometry } from "./cabinet-geometry";
import { proposeLayout, validateLayout, type LayoutDevice, type LayoutInput } from "./cabinet-layout";
import { geometry, SEED_A, SEED_B, SEED_C } from "./cabinet-layout.fixtures";
import { ENTRY_SIDES } from "./cabinet-geometry";
import type { EntrySide } from "./circuit-params";
import { N_TERMINAL_SIDES, polesCarryN, type NTerminalSide, type PoleConfig } from "./device-spec";

/*
 * Property test for the layout (test-plan risk #4): for random matched sets — shaped the way S-04's
 * matcher emits them (one main switch, per group an RCBO or an RCD + MCBs, ungrouped MCBs) — on every
 * seed geometry plus a hand-built one with rails at a pitch under a device's height:
 *
 * 1. every `ok` proposal places each device exactly once and passes `validateLayout` with no issue;
 * 2. a proposal is deterministic — the same input gives the same output;
 * 3. offsets carry at most two decimals.
 *
 * `validateLayout` is the invariant oracle here; its own negative cases live in the table suite.
 */

/** Rails 60 mm apart: an 85 mm device on one collides with one on the next where they overlap in x. */
const PITCHED = geometry({
  version: 1,
  interior: { widthMm: 400, heightMm: 400, depthMm: 100 },
  rails: [
    { xMm: 20, yMm: 60, lengthMm: 360 },
    { xMm: 20, yMm: 120, lengthMm: 360 },
    { xMm: 20, yMm: 260, lengthMm: 180 },
    { xMm: 220, yMm: 260, lengthMm: 160 },
  ],
  entries: [
    { side: "left", offsetMm: 50, lengthMm: 100 },
    { side: "bottom", offsetMm: 0, lengthMm: 400 },
  ],
  bars: [
    {
      kind: "N",
      orientation: "vertical",
      xMm: 0,
      yMm: 0,
      lengthMm: 400,
      heightMm: 15,
      zMm: 20,
      terminalGroups: [{ count: 10, minMm2: 1.5, maxMm2: 16 }],
    },
  ],
});

const GEOMETRIES: [string, CabinetGeometry][] = [
  ["(a) PRZ-S1", SEED_A],
  ["(b) PRZ-M3", SEED_B],
  ["(c) PRZ-L4", SEED_C],
  ["pitched rails", PITCHED],
];

/** Pole sets and the widths the catalog makes them in. */
const MCB_SHAPES: [PoleConfig, number][] = [
  ["1P", 17.5],
  ["1P+N", 17.5],
  ["1P+N", 35],
  ["2P", 35],
  ["3P", 52.5],
  ["3P+N", 70],
  ["4P", 70],
];
const RCD_SHAPES: [PoleConfig, number][] = [
  ["2P", 35],
  ["4P", 70],
];
const RCBO_SHAPES: [PoleConfig, number][] = [
  ["1P+N", 17.5],
  ["1P+N", 35],
  ["2P", 35],
];
const FR_SHAPES: [PoleConfig, number][] = [
  ["1P", 17.5],
  ["2P", 35],
  ["3P", 52.5],
  ["4P", 70],
];

const sideArb = fc.constantFrom<EntrySide>(...ENTRY_SIDES);
const nSideArb = fc.constantFrom<NTerminalSide>(...N_TERMINAL_SIDES);
const shapeArb = (shapes: [PoleConfig, number][]) => fc.constantFrom(...shapes);

const circuitArb = fc.record({ side: sideArb, shape: shapeArb(MCB_SHAPES), nSide: nSideArb });

const groupArb = fc.record({
  circuits: fc.array(circuitArb, { minLength: 1, maxLength: 5 }),
  rcd: shapeArb(RCD_SHAPES),
  rcbo: shapeArb(RCBO_SHAPES),
  /** A single-circuit group: an RCBO, or (true) the RCD + MCB fallback. */
  fallback: fc.boolean(),
  nSide: nSideArb,
});

const scenarioArb = fc.record({
  fr: shapeArb(FR_SHAPES),
  frSide: nSideArb,
  groups: fc.array(groupArb, { maxLength: 5 }),
  ungrouped: fc.array(circuitArb, { maxLength: 5 }),
  /** Catalog PE/N bars (plan Phase 5b): none, PE only, N only or both; 2 or 4 TE wide. */
  catalogBars: fc.subarray(["pe_bar", "n_bar"] as const),
  barWidth: fc.constantFrom(35, 70),
});

type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never;

/** The snapshot S-04 would store for the scenario, in its order, plus groups and circuits. */
function buildInput(scenario: Scenario, geo: CabinetGeometry): LayoutInput {
  const devices: LayoutDevice[] = [];
  const circuits: LayoutInput["circuits"][number][] = [];
  const add = (
    role: string,
    kind: LayoutDevice["kind"],
    [poles, width]: [PoleConfig, number],
    nSide: NTerminalSide,
    group: string | null,
    circuit: string | null,
  ) => {
    devices.push({
      id: `d${String(devices.length)}`,
      role,
      kind,
      rcd_group_id: group,
      circuit_id: circuit,
      width_mm: width,
      height_mm: 85,
      poles,
      n_terminal_side: polesCarryN(poles) ? nSide : null,
      position: devices.length,
    });
  };

  add("main_switch", "switch_disconnector", scenario.fr, scenario.frSide, null, null);
  const groups = scenario.groups.map((group, g) => {
    const id = `g${String(g)}`;
    const members = group.circuits.map((c, i) => ({ ...c, id: `${id}-c${String(i)}` }));
    for (const c of members) circuits.push({ id: c.id, entry_side: c.side });
    if (members.length === 1 && !group.fallback) {
      add("rcbo", "rcbo", group.rcbo, group.nSide, id, members[0].id);
    } else {
      add("rcd", "rcd", group.rcd, group.nSide, id, null);
      for (const c of members) add("mcb", "mcb_b", c.shape, c.nSide, id, c.id);
    }
    return { id, label: `RCD ${String(g + 1)}` };
  });
  scenario.ungrouped.forEach((c, i) => {
    const id = `u${String(i)}`;
    circuits.push({ id, entry_side: c.side });
    add("mcb", "mcb_b", c.shape, c.nSide, null, id);
  });
  for (const role of scenario.catalogBars) {
    devices.push({
      id: `d${String(devices.length)}`,
      role,
      kind: role,
      rcd_group_id: null,
      circuit_id: null,
      width_mm: scenario.barWidth,
      height_mm: 15,
      poles: null,
      n_terminal_side: null,
      position: devices.length,
    });
  }
  return { devices, groups, circuits, geometry: geo };
}

describe("proposeLayout properties", () => {
  for (const [name, geo] of GEOMETRIES) {
    it(`every proposal on ${name} is valid and deterministic`, () => {
      let placed = 0;
      fc.assert(
        fc.property(scenarioArb, (scenario) => {
          const input = buildInput(scenario, geo);
          const result = proposeLayout(input);
          expect(proposeLayout(input)).toEqual(result);
          if (!result.ok) {
            expect(result.reason.code).toBe("does_not_fit");
            return;
          }
          placed += 1;
          expect(result.placements.map((p) => p.projectDeviceId)).toEqual(input.devices.map((d) => d.id));
          for (const p of result.placements) expect(Math.round(p.xMm * 100) / 100).toBe(p.xMm);
          expect(validateLayout(input.devices, result.placements, geo, input.groups)).toEqual([]);
        }),
        { numRuns: 400 },
      );
      // Not vacuous: about 1 in 5 sets fits even the one-rail cabinet (a), nearly all fit (c).
      expect(placed).toBeGreaterThan(20);
    });
  }
});
