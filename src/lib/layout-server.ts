import type { SupabaseClient } from "@supabase/supabase-js";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import {
  proposeLayout,
  validateLayout,
  type LayoutDevice,
  type LayoutFailure,
  type LayoutIssue,
  type Placement,
} from "@/lib/cabinet-layout";
import { routeConductors, type Conductor } from "@/lib/cabinet-wiring";
import type { CircuitsPayload } from "@/lib/circuit-params";
import type { Database, Tables } from "@/lib/database.types";
import type { DeviceSpecWithId, MatchResult } from "@/lib/device-matching";
import {
  loadMatchContext,
  type MatchContext,
  type MatchView,
  type ProjectMatchRow,
  type SelectionPlacements,
} from "@/lib/device-matching-server";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";

/**
 * The server side of the cabinet layout (S-05) — the layout counterpart of
 * `device-matching-server.ts`: loading the stored placements, deriving the page's layout state, and
 * shaping the two write paths (`save_project_circuits` with placements, `save_project_layout`).
 *
 * The contract the page relies on: a layout is shown only for a `current` match, and a stored
 * placement set is never trusted — it is `placed` only when it covers the snapshot exactly and
 * `validateLayout` finds nothing. Placements are written only by the two RPCs.
 */

export type PlacementRow = Pick<Tables<"project_device_placements">, "project_device_id" | "rail_index" | "x_mm">;

export function placementsFromRows(rows: readonly PlacementRow[]): Placement[] {
  return rows.map((row) => ({ projectDeviceId: row.project_device_id, railIndex: row.rail_index, xMm: row.x_mm }));
}

/**
 * - `placed`: the stored placements cover the snapshot exactly and pass `validateLayout`;
 * - `missing`: nothing is stored, and a proposal fits — `proposal` is what "Zaproponuj układ" stores;
 * - `does_not_fit`: the devices cannot be placed on this cabinet's rails;
 * - `outdated`: placements are stored but incomplete or failing validation, and a proposal fits.
 */
export type LayoutViewState = "placed" | "missing" | "does_not_fit" | "outdated";

export type LayoutView =
  | { state: "placed"; placements: Placement[] }
  | { state: "missing"; proposal: Placement[] }
  | { state: "does_not_fit"; failure: LayoutFailure }
  | { state: "outdated"; issues: LayoutIssue[]; proposal: Placement[] };

/**
 * The layout state for the page, or `null` when there is none to show: the match is not `current`
 * (the stored snapshot may not be compliant — S-08/S-09 rule), or the project's cabinet snapshot does
 * not parse (unreachable: only the cabinet trigger writes it, from a parsed geometry).
 *
 * A proposal is computed only when the stored placements are not `placed`. When the devices do not
 * fit, `does_not_fit` wins over `outdated`: re-proposing could not help.
 */
export function computeLayoutView(
  matchView: MatchView,
  context: Pick<MatchContext, "geometry" | "groups" | "circuits">,
  placements: readonly Placement[],
): LayoutView | null {
  if (matchView.state !== "current" || context.geometry === null) return null;
  const devices = matchView.snapshot;

  let issues: LayoutIssue[] = [];
  if (placements.length > 0) {
    issues = validateLayout(devices, placements, context.geometry, context.groups);
    if (issues.length === 0) return { state: "placed", placements: [...placements] };
  }

  const proposal = proposeLayout({
    devices,
    groups: context.groups,
    circuits: context.circuits,
    geometry: context.geometry,
  });
  if (!proposal.ok) return { state: "does_not_fit", failure: proposal.reason };
  if (placements.length > 0) return { state: "outdated", issues, proposal: proposal.placements };
  return { state: "missing", proposal: proposal.placements };
}

/**
 * The conductors of a `placed` layout (plan Phase 5), or none for every other state — wires are drawn
 * only over a layout that passed validation, and a `current` match always has a supply. Display-only:
 * nothing downstream decides on them.
 */
export function computeWiring(
  view: LayoutView | null,
  matchView: MatchView,
  context: Pick<MatchContext, "geometry" | "circuits" | "supply">,
): Conductor[] {
  if (view?.state !== "placed" || context.geometry === null || context.supply === null) return [];
  return routeConductors({
    geometry: context.geometry,
    devices: matchView.snapshot,
    placements: view.placements,
    circuits: context.circuits,
    supply: context.supply,
  });
}

/**
 * The layout for a fresh match, before it is saved: each selection becomes a `LayoutDevice` built
 * from its catalog row (the same row the snapshot trigger is about to copy), keyed by its index,
 * because the `project_devices` ids do not exist yet. Returns `undefined` — store no placements —
 * for anything but a `matched` result, a missing cabinet snapshot, a selection whose device is not
 * in the catalog (unreachable: the matcher picks from it), or a layout that does not fit; the page
 * then reports the layout state from the stored snapshot.
 */
export function proposeSelectionLayout(
  result: MatchResult,
  catalog: readonly DeviceSpecWithId[],
  payload: CircuitsPayload,
  geometry: CabinetGeometry | null,
): SelectionPlacements | undefined {
  if (geometry === null) return undefined;
  const devices = selectionLayoutDevices(result, catalog);
  if (devices === undefined) return undefined;

  const layout = proposeLayout({ devices, groups: payload.groups, circuits: payload.circuits, geometry });
  if (!layout.ok) return undefined;
  return selectionPlacements(devices, layout.placements);
}

/**
 * Placements keyed by the index ids of `selectionLayoutDevices`, as `SelectionPlacements` aligned with
 * the selections (null for a device without a placement).
 */
export function selectionPlacements(
  devices: readonly LayoutDevice[],
  placements: readonly Placement[],
): SelectionPlacements {
  const byIndex = new Map(placements.map((placement) => [placement.projectDeviceId, placement]));
  return devices.map((device) => {
    const placement = byIndex.get(device.id);
    return placement === undefined ? null : { railIndex: placement.railIndex, xMm: placement.xMm };
  });
}

/**
 * A `matched` result's selections as `LayoutDevice`s, each built from its catalog row (the same row
 * the snapshot trigger is about to copy) and keyed by its index, because the `project_devices` ids do
 * not exist yet. `undefined` for any other result, or when a selection's device is not in the catalog
 * (unreachable: the matcher picks from it). Shared by `proposeSelectionLayout` and the carry-over of a
 * manual layout (`carryOverPlacements` in `src/lib/layout-editing.ts`).
 */
export function selectionLayoutDevices(
  result: MatchResult,
  catalog: readonly DeviceSpecWithId[],
): LayoutDevice[] | undefined {
  if (result.status !== "matched") return undefined;

  const byId = new Map(catalog.map((device) => [device.id, device]));
  const devices: LayoutDevice[] = [];
  for (const [index, selection] of result.selections.entries()) {
    const spec = byId.get(selection.deviceId);
    if (spec === undefined) return undefined;
    devices.push({
      id: String(index),
      position: index,
      role: selection.role,
      rcd_group_id: selection.groupId,
      circuit_id: selection.circuitId,
      kind: spec.kind,
      width_mm: spec.width_mm,
      height_mm: spec.height_mm,
      poles: spec.poles,
      n_terminal_side: spec.n_terminal_side,
    });
  }
  return devices;
}

/** The `save_project_layout` arguments. */
export function saveLayoutArgs(
  projectId: string,
  placements: readonly Placement[],
): Database["public"]["Functions"]["save_project_layout"]["Args"] {
  const rows = placements.map((placement) => ({
    project_device_id: placement.projectDeviceId,
    rail_index: placement.railIndex,
    x_mm: placement.xMm,
  }));
  return { p_project_id: projectId, p_placements: rows };
}

/**
 * Maps a `save_project_layout` failure to a `?error=` code, by SQLSTATE and the RPC's machine
 * exception name — never by Supabase's English text.
 */
export function layoutRpcErrorCode(error: { code?: string | null; message?: string | null }): string {
  if (error.code === "P0002") {
    if (error.message === "project_device_unavailable") return PROJECT_ERROR.layoutDeviceUnavailable;
    if (error.message === "project_not_found") return PROJECT_ERROR.notFound;
  }
  if (error.code === "42501") return PROJECT_ERROR.forbidden;
  return projectErrorFromPostgrest(error);
}

/** Everything the layout state needs: the match context plus the stored placements. */
export interface LayoutContext {
  context: MatchContext;
  placements: Placement[];
}

export type LoadLayoutContextResult = ({ ok: true } & LayoutContext) | { ok: false; code: "not_found" | "unknown" };

/**
 * `loadMatchContext` and the project's placements, read as the signed-in user in parallel. Any
 * PostgREST error is `unknown`; a project the caller cannot see is `not_found`.
 */
export async function loadLayoutContext(
  supabase: SupabaseClient<Database>,
  projectId: string,
  project?: ProjectMatchRow,
): Promise<LoadLayoutContextResult> {
  const [match, placements] = await Promise.all([
    loadMatchContext(supabase, projectId, project),
    supabase
      .from("project_device_placements")
      .select("project_device_id, rail_index, x_mm")
      .eq("project_id", projectId),
  ]);
  if (!match.ok) return match;
  if (placements.error !== null) {
    // Only the SQLSTATE / PostgREST code — never Supabase's message text.
    // eslint-disable-next-line no-console
    console.error("layout context load failed: project_device_placements", placements.error.code);
    return { ok: false, code: "unknown" };
  }
  return { ok: true, context: match.context, placements: placementsFromRows(placements.data) };
}
