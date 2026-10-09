import type { Placement } from "@/lib/cabinet-layout";
import { SEED_B, SEED_C } from "@/lib/cabinet-layout.fixtures";
import type { CircuitInput, RcdGroupInput } from "@/lib/circuit-params";
import type { DeviceSpecWithId, Selection } from "@/lib/device-matching";
import { computeMatchView, type MatchContext, type SnapshotRow } from "@/lib/device-matching-server";
import { parseDeviceSpec, polesCarryN, type DeviceKind, type PoleConfig } from "@/lib/device-spec";
import { computeLayoutView } from "@/lib/layout-server";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";

/**
 * Fixed project fixtures for the render-path CPU measurements: the worst case (60 circuits, 20
 * groups, seed cabinet (c)) and a realistic project (12 circuits, 4 groups, seed cabinet (b)). The
 * unit test in `layout-server.test.ts` and the throwaway benchmark Worker in `scripts/wiring-bench/`
 * import the same builders, so both measure the same input.
 *
 * Bundle-safe on purpose: it imports only the pure render-path modules, never a loader that talks to
 * Supabase at runtime (`layout-server.ts` and `device-matching-server.ts` import the client as a type
 * only).
 */

export const PROJECT_ID = "5b1d6a3e-0c2f-4e8a-9b7d-1a2b3c4d5e6f";

const ROLE_KIND = {
  main_switch: "switch_disconnector",
  rcd: "rcd",
  rcbo: "rcbo",
  mcb: "mcb_b",
  pe_bar: "pe_bar",
  n_bar: "n_bar",
  busbar: "comb_busbar",
} as const;

export function uuid(prefix: string, n: number): string {
  return `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

export function group(n: number): RcdGroupInput {
  return {
    id: uuid("7c2e8b4f", n),
    label: `RCD ${String(n)}`,
    residual_current_ma: 30,
    min_rcd_type: "A",
    rcd_margin_percent: 15,
  };
}

export function circuit(n: number, groupId: string | null, entry: CircuitInput["entry_side"] = "top"): CircuitInput {
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

export function row(
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
    busbar_piece: null,
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
export function project(groupCount: number, perGroup: number) {
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

export function catalogDevice(
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
    comb_busbar: { rated_current_a: 63 },
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

export const FR_ID = "a1000000-0000-4000-8000-0000000000f1";
export const RCD_ID = "a1000000-0000-4000-8000-0000000000f2";
export const MCB_ID = "a1000000-0000-4000-8000-0000000000f3";

/** What the render path needs: the match context (snapshot included) and the stored placements. */
export interface RenderFixture {
  context: MatchContext;
  /** The stored layout — a proposal for the snapshot, so the layout state is `placed`. */
  placements: Placement[];
}

/** Matches `groupCount` × `perGroup` circuits on `geometry` and stores the proposed layout. */
export function renderFixture(groupCount: number, perGroup: number, geometry: CabinetGeometry): RenderFixture {
  const generated = project(groupCount, perGroup);
  // perGroup × 16 A × 1.15 stays under 63 A for the sizes used here: the groups need a 63 A RCD.
  const catalog = [
    catalogDevice(FR_ID, "switch_disconnector", "2P", 35),
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
    geometry,
    catalog,
    groups: generated.groups,
    circuits: generated.circuits,
    snapshot: [],
  };
  const fresh = computeMatchView(base).fresh;
  if (fresh.status !== "matched") throw new Error("render fixture must match");
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
  if (missing?.state !== "missing") throw new Error(`render fixture must fit: ${String(missing?.state)}`);
  return { context, placements: missing.proposal };
}

/** 60 circuits in 20 RCD groups on seed cabinet (c): the largest project the editor accepts. */
export function worstCaseFixture(): RenderFixture {
  return renderFixture(20, 3, SEED_C);
}

/** 12 circuits in 4 RCD groups on seed cabinet (b): a typical single-family house. */
export function realisticFixture(): RenderFixture {
  return renderFixture(4, 3, SEED_B);
}
