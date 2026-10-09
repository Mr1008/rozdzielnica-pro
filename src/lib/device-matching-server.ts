import type { SupabaseClient } from "@supabase/supabase-js";
import { builtInBarKinds, type BarKind } from "@/lib/bar-conductors";
import { parseCabinetGeometry, type CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Placement } from "@/lib/cabinet-layout";
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
  SELECTION_ROLES,
  type DeviceSpecWithId,
  type MatchResult,
  type Selection,
  type SelectionNote,
  type SelectionRole,
} from "@/lib/device-matching";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";
import { supplyFromRow, type SupplyParams, type SupplyRow } from "@/lib/supply-params";

/**
 * The server side of the device matcher: loading everything `matchDevices` needs for one project,
 * comparing a fresh match with the stored `project_devices` snapshot, and shaping the
 * `save_project_circuits` RPC call. The contract the page and endpoints rely on: nothing is shown as
 * matched unless it comes from the stored snapshot — a fresh result is only ever a preview or the
 * signal that the snapshot went stale.
 */

export type SnapshotRow = Tables<"project_devices">;

/** What matching a submitted set needs: the supply, the cabinet snapshot and the catalog. */
export interface MatchBase {
  supply: SupplyParams | null;
  /** The project's parsed `cabinet_geometry` snapshot, or null if it does not parse. */
  geometry: CabinetGeometry | null;
  /** The active, well-formed catalog. */
  catalog: DeviceSpecWithId[];
}

/** The base plus the project's stored groups, circuits and device snapshot. */
export interface MatchContext extends MatchBase {
  /** Ordered by position. */
  groups: RcdGroupInput[];
  /** Ordered by stored position. */
  circuits: CircuitInput[];
  /** Ordered by position. */
  snapshot: SnapshotRow[];
}

/** The project columns the base reads. A caller that already loaded them passes the row in. */
export type ProjectMatchRow = SupplyRow & Pick<Tables<"projects">, "cabinet_geometry">;

interface LoadFailure {
  ok: false;
  code: "not_found" | "unknown";
}
export type LoadMatchBaseResult = { ok: true; base: MatchBase } | LoadFailure;
export type LoadMatchContextResult = { ok: true; context: MatchContext } | LoadFailure;

const SUPPLY_COLUMNS =
  "premeter_protection_a, earthing_system, phase_count, wlz_length_m, wlz_cross_section_mm2, wlz_material, wlz_installation";

function logLoadFailure(what: string, code: string | null | undefined): void {
  // Only the SQLSTATE / PostgREST code — never Supabase's message text.
  // eslint-disable-next-line no-console
  console.error(`match context load failed: ${what}`, code);
}

function hasId(row: unknown): row is { id: unknown } {
  return typeof row === "object" && row !== null && "id" in row;
}

/**
 * The active catalog, parsed. A row `activeCatalog` drops is logged by id only: a malformed catalog
 * device otherwise surfaces as an unexplained catalog gap, and `wrangler tail` is the only trace.
 */
function parseCatalog(rows: readonly unknown[]): DeviceSpecWithId[] {
  const catalog = activeCatalog(rows);
  if (catalog.length < rows.length) {
    const kept = new Set(catalog.map((device) => device.id));
    const dropped = rows.flatMap((row) => (hasId(row) && !kept.has(row.id as string) ? [String(row.id)] : []));
    // eslint-disable-next-line no-console
    console.error("match catalog: devices dropped as unparseable", dropped);
  }
  return catalog;
}

/**
 * The supply, cabinet snapshot and active catalog for one project, read as the signed-in user (RLS
 * decides visibility: a project that is not the caller's reads as `not_found`). Pass `project` when
 * the row is already loaded, to skip re-reading it. Any PostgREST error is `unknown`.
 */
export async function loadMatchBase(
  supabase: SupabaseClient<Database>,
  projectId: string,
  project?: ProjectMatchRow,
): Promise<LoadMatchBaseResult> {
  const [projectRow, devices] = await Promise.all([
    project
      ? Promise.resolve({ data: project, error: null })
      : supabase.from("projects").select(`${SUPPLY_COLUMNS}, cabinet_geometry`).eq("id", projectId).maybeSingle(),
    supabase.from("devices").select("*").is("archived_at", null),
  ]);
  for (const [what, error] of [
    ["projects", projectRow.error],
    ["devices", devices.error],
  ] as const) {
    if (error !== null) {
      logLoadFailure(what, error.code);
      return { ok: false, code: "unknown" };
    }
  }
  if (projectRow.data === null) return { ok: false, code: "not_found" };

  const geometry = parseCabinetGeometry(projectRow.data.cabinet_geometry);
  return {
    ok: true,
    base: {
      supply: supplyFromRow(projectRow.data),
      geometry: geometry.ok ? geometry.geometry : null,
      catalog: parseCatalog(devices.data ?? []),
    },
  };
}

/** Everything the page and the re-match need: the base plus the stored rows. */
export async function loadMatchContext(
  supabase: SupabaseClient<Database>,
  projectId: string,
  project?: ProjectMatchRow,
): Promise<LoadMatchContextResult> {
  const [base, groups, circuits, snapshot] = await Promise.all([
    loadMatchBase(supabase, projectId, project),
    supabase.from("rcd_groups").select("*").eq("project_id", projectId).order("position"),
    supabase.from("circuits").select("*").eq("project_id", projectId).order("position"),
    supabase.from("project_devices").select("*").eq("project_id", projectId).order("position"),
  ]);
  if (!base.ok) return base;
  for (const [what, error] of [
    ["rcd_groups", groups.error],
    ["circuits", circuits.error],
    ["project_devices", snapshot.error],
  ] as const) {
    if (error !== null) {
      logLoadFailure(what, error.code);
      return { ok: false, code: "unknown" };
    }
  }

  // Stored rows passed the table CHECKs; the parser narrows them to the input types (and drops
  // `position`, `project_id`, …). A failure here is unreachable in practice and never guessed around.
  const parsed = parseCircuitsPayload({ groups: groups.data ?? [], circuits: circuits.data ?? [] });
  if (!parsed.ok) {
    logLoadFailure("stored circuits do not parse", parsed.issues.at(0)?.code);
    return { ok: false, code: "unknown" };
  }

  return {
    ok: true,
    context: {
      ...base.base,
      groups: parsed.value.groups,
      circuits: parsed.value.circuits,
      snapshot: snapshot.data ?? [],
    },
  };
}

const SELECTION_NOTES: readonly string[] = [
  "rcbo_fallback",
  "no_rcd",
  "busbar_missing",
  "busbar_group_too_wide",
] satisfies SelectionNote[];

function isRole(value: string): value is SelectionRole {
  return (SELECTION_ROLES as readonly string[]).includes(value);
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
      busbarPiece: row.busbar_piece,
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

/**
 * The bar kinds built into a project's cabinet snapshot, for `MatchInput.cabinetBarKinds`: a kind
 * missing here is matched from the catalog. A snapshot that does not parse (unreachable: only the
 * cabinet trigger writes it, from a parsed geometry) gives `null` — no bar is required, rather than
 * one invented for a cabinet nobody can see.
 */
export function cabinetBarKinds(geometry: CabinetGeometry | null): BarKind[] | null {
  return geometry === null ? null : builtInBarKinds(geometry);
}

/**
 * The longest DIN rail of a project's cabinet snapshot, for `MatchInput.maxRailMm`: the widest group
 * a busbar may serve. A snapshot that does not parse gives `null` — no busbar is selected.
 */
export function maxRailMm(geometry: CabinetGeometry | null): number | null {
  return geometry === null ? null : Math.max(...geometry.rails.map((rail) => rail.lengthMm));
}

export function computeMatchView(context: MatchContext): MatchView {
  const fresh = matchDevices(
    {
      supply: context.supply,
      groups: context.groups,
      circuits: context.circuits,
      cabinetBarKinds: cabinetBarKinds(context.geometry),
      maxRailMm: maxRailMm(context.geometry),
    },
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
 * A proposed layout for a fresh match, aligned with `result.selections` by index (the RPC stores
 * selection i at position i). The `project_devices` ids do not exist before the insert, so the
 * placements travel by position. `null` leaves that device unplaced.
 */
export type SelectionPlacements = readonly (Pick<Placement, "railIndex" | "xMm"> | null)[];

/**
 * The `save_project_circuits` arguments. Only a `matched` result stores a snapshot; a gap or a block
 * stores none (`p_device_ids: []`), so a partial or unguarded device set is never persisted. With a
 * `layout` (from `chooseSelectionLayout` in `src/lib/layout-server.ts`), each placed item also
 * carries `rail_index` / `x_mm` and the RPC stores its placement in the same transaction; with
 * `editedManually` (a manual layout carried over, S-06) each placed item also carries
 * `edited_manually: true`. Unplaced items never carry the marker.
 */
export function saveCircuitsArgs(
  projectId: string,
  payload: CircuitsPayload,
  result: MatchResult,
  layout?: SelectionPlacements,
  editedManually = false,
): Database["public"]["Functions"]["save_project_circuits"]["Args"] {
  const devices =
    result.status === "matched"
      ? result.selections.map((selection, index) => {
          const placement = layout?.[index] ?? null;
          return {
            device_id: selection.deviceId,
            role: selection.role,
            rcd_group_id: selection.groupId,
            circuit_id: selection.circuitId,
            notes: selection.notes,
            // Only a busbar segment carries a piece; it is never placed on a rail.
            ...(selection.busbarPiece === null ? {} : { busbar_piece: selection.busbarPiece }),
            ...(placement === null
              ? {}
              : {
                  rail_index: placement.railIndex,
                  x_mm: placement.xMm,
                  ...(editedManually ? { edited_manually: true } : {}),
                }),
          };
        })
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
