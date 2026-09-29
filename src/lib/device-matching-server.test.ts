import { describe, expect, it } from "vitest";
import type { CircuitInput, CircuitsPayload, RcdGroupInput } from "./circuit-params";
import type { DeviceSpecWithId, MatchResult, Selection } from "./device-matching";
import {
  circuitsRpcErrorCode,
  computeMatchView,
  saveCircuitsArgs,
  snapshotSelections,
  type MatchContext,
  type SnapshotRow,
} from "./device-matching-server";
import { parseDeviceSpec } from "./device-spec";
import { PROJECT_ERROR } from "./project-errors";
import type { SupplyParams } from "./supply-params";

const PROJECT_ID = "5b1d6a3e-0c2f-4e8a-9b7d-1a2b3c4d5e6f";
const GROUP_ID = "7c2e8b4f-1d3a-4f9b-8c6e-2b3c4d5e6f70";
const CIRCUIT_A = "8d3f9c5a-2e4b-4a0c-9d7f-3c4d5e6f7081";
const CIRCUIT_B = "9e4a0d6b-3f5c-4b1d-8e8a-4d5e6f708192";
const FR_ID = "a1000000-0000-4000-8000-000000000001";
const RCD_ID = "a1000000-0000-4000-8000-000000000002";
const MCB_ID = "a1000000-0000-4000-8000-000000000003";

function device(id: string, row: Record<string, unknown>): DeviceSpecWithId {
  const parsed = parseDeviceSpec({
    name: id,
    manufacturer: "Alfa",
    model: id,
    price_grosze: 1000,
    width_mm: 17.5,
    height_mm: 85,
    depth_mm: 70,
    ...row,
  });
  if (!parsed.ok) throw new Error(`fixture ${id} does not parse: ${JSON.stringify(parsed.issues)}`);
  return { ...parsed.spec, id };
}

const CATALOG: DeviceSpecWithId[] = [
  device(FR_ID, { kind: "switch_disconnector", rated_current_a: 40, poles: "2P" }),
  device(RCD_ID, { kind: "rcd", rated_current_a: 40, residual_current_ma: 30, rcd_type: "A", poles: "2P" }),
  device(MCB_ID, { kind: "mcb_b", rated_current_a: 16, poles: "1P", breaking_capacity_ka: 6 }),
];

const SUPPLY: SupplyParams = {
  premeter_protection_a: 32,
  earthing_system: "TN-C-S",
  phase_count: 1,
  wlz_length_m: 12,
  wlz_cross_section_mm2: 16,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

const GROUP: RcdGroupInput = { id: GROUP_ID, label: "Grupa 1", residual_current_ma: 30, min_rcd_type: "A" };

function circuit(id: string, overrides: Partial<CircuitInput> = {}): CircuitInput {
  return {
    id,
    rcd_group_id: GROUP_ID,
    name: `Obwód ${id.slice(0, 4)}`,
    rated_current_a: 16,
    phase_count: 1,
    cross_section_mm2: 2.5,
    installation: "conduit_flush",
    entry_side: "top",
    ...overrides,
  };
}

const PAYLOAD: CircuitsPayload = { groups: [GROUP], circuits: [circuit(CIRCUIT_A), circuit(CIRCUIT_B)] };

/** What the matcher picks for `PAYLOAD` over `CATALOG`. */
const EXPECTED: Selection[] = [
  { role: "main_switch", deviceId: FR_ID, groupId: null, circuitId: null, notes: [] },
  { role: "rcd", deviceId: RCD_ID, groupId: GROUP_ID, circuitId: null, notes: [] },
  { role: "mcb", deviceId: MCB_ID, groupId: GROUP_ID, circuitId: CIRCUIT_A, notes: [] },
  { role: "mcb", deviceId: MCB_ID, groupId: GROUP_ID, circuitId: CIRCUIT_B, notes: [] },
];

function snapshotRow(selection: Selection, position: number, overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: `b2000000-0000-4000-8000-00000000000${String(position)}`,
    project_id: PROJECT_ID,
    position,
    role: selection.role,
    device_id: selection.deviceId,
    rcd_group_id: selection.groupId,
    circuit_id: selection.circuitId,
    notes: [...selection.notes],
    kind: "mcb_b",
    name: "x",
    manufacturer: "Alfa",
    model: "x",
    price_grosze: 1000,
    width_mm: 17.5,
    height_mm: 85,
    depth_mm: 70,
    poles: "1P",
    rated_current_a: 16,
    residual_current_ma: null,
    rcd_type: null,
    breaking_capacity_ka: 6,
    created_at: "2026-09-29T00:00:00Z",
    ...overrides,
  };
}

const STORED: SnapshotRow[] = EXPECTED.map((selection, i) => snapshotRow(selection, i));

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    supply: SUPPLY,
    groups: PAYLOAD.groups,
    circuits: PAYLOAD.circuits,
    geometry: null,
    catalog: CATALOG,
    snapshot: STORED,
    ...overrides,
  };
}

describe("snapshotSelections", () => {
  it("turns stored rows into selections, in order", () => {
    expect(snapshotSelections(STORED)).toEqual(EXPECTED);
  });

  it("keeps known notes", () => {
    const row = snapshotRow({ ...EXPECTED[2], notes: ["rcbo_fallback"] }, 0);
    expect(snapshotSelections([row])[0]?.notes).toEqual(["rcbo_fallback"]);
  });

  it("drops a row with an unknown role or note whole, so a comparison can only mismatch", () => {
    const badRole = snapshotRow(EXPECTED[0], 0, { role: "fuse" });
    const badNote = snapshotRow(EXPECTED[1], 1, { notes: ["no_rcd", "mystery"] });
    expect(snapshotSelections([badRole, badNote, STORED[2]])).toEqual([EXPECTED[2]]);
  });
});

describe("computeMatchView", () => {
  it("is current when the stored snapshot equals the fresh match", () => {
    const view = computeMatchView(context());
    expect(view.state).toBe("current");
    expect(view.fresh).toEqual({ status: "matched", selections: EXPECTED });
    expect(view.snapshot).toBe(STORED);
  });

  it("is stale when the stored snapshot differs from the fresh match", () => {
    const cheaperMcb = device("a1000000-0000-4000-8000-000000000009", {
      kind: "mcb_b",
      rated_current_a: 16,
      poles: "1P",
      breaking_capacity_ka: 6,
      price_grosze: 500,
    });
    expect(computeMatchView(context({ catalog: [...CATALOG, cheaperMcb] })).state).toBe("stale");
  });

  it("is stale when the snapshot is shorter than the fresh match", () => {
    expect(computeMatchView(context({ snapshot: STORED.slice(0, 3) })).state).toBe("stale");
  });

  it("is cleared when the fresh match succeeds but nothing is stored — a preview only", () => {
    const view = computeMatchView(context({ snapshot: [] }));
    expect(view.state).toBe("cleared");
    expect(view.fresh.status).toBe("matched");
    expect(view.snapshot).toEqual([]);
  });

  it("is gaps when the catalog lacks a device, even with a stored snapshot", () => {
    const view = computeMatchView(context({ catalog: CATALOG.filter((d) => d.id !== RCD_ID) }));
    expect(view.state).toBe("gaps");
    expect(view.fresh.status).toBe("gaps");
  });

  it("is blocked when the supply is missing, even with a stored snapshot", () => {
    const view = computeMatchView(context({ supply: null }));
    expect(view.state).toBe("blocked");
    expect(view.fresh).toEqual({ status: "blocked", reasons: [{ code: "supply_missing" }] });
  });
});

describe("saveCircuitsArgs", () => {
  it("passes the payload rows and the matched selections as device ids", () => {
    const result: MatchResult = { status: "matched", selections: EXPECTED };
    expect(saveCircuitsArgs(PROJECT_ID, PAYLOAD, result)).toEqual({
      p_project_id: PROJECT_ID,
      p_groups: PAYLOAD.groups,
      p_circuits: PAYLOAD.circuits,
      p_device_ids: EXPECTED.map((s) => ({
        device_id: s.deviceId,
        role: s.role,
        rcd_group_id: s.groupId,
        circuit_id: s.circuitId,
        notes: s.notes,
      })),
    });
  });

  it("stores no snapshot for a catalog gap", () => {
    const result: MatchResult = {
      status: "gaps",
      gaps: [{ role: "main_switch", kind: "switch_disconnector", poles: ["2P"], minRatedCurrentA: 32 }],
    };
    expect(saveCircuitsArgs(PROJECT_ID, PAYLOAD, result).p_device_ids).toEqual([]);
  });

  it("stores no snapshot for a blocked match", () => {
    const result: MatchResult = { status: "blocked", reasons: [{ code: "no_circuits" }] };
    const args = saveCircuitsArgs(PROJECT_ID, { groups: [], circuits: [] }, result);
    expect(args.p_device_ids).toEqual([]);
    expect(args.p_groups).toEqual([]);
    expect(args.p_circuits).toEqual([]);
  });
});

describe("circuitsRpcErrorCode", () => {
  it("tells the RPC's two P0002 exceptions apart", () => {
    expect(circuitsRpcErrorCode({ code: "P0002", message: "device_unavailable" })).toBe(
      PROJECT_ERROR.deviceUnavailable,
    );
    expect(circuitsRpcErrorCode({ code: "P0002", message: "project_not_found" })).toBe(PROJECT_ERROR.notFound);
  });

  it("maps any other P0002 through the global mapping", () => {
    expect(circuitsRpcErrorCode({ code: "P0002", message: "something else" })).toBe(PROJECT_ERROR.cabinetUnavailable);
  });

  it("maps the cross-project ownership refusals to forbidden", () => {
    expect(circuitsRpcErrorCode({ code: "42501", message: "group_belongs_to_another_project" })).toBe(
      PROJECT_ERROR.forbidden,
    );
    expect(circuitsRpcErrorCode({ code: "42501", message: "circuit_belongs_to_another_project" })).toBe(
      PROJECT_ERROR.forbidden,
    );
  });

  it("falls back to the global mapping for everything else", () => {
    expect(circuitsRpcErrorCode({ code: "23514", message: "x" })).toBe(PROJECT_ERROR.invalidInput);
    expect(circuitsRpcErrorCode({ code: "23505" })).toBe("23505");
    expect(circuitsRpcErrorCode({})).toBe(PROJECT_ERROR.unknown);
  });
});
