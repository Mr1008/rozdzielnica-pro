import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCabinetGeometry, type CabinetGeometry } from "@/lib/cabinet-geometry";
import {
  parseCircuitsPayload,
  type CircuitInput,
  type CircuitsPayload,
  type RcdGroupInput,
} from "@/lib/circuit-params";
import type { Database, Json, Tables } from "@/lib/database.types";
import {
  activeCatalog,
  matchDevices,
  sameSelection,
  type DeviceSpecWithId,
  type MatchResult,
  type Selection,
  type SelectionNote,
  type SelectionRole,
} from "@/lib/device-matching";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";
import { supplyFromRow, type SupplyParams } from "@/lib/supply-params";

/**
 * The server side of the device matcher: loading everything `matchDevices` needs for one project,
 * comparing a fresh match with the stored `project_devices` snapshot, and shaping the
 * `save_project_circuits` RPC call. The contract the page and endpoints rely on: nothing is shown as
 * matched unless it comes from the stored snapshot — a fresh result is only ever a preview or the
 * signal that the snapshot went stale.
 */

export type SnapshotRow = Tables<"project_devices">;

export interface MatchContext {
  supply: SupplyParams | null;
  /** Ordered by position. */
  groups: RcdGroupInput[];
  /** Ordered by stored position. */
  circuits: CircuitInput[];
  /** The project's parsed `cabinet_geometry` snapshot, or null if it does not parse. */
  geometry: CabinetGeometry | null;
  /** The active, well-formed catalog. */
  catalog: DeviceSpecWithId[];
  /** Ordered by position. */
  snapshot: SnapshotRow[];
}

export type LoadMatchContextResult = { ok: true; context: MatchContext } | { ok: false; code: "not_found" | "unknown" };

const SUPPLY_COLUMNS =
  "premeter_protection_a, earthing_system, phase_count, wlz_length_m, wlz_cross_section_mm2, wlz_material, wlz_installation";

function logLoadFailure(what: string, code: string | null | undefined): void {
  // Only the SQLSTATE / PostgREST code — never Supabase's message text.
  // eslint-disable-next-line no-console
  console.error(`match context load failed: ${what}`, code);
}

/**
 * Everything the matcher needs for one project, read as the signed-in user (RLS decides visibility:
 * a project that is not the caller's reads as `not_found`). Any PostgREST error is `unknown`.
 */
export async function loadMatchContext(
  supabase: SupabaseClient<Database>,
  projectId: string,
): Promise<LoadMatchContextResult> {
  const [project, groups, circuits, snapshot, devices] = await Promise.all([
    supabase.from("projects").select(`${SUPPLY_COLUMNS}, cabinet_geometry`).eq("id", projectId).maybeSingle(),
    supabase.from("rcd_groups").select("*").eq("project_id", projectId).order("position"),
    supabase.from("circuits").select("*").eq("project_id", projectId).order("position"),
    supabase.from("project_devices").select("*").eq("project_id", projectId).order("position"),
    supabase.from("devices").select("*").is("archived_at", null),
  ]);

  const failures: [string, { code?: string | null } | null][] = [
    ["projects", project.error],
    ["rcd_groups", groups.error],
    ["circuits", circuits.error],
    ["project_devices", snapshot.error],
    ["devices", devices.error],
  ];
  for (const [what, error] of failures) {
    if (error !== null) {
      logLoadFailure(what, error.code);
      return { ok: false, code: "unknown" };
    }
  }
  if (project.data === null) return { ok: false, code: "not_found" };

  // Stored rows passed the table CHECKs; the parser narrows them to the input types (and drops
  // `position`, `project_id`, …). A failure here is unreachable in practice and never guessed around.
  const parsed = parseCircuitsPayload({ groups: groups.data ?? [], circuits: circuits.data ?? [] });
  if (!parsed.ok) {
    logLoadFailure("stored circuits do not parse", parsed.issues.at(0)?.code);
    return { ok: false, code: "unknown" };
  }

  const geometry = parseCabinetGeometry(project.data.cabinet_geometry);
  return {
    ok: true,
    context: {
      supply: supplyFromRow(project.data),
      groups: parsed.value.groups,
      circuits: parsed.value.circuits,
      geometry: geometry.ok ? geometry.geometry : null,
      catalog: activeCatalog(devices.data ?? []),
      snapshot: snapshot.data ?? [],
    },
  };
}

const SELECTION_ROLES: readonly string[] = ["main_switch", "rcd", "rcbo", "mcb"] satisfies SelectionRole[];
const SELECTION_NOTES: readonly string[] = ["rcbo_fallback", "no_rcd"] satisfies SelectionNote[];

function isRole(value: string): value is SelectionRole {
  return SELECTION_ROLES.includes(value);
}

function isNote(value: string): value is SelectionNote {
  return SELECTION_NOTES.includes(value);
}

/**
 * The stored snapshot as selections, for comparison with a fresh match. A row with a role or note
 * outside the known lists (unreachable past the CHECKs) is dropped whole rather than repaired, so
 * the comparison can only come out as a mismatch — "stale" is the safe direction.
 */
export function snapshotSelections(rows: readonly SnapshotRow[]): Selection[] {
  const selections: Selection[] = [];
  for (const row of rows) {
    if (!isRole(row.role) || !row.notes.every(isNote)) continue;
    selections.push({
      role: row.role,
      deviceId: row.device_id,
      groupId: row.rcd_group_id,
      circuitId: row.circuit_id,
      notes: row.notes.filter(isNote),
    });
  }
  return selections;
}

/**
 * - `blocked` / `gaps`: the fresh match fails — whatever the snapshot holds is not shown as matched;
 * - `cleared`: the fresh match succeeds but nothing is stored — `fresh` is a preview only;
 * - `current`: the stored snapshot equals the fresh match;
 * - `stale`: both exist and differ (catalog or circuits changed since the save).
 */
export type MatchViewState = "current" | "stale" | "cleared" | "gaps" | "blocked";

export interface MatchView {
  state: MatchViewState;
  fresh: MatchResult;
  snapshot: SnapshotRow[];
}

export function computeMatchView(context: MatchContext): MatchView {
  const fresh = matchDevices(
    { supply: context.supply, groups: context.groups, circuits: context.circuits },
    context.catalog,
  );
  const view = (state: MatchViewState): MatchView => ({ state, fresh, snapshot: context.snapshot });
  if (fresh.status === "blocked") return view("blocked");
  if (fresh.status === "gaps") return view("gaps");
  if (context.snapshot.length === 0) return view("cleared");
  return view(sameSelection(snapshotSelections(context.snapshot), fresh.selections) ? "current" : "stale");
}

/** Interfaces carry no index signature, so a plain object array needs a cast to the RPC's `Json`. */
function toJson(rows: readonly object[]): Json {
  return rows as unknown as Json;
}

/**
 * The `save_project_circuits` arguments. Only a `matched` result stores a snapshot; a gap or a block
 * stores none (`p_device_ids: []`), so a partial or unguarded device set is never persisted.
 */
export function saveCircuitsArgs(
  projectId: string,
  payload: CircuitsPayload,
  result: MatchResult,
): Database["public"]["Functions"]["save_project_circuits"]["Args"] {
  const devices =
    result.status === "matched"
      ? result.selections.map((selection) => ({
          device_id: selection.deviceId,
          role: selection.role,
          rcd_group_id: selection.groupId,
          circuit_id: selection.circuitId,
          notes: selection.notes,
        }))
      : [];
  return {
    p_project_id: projectId,
    p_groups: toJson(payload.groups),
    p_circuits: toJson(payload.circuits),
    p_device_ids: toJson(devices),
  };
}

/**
 * Maps a `save_project_circuits` failure to a `?error=` code. The RPC raises `P0002` for two
 * distinct reasons, told apart by its (machine, English-free) exception name; every other code goes
 * through `projectErrorFromPostgrest`, where a bare `P0002` still means the cabinet trigger.
 */
export function circuitsRpcErrorCode(error: { code?: string | null; message?: string | null }): string {
  if (error.code === "P0002") {
    if (error.message === "device_unavailable") return PROJECT_ERROR.deviceUnavailable;
    if (error.message === "project_not_found") return PROJECT_ERROR.notFound;
  }
  if (error.code === "42501") return PROJECT_ERROR.forbidden;
  return projectErrorFromPostgrest(error);
}
