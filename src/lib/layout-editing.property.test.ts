import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { CabinetGeometry } from "./cabinet-geometry";
import { proposeLayout, validateLayout, type LayoutDevice, type LayoutInput } from "./cabinet-layout";
import { SEED_A, SEED_B, SEED_C } from "./cabinet-layout.fixtures";
import type { EntrySide } from "./circuit-params";
import { polesCarryN, type PoleConfig } from "./device-spec";
import {
  editUnits,
  keyboardStep,
  moveUnit,
  type EditContext,
  type LayoutDraft,
  type StepDirection,
} from "./layout-editing";

/*
 * Property test for manual editing (test-plan risk #4, "after every edit"): start from a valid
 * proposal on each seed geometry, then apply a random sequence of moves — whole blocks and single
 * devices, dropped anywhere on any rail (including past either end and onto a rail that does not
 * exist), or stepped by the keyboard. After every move:
 *
 * 1. an accepted move leaves `validateLayout` empty and every device placed exactly once;
 * 2. a refused move reports at least one issue and leaves the draft exactly as it was.
 *
 * `validateLayout` is the invariant oracle, as in `cabinet-layout.property.test.ts`. Most random drops
 * are invalid (overlaps, off-rail, a split group), so rule 2 is exercised as much as rule 1.
 */

const GEOMETRIES: [string, CabinetGeometry][] = [
  ["(a) PRZ-S1", SEED_A],
  ["(b) PRZ-M3", SEED_B],
  ["(c) PRZ-L4", SEED_C],
];

const SIDES: EntrySide[] = ["top", "bottom", "left", "right"];
const MCB_SHAPES: [PoleConfig, number][] = [
  ["1P", 17.5],
  ["1P+N", 35],
  ["3P", 52.5],
];

const scenarioArb = fc.record({
  groups: fc.array(
    fc.record({
      circuits: fc.array(fc.record({ side: fc.constantFrom(...SIDES), shape: fc.constantFrom(...MCB_SHAPES) }), {
        minLength: 1,
        maxLength: 4,
      }),
      rcbo: fc.boolean(),
    }),
    { minLength: 1, maxLength: 4 },
  ),
  ungrouped: fc.array(fc.constantFrom(...MCB_SHAPES), { maxLength: 3 }),
  catalogBar: fc.boolean(),
});

type Scenario = typeof scenarioArb extends fc.Arbitrary<infer T> ? T : never;

function buildInput(scenario: Scenario, geo: CabinetGeometry): LayoutInput {
  const devices: LayoutDevice[] = [];
  const circuits: LayoutInput["circuits"][number][] = [];
  const add = (
    role: string,
    kind: LayoutDevice["kind"],
    [poles, width]: [PoleConfig | null, number],
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
      height_mm: poles === null ? 15 : 85,
      poles,
      n_terminal_side: polesCarryN(poles) ? "left" : null,
      position: devices.length,
    });
  };
  add("main_switch", "switch_disconnector", ["2P", 35], null, null);
  const groups = scenario.groups.map((group, g) => {
    const id = `g${String(g)}`;
    const members = group.circuits.map((c, i) => ({ ...c, id: `${id}-c${String(i)}` }));
    for (const c of members) circuits.push({ id: c.id, entry_side: c.side });
    if (members.length === 1 && group.rcbo) {
      add("rcbo", "rcbo", ["1P+N", 35], id, members[0].id);
    } else {
      add("rcd", "rcd", ["2P", 35], id, null);
      for (const c of members) add("mcb", "mcb_b", c.shape, id, c.id);
    }
    return { id, label: `RCD ${String(g + 1)}` };
  });
  scenario.ungrouped.forEach((shape, i) => {
    const id = `u${String(i)}`;
    circuits.push({ id, entry_side: "top" });
    add("mcb", "mcb_b", shape, null, id);
  });
  if (scenario.catalogBar) add("pe_bar", "pe_bar", [null, 35], null, null);
  return { devices, groups, circuits, geometry: geo };
}

/** One move: a drop of unit `unit` (modulo the unit count) at a target, or a keyboard step. */
const moveArb = fc.oneof(
  fc.record({
    type: fc.constant("drop" as const),
    unit: fc.nat(),
    railIndex: fc.integer({ min: 0, max: 5 }),
    /** In half-modules, from 4 before the rail start to well past the longest rail's end. */
    halfModules: fc.integer({ min: -4, max: 70 }),
  }),
  fc.record({
    type: fc.constant("step" as const),
    unit: fc.nat(),
    direction: fc.constantFrom<StepDirection>("left", "right", "up", "down"),
  }),
);

describe("manual edits keep the layout valid", () => {
  for (const [name, geo] of GEOMETRIES) {
    it(`every accepted move on ${name} passes validateLayout; every refused one changes nothing`, () => {
      let accepted = 0;
      let acceptedBlocks = 0;
      let refused = 0;
      fc.assert(
        fc.property(scenarioArb, fc.array(moveArb, { minLength: 1, maxLength: 25 }), (scenario, moves) => {
          const input = buildInput(scenario, geo);
          const proposal = proposeLayout(input);
          if (!proposal.ok) return;
          const context: EditContext = { devices: input.devices, geometry: geo, groups: input.groups };
          const units = editUnits(input.devices, input.groups);
          const ids = input.devices.map((device) => device.id);
          let draft: LayoutDraft = { placements: proposal.placements };

          for (const move of moves) {
            const unit = units[move.unit % units.length];
            const target =
              move.type === "drop"
                ? { railIndex: move.railIndex, xMm: move.halfModules * 8.75 }
                : keyboardStep(context, draft, unit, move.direction);
            if (target === null) continue;
            const before = structuredClone(draft);
            const result = moveUnit(context, draft, unit, target);
            expect(draft).toEqual(before);
            if (result.ok) {
              accepted += 1;
              if (unit.kind === "block") acceptedBlocks += 1;
              expect(result.draft.placements.map((p) => p.projectDeviceId)).toEqual(ids);
              expect(validateLayout(input.devices, result.draft.placements, geo, input.groups)).toEqual([]);
              draft = result.draft;
            } else {
              refused += 1;
              expect(result.issues.length).toBeGreaterThan(0);
            }
          }
        }),
        { numRuns: 300 },
      );
      // Not vacuous: both verdicts occur, and blocks really move.
      expect(accepted).toBeGreaterThan(50);
      expect(acceptedBlocks).toBeGreaterThan(5);
      expect(refused).toBeGreaterThan(50);
    });
  }
});
