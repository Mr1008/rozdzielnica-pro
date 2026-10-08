import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { buildDrawnWires } from "./cabinet-drawing";
import { proposeLayout, validateLayout, type Placement } from "./cabinet-layout";
import { wireLengthsBySection } from "./cabinet-wiring";
import { SEED_A, SEED_B, SEED_C } from "./cabinet-layout.fixtures";
import type { CircuitInput, CircuitsPayload, RcdGroupInput } from "./circuit-params";
import type { DeviceSpecWithId, MatchResult, Selection } from "./device-matching";
import {
  computeMatchView,
  type MatchContext,
  type MatchView,
  type MatchViewState,
  type SnapshotRow,
} from "./device-matching-server";
import { parseDeviceSpec, polesCarryN, type DeviceKind, type PoleConfig } from "./device-spec";
import {
  chooseSelectionLayout,
  computeLayoutView,
  computeWiring,
  layoutRpcErrorCode,
  placementsFromRows,
  previousLayoutFromReads,
  proposeSelectionLayout,
  saveLayoutArgs,
} from "./layout-server";
import { PROJECT_ERROR } from "./project-errors";

const PROJECT_ID = "5b1d6a3e-0c2f-4e8a-9b7d-1a2b3c4d5e6f";

// ---------------------------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------------------------

const ROLE_KIND = {
  main_switch: "switch_disconnector",
  rcd: "rcd",
  rcbo: "rcbo",
  mcb: "mcb_b",
  pe_bar: "pe_bar",
  n_bar: "n_bar",
} as const;

function uuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

function group(n: number): RcdGroupInput {
  return {
    id: uuid("7c2e8b4f", n),
    label: `RCD ${String(n)}`,
    residual_current_ma: 30,
    min_rcd_type: "A",
    rcd_margin_percent: 15,
  };
}

function circuit(n: number, groupId: string | null, entry: CircuitInput["entry_side"] = "top"): CircuitInput {
  return {
    id: uuid("8d3f9c5a", n),
    rcd_group_id: groupId,
    name: `Obwód ${String(n)}`,
    rated_current_a: 16,
    phase_count: 1,
    cross_section_mm2: 2.5,
    installation: "conduit_flush",
    entry_side: entry,
  };
}

function row(
  position: number,
  role: Selection["role"],
  poles: PoleConfig,
  widthMm: number,
  refs: { group?: string | null; circuit?: string | null } = {},
): SnapshotRow {
  return {
    id: uuid("b2000000", position),
    project_id: PROJECT_ID,
    position,
    role,
    device_id: uuid("a1000000", position),
    rcd_group_id: refs.group ?? null,
    circuit_id: refs.circuit ?? null,
    notes: [],
    kind: ROLE_KIND[role],
    name: "x",
    manufacturer: "Alfa",
    model: "x",
    price_grosze: 1000,
    width_mm: widthMm,
    height_mm: 85,
    depth_mm: 70,
    poles,
    rated_current_a: 16,
    residual_current_ma: null,
    rcd_type: null,
    breaking_capacity_ka: null,
    n_terminal_side: polesCarryN(poles) ? "left" : null,
    terminal_groups: null,
    created_at: "2026-10-06T00:00:00Z",
  };
}

/** A main switch, then `groups` RCD groups of `perGroup` 1P MCB circuits each. */
function project(groupCount: number, perGroup: number) {
  const groups = Array.from({ length: groupCount }, (_, g) => group(g + 1));
  const circuits = groups.flatMap((g, gi) =>
    Array.from({ length: perGroup }, (_, c) => circuit(gi * perGroup + c + 1, g.id)),
  );
  const snapshot: SnapshotRow[] = [row(0, "main_switch", "2P", 35)];
  for (const [gi, g] of groups.entries()) {
    snapshot.push(row(snapshot.length, "rcd", "2P", 35, { group: g.id }));
    for (const c of circuits.slice(gi * perGroup, (gi + 1) * perGroup)) {
      snapshot.push(row(snapshot.length, "mcb", "1P", 17.5, { group: g.id, circuit: c.id }));
    }
  }
  return { groups, circuits, snapshot };
}

function matchView(state: MatchViewState, snapshot: SnapshotRow[]): MatchView {
  return { state, fresh: { status: "matched", selections: [] }, snapshot };
}

function proposal(snapshot: SnapshotRow[], payload: CircuitsPayload, geometry = SEED_B): Placement[] {
  const result = proposeLayout({ devices: snapshot, groups: payload.groups, circuits: payload.circuits, geometry });
  if (!result.ok) throw new Error(`fixture does not fit: ${JSON.stringify(result.reason)}`);
  return result.placements;
}

const SMALL = project(1, 2);
const SMALL_CONTEXT = { geometry: SEED_B, groups: SMALL.groups, circuits: SMALL.circuits };

// ---------------------------------------------------------------------------------------------
// computeLayoutView
// ---------------------------------------------------------------------------------------------

describe("computeLayoutView", () => {
  it.each(["stale", "cleared", "gaps", "blocked"] as const)("is null for a %s match", (state) => {
    const placements = proposal(SMALL.snapshot, SMALL);
    expect(computeLayoutView(matchView(state, SMALL.snapshot), SMALL_CONTEXT, placements)).toBeNull();
    expect(computeLayoutView(matchView(state, SMALL.snapshot), SMALL_CONTEXT, [])).toBeNull();
  });

  it("is null when the cabinet snapshot does not parse", () => {
    expect(
      computeLayoutView(matchView("current", SMALL.snapshot), { ...SMALL_CONTEXT, geometry: null }, []),
    ).toBeNull();
  });

  it("is placed when the stored placements cover the snapshot and validate", () => {
    const placements = proposal(SMALL.snapshot, SMALL);
    const view = computeLayoutView(matchView("current", SMALL.snapshot), SMALL_CONTEXT, placements);
    expect(view).toEqual({ state: "placed", placements, editedManually: false });
  });

  it("carries the manual marker only into the placed state", () => {
    const placements = proposal(SMALL.snapshot, SMALL);
    const current = matchView("current", SMALL.snapshot);
    expect(computeLayoutView(current, SMALL_CONTEXT, placements, true)).toEqual({
      state: "placed",
      placements,
      editedManually: true,
    });
    // An outdated manual layout is no longer shown as manual.
    const outdated = computeLayoutView(current, SMALL_CONTEXT, placements.slice(1), true);
    expect(outdated?.state).toBe("outdated");
    expect(outdated).not.toHaveProperty("editedManually");
  });

  it("is missing when nothing is stored and a proposal fits — the proposal validates", () => {
    const view = computeLayoutView(matchView("current", SMALL.snapshot), SMALL_CONTEXT, []);
    expect(view?.state).toBe("missing");
    if (view?.state !== "missing") return;
    expect(view.proposal).toEqual(proposal(SMALL.snapshot, SMALL));
    expect(validateLayout(SMALL.snapshot, view.proposal, SEED_B, SMALL.groups)).toEqual([]);
  });

  it("is outdated when a stored placement is missing, with the issue and a fresh proposal", () => {
    const placements = proposal(SMALL.snapshot, SMALL).slice(1);
    const view = computeLayoutView(matchView("current", SMALL.snapshot), SMALL_CONTEXT, placements);
    expect(view?.state).toBe("outdated");
    if (view?.state !== "outdated") return;
    expect(view.issues).toEqual([{ code: "device_not_placed", deviceId: SMALL.snapshot[0].id }]);
    expect(view.proposal).toEqual(proposal(SMALL.snapshot, SMALL));
  });

  it("is outdated when the stored placements fail validation (a device off its rail)", () => {
    const placements = proposal(SMALL.snapshot, SMALL).map((p, i) => (i === 0 ? { ...p, railIndex: 7 } : p));
    expect(computeLayoutView(matchView("current", SMALL.snapshot), SMALL_CONTEXT, placements)?.state).toBe("outdated");
  });

  it("is outdated when the stored placements name a device the snapshot lacks", () => {
    const placements = [
      ...proposal(SMALL.snapshot, SMALL),
      { projectDeviceId: "b2000000-0000-4000-8000-999999999999", railIndex: 0, xMm: 0 },
    ];
    expect(computeLayoutView(matchView("current", SMALL.snapshot), SMALL_CONTEXT, placements)?.state).toBe("outdated");
  });

  it("is does_not_fit when the devices exceed the cabinet's rails, with the TE counts", () => {
    // Seed (a): one 230 mm rail. FR 35 + RCD 35 + 10 × 17.5 = 245 mm.
    const big = project(1, 10);
    const view = computeLayoutView(matchView("current", big.snapshot), { ...big, geometry: SEED_A }, []);
    expect(view?.state).toBe("does_not_fit");
    if (view?.state !== "does_not_fit") return;
    expect(view.failure).toMatchObject({ code: "does_not_fit", requiredModules: 14, availableModules: 13 });
  });

  it("prefers does_not_fit over outdated when re-proposing could not help", () => {
    const big = project(1, 10);
    const stale: Placement[] = big.snapshot.map((d, i) => ({ projectDeviceId: d.id, railIndex: 0, xMm: i }));
    const view = computeLayoutView(matchView("current", big.snapshot), { ...big, geometry: SEED_A }, stale);
    expect(view?.state).toBe("does_not_fit");
  });
});

// ---------------------------------------------------------------------------------------------
// proposeSelectionLayout
// ---------------------------------------------------------------------------------------------

function catalogDevice(
  id: string,
  kind: DeviceKind,
  poles: PoleConfig,
  widthMm: number,
  overrides: Record<string, unknown> = {},
): DeviceSpecWithId {
  const parameters: Record<DeviceKind, Record<string, unknown>> = {
    switch_disconnector: { rated_current_a: 40 },
    rcd: { rated_current_a: 40, residual_current_ma: 30, rcd_type: "A" },
    rcbo: { rated_current_a: 16, residual_current_ma: 30, rcd_type: "A", breaking_capacity_ka: 6 },
    mcb_b: { rated_current_a: 16, breaking_capacity_ka: 6 },
    pe_bar: {},
    n_bar: {},
  };
  const parsed = parseDeviceSpec({
    kind,
    name: id,
    manufacturer: "Alfa",
    model: id,
    price_grosze: 1000,
    width_mm: widthMm,
    height_mm: 85,
    depth_mm: 70,
    poles,
    n_terminal_side: polesCarryN(poles) ? "right" : null,
    ...parameters[kind],
    ...overrides,
  });
  if (!parsed.ok) throw new Error(`fixture ${id} does not parse: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, id };
}

const FR_ID = "a1000000-0000-4000-8000-0000000000f1";
const RCD_ID = "a1000000-0000-4000-8000-0000000000f2";
const MCB_ID = "a1000000-0000-4000-8000-0000000000f3";
const CATALOG = [
  catalogDevice(FR_ID, "switch_disconnector", "2P", 35),
  catalogDevice(RCD_ID, "rcd", "2P", 35),
  catalogDevice(MCB_ID, "mcb_b", "1P", 17.5),
];

function selections(payload: CircuitsPayload): Selection[] {
  const g = payload.groups[0];
  return [
    { role: "main_switch", deviceId: FR_ID, groupId: null, circuitId: null, notes: [] },
    { role: "rcd", deviceId: RCD_ID, groupId: g.id, circuitId: null, notes: [] },
    ...payload.circuits.map((c): Selection => ({
      role: "mcb",
      deviceId: MCB_ID,
      groupId: g.id,
      circuitId: c.id,
      notes: [],
    })),
  ];
}

describe("proposeSelectionLayout", () => {
  const payload: CircuitsPayload = { groups: SMALL.groups, circuits: SMALL.circuits };
  const matched: MatchResult = { status: "matched", selections: selections(payload) };

  it("places every selection, aligned by index, exactly as the stored snapshot would be placed", () => {
    const layout = proposeSelectionLayout(matched, CATALOG, payload, SEED_B);
    expect(layout).toHaveLength(matched.selections.length);

    // The same devices as a snapshot (same order, dimensions and N side) give the same proposal.
    const snapshot = SMALL.snapshot.map((r) => ({
      ...r,
      n_terminal_side: r.n_terminal_side === null ? null : "right",
    }));
    const expected = proposal(snapshot as SnapshotRow[], payload);
    expect(layout).toEqual(expected.map((p) => ({ railIndex: p.railIndex, xMm: p.xMm })));
  });

  it("stores nothing for a gap or a blocked match", () => {
    const gaps: MatchResult = {
      status: "gaps",
      gaps: [{ role: "main_switch", kind: "switch_disconnector", poles: ["2P"], minRatedCurrentA: 32 }],
    };
    expect(proposeSelectionLayout(gaps, CATALOG, payload, SEED_B)).toBeUndefined();
    const blocked: MatchResult = { status: "blocked", reasons: [{ code: "no_circuits" }] };
    expect(proposeSelectionLayout(blocked, CATALOG, payload, SEED_B)).toBeUndefined();
  });

  it("stores nothing without a cabinet snapshot or with a device missing from the catalog", () => {
    expect(proposeSelectionLayout(matched, CATALOG, payload, null)).toBeUndefined();
    expect(proposeSelectionLayout(matched, CATALOG.slice(1), payload, SEED_B)).toBeUndefined();
  });

  it("stores nothing when the layout does not fit — the devices are still saved", () => {
    const big = project(1, 10);
    const bigPayload = { groups: big.groups, circuits: big.circuits };
    const result: MatchResult = { status: "matched", selections: selections(bigPayload) };
    expect(proposeSelectionLayout(result, CATALOG, bigPayload, SEED_A)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------
// chooseSelectionLayout — carry-over of a manual layout (S-06)
// ---------------------------------------------------------------------------------------------

describe("chooseSelectionLayout", () => {
  const payload: CircuitsPayload = { groups: SMALL.groups, circuits: SMALL.circuits };
  const matched: MatchResult = { status: "matched", selections: selections(payload) };
  // A manual layout on seed (b): the main switch at the start of rail 0, the group block (RCD 35 mm,
  // then two 17.5 mm MCBs) packed at the start of rail 1.
  const fixedManual: Placement[] = [
    { projectDeviceId: SMALL.snapshot[0].id, railIndex: 0, xMm: 0 },
    { projectDeviceId: SMALL.snapshot[1].id, railIndex: 1, xMm: 0 },
    { projectDeviceId: SMALL.snapshot[2].id, railIndex: 1, xMm: 35 },
    { projectDeviceId: SMALL.snapshot[3].id, railIndex: 1, xMm: 52.5 },
  ];

  it("keeps a manual layout that still applies, marked, keyed by selection index", () => {
    expect(validateLayout(SMALL.snapshot, fixedManual, SEED_B, SMALL.groups)).toEqual([]);
    const choice = chooseSelectionLayout(
      { snapshot: SMALL.snapshot, placements: fixedManual, editedManually: true },
      matched,
      CATALOG,
      payload,
      SEED_B,
    );
    expect(choice).toEqual({
      layout: fixedManual.map((p) => ({ railIndex: p.railIndex, xMm: p.xMm })),
      editedManually: true,
      reset: false,
    });
  });

  it("re-proposes a layout that was not edited manually, without a reset notice", () => {
    const choice = chooseSelectionLayout(
      { snapshot: SMALL.snapshot, placements: fixedManual, editedManually: false },
      matched,
      CATALOG,
      payload,
      SEED_B,
    );
    expect(choice).toEqual({
      layout: proposeSelectionLayout(matched, CATALOG, payload, SEED_B),
      editedManually: false,
      reset: false,
    });
  });

  it("re-proposes and reports a reset when a circuit was added", () => {
    const grown: CircuitsPayload = {
      groups: payload.groups,
      circuits: [...payload.circuits, circuit(3, payload.groups[0].id)],
    };
    const result: MatchResult = { status: "matched", selections: selections(grown) };
    const choice = chooseSelectionLayout(
      { snapshot: SMALL.snapshot, placements: fixedManual, editedManually: true },
      result,
      CATALOG,
      grown,
      SEED_B,
    );
    expect(choice).toEqual({
      layout: proposeSelectionLayout(result, CATALOG, grown, SEED_B),
      editedManually: false,
      reset: true,
    });
    expect(choice.layout).toHaveLength(5);
  });

  it("stores nothing and reports no reset for a match that stores no snapshot", () => {
    const blocked: MatchResult = { status: "blocked", reasons: [{ code: "no_circuits" }] };
    expect(
      chooseSelectionLayout(
        { snapshot: SMALL.snapshot, placements: fixedManual, editedManually: true },
        blocked,
        CATALOG,
        payload,
        SEED_B,
      ),
    ).toEqual({ layout: undefined, editedManually: false, reset: false });
  });
});

// ---------------------------------------------------------------------------------------------
// RPC shapes and errors
// ---------------------------------------------------------------------------------------------

describe("placementsFromRows and saveLayoutArgs", () => {
  it("round-trip between the row shape and placements", () => {
    const rows = [
      { project_device_id: "d1", rail_index: 0, x_mm: 0 },
      { project_device_id: "d2", rail_index: 2, x_mm: 52.5 },
    ];
    const placements = placementsFromRows(rows);
    expect(placements).toEqual([
      { projectDeviceId: "d1", railIndex: 0, xMm: 0 },
      { projectDeviceId: "d2", railIndex: 2, xMm: 52.5 },
    ]);
    expect(saveLayoutArgs(PROJECT_ID, placements)).toEqual({
      p_project_id: PROJECT_ID,
      p_placements: rows,
      p_edited_manually: false,
    });
    expect(saveLayoutArgs(PROJECT_ID, placements, true)).toEqual({
      p_project_id: PROJECT_ID,
      p_placements: rows,
      p_edited_manually: true,
    });
  });
});

describe("layoutRpcErrorCode", () => {
  it("maps the RPC's two P0002 exceptions", () => {
    expect(layoutRpcErrorCode({ code: "P0002", message: "project_device_unavailable" })).toBe(
      PROJECT_ERROR.layoutDeviceUnavailable,
    );
    expect(layoutRpcErrorCode({ code: "P0002", message: "project_not_found" })).toBe(PROJECT_ERROR.notFound);
  });

  it("maps an RLS refusal to forbidden and falls back to the global mapping", () => {
    expect(layoutRpcErrorCode({ code: "42501" })).toBe(PROJECT_ERROR.forbidden);
    expect(layoutRpcErrorCode({ code: "23514" })).toBe(PROJECT_ERROR.invalidInput);
    expect(layoutRpcErrorCode({ code: "23505" })).toBe("23505");
    expect(layoutRpcErrorCode({})).toBe(PROJECT_ERROR.unknown);
  });
});

// ---------------------------------------------------------------------------------------------
// CPU budget (plan Phase 3 §5) — the Worker allows 10 ms of CPU per request
// ---------------------------------------------------------------------------------------------

describe("layout CPU budget", () => {
  it("proposes and validates the worst case (60 circuits, 20 groups) well inside the budget", () => {
    const worst = project(20, 3);
    const input = { devices: worst.snapshot, groups: worst.groups, circuits: worst.circuits, geometry: SEED_C };
    const run = () => {
      const result = proposeLayout(input);
      if (!result.ok) throw new Error(`worst-case fixture does not fit: ${JSON.stringify(result.reason)}`);
      return validateLayout(worst.snapshot, result.placements, SEED_C, worst.groups);
    };
    expect(run()).toEqual([]);

    for (let i = 0; i < 5; i++) run(); // warm-up
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      run();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const max = samples[samples.length - 1];
    // eslint-disable-next-line no-console
    console.info(
      `layout CPU budget: propose + validate, ${String(worst.snapshot.length)} devices on seed (c): median ${median.toFixed(2)} ms, max ${max.toFixed(2)} ms`,
    );
    // Generous on purpose so a slow CI runner never flakes; the recorded median is the real signal.
    expect(median).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------------------------
// CPU budget, second measurement (plan Phase 5 §1a) — the full render path
// ---------------------------------------------------------------------------------------------

describe("render path CPU budget", () => {
  it("matches, validates the stored layout and routes the wires (60 circuits, 20 groups) inside the budget", () => {
    const worst = project(20, 3);
    const catalog = [
      catalogDevice(FR_ID, "switch_disconnector", "2P", 35),
      // 3 × 16 A × 1.15 = 55.2 A: the groups need a 63 A RCD.
      catalogDevice(RCD_ID, "rcd", "2P", 35, { rated_current_a: 63 }),
      catalogDevice(MCB_ID, "mcb_b", "1P", 17.5),
    ];
    const base: MatchContext = {
      supply: {
        premeter_protection_a: 25,
        earthing_system: "TN-C-S",
        phase_count: 1,
        wlz_length_m: 12,
        wlz_cross_section_mm2: 10,
        wlz_material: "Cu",
        wlz_installation: "conduit_flush",
      },
      geometry: SEED_C,
      catalog,
      groups: worst.groups,
      circuits: worst.circuits,
      snapshot: [],
    };
    const fresh = computeMatchView(base).fresh;
    if (fresh.status !== "matched") throw new Error("worst-case fixture must match");
    const snapshot: SnapshotRow[] = fresh.selections.map((selection, position) => {
      const spec = catalog.find((device) => device.id === selection.deviceId);
      if (spec === undefined) throw new Error("unknown device");
      return {
        ...row(position, selection.role, spec.poles ?? "1P", spec.width_mm, {
          group: selection.groupId,
          circuit: selection.circuitId,
        }),
        device_id: spec.id,
        notes: [...selection.notes],
        poles: spec.poles,
        rated_current_a: spec.rated_current_a,
        n_terminal_side: spec.n_terminal_side,
      };
    });
    const context: MatchContext = { ...base, snapshot };
    const missing = computeLayoutView(computeMatchView(context), context, []);
    if (missing?.state !== "missing") throw new Error(`worst-case fixture must fit: ${String(missing?.state)}`);
    const stored = missing.proposal;

    const run = () => {
      const match = computeMatchView(context);
      const layout = computeLayoutView(match, context, stored);
      const conductors = computeWiring(layout, match, context);
      return { layout, conductors, wires: buildDrawnWires(conductors), lengths: wireLengthsBySection(conductors) };
    };
    const once = run();
    expect(once.layout?.state).toBe("placed");
    // 60 circuits × (L, N, PE) + WLZ (L, PEN, split link) + feeds (N to the bar, 20 RCDs × (L, N),
    // 60 MCBs × L) — less the bar conductors seed (c)'s bars have no terminal for (plan Phase 5c: one
    // conductor per terminal). PE bar: 62 conductors (60 circuit PEs, the WLZ PEN and the split link at
    // 10 mm²) on 20 terminals up to 16 mm² and 3 from 6 mm² — 22 land. N bar: 21 at 10 mm² (the main
    // switch's N and 20 RCDs' N) on 16 + 2 terminals — 18 land. 43 are left unrouted.
    expect(once.conductors).toHaveLength(60 * 3 + 3 + 1 + 20 * 2 + 60 - (62 - 22) - (21 - 18));

    for (let i = 0; i < 5; i++) run(); // warm-up
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      run();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    const median = samples[Math.floor(samples.length / 2)];
    const max = samples[samples.length - 1];
    // eslint-disable-next-line no-console
    console.info(
      `render path CPU budget: match + layout state + wiring, ${String(snapshot.length)} devices, ${String(once.conductors.length)} conductors on seed (c): median ${median.toFixed(2)} ms, max ${max.toFixed(2)} ms`,
    );
    // Generous on purpose so a slow CI runner never flakes; the recorded median is the real signal.
    expect(median).toBeLessThan(100);
  });
});

describe("previousLayoutFromReads (circuit save carry-over input, review F1)", () => {
  const device = {
    id: "d1",
    position: 0,
    role: "mcb",
    rcd_group_id: null,
    circuit_id: "c1",
    kind: "mcb_b",
    width_mm: 17.5,
    height_mm: 85,
    poles: "1P",
    n_terminal_side: null,
  } as const;
  const row = { project_device_id: "d1", rail_index: 0, x_mm: 8.75, edited_manually: true };
  const failed = { data: null, error: { code: "PGRST000" } };

  it("returns the stored snapshot, placements and marker when both reads succeed", () => {
    expect(previousLayoutFromReads({ data: [device], error: null }, { data: [row], error: null })).toEqual({
      snapshot: [device],
      placements: [{ projectDeviceId: "d1", railIndex: 0, xMm: 8.75 }],
      editedManually: true,
    });
  });

  it("knows no manual layout when the placements read fails, so nothing blocks the save", () => {
    expect(previousLayoutFromReads({ data: [device], error: null }, failed)).toEqual({
      snapshot: [],
      placements: [],
      editedManually: false,
    });
  });

  it("keeps the marker with no devices when only the snapshot read fails, so the save reports a reset", () => {
    expect(previousLayoutFromReads(failed, { data: [row], error: null })).toEqual({
      snapshot: [],
      placements: [{ projectDeviceId: "d1", railIndex: 0, xMm: 8.75 }],
      editedManually: true,
    });
  });
});
