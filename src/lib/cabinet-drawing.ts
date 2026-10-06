import {
  barRect,
  railRect,
  type CabinetGeometry,
  type GeometryElementKind,
  type GeometryIssue,
  type Rect,
} from "@/lib/cabinet-geometry";
import { deviceRect, type LayoutGroup, type Placement, type Point } from "@/lib/cabinet-layout";
import {
  WIRE_SLACK_RATIO,
  type Conductor,
  type ConductorKind,
  type ConductorRole,
  type Endpoint,
} from "@/lib/cabinet-wiring";
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

// ---------------------------------------------------------------------------------------------
// Wires
// ---------------------------------------------------------------------------------------------

/**
 * The share of a conductor's slack drawn as sag in one horizontal run. A wire hanging over a span `L`
 * with a fraction `s` of extra length sags by about `L·√(3s/8)` (the shallow-parabola arc length); all
 * of the 30 % would hang a 300 mm run about 100 mm deep, through the next row of devices, so only this share
 * is drawn — the rest is the reserve coiled at the terminals.
 */
export const SAG_SLACK_SHARE = 0.1;
/** No run sags deeper than this, so a sagging wire stays inside its channel between rows. */
export const MAX_SAG_MM = 8;
/** Runs shorter than this are drawn straight: a short jumper is taut. */
export const MIN_SAG_SPAN_MM = 30;
/** Bend radius at each corner of a route. */
export const WIRE_BEND_MM = 4;

/** How deep a horizontal run of `spanMm` sags, derived from the slack; 0 for a short run. */
export function sagDepthMm(spanMm: number): number {
  if (spanMm < MIN_SAG_SPAN_MM) return 0;
  return Math.min(MAX_SAG_MM, spanMm * Math.sqrt((3 * WIRE_SLACK_RATIO * SAG_SLACK_SHARE) / 8));
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function towards(from: Point, to: Point, distanceMm: number): Point {
  const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  if (length === 0) return from;
  const share = distanceMm / length;
  return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share };
}

/**
 * An orthogonal route as an SVG path that looks wired rather than schematic: each corner is a short
 * bend, and each long horizontal run sags downward (gravity) by `sagDepthMm` — a quadratic curve whose
 * control point sits twice the depth below the run's middle. `sagLimits[i]`, when given, caps the sag
 * of the run from `points[i]` to `points[i + 1]` (see `sagLimits`). Presentation only: lengths come
 * from the route, never from this curve.
 */
export function wirePathD(points: readonly Point[], sagLimits: readonly number[] = []): string {
  if (points.length === 0) return "";
  const first = points[0];
  let d = `M${fmt(first.x)} ${fmt(first.y)}`;
  if (points.length === 1) return d;

  // Per corner: how far the bend reaches back along each adjacent run (at most half of either run).
  const radius = points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return 0;
    const before = Math.abs(point.x - points[i - 1].x) + Math.abs(point.y - points[i - 1].y);
    const after = Math.abs(points[i + 1].x - point.x) + Math.abs(points[i + 1].y - point.y);
    return Math.min(WIRE_BEND_MM, before / 2, after / 2);
  });

  let start = first;
  for (let i = 1; i < points.length; i++) {
    const corner = points[i];
    const end = towards(corner, points[i - 1], radius[i]);
    const horizontal = Math.abs(end.y - start.y) < 1e-9;
    const sag = horizontal ? Math.min(sagDepthMm(Math.abs(end.x - start.x)), sagLimits.at(i - 1) ?? Infinity) : 0;
    if (sag > 0) {
      d += ` Q${fmt((start.x + end.x) / 2)} ${fmt(start.y + 2 * sag)} ${fmt(end.x)} ${fmt(end.y)}`;
    } else {
      d += ` L${fmt(end.x)} ${fmt(end.y)}`;
    }
    if (i < points.length - 1) {
      const next = towards(corner, points[i + 1], radius[i]);
      d += ` Q${fmt(corner.x)} ${fmt(corner.y)} ${fmt(next.x)} ${fmt(next.y)}`;
      start = next;
    }
  }
  return d;
}

/** One conductor ready to draw. */
export interface DrawnWire {
  key: string;
  role: ConductorRole;
  kind: ConductorKind;
  d: string;
  /** The hover tooltip naming the conductor; empty when no names were given. */
  title: string;
}

/** What the tooltips name conductors by: circuit names by id, and the drawn devices. */
export interface WireNames {
  circuits: ReadonlyMap<string, string>;
  devices: readonly DrawnDevice[];
}

function endpointName(endpoint: Endpoint, names: WireNames): string {
  const w = t.layout.section.wireTitle;
  if (endpoint.type === "entry") return w.entry;
  if (endpoint.type === "bar") return endpoint.kind === "PE" ? w.peBar : w.nBar;
  const device = names.devices.find((candidate) => candidate.id === endpoint.deviceId);
  if (device === undefined) return endpoint.deviceId;
  const label = device.lines[0] ?? "";
  return device.groupLabel === null || device.role === "mcb" ? label : w.deviceInGroup(label, device.groupLabel);
}

/** "Obwód „Gniazda kuchnia” — L, 2,5 mm², 0,42 m", "WLZ — …", "Połączenie FR → RCD „Kuchnia” — …". */
export function wireTitle(conductor: Conductor, names: WireNames): string {
  const w = t.layout.section.wireTitle;
  const metres = Math.round(conductor.lengthMm / 10) / 100;
  const details = w.details(conductor.role, conductor.crossSectionMm2, metres);
  if (conductor.kind === "wlz") return w.wlz(details);
  if (conductor.kind === "feed") {
    return w.feed(endpointName(conductor.from, names), endpointName(conductor.to, names), details);
  }
  const name = conductor.circuitId === null ? undefined : names.circuits.get(conductor.circuitId);
  return w.circuit(name ?? w.unknownCircuit, details);
}

/**
 * Per conductor, per path segment: the deepest a horizontal run may sag so that it keeps above the
 * nearest run of another conductor below it that it runs alongside — half the gap between them, so
 * parallel tracks (`WIRE_TRACK_PITCH_MM` apart) never touch or swap order however long each span is.
 * The lowest run of a bundle, with nothing close beneath, keeps its full `sagDepthMm`. Vertical
 * segments are unlimited (they never sag). Presentation only.
 */
export function sagLimits(conductors: readonly Conductor[]): number[][] {
  const limits = conductors.map((conductor) => conductor.path.slice(1).map(() => Infinity));
  const runs: { owner: number; index: number; y: number; x1: number; x2: number }[] = [];
  conductors.forEach((conductor, owner) => {
    for (let index = 0; index + 1 < conductor.path.length; index++) {
      const [a, b] = [conductor.path[index], conductor.path[index + 1]];
      if (a.y !== b.y) continue;
      runs.push({ owner, index, y: a.y, x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x) });
    }
  });
  runs.sort((p, q) => p.y - q.y);
  // A run farther below than twice the deepest sag can never be reached, so the scan stops there.
  const reach = 2 * MAX_SAG_MM;
  runs.forEach((run, i) => {
    for (let j = i + 1; j < runs.length && runs[j].y - run.y < reach; j++) {
      const other = runs[j];
      if (other.owner === run.owner || other.y - run.y < 1e-9) continue;
      if (Math.min(run.x2, other.x2) - Math.max(run.x1, other.x1) <= 1e-9) continue;
      limits[run.owner][run.index] = (other.y - run.y) / 2;
      break;
    }
  });
  return limits;
}

/**
 * The conductors as SVG paths, protective conductors first so the live ones (L, N) paint over them,
 * then in routing order. A path that runs behind a device (allowed: under the DIN rail) is drawn
 * over it like any other, so it stays traceable.
 */
export function buildDrawnWires(conductors: readonly Conductor[], names?: WireNames): DrawnWire[] {
  const limits = sagLimits(conductors);
  const layer = (role: ConductorRole) => (role === "PE" || role === "PEN" ? 0 : 1);
  return [...conductors]
    .map((conductor, index) => ({ conductor, index }))
    .sort((a, b) => layer(a.conductor.role) - layer(b.conductor.role) || a.index - b.index)
    .map(({ conductor, index }) => ({
      key: conductor.key,
      role: conductor.role,
      kind: conductor.kind,
      d: wirePathD(conductor.path, limits[index]),
      title: names === undefined ? "" : wireTitle(conductor, names),
    }));
}
