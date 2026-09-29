import { z } from "zod";
import { ENTRY_SIDES } from "@/lib/cabinet-geometry";
import {
  CIRCUIT_CROSS_SECTIONS_MM2,
  CIRCUIT_PHASE_COUNTS,
  CIRCUIT_RATED_CURRENTS_A,
  DEFAULT_MIN_RCD_TYPE,
  DEFAULT_RESIDUAL_CURRENT_MA,
  MAX_CIRCUITS,
  MAX_GROUPS,
  RESIDUAL_CURRENTS_MA,
  type CircuitInput,
  type CircuitsPayload,
  type EntrySide,
  type RcdGroupInput,
} from "@/lib/circuit-params";
import { RCD_TYPES } from "@/lib/device-spec";
import { t } from "@/lib/i18n";
import { WLZ_INSTALLATIONS } from "@/lib/supply-params";

/**
 * The circuit editor's state and every transition behind its drag-and-drop and button equivalents.
 * All operations are pure: they return a new draft, and an unknown id returns the draft unchanged.
 *
 * Unlike the admin editors' drafts, every select here holds its typed value (all of them are closed
 * lists) and only the free-text fields (`label`, `name`) may be empty while typing. Ids are the
 * row ids that get submitted — client-supplied UUIDs, because a circuit points at its group by id
 * before either is saved — and double as React keys. Nothing here validates: `draftToPayload`
 * produces the candidate that `parseCircuitsPayload` judges.
 *
 * Order: `groups` is in list order. `circuits` is kept canonical — group by group in group order,
 * then the ungrouped ("Bez grupy") ones — so filtering by `rcd_group_id` yields each container's
 * order and the flat array position is the saved `position`.
 */

export type GroupDraft = RcdGroupInput;
export type CircuitDraft = CircuitInput;

export interface CircuitDraftState {
  groups: GroupDraft[];
  circuits: CircuitDraft[];
}

/** The circuit fields a row edits in place; its container changes only through the move operations. */
export type CircuitPatch = Partial<Omit<CircuitDraft, "id" | "rcd_group_id">>;
export type GroupPatch = Partial<Omit<GroupDraft, "id">>;

export type IdFactory = () => string;

const defaultId: IdFactory = () => crypto.randomUUID();

export const EMPTY_CIRCUIT_DRAFT: CircuitDraftState = { groups: [], circuits: [] };

/** New circuits: B16, one phase, 2.5 mm² in flush conduit — the everyday socket circuit. */
export const NEW_CIRCUIT_DEFAULTS = {
  rated_current_a: 16,
  phase_count: 1,
  cross_section_mm2: 2.5,
  installation: "conduit_flush",
  entry_side: "top",
} as const satisfies Omit<CircuitDraft, "id" | "rcd_group_id" | "name">;

function oneOf<T>(list: readonly T[]) {
  return z.custom<T>((value) => (list as readonly unknown[]).includes(value));
}

/** The shape a draft stored in `sessionStorage` must have to be restored. */
export const circuitDraftSchema = z.object({
  groups: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      residual_current_ma: oneOf(RESIDUAL_CURRENTS_MA),
      min_rcd_type: oneOf(RCD_TYPES),
    }),
  ),
  circuits: z.array(
    z.object({
      id: z.string(),
      rcd_group_id: z.string().nullable(),
      name: z.string(),
      rated_current_a: oneOf(CIRCUIT_RATED_CURRENTS_A),
      phase_count: oneOf(CIRCUIT_PHASE_COUNTS),
      cross_section_mm2: oneOf(CIRCUIT_CROSS_SECTIONS_MM2),
      installation: oneOf(WLZ_INSTALLATIONS),
      entry_side: oneOf<EntrySide>(ENTRY_SIDES),
    }),
  ),
}) satisfies z.ZodType<CircuitDraftState>;

/** "RCD n" with the lowest n no group's (trimmed) label already uses. */
export function nextGroupLabel(groups: readonly GroupDraft[]): string {
  const used = new Set(groups.map((group) => group.label.trim()));
  let n = 1;
  while (used.has(t.circuits.defaultGroupLabel(n))) n += 1;
  return t.circuits.defaultGroupLabel(n);
}

function hasGroup(draft: CircuitDraftState, groupId: string | null): boolean {
  return groupId === null || draft.groups.some((group) => group.id === groupId);
}

/** Each container's circuits, in order. Ungrouped under `null`. */
function containers(circuits: readonly CircuitDraft[]): Map<string | null, CircuitDraft[]> {
  const map = new Map<string | null, CircuitDraft[]>();
  for (const circuit of circuits) {
    const list = map.get(circuit.rcd_group_id) ?? [];
    list.push(circuit);
    map.set(circuit.rcd_group_id, list);
  }
  return map;
}

/**
 * The canonical flat order: groups in order, then ungrouped. A circuit pointing at a group that is
 * not in the draft (never produced here) is kept last, untouched, for the parser to report.
 */
function canonical(groups: readonly GroupDraft[], circuits: readonly CircuitDraft[]): CircuitDraft[] {
  const byContainer = containers(circuits);
  const ordered = [...groups.map((group) => group.id), null].flatMap((id) => byContainer.get(id) ?? []);
  const known = new Set(ordered);
  return [...ordered, ...circuits.filter((circuit) => !known.has(circuit))];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max);
}

export function addGroup(draft: CircuitDraftState, newId: IdFactory = defaultId): CircuitDraftState {
  if (draft.groups.length >= MAX_GROUPS) return draft;
  const group: GroupDraft = {
    id: newId(),
    label: nextGroupLabel(draft.groups),
    residual_current_ma: DEFAULT_RESIDUAL_CURRENT_MA,
    min_rcd_type: DEFAULT_MIN_RCD_TYPE,
  };
  return { ...draft, groups: [...draft.groups, group] };
}

/** The group's circuits move to the end of "Bez grupy", keeping their relative order. */
export function removeGroup(draft: CircuitDraftState, groupId: string): CircuitDraftState {
  if (!draft.groups.some((group) => group.id === groupId)) return draft;
  const groups = draft.groups.filter((group) => group.id !== groupId);
  const ungroupedBefore = draft.circuits.filter((circuit) => circuit.rcd_group_id === null);
  const released = draft.circuits
    .filter((circuit) => circuit.rcd_group_id === groupId)
    .map((circuit) => ({ ...circuit, rcd_group_id: null }));
  const others = draft.circuits.filter((circuit) => circuit.rcd_group_id !== groupId && circuit.rcd_group_id !== null);
  return { groups, circuits: canonical(groups, [...others, ...ungroupedBefore, ...released]) };
}

export function updateGroup(draft: CircuitDraftState, groupId: string, patch: GroupPatch): CircuitDraftState {
  if (!draft.groups.some((group) => group.id === groupId)) return draft;
  return {
    ...draft,
    groups: draft.groups.map((group) => (group.id === groupId ? { ...group, ...patch, id: group.id } : group)),
  };
}

/** `toIndex` is the group's final index, clamped to the list. */
export function moveGroup(draft: CircuitDraftState, groupId: string, toIndex: number): CircuitDraftState {
  const from = draft.groups.findIndex((group) => group.id === groupId);
  if (from < 0 || !Number.isFinite(toIndex)) return draft;
  const to = clamp(toIndex, 0, draft.groups.length - 1);
  if (to === from) return draft;
  const groups = [...draft.groups];
  const [moved] = groups.splice(from, 1);
  groups.splice(to, 0, moved);
  return { groups, circuits: canonical(groups, draft.circuits) };
}

/** The up/down button equivalent of dragging a group. */
export function moveGroupBy(draft: CircuitDraftState, groupId: string, delta: number): CircuitDraftState {
  const from = draft.groups.findIndex((group) => group.id === groupId);
  if (from < 0) return draft;
  return moveGroup(draft, groupId, from + delta);
}

export interface AddCircuitOptions {
  entrySide?: EntrySide;
  newId?: IdFactory;
}

/** A new circuit at the end of the container. An unknown group returns the draft unchanged. */
export function addCircuit(
  draft: CircuitDraftState,
  groupId: string | null,
  { entrySide = NEW_CIRCUIT_DEFAULTS.entry_side, newId = defaultId }: AddCircuitOptions = {},
): CircuitDraftState {
  if (!hasGroup(draft, groupId) || draft.circuits.length >= MAX_CIRCUITS) return draft;
  const circuit: CircuitDraft = {
    ...NEW_CIRCUIT_DEFAULTS,
    id: newId(),
    rcd_group_id: groupId,
    name: t.circuits.defaultCircuitName(draft.circuits.length + 1),
    entry_side: entrySide,
  };
  return { ...draft, circuits: canonical(draft.groups, [...draft.circuits, circuit]) };
}

export function removeCircuit(draft: CircuitDraftState, circuitId: string): CircuitDraftState {
  if (!draft.circuits.some((circuit) => circuit.id === circuitId)) return draft;
  return { ...draft, circuits: draft.circuits.filter((circuit) => circuit.id !== circuitId) };
}

export function updateCircuit(draft: CircuitDraftState, circuitId: string, patch: CircuitPatch): CircuitDraftState {
  if (!draft.circuits.some((circuit) => circuit.id === circuitId)) return draft;
  return {
    ...draft,
    circuits: draft.circuits.map((circuit) =>
      circuit.id === circuitId ? { ...circuit, ...patch, id: circuit.id, rcd_group_id: circuit.rcd_group_id } : circuit,
    ),
  };
}

/**
 * Moves a circuit into `toGroupId` (`null` = "Bez grupy") at `toIndex`, its final index within that
 * container — counted without the circuit itself, clamped to 0…length. Covers reordering within a
 * container and moving across containers. An unknown circuit or group returns the draft unchanged.
 */
export function moveCircuit(
  draft: CircuitDraftState,
  circuitId: string,
  toGroupId: string | null,
  toIndex: number,
): CircuitDraftState {
  const circuit = draft.circuits.find((candidate) => candidate.id === circuitId);
  if (!circuit || !hasGroup(draft, toGroupId) || !Number.isFinite(toIndex)) return draft;
  const rest = draft.circuits.filter((candidate) => candidate.id !== circuitId);
  const target = rest.filter((candidate) => candidate.rcd_group_id === toGroupId);
  const to = clamp(toIndex, 0, target.length);
  const moved = { ...circuit, rcd_group_id: toGroupId };
  // Insert before the circuit currently at `to` in the target container, or after its last one.
  const anchor = target.at(to);
  let at: number;
  if (anchor) {
    at = rest.indexOf(anchor);
  } else {
    const last = target.at(-1);
    at = last ? rest.indexOf(last) + 1 : rest.length;
  }
  const circuits = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return { ...draft, circuits: canonical(draft.groups, circuits) };
}

/** The up/down button equivalent of dragging a circuit within its container. */
export function moveCircuitBy(draft: CircuitDraftState, circuitId: string, delta: number): CircuitDraftState {
  const circuit = draft.circuits.find((candidate) => candidate.id === circuitId);
  if (!circuit) return draft;
  const container = draft.circuits.filter((candidate) => candidate.rcd_group_id === circuit.rcd_group_id);
  return moveCircuit(draft, circuitId, circuit.rcd_group_id, container.indexOf(circuit) + delta);
}

/** The "Grupa" select equivalent: the circuit goes to the end of the chosen container. */
export function setCircuitGroup(
  draft: CircuitDraftState,
  circuitId: string,
  groupId: string | null,
): CircuitDraftState {
  const circuit = draft.circuits.find((candidate) => candidate.id === circuitId);
  if (!circuit || circuit.rcd_group_id === groupId) return draft;
  return moveCircuit(draft, circuitId, groupId, Number.MAX_SAFE_INTEGER);
}

/** The candidate for `parseCircuitsPayload`: groups in list order, circuits group by group. */
export function draftToPayload(draft: CircuitDraftState): CircuitsPayload {
  return {
    groups: draft.groups.map((group) => ({ ...group })),
    circuits: canonical(draft.groups, draft.circuits).map((circuit) => ({ ...circuit })),
  };
}

type Positioned<T> = T & { position?: number | null };

export interface StoredCircuitRows {
  groups: readonly Positioned<RcdGroupInput>[];
  circuits: readonly Positioned<CircuitInput>[];
}

function byPosition<T extends { position?: number | null }>(rows: readonly T[]): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.position ?? a.index) - (b.row.position ?? b.index) || a.index - b.index)
    .map(({ row }) => row);
}

/**
 * The editor's starting state from stored rows (sorted by `position`, extra columns dropped) or a
 * plain payload. `null` — nothing saved yet — is the empty draft.
 */
export function payloadToDraft(rows: StoredCircuitRows | null): CircuitDraftState {
  if (rows === null) return EMPTY_CIRCUIT_DRAFT;
  const groups = byPosition(rows.groups).map(({ id, label, residual_current_ma, min_rcd_type }): GroupDraft => ({
    id,
    label,
    residual_current_ma,
    min_rcd_type,
  }));
  const circuits = byPosition(rows.circuits).map(
    ({
      id,
      rcd_group_id,
      name,
      rated_current_a,
      phase_count,
      cross_section_mm2,
      installation,
      entry_side,
    }): CircuitDraft => ({
      id,
      rcd_group_id,
      name,
      rated_current_a,
      phase_count,
      cross_section_mm2,
      installation,
      entry_side,
    }),
  );
  return { groups, circuits: canonical(groups, circuits) };
}
