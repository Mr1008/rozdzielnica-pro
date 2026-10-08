import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import {
  validateLayout,
  type LayoutDevice,
  type LayoutGroup,
  type LayoutIssue,
  type Placement,
} from "@/lib/cabinet-layout";
import { isUuid } from "@/lib/catalog";
import { DIN_MODULE_MM } from "@/lib/din-module";

/**
 * Manual layout editing (FR-009, S-06): the pure model behind the layout editor island. Client-safe —
 * no server-only imports — so the island and the endpoints share it.
 *
 * The one invariant: a move is accepted only when the whole resulting placement set passes
 * `validateLayout`, the same validator that guards the proposal and every render. A draft that
 * started valid therefore stays valid, and a refused move never changes it. Rule 1 is not relaxed:
 * a group's devices may only reorder inside the group, and a whole group moves as one packed block.
 * A group wider than every rail (rule 1's continuation across rails) has no block unit: one packed
 * block would never fit a rail, so it is edited device by device.
 *
 * The 0.5 TE grid (`snapX`) is an editor affordance only — the proposal itself places devices off it
 * when it fills from a rail end, so nothing here or on the server enforces it.
 */

/** A placement set in snapshot (`position`) order. Its `DrawnDevice[]` come from `buildDrawnDevices`. */
export interface LayoutDraft {
  placements: Placement[];
}

/** What every move is checked against: the snapshot devices, the cabinet snapshot and the groups. */
export interface EditContext {
  devices: readonly LayoutDevice[];
  geometry: CabinetGeometry;
  /** Ordered by position. */
  groups: readonly Pick<LayoutGroup, "id">[];
}

/**
 * What the editor can pick up: a whole RCD group (`block`), or a single device. The main switch,
 * ungrouped MCBs and catalog bars are free devices (`groupId: null`); a group's device carries its
 * group and may only reorder inside it.
 */
export type EditUnit =
  | { kind: "block"; groupId: string; deviceIds: string[] }
  | { kind: "device"; deviceId: string; groupId: string | null };

export interface MoveTarget {
  railIndex: number;
  /** The unit's left edge, from the rail start. */
  xMm: number;
}

export type MoveResult = { ok: true; draft: LayoutDraft } | { ok: false; issues: LayoutIssue[] };

/** Float tolerance for millimetre comparisons; every real quantity is a multiple of 0.01 mm. */
const EPS = 1e-6;

/** The editor's grid: half a DIN module. */
export const SNAP_STEP_MM = DIN_MODULE_MM / 2;

function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The group a device belongs to for rule 1 — the main switch never belongs to one. */
function groupOf(device: LayoutDevice): string | null {
  return device.role === "main_switch" ? null : device.rcd_group_id;
}

/** RCD / RCBO first, then the rest in snapshot order — the order the proposal packs a group in. */
function leadFirst(devices: readonly LayoutDevice[]): LayoutDevice[] {
  const sorted = [...devices].sort((a, b) => a.position - b.position);
  const lead = sorted.filter((device) => device.role === "rcd" || device.role === "rcbo");
  return [...lead, ...sorted.filter((device) => !lead.includes(device))];
}

// ---------------------------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------------------------

/**
 * The movable units: one `block` per non-empty RCD group (stored group order, then any group id the
 * list lacks, in snapshot order; RCD / RCBO first), then one `device` unit per device in snapshot
 * order. With `geometry`, a group wider than every rail gets no block: packed onto one rail it would
 * always be refused, so its handle would do nothing.
 */
export function editUnits(
  devices: readonly LayoutDevice[],
  groups: readonly Pick<LayoutGroup, "id">[],
  geometry?: Pick<CabinetGeometry, "rails">,
): EditUnit[] {
  const maxRailMm = geometry === undefined ? Infinity : Math.max(...geometry.rails.map((rail) => rail.lengthMm));
  const sorted = [...devices].sort((a, b) => a.position - b.position);
  const groupIds = groups.map((group) => group.id);
  for (const device of sorted) {
    const groupId = groupOf(device);
    if (groupId !== null && !groupIds.includes(groupId)) groupIds.push(groupId);
  }
  const blocks: EditUnit[] = groupIds.flatMap((groupId) => {
    const members = sorted.filter((device) => groupOf(device) === groupId);
    if (members.length === 0) return [];
    if (members.reduce((sum, device) => sum + device.width_mm, 0) > maxRailMm + EPS) return [];
    return [{ kind: "block" as const, groupId, deviceIds: leadFirst(members).map((device) => device.id) }];
  });
  const singles: EditUnit[] = sorted.map((device) => ({
    kind: "device" as const,
    deviceId: device.id,
    groupId: groupOf(device),
  }));
  return [...blocks, ...singles];
}

// ---------------------------------------------------------------------------------------------
// Snapping and keyboard steps
// ---------------------------------------------------------------------------------------------

/**
 * `xMm` rounded to the nearest multiple of 0.5 TE from the rail start, then clamped so a unit
 * `widthMm` wide stays on the rail: `[0, lengthMm − widthMm]` (0 when the unit is wider than the rail).
 * The upper bound may be off the grid; staying on the rail wins.
 */
export function snapX(rail: Pick<CabinetGeometry["rails"][number], "lengthMm">, xMm: number, widthMm: number): number {
  const snapped = Math.round(xMm / SNAP_STEP_MM) * SNAP_STEP_MM;
  return roundMm(Math.max(0, Math.min(snapped, rail.lengthMm - widthMm)));
}

export type StepDirection = "left" | "right" | "up" | "down";

/** The unit's devices, each with its current placement, in rail then x order. */
function locatedMembers(context: EditContext, draft: LayoutDraft, unit: EditUnit) {
  const ids = unit.kind === "block" ? unit.deviceIds : [unit.deviceId];
  const byId = new Map(context.devices.map((device) => [device.id, device]));
  return draft.placements
    .filter((placement) => ids.includes(placement.projectDeviceId))
    .flatMap((placement) => {
      const device = byId.get(placement.projectDeviceId);
      return device === undefined ? [] : [{ device, placement }];
    })
    .sort((a, b) => a.placement.railIndex - b.placement.railIndex || a.placement.xMm - b.placement.xMm);
}

function unitWidth(members: readonly { device: LayoutDevice }[]): number {
  return members.reduce((sum, member) => sum + member.device.width_mm, 0);
}

/**
 * Where one keyboard step takes the unit: 0.5 TE left or right on its rail, or the adjacent rail in
 * the geometry's rail order (`up` = the previous index, `down` = the next) with the snapped x kept.
 * At an edge the unit stays put. A preview position, not a verdict — the drop is judged by
 * `moveUnit`. Null when the unit is not placed in the draft.
 */
export function keyboardStep(
  context: EditContext,
  draft: LayoutDraft,
  unit: EditUnit,
  direction: StepDirection,
): MoveTarget | null {
  const members = locatedMembers(context, draft, unit);
  const first = members.at(0);
  if (first === undefined) return null;
  const width = unitWidth(members);
  const { railIndex, xMm } = first.placement;
  const rails = context.geometry.rails;
  if (direction === "left" || direction === "right") {
    const rail = rails.at(railIndex);
    if (rail === undefined) return null;
    const delta = direction === "left" ? -SNAP_STEP_MM : SNAP_STEP_MM;
    return { railIndex, xMm: snapX(rail, xMm + delta, width) };
  }
  const nextIndex = Math.max(0, Math.min(rails.length - 1, railIndex + (direction === "up" ? -1 : 1)));
  return { railIndex: nextIndex, xMm: snapX(rails[nextIndex], xMm, width) };
}

// ---------------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------------

/** The draft with these placements replaced, kept in the draft's (snapshot) order. */
function withPlacements(draft: LayoutDraft, changed: readonly Placement[]): LayoutDraft {
  const byId = new Map(changed.map((placement) => [placement.projectDeviceId, placement]));
  return { placements: draft.placements.map((placement) => byId.get(placement.projectDeviceId) ?? placement) };
}

/** Devices laid side by side on one rail from `xMm`, in the given order. */
function packed(devices: readonly LayoutDevice[], railIndex: number, xMm: number): Placement[] {
  let x = xMm;
  return devices.map((device) => {
    const placement = { projectDeviceId: device.id, railIndex, xMm: roundMm(x) };
    x += device.width_mm;
    return placement;
  });
}

/**
 * What the editor draws while a unit is dragged or lifted: the unit's devices laid side by side, in
 * their current order, from `target` — with no verdict. Overlaps and rule 1 are not checked here; the
 * drop is judged by `moveUnit`. Never mutates the draft.
 */
export function previewMove(context: EditContext, draft: LayoutDraft, unit: EditUnit, target: MoveTarget): LayoutDraft {
  const members = locatedMembers(context, draft, unit);
  return withPlacements(
    draft,
    packed(
      members.map((member) => member.device),
      target.railIndex,
      target.xMm,
    ),
  );
}

/**
 * Moves a unit so its left edge lands on `target`. A block keeps its devices packed, in their current
 * x order; a device unit is `moveDevice`. Accepted only when the result passes `validateLayout`;
 * never mutates the draft.
 */
export function moveUnit(context: EditContext, draft: LayoutDraft, unit: EditUnit, target: MoveTarget): MoveResult {
  if (unit.kind === "device") return moveDevice(context, draft, unit.deviceId, target);
  const members = locatedMembers(context, draft, unit);
  const next = withPlacements(
    draft,
    packed(
      members.map((member) => member.device),
      target.railIndex,
      target.xMm,
    ),
  );
  const issues = validateLayout(context.devices, next.placements, context.geometry, context.groups);
  return issues.length === 0 ? { ok: true, draft: next } : { ok: false, issues };
}

/**
 * Moves one device so its left edge lands on `target`.
 *
 * - A device of a group with other members may only reorder: when the dropped device's centre falls
 *   inside the span its group covers on the target rail, the group's devices there are re-packed from
 *   the span's start with the device inserted by its centre. Any other drop would break rule 1 and is
 *   refused with `group_not_contiguous`.
 * - Every other device (the main switch, an ungrouped MCB, a catalog bar, an RCBO alone in its group)
 *   moves freely.
 *
 * Accepted only when the result passes `validateLayout`; never mutates the draft.
 */
export function moveDevice(context: EditContext, draft: LayoutDraft, deviceId: string, target: MoveTarget): MoveResult {
  const device = context.devices.find((candidate) => candidate.id === deviceId);
  if (device === undefined) return { ok: false, issues: [{ code: "unknown_device", deviceId }] };

  const groupId = groupOf(device);
  const mates =
    groupId === null
      ? []
      : context.devices.filter((candidate) => candidate.id !== device.id && groupOf(candidate) === groupId);

  let changed: Placement[];
  if (groupId === null || mates.length === 0) {
    changed = [{ projectDeviceId: device.id, railIndex: target.railIndex, xMm: roundMm(target.xMm) }];
  } else {
    const reordered = reorderInGroup(context, draft, device, groupId, target);
    if (reordered === null) return { ok: false, issues: [{ code: "group_not_contiguous", groupId }] };
    changed = reordered;
  }

  const next = withPlacements(draft, changed);
  const issues = validateLayout(context.devices, next.placements, context.geometry, context.groups);
  return issues.length === 0 ? { ok: true, draft: next } : { ok: false, issues };
}

/**
 * The group's placements on the target rail after inserting `device` by its dropped centre, re-packed
 * from the span's start; null when the centre falls outside the span the group covers there.
 */
function reorderInGroup(
  context: EditContext,
  draft: LayoutDraft,
  device: LayoutDevice,
  groupId: string,
  target: MoveTarget,
): Placement[] | null {
  const byId = new Map(context.devices.map((candidate) => [candidate.id, candidate]));
  const onRail = draft.placements
    .filter((placement) => placement.railIndex === target.railIndex)
    .flatMap((placement) => {
      const member = byId.get(placement.projectDeviceId);
      return member !== undefined && groupOf(member) === groupId ? [{ device: member, placement }] : [];
    })
    .sort((a, b) => a.placement.xMm - b.placement.xMm);
  const first = onRail.at(0);
  const last = onRail.at(-1);
  if (first === undefined || last === undefined) return null;

  const spanStart = first.placement.xMm;
  const spanEnd = last.placement.xMm + last.device.width_mm;
  const centre = target.xMm + device.width_mm / 2;
  if (centre < spanStart - EPS || centre > spanEnd + EPS) return null;

  const others = onRail.filter((member) => member.device.id !== device.id);
  // A centre that lands exactly on a neighbour's centre passes it in the direction of the move, so a
  // one-module step past a same-width neighbour swaps the two instead of changing nothing.
  const current = onRail.find((member) => member.device.id === device.id)?.placement.xMm;
  const movingLeft = current !== undefined && target.xMm < current - EPS;
  const index = others.findIndex((member) => {
    const memberCentre = member.placement.xMm + member.device.width_mm / 2;
    return movingLeft ? centre <= memberCentre + EPS : centre < memberCentre - EPS;
  });
  const order = others.map((member) => member.device);
  order.splice(index === -1 ? order.length : index, 0, device);
  return packed(order, target.railIndex, spanStart);
}

// ---------------------------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------------------------

/** The most undo steps kept; older ones are dropped. */
export const HISTORY_LIMIT = 50;

export interface History<T> {
  past: readonly T[];
  present: T;
  future: readonly T[];
}

/**
 * Immutable undo/redo over accepted drafts. Only an accepted move is committed, so a refused one
 * never enters the history. Every function returns a new history and leaves its input untouched.
 */
export const history = {
  start<T>(present: T): History<T> {
    return { past: [], present, future: [] };
  },
  /** `next` becomes the present; the old present is undoable; redo is cleared. */
  commit<T>(current: History<T>, next: T): History<T> {
    const past = [...current.past, current.present].slice(-HISTORY_LIMIT);
    return { past, present: next, future: [] };
  },
  undo<T>(current: History<T>): History<T> {
    const previous = current.past.at(-1);
    if (previous === undefined) return current;
    return { past: current.past.slice(0, -1), present: previous, future: [current.present, ...current.future] };
  },
  redo<T>(current: History<T>): History<T> {
    const next = current.future.at(0);
    if (next === undefined) return current;
    return {
      past: [...current.past, current.present].slice(-HISTORY_LIMIT),
      present: next,
      future: current.future.slice(1),
    };
  },
  /** A fresh history at `present` — after a save, a cancel or a restored draft. */
  reset<T>(present: T): History<T> {
    return { past: [], present, future: [] };
  },
};

// ---------------------------------------------------------------------------------------------
// The hidden field
// ---------------------------------------------------------------------------------------------

/** The editor's hidden field, shared by the island and the endpoint. */
export const LAYOUT_FORM_FIELDS = { placements: "placements_payload" } as const;

export const MAX_PLACEMENTS = 200;
/** `project_device_placements.rail_index` is a `smallint`. */
export const MAX_RAIL_INDEX = 32767;
/** `project_device_placements.x_mm` is `numeric(7,2)`. */
export const MAX_X_MM = 99999.99;

export type PlacementsPayloadResult = { ok: true; placements: Placement[] } | { ok: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isXMm(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_X_MM &&
    Number(value.toFixed(2)) === value
  );
}

function isRailIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_RAIL_INDEX;
}

/**
 * The parsed hidden field (the endpoint `JSON.parse`s it; this takes the result): an array of
 * `{ projectDeviceId, railIndex, xMm }`. Never throws and carries no message — a rejection means a
 * tampered or scripted POST, because the island submits only drafts it built. Keys other than the
 * three are dropped. Coverage and geometry are `validateLayout`'s job on the server.
 */
export function parsePlacementsPayload(raw: unknown): PlacementsPayloadResult {
  if (!Array.isArray(raw) || raw.length > MAX_PLACEMENTS) return { ok: false };
  const seen = new Set<string>();
  const placements: Placement[] = [];
  for (const item of raw as unknown[]) {
    if (!isRecord(item)) return { ok: false };
    const { projectDeviceId, railIndex, xMm } = item;
    if (!isUuid(projectDeviceId) || !isRailIndex(railIndex) || !isXMm(xMm)) return { ok: false };
    const key = projectDeviceId.toLowerCase();
    if (seen.has(key)) return { ok: false };
    seen.add(key);
    placements.push({ projectDeviceId, railIndex, xMm });
  }
  return { ok: true, placements };
}

// ---------------------------------------------------------------------------------------------
// Carry-over across a re-match
// ---------------------------------------------------------------------------------------------

/** Groups and circuits keep their ids across saves, so this pairs an old device with its successor. */
function carryKey(device: Pick<LayoutDevice, "role" | "rcd_group_id" | "circuit_id">): string {
  return JSON.stringify([device.role, device.rcd_group_id, device.circuit_id]);
}

function keyed(devices: readonly LayoutDevice[]): Map<string, LayoutDevice> | null {
  const map = new Map<string, LayoutDevice>();
  for (const device of devices) {
    const key = carryKey(device);
    if (map.has(key)) return null;
    map.set(key, device);
  }
  return map;
}

/**
 * A manual layout carried onto a new device set, or null when it no longer applies as a whole. Old
 * and new devices pair by `(role, rcd_group_id, circuit_id)`; the result is keyed by the `next` ids,
 * in `next`'s position order. Null when a key repeats on either side, a new device has no old
 * counterpart, an old placement has no new device, or the carried set fails `validateLayout` (say, a
 * wider replacement device now overlaps its neighbour). There is no partial carry-over: the caller
 * then stores a fresh proposal.
 */
export function carryOverPlacements(
  old: { devices: readonly LayoutDevice[]; placements: readonly Placement[] },
  next: readonly LayoutDevice[],
  geometry: CabinetGeometry,
  groups: readonly Pick<LayoutGroup, "id">[],
): Placement[] | null {
  const oldByKey = keyed(old.devices);
  const nextByKey = keyed(next);
  if (oldByKey === null || nextByKey === null) return null;

  const oldById = new Map(old.devices.map((device) => [device.id, device]));
  const placementByOldId = new Map<string, Placement>();
  for (const placement of old.placements) {
    const device = oldById.get(placement.projectDeviceId);
    if (device === undefined || !nextByKey.has(carryKey(device))) return null;
    placementByOldId.set(device.id, placement);
  }

  const carried: Placement[] = [];
  for (const device of [...next].sort((a, b) => a.position - b.position)) {
    const counterpart = oldByKey.get(carryKey(device));
    const placement = counterpart === undefined ? undefined : placementByOldId.get(counterpart.id);
    if (placement === undefined) return null;
    carried.push({ projectDeviceId: device.id, railIndex: placement.railIndex, xMm: placement.xMm });
  }

  return validateLayout(next, carried, geometry, groups).length === 0 ? carried : null;
}
