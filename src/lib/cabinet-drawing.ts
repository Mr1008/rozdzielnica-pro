import {
  barRect,
  railRect,
  type CabinetGeometry,
  type GeometryElementKind,
  type GeometryIssue,
  type Rect,
} from "@/lib/cabinet-geometry";
import { deviceRect, type LayoutGroup, type Placement } from "@/lib/cabinet-layout";
import type { Tables } from "@/lib/database.types";
import { t } from "@/lib/i18n";

/**
 * Pure front-view geometry for `CabinetDrawing`. Kept out of the component so it stays hook-free and
 * testable; nothing here validates — `parseCabinetGeometry` does that.
 */

type Interior = CabinetGeometry["interior"];
type Entry = CabinetGeometry["entries"][number];

/** A rail, entry or bar by position in its collection. `index` is 0-based. */
export interface ElementRef {
  kind: GeometryElementKind;
  index: number;
}

/** Entry zones are drawn as a strip along their edge, inside the interior. */
function entryThicknessMm(interior: Interior): number {
  return Math.max(4, Math.round(Math.min(interior.widthMm, interior.heightMm) * 0.03));
}

export function entryRect(entry: Entry, interior: Interior): Rect {
  const thickness = entryThicknessMm(interior);
  switch (entry.side) {
    case "top":
      return { x: entry.offsetMm, y: 0, w: entry.lengthMm, h: thickness };
    case "bottom":
      return { x: entry.offsetMm, y: interior.heightMm - thickness, w: entry.lengthMm, h: thickness };
    case "left":
      return { x: 0, y: entry.offsetMm, w: thickness, h: entry.lengthMm };
    case "right":
      return { x: interior.widthMm - thickness, y: entry.offsetMm, w: thickness, h: entry.lengthMm };
  }
}

/** The element's drawn rectangle, or `null` when the geometry has no such element. */
export function elementRect(geometry: CabinetGeometry, { kind, index }: ElementRef): Rect | null {
  if (kind === "rail") {
    const rail = geometry.rails.at(index);
    return rail ? railRect(rail) : null;
  }
  if (kind === "entry") {
    const entry = geometry.entries.at(index);
    return entry ? entryRect(entry, geometry.interior) : null;
  }
  const bar = geometry.bars.at(index);
  return bar ? barRect(bar) : null;
}

/** The part of `rect` inside the interior, or `null` when none of it is. */
export function clipRect(rect: Rect, interior: Interior): Rect | null {
  const x = Math.max(rect.x, 0);
  const y = Math.max(rect.y, 0);
  const w = Math.min(rect.x + rect.w, interior.widthMm) - x;
  const h = Math.min(rect.y + rect.h, interior.heightMm) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/**
 * `rect` squashed into the interior: each axis is clamped to the interior's range, so a rectangle
 * wholly outside becomes a segment (or, off a corner, a point) on the edge it lies beyond. The
 * drawing marks such an element there, since nothing of it is visible.
 */
export function clampRect(rect: Rect, interior: Interior): Rect {
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const x = clamp(rect.x, interior.widthMm);
  const y = clamp(rect.y, interior.heightMm);
  return {
    x,
    y,
    w: clamp(rect.x + rect.w, interior.widthMm) - x,
    h: clamp(rect.y + rect.h, interior.heightMm) - y,
  };
}

/** Each element named by at least one issue, once, in first-seen order. */
export function issueElements(issues: readonly GeometryIssue[]): ElementRef[] {
  const seen = new Set<string>();
  const elements: ElementRef[] = [];
  for (const { element } of issues) {
    if (!element) continue;
    const key = `${element.kind}:${String(element.index)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    elements.push({ kind: element.kind, index: element.index });
  }
  return elements;
}

// ---------------------------------------------------------------------------------------------
// Devices on the rails
// ---------------------------------------------------------------------------------------------

/** What the drawing needs of a `project_devices` row; a stored row is one as is. */
export type DrawableDevice = Pick<
  Tables<"project_devices">,
  | "id"
  | "role"
  | "rcd_group_id"
  | "width_mm"
  | "height_mm"
  | "rated_current_a"
  | "residual_current_ma"
  | "n_terminal_side"
>;

export type DrawnRole = "main_switch" | "rcd" | "rcbo" | "mcb";

/** One device ready to draw: its rectangle in millimetres, its label lines and its group. */
export interface DrawnDevice {
  id: string;
  role: DrawnRole;
  railIndex: number;
  rect: Rect;
  /** Top to bottom, e.g. `["RCD", "40A", "30mA"]`. */
  lines: string[];
  /** Font size of the label lines, in millimetres. */
  fontSizeMm: number;
  /** The RCD group id; null for the main switch and for ungrouped MCBs. */
  groupKey: string | null;
  groupLabel: string | null;
  nTerminalSide: DrawableDevice["n_terminal_side"];
}

export interface GroupOutline {
  key: string;
  label: string;
  rect: Rect;
}

/** An unknown role is drawn as an MCB — the plainest device. */
function drawnRole(role: string): DrawnRole {
  return role === "main_switch" || role === "rcd" || role === "rcbo" ? role : "mcb";
}

/** The label lines for a device, e.g. "B16", or "RCD" / "40A" / "30mA". A missing rating is left out. */
export function deviceLabelLines(
  role: DrawnRole,
  ratedCurrentA: number | null,
  residualCurrentMa: number | null,
): string[] {
  const d = t.layout.drawing;
  const ampere = ratedCurrentA === null ? [] : [d.ampere(ratedCurrentA)];
  const milliampere = residualCurrentMa === null ? [] : [d.milliampere(residualCurrentMa)];
  switch (role) {
    case "main_switch":
      return [d.mainSwitch, ...ampere];
    case "rcd":
      return [d.rcd, ...ampere, ...milliampere];
    case "rcbo":
      return [d.rcbo, ...(ratedCurrentA === null ? [] : [d.mcbCharacteristic(ratedCurrentA)]), ...milliampere];
    case "mcb":
      return ratedCurrentA === null ? [] : [d.mcbCharacteristic(ratedCurrentA)];
  }
}

/** Monospace glyphs are about 0.6 em wide; lines are spaced 1.25 em. */
const GLYPH_WIDTH_EM = 0.6;
export const LABEL_LINE_EM = 1.25;
const MAX_LABEL_FONT_MM = 8;
const LABEL_PADDING_MM = 2;

/** The largest font that keeps every line inside the device's width and the lines inside its height. */
export function labelFontSizeMm(rect: Rect, lines: readonly string[]): number {
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const byWidth = (rect.w - LABEL_PADDING_MM) / (longest * GLYPH_WIDTH_EM);
  const byHeight = (rect.h - LABEL_PADDING_MM) / (Math.max(1, lines.length) * LABEL_LINE_EM);
  return Math.max(1, Math.min(MAX_LABEL_FONT_MM, byWidth, byHeight));
}

/**
 * The placed devices as drawable rectangles, in placement order. A placement naming a device the
 * list lacks, or a rail the geometry lacks, is skipped — the drawing never throws on a stale layout,
 * though the page draws only a `placed` one.
 */
export function buildDrawnDevices(
  devices: readonly DrawableDevice[],
  placements: readonly Placement[],
  geometry: CabinetGeometry,
  groups: readonly Pick<LayoutGroup, "id" | "label">[],
): DrawnDevice[] {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const labels = new Map(groups.map((group) => [group.id, group.label]));
  return placements.flatMap((placement) => {
    const device = byId.get(placement.projectDeviceId);
    const rect = device ? deviceRect(placement, device, geometry) : null;
    if (!device || !rect) return [];
    const role = drawnRole(device.role);
    const lines = deviceLabelLines(role, device.rated_current_a, device.residual_current_ma);
    const grouped = role !== "main_switch" && device.rcd_group_id !== null;
    return [
      {
        id: device.id,
        role,
        railIndex: placement.railIndex,
        rect,
        lines,
        fontSizeMm: labelFontSizeMm(rect, lines),
        groupKey: grouped ? device.rcd_group_id : null,
        groupLabel: grouped && device.rcd_group_id !== null ? (labels.get(device.rcd_group_id) ?? null) : null,
        nTerminalSide: device.n_terminal_side,
      },
    ];
  });
}

/** Space between a group's devices and its outline, in millimetres. */
export const GROUP_OUTLINE_PADDING_MM = 2;

/**
 * One outline per group per rail (a group wider than every rail continues on the next), the padded
 * bounding box of its devices there. Ungrouped devices and the main switch have none.
 */
export function groupOutlines(devices: readonly DrawnDevice[]): GroupOutline[] {
  const boxes = new Map<string, { label: string; left: number; top: number; right: number; bottom: number }>();
  for (const device of devices) {
    if (device.groupKey === null) continue;
    const key = `${device.groupKey}:${String(device.railIndex)}`;
    const { x, y, w, h } = device.rect;
    const box = boxes.get(key);
    if (box === undefined) {
      boxes.set(key, { label: device.groupLabel ?? "", left: x, top: y, right: x + w, bottom: y + h });
    } else {
      box.left = Math.min(box.left, x);
      box.top = Math.min(box.top, y);
      box.right = Math.max(box.right, x + w);
      box.bottom = Math.max(box.bottom, y + h);
    }
  }
  const pad = GROUP_OUTLINE_PADDING_MM;
  return [...boxes].map(([key, box]) => ({
    key,
    label: box.label,
    rect: { x: box.left - pad, y: box.top - pad, w: box.right - box.left + 2 * pad, h: box.bottom - box.top + 2 * pad },
  }));
}
