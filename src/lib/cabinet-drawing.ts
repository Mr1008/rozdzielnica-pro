import {
  barRect,
  railRect,
  type CabinetGeometry,
  type GeometryElementKind,
  type GeometryIssue,
  type Rect,
} from "@/lib/cabinet-geometry";
import {
  catalogBarAsCabinetBar,
  deviceRect,
  type CabinetBar,
  type LayoutGroup,
  type Placement,
  type Point,
} from "@/lib/cabinet-layout";
import {
  WIRE_CLEARANCE_MM,
  WIRE_SLACK_RATIO,
  type Busbar,
  type Conductor,
  type ConductorKind,
  type ConductorRole,
  type Endpoint,
} from "@/lib/cabinet-wiring";
import type { Tables } from "@/lib/database.types";
import { t } from "@/lib/i18n";
import {
  cableDiameterMm,
  CABLE_CORE_COUNTS,
  FERRULE,
  WIRE_CROSS_SECTIONS_MM2,
  type CableCores,
  type FerruleColourToken,
  type WireCrossSectionMm2,
} from "@/lib/wire-dimensions";

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

/**
 * What the drawing needs of a `project_devices` row; a stored row is one as is. `terminal_groups`
 * matters only for a catalog PE/N bar, whose terminals the drawing shows.
 */
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
> & { terminal_groups?: unknown };

/** `pe_bar` / `n_bar`: a catalog bar on a rail (plan Phase 5b), drawn like a built-in bar of its kind. */
export type DrawnRole = "main_switch" | "rcd" | "rcbo" | "mcb" | "pe_bar" | "n_bar";

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
  /** A catalog PE/N bar seen as a cabinet bar (with its terminals); null for every other device. */
  bar: CabinetBar | null;
}

export interface GroupOutline {
  key: string;
  label: string;
  rect: Rect;
}

const DRAWN_ROLES: readonly string[] = ["main_switch", "rcd", "rcbo", "mcb", "pe_bar", "n_bar"] satisfies DrawnRole[];

function isDrawnRole(role: string): role is DrawnRole {
  return DRAWN_ROLES.includes(role);
}

/** An unknown role is drawn as an MCB — the plainest device. */
function drawnRole(role: string): DrawnRole {
  return isDrawnRole(role) ? role : "mcb";
}

/**
 * The label lines for a device, e.g. "B16", or "RCD" / "40A" / "30mA". A missing rating is left out. A
 * catalog bar has none: it is labelled like a built-in bar, by the drawing.
 */
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
    case "pe_bar":
    case "n_bar":
      return [];
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
        bar: catalogBarAsCabinetBar(device, rect),
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
/** Bend radius at each corner of a route in the schematic drawing, and the least in the realistic one. */
export const WIRE_BEND_MM = 4;
/**
 * The realistic drawing bends a conductor around a radius of this many of its outer diameters — the
 * usual minimum inner bend radius for fixed PVC-insulated wiring (3–4 × d), so a thick WLZ core bends
 * visibly wider than a 1.5 mm² one.
 */
export const BEND_RADIUS_DIAMETERS = 3;

/**
 * The two looks of one wiring (S-11): `realistic` draws every conductor at its true outer diameter, with
 * ferrules, cable ties and sheaths; `schematic` draws thin lines with greyscale-safe patterns. Both draw
 * the same routes — the variant never feeds back into routing.
 */
export type WiringVariant = "realistic" | "schematic";
export const WIRING_VARIANTS = ["realistic", "schematic"] as const satisfies readonly WiringVariant[];

/** The bend radius at a conductor's corners in a variant (still capped at half of each adjacent run). */
export function bendRadiusMm(diameterMm: number, variant: WiringVariant): number {
  return variant === "realistic" ? Math.max(WIRE_BEND_MM, BEND_RADIUS_DIAMETERS * diameterMm) : WIRE_BEND_MM;
}

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

/** One path segment's drawn piece: where it starts, and its path commands (each with a leading space). */
interface PathPiece {
  start: Point;
  body: string;
}

/** Per segment of `points`: its run (straight or sagging) and the bend at its far corner. */
function wirePathPieces(points: readonly Point[], sagLimits: readonly number[], bendMm: number): PathPiece[] {
  // Per corner: how far the bend reaches back along each adjacent run (at most half of either run).
  const radius = points.map((point, i) => {
    if (i === 0 || i === points.length - 1) return 0;
    const before = Math.abs(point.x - points[i - 1].x) + Math.abs(point.y - points[i - 1].y);
    const after = Math.abs(points[i + 1].x - point.x) + Math.abs(points[i + 1].y - point.y);
    return Math.min(bendMm, before / 2, after / 2);
  });

  const pieces: PathPiece[] = [];
  let start = points[0];
  for (let i = 1; i < points.length; i++) {
    const corner = points[i];
    const end = towards(corner, points[i - 1], radius[i]);
    const horizontal = Math.abs(end.y - start.y) < 1e-9;
    const sag = horizontal ? Math.min(sagDepthMm(Math.abs(end.x - start.x)), sagLimits.at(i - 1) ?? Infinity) : 0;
    let body =
      sag > 0
        ? ` Q${fmt((start.x + end.x) / 2)} ${fmt(start.y + 2 * sag)} ${fmt(end.x)} ${fmt(end.y)}`
        : ` L${fmt(end.x)} ${fmt(end.y)}`;
    const pieceStart = start;
    if (i < points.length - 1) {
      const next = towards(corner, points[i + 1], radius[i]);
      body += ` Q${fmt(corner.x)} ${fmt(corner.y)} ${fmt(next.x)} ${fmt(next.y)}`;
      start = next;
    }
    pieces.push({ start: pieceStart, body });
  }
  return pieces;
}

function moveTo(point: Point): string {
  return `M${fmt(point.x)} ${fmt(point.y)}`;
}

/**
 * An orthogonal route as an SVG path that looks wired rather than schematic: each corner is a bend of
 * `bendMm` (`WIRE_BEND_MM` unless given; see `bendRadiusMm`), and each long horizontal run sags downward
 * (gravity) by `sagDepthMm` — a quadratic curve whose control point sits twice the depth below the
 * run's middle. `sagLimits[i]`, when given, caps the sag of the run from `points[i]` to `points[i + 1]`
 * (see `sagLimits`). Presentation only: lengths come from the route, never from this curve.
 */
export function wirePathD(points: readonly Point[], sagLimits: readonly number[] = [], bendMm = WIRE_BEND_MM): string {
  if (points.length === 0) return "";
  const d = moveTo(points[0]);
  if (points.length === 1) return d;
  return d + wirePathPieces(points, sagLimits, bendMm).reduce((path, piece) => path + piece.body, "");
}

/**
 * The same curve as `wirePathD`, cut into the segments `include` keeps: consecutive kept segments are
 * one subpath, a skipped one breaks it. Empty when none is kept.
 */
function wireSubpathD(pieces: readonly PathPiece[], include: (segment: number) => boolean): string {
  let d = "";
  pieces.forEach((piece, segment) => {
    if (!include(segment)) return;
    const joined = segment > 0 && include(segment - 1);
    d += (joined ? "" : `${d === "" ? "" : " "}${moveTo(piece.start)}`) + piece.body;
  });
  return d;
}

/**
 * The schematic drawing's conductor colours per PN-EN 60445 (the `--wire-*` tokens), plus a pattern per role so a greyscale
 * print still tells them apart: phases solid (L1 brown, L2 black, L3 grey), N dashed, PE a wider solid
 * green line with a solid yellow centre stripe — a hollow double line in greyscale, never mistaken for
 * the dashed N — and PEN the PE pair drawn heavier with blue dashes over the yellow stripe (user
 * 2026-10-07), so it never reads as PE: in greyscale the dashes break its light centre. Single-phase L
 * is drawn in L1's colour (no phase balancing in the MVP). `fill` colours a wire's end on a bar
 * terminal.
 */
export const WIRE_STYLES: Record<
  ConductorRole,
  { stroke: string; fill: string; dash?: string; stripe: boolean; penDash: boolean; weight: number }
> = {
  L: { stroke: "stroke-wire-l1", fill: "fill-wire-l1", stripe: false, penDash: false, weight: 1 },
  L1: { stroke: "stroke-wire-l1", fill: "fill-wire-l1", stripe: false, penDash: false, weight: 1 },
  L2: { stroke: "stroke-wire-l2", fill: "fill-wire-l2", stripe: false, penDash: false, weight: 1 },
  L3: { stroke: "stroke-wire-l3", fill: "fill-wire-l3", stripe: false, penDash: false, weight: 1 },
  N: { stroke: "stroke-wire-n", fill: "fill-wire-n", dash: "6 3", stripe: false, penDash: false, weight: 1 },
  PE: { stroke: "stroke-wire-pe", fill: "fill-wire-pe", stripe: true, penDash: false, weight: 1.6 },
  PEN: { stroke: "stroke-wire-pe", fill: "fill-wire-pe", stripe: true, penDash: true, weight: 2.2 },
};

/** The blue dashes over a PEN's yellow stripe. */
export const PEN_DASH = "3 3";

/**
 * The realistic drawing's insulation colours (S-11), also per PN-EN 60445 and also token classes only:
 * L1 brown, L2 black and L3 grey, solid; N solid blue; PE a yellow body with green dashes along it
 * (`dash`, in conductor diameters: drawn, then left open); PEN as PE plus blue sleeves at its ends
 * (`sleeve`), the usual marking of a PEN core. `fill` colours a wire's end on a bar terminal.
 */
export const REALISTIC_WIRE_STYLES: Record<
  ConductorRole,
  {
    body: string;
    fill: string;
    dash: { stroke: string; onDiameters: number; offDiameters: number } | null;
    sleeve: string | null;
  }
> = {
  L: { body: "stroke-wire-l1", fill: "fill-wire-l1", dash: null, sleeve: null },
  L1: { body: "stroke-wire-l1", fill: "fill-wire-l1", dash: null, sleeve: null },
  L2: { body: "stroke-wire-l2", fill: "fill-wire-l2", dash: null, sleeve: null },
  L3: { body: "stroke-wire-l3", fill: "fill-wire-l3", dash: null, sleeve: null },
  N: { body: "stroke-wire-n", fill: "fill-wire-n", dash: null, sleeve: null },
  PE: {
    body: "stroke-wire-pe-stripe",
    fill: "fill-wire-pe",
    dash: { stroke: "stroke-wire-pe", onDiameters: 2, offDiameters: 1.5 },
    sleeve: null,
  },
  PEN: {
    body: "stroke-wire-pe-stripe",
    fill: "fill-wire-pe",
    dash: { stroke: "stroke-wire-pe", onDiameters: 2, offDiameters: 1.5 },
    sleeve: "stroke-wire-n",
  },
};

/** The length of a PEN's blue sleeve, past its ferrule. */
export const PEN_SLEEVE_MM = 6;

/** Each ferrule colour's stroke class, spelt out so Tailwind generates every one. */
const FERRULE_STROKE_CLASSES: Record<FerruleColourToken, string> = {
  "ferrule-black": "stroke-ferrule-black",
  "ferrule-blue": "stroke-ferrule-blue",
  "ferrule-grey": "stroke-ferrule-grey",
  "ferrule-yellow": "stroke-ferrule-yellow",
  "ferrule-red": "stroke-ferrule-red",
};

function isWireCrossSection(mm2: number): mm2 is WireCrossSectionMm2 {
  return (WIRE_CROSS_SECTIONS_MM2 as readonly number[]).includes(mm2);
}

/** A ferrule's colour class and sleeve length for a cross-section (DIN 46228-4); null when untabulated. */
export function ferruleStyle(crossSectionMm2: number): { stroke: string; lengthMm: number } | null {
  if (!isWireCrossSection(crossSectionMm2)) return null;
  const ferrule = FERRULE[crossSectionMm2];
  return { stroke: FERRULE_STROKE_CLASSES[ferrule.colourToken], lengthMm: ferrule.lengthMm };
}

/**
 * Where a conductor ends on a device or bar terminal: the terminal point, the unit vector from it along
 * the wire, and how long the end segment is (a ferrule never reaches past it).
 */
export interface TerminalEnd {
  point: Point;
  direction: Point;
  runMm: number;
}

/** One conductor ready to draw. */
export interface DrawnWire {
  key: string;
  role: ConductorRole;
  kind: ConductorKind;
  crossSectionMm2: number;
  /** The insulated core's outer diameter: the realistic body's width, in millimetres. */
  diameterMm: number;
  /** `Conductor.overflow`: some of it did not fit its tied bundle (`conductors_do_not_fit`). */
  overflow: boolean;
  /** The whole route, bent and sagging per the variant. */
  d: string;
  /**
   * `d` split by layer: the segments the router spilled into the overflow layer behind a bundle
   * (`behindD`, drawn beneath the devices in the realistic variant), and the rest (`frontD`). Without
   * overflow segments `frontD` is `d` and `behindD` is empty.
   */
  frontD: string;
  behindD: string;
  /** The hover tooltip naming the conductor; empty when no names were given. */
  title: string;
  /** Where the conductor lands on a bar terminal — drawn as the terminal taken by its end. */
  barEnds: Point[];
  /** Its device and bar terminal ends, never an entry — where the realistic drawing puts a ferrule. */
  terminalEnds: TerminalEnd[];
}

/** What the tooltips name conductors by: circuit names by id, and the drawn devices. */
export interface WireNames {
  circuits: ReadonlyMap<string, string>;
  devices: readonly DrawnDevice[];
}

function endpointName(endpoint: Endpoint, names: WireNames): string {
  const w = t.layout.section.wireTitle;
  if (endpoint.type === "entry") return w.entry;
  if (endpoint.type === "bar") {
    return w.barTerminal(endpoint.kind === "PE" ? w.peBar : w.nBar, endpoint.terminalIndex + 1);
  }
  const device = names.devices.find((candidate) => candidate.id === endpoint.deviceId);
  if (device === undefined) return endpoint.deviceId;
  const label = device.lines[0] ?? "";
  return device.groupLabel === null || device.role === "mcb" ? label : w.deviceInGroup(label, device.groupLabel);
}

/**
 * "Obwód „Gniazda kuchnia” — L, 2,5 mm², 0,42 m", "WLZ — …", "Połączenie FR → RCD „Kuchnia” — …". A
 * cable core landing on a bar also names the terminal: "… — szyna PE, zacisk 3".
 */
export function wireTitle(conductor: Conductor, names: WireNames): string {
  const w = t.layout.section.wireTitle;
  const metres = Math.round(conductor.lengthMm / 10) / 100;
  const details = w.details(conductor.role, conductor.crossSectionMm2, metres);
  if (conductor.kind === "feed") {
    return w.feed(endpointName(conductor.from, names), endpointName(conductor.to, names), details);
  }
  const name = conductor.circuitId === null ? undefined : names.circuits.get(conductor.circuitId);
  const title = conductor.kind === "wlz" ? w.wlz(details) : w.circuit(name ?? w.unknownCircuit, details);
  return conductor.to.type === "bar" ? w.landsOn(title, endpointName(conductor.to, names)) : title;
}

/**
 * Per conductor, per path segment: the deepest a horizontal run may sag so that it keeps above the
 * nearest run of another conductor below it that it runs alongside — half the gap between them, so
 * parallel tracks (true-scale spacing apart, see `WIRE_CLEARANCE_MM`) never touch or swap order
 * however long each span is. The schematic gap is centre to centre (thin lines); the realistic one is
 * between the insulation bodies (`diameterMm`), so cores spaced at true scale, or overlapping in a
 * bundle, barely sag or not at all.
 * The lowest run of a bundle, with nothing close beneath, keeps its full `sagDepthMm`. Vertical
 * segments are unlimited (they never sag). Presentation only.
 */
export function sagLimits(conductors: readonly Conductor[], variant: WiringVariant = "schematic"): number[][] {
  const limits = conductors.map((conductor) => conductor.path.slice(1).map(() => Infinity));
  const bodies = variant === "realistic";
  const runs: { owner: number; index: number; y: number; x1: number; x2: number; r: number }[] = [];
  let widest = 0;
  conductors.forEach((conductor, owner) => {
    const r = bodies ? conductor.diameterMm / 2 : 0;
    widest = Math.max(widest, r);
    for (let index = 0; index + 1 < conductor.path.length; index++) {
      const [a, b] = [conductor.path[index], conductor.path[index + 1]];
      if (a.y !== b.y) continue;
      runs.push({ owner, index, y: a.y, x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x), r });
    }
  });
  runs.sort((p, q) => p.y - q.y);
  // A run farther below than twice the deepest sag (plus both bodies) can never be reached, so the
  // scan stops there.
  const reach = 2 * MAX_SAG_MM + 2 * widest;
  runs.forEach((run, i) => {
    for (let j = i + 1; j < runs.length && runs[j].y - run.y < reach; j++) {
      const other = runs[j];
      if (other.owner === run.owner || other.y - run.y < 1e-9) continue;
      if (Math.min(run.x2, other.x2) - Math.max(run.x1, other.x1) <= 1e-9) continue;
      limits[run.owner][run.index] = Math.max(0, other.y - run.y - run.r - other.r) / 2;
      break;
    }
  });
  return limits;
}

/** The unit vector from `from` towards `to`; zero for the same point. */
function unit(from: Point, to: Point): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0 ? { x: 0, y: 0 } : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** A conductor's device and bar terminal ends: its first point, its last, or both. */
function terminalEnds(conductor: Conductor): TerminalEnd[] {
  const { path } = conductor;
  if (path.length < 2) return [];
  const ends: TerminalEnd[] = [];
  const end = (point: Point, next: Point) => ({
    point,
    direction: unit(point, next),
    runMm: Math.hypot(next.x - point.x, next.y - point.y),
  });
  if (conductor.from.type !== "entry") ends.push(end(path[0], path[1]));
  if (conductor.to.type !== "entry") ends.push(end(path[path.length - 1], path[path.length - 2]));
  return ends;
}

/**
 * The conductors as SVG paths, protective conductors first so the live ones (L, N) paint over them,
 * then in routing order. A path that runs behind a device (allowed: under the DIN rail) is drawn
 * over it like any other, so it stays traceable.
 *
 * `variant` sets the bends (`bendRadiusMm`) and the sag: the schematic drawing sags as it always has;
 * the realistic one draws every circuit and WLZ core taut — straight runs with tight bends, as a
 * carefully wired cabinet's packs and channels are laid (the electrician, 2026-10-09, comparing
 * `context/foundation/references/wiring/rozdzielnica-z-opaskami.webp`) — and lets only the feeds, the
 * short jumpers between devices, hang loose: never a run the router laid in a tied bundle
 * (`Conductor.tied`) or one a cable tie holds (`buildCableTies`), and the rest spaced by their bodies
 * (`sagLimits`).
 */
export function buildDrawnWires(
  conductors: readonly Conductor[],
  names?: WireNames,
  variant: WiringVariant = "realistic",
): DrawnWire[] {
  const limits = sagLimits(conductors, variant);
  if (variant === "realistic") {
    const held = tieLayout(conductors).held;
    conductors.forEach((conductor, owner) => {
      if (conductor.kind !== "feed") limits[owner].fill(0);
      for (const tie of conductor.tied) limits[owner][tie.segment] = 0;
      held.get(owner)?.forEach((segment) => {
        limits[owner][segment] = 0;
      });
    });
  }
  const layer = (role: ConductorRole) => (role === "PE" || role === "PEN" ? 0 : 1);
  return [...conductors]
    .map((conductor, index) => ({ conductor, index }))
    .sort((a, b) => layer(a.conductor.role) - layer(b.conductor.role) || a.index - b.index)
    .map(({ conductor, index }) => {
      const pieces = wirePathPieces(conductor.path, limits[index], bendRadiusMm(conductor.diameterMm, variant));
      const behind = new Set(conductor.tied.filter((tie) => tie.layer === "overflow").map((tie) => tie.segment));
      const d =
        conductor.path.length === 0 ? "" : pieces.reduce((path, piece) => path + piece.body, moveTo(conductor.path[0]));
      return {
        key: conductor.key,
        role: conductor.role,
        kind: conductor.kind,
        crossSectionMm2: conductor.crossSectionMm2,
        diameterMm: conductor.diameterMm,
        overflow: conductor.overflow,
        d,
        frontD: behind.size === 0 ? d : wireSubpathD(pieces, (segment) => !behind.has(segment)),
        behindD: behind.size === 0 ? "" : wireSubpathD(pieces, (segment) => behind.has(segment)),
        title: names === undefined ? "" : wireTitle(conductor, names),
        barEnds: [
          ...(conductor.from.type === "bar" ? conductor.path.slice(0, 1) : []),
          ...(conductor.to.type === "bar" ? conductor.path.slice(-1) : []),
        ],
        terminalEnds: terminalEnds(conductor),
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Comb busbars
// ---------------------------------------------------------------------------------------------

/** How far a busbar strip reaches past its first and last tooth. */
export const BUSBAR_OVERHANG_MM = 2;
/** A tooth's width in the realistic drawing; the schematic one draws it as a tick line. */
export const BUSBAR_TOOTH_MM = 3;
/** How far a tooth reaches into the device, past the terminal's edge. */
export const BUSBAR_TOOTH_DEPTH_MM = 3;

/** One tooth ready to draw: a vertical run from the strip's edge, at `x`, into the device's terminal. */
export interface DrawnBusbarTooth {
  x: number;
  /** The strip's edge facing the devices. */
  y1: number;
  /** Where the tooth ends, inside the terminal. */
  y2: number;
  pole: Busbar["teeth"][number]["pole"];
}

/** A comb busbar ready to draw (`rcd-group-busbars`, Phase 4). Both variants share the geometry. */
export interface DrawnBusbar {
  key: string;
  groupId: string;
  variant: WiringVariant;
  phases: 1 | 3;
  pins: number;
  /** The strip, reaching `BUSBAR_OVERHANG_MM` past its first and last tooth. */
  body: Rect;
  teeth: DrawnBusbarTooth[];
  /** The hover tooltip: "Listwa zasilająca 3F — grupa „Kuchnia”, 8 pinów". */
  title: string;
}

/**
 * The routed busbars as drawable strips with teeth. The variant changes only how they are painted
 * (a copper tooth rectangle, or a tick line), never the geometry the router fixed. `groupLabels` names
 * the groups in the tooltip; a missing label leaves the group out of it.
 */
export function buildDrawnBusbars(
  busbars: readonly Busbar[],
  variant: WiringVariant,
  groupLabels: ReadonlyMap<string, string> = new Map(),
): DrawnBusbar[] {
  return busbars.map((busbar) => {
    const towardsDevices = busbar.edge === "top" ? 1 : -1;
    const edgeY = busbar.edge === "top" ? busbar.rect.y + busbar.rect.h : busbar.rect.y;
    return {
      key: busbar.key,
      groupId: busbar.groupId,
      variant,
      phases: busbar.phases,
      pins: busbar.pins,
      body: {
        x: busbar.rect.x - BUSBAR_OVERHANG_MM,
        y: busbar.rect.y,
        w: busbar.rect.w + 2 * BUSBAR_OVERHANG_MM,
        h: busbar.rect.h,
      },
      teeth: busbar.teeth.map((tooth) => ({
        x: tooth.x,
        y1: edgeY,
        y2: tooth.y + towardsDevices * BUSBAR_TOOTH_DEPTH_MM,
        pole: tooth.pole,
      })),
      title: t.layout.section.busbarTitle(busbar.phases, groupLabels.get(busbar.groupId) ?? "", busbar.pins),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Cable ties
// ---------------------------------------------------------------------------------------------

/** One cable tie every this many millimetres along a tied group's shared extent. */
export const TIE_PITCH_MM = 60;
/** A group of parallel runs is tied only from this many conductors up. */
export const TIE_MIN_CONDUCTORS = 3;
/** The tie strap's width along the runs it holds. */
export const TIE_BAND_MM = 2.5;
/** Neighbouring runs closer than this, insulation to insulation, belong to one group. */
export const TIE_NEIGHBOUR_GAP_MM = 2 * WIRE_CLEARANCE_MM;

/** One cable tie across a group of parallel runs, as a rectangle in millimetres. */
export interface DrawnTie {
  key: string;
  rect: Rect;
}

interface TieRun {
  owner: number;
  segment: number;
  /** The run's position across its axis, and its extent along it. */
  across: number;
  lo: number;
  hi: number;
  radius: number;
}

const TIE_EPS = 1e-6;

/**
 * The cable ties and, per conductor, the segments they hold. Inner path segments only — the end stubs
 * at terminals and entries are never tied — and never a segment in the overflow layer, which lies
 * behind the devices. Per axis, runs are joined into groups when they overlap along the axis and sit
 * within `TIE_NEIGHBOUR_GAP_MM` of each other across it (a bundle's cores overlap, so they always do);
 * a group of at least `TIE_MIN_CONDUCTORS` conductors gets a tie every `TIE_PITCH_MM`, centred on its
 * extent, each as wide as the runs it crosses there. Sorting by position keeps it near O(n log n).
 */
function tieLayout(conductors: readonly Conductor[]): { ties: DrawnTie[]; held: Map<number, Set<number>> } {
  const ties: DrawnTie[] = [];
  const held = new Map<number, Set<number>>();
  for (const axis of ["v", "h"] as const) {
    const runs: TieRun[] = [];
    conductors.forEach((conductor, owner) => {
      const behind = new Set(conductor.tied.filter((tie) => tie.layer === "overflow").map((tie) => tie.segment));
      for (let segment = 1; segment + 2 < conductor.path.length; segment++) {
        if (behind.has(segment)) continue;
        const [a, b] = [conductor.path[segment], conductor.path[segment + 1]];
        const vertical = Math.abs(a.x - b.x) < TIE_EPS && Math.abs(a.y - b.y) > TIE_EPS;
        const horizontal = Math.abs(a.y - b.y) < TIE_EPS && Math.abs(a.x - b.x) > TIE_EPS;
        if (axis === "v" ? !vertical : !horizontal) continue;
        const [p, q] = axis === "v" ? [a.y, b.y] : [a.x, b.x];
        runs.push({
          owner,
          segment,
          across: axis === "v" ? a.x : a.y,
          lo: Math.min(p, q),
          hi: Math.max(p, q),
          radius: conductor.diameterMm / 2,
        });
      }
    });
    runs.sort((p, q) => p.across - q.across || p.lo - q.lo || p.owner - q.owner);
    const widest = Math.max(0, ...runs.map((run) => run.radius));

    // Groups: union-find over neighbouring, overlapping runs.
    const parent = runs.map((_, i) => i);
    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    runs.forEach((run, i) => {
      for (let j = i + 1; j < runs.length; j++) {
        const other = runs[j];
        if (other.across - run.across > run.radius + widest + TIE_NEIGHBOUR_GAP_MM + TIE_EPS) break;
        if (other.across - run.across - run.radius - other.radius > TIE_NEIGHBOUR_GAP_MM + TIE_EPS) continue;
        if (Math.min(run.hi, other.hi) - Math.max(run.lo, other.lo) <= TIE_EPS) continue;
        parent[find(j)] = find(i);
      }
    });
    const groups = new Map<number, TieRun[]>();
    runs.forEach((run, i) => {
      const root = find(i);
      const group = groups.get(root);
      if (group === undefined) groups.set(root, [run]);
      else group.push(run);
    });

    let groupIndex = 0;
    for (const group of groups.values()) {
      if (new Set(group.map((run) => run.owner)).size < TIE_MIN_CONDUCTORS) continue;
      const lo = Math.min(...group.map((run) => run.lo));
      const hi = Math.max(...group.map((run) => run.hi));
      const count = Math.floor((hi - lo + TIE_EPS) / TIE_PITCH_MM);
      const first = lo + (hi - lo - (count - 1) * TIE_PITCH_MM) / 2;
      for (let k = 0; k < count; k++) {
        const at = first + k * TIE_PITCH_MM;
        const active = group.filter((run) => run.lo < at - TIE_EPS && run.hi > at + TIE_EPS);
        // The runs a tie crosses at this point, split wherever a gap opens between neighbours.
        const clusters: TieRun[][] = [];
        for (const run of active) {
          const current = clusters.at(-1);
          const previous = current?.at(-1);
          if (
            current !== undefined &&
            previous !== undefined &&
            run.across - previous.across - run.radius - previous.radius <= TIE_NEIGHBOUR_GAP_MM + TIE_EPS
          ) {
            current.push(run);
          } else {
            clusters.push([run]);
          }
        }
        clusters.forEach((cluster, c) => {
          if (new Set(cluster.map((run) => run.owner)).size < TIE_MIN_CONDUCTORS) return;
          const from = Math.min(...cluster.map((run) => run.across - run.radius));
          const to = Math.max(...cluster.map((run) => run.across + run.radius));
          const rect =
            axis === "v"
              ? { x: from, y: at - TIE_BAND_MM / 2, w: to - from, h: TIE_BAND_MM }
              : { x: at - TIE_BAND_MM / 2, y: from, w: TIE_BAND_MM, h: to - from };
          ties.push({ key: `${axis}${String(groupIndex)}-${String(k)}-${String(c)}`, rect });
          for (const run of cluster) {
            const segments = held.get(run.owner) ?? new Set<number>();
            segments.add(run.segment);
            held.set(run.owner, segments);
          }
        });
      }
      groupIndex += 1;
    }
  }
  return { ties, held };
}

/**
 * The cable ties of the realistic drawing (S-11): across every group of at least `TIE_MIN_CONDUCTORS`
 * parallel runs lying together — the side packs and the dense lane and row channels alike — one every
 * `TIE_PITCH_MM`, as wide as the group. Derived from the routes alone; presentation only.
 */
export function buildCableTies(conductors: readonly Conductor[]): DrawnTie[] {
  return tieLayout(conductors).ties;
}

/** One cable's sheathed stub from its entry point, before it splits into its cores. */
export interface DrawnCable {
  key: string;
  kind: "circuit" | "wlz";
  d: string;
  /**
   * The sheath's outer diameter (`cableDiameterMm` for its core count and cross-section), which the
   * realistic drawing draws it at; the schematic one keeps a fixed on-screen width.
   */
  diameterMm: number;
}

/** A cable's sheath diameter: tabulated by cores (2–5) and cross-section, or its widest core's. */
function sheathDiameterMm(cores: readonly Conductor[]): number {
  const count = Math.min(Math.max(cores.length, CABLE_CORE_COUNTS[0]), CABLE_CORE_COUNTS[CABLE_CORE_COUNTS.length - 1]);
  const section = cores[0].crossSectionMm2;
  if (isWireCrossSection(section)) return cableDiameterMm(count as CableCores, section);
  return Math.max(...cores.map((core) => core.diameterMm));
}

/**
 * How far a cable keeps its outer sheath past its entry point (the electrician, 2026-10-09): the sheath
 * is stripped just inside the cabinet and only the bare cores run on — to their packs, channels and
 * terminals. A couple of centimetres, as a carefully wired cabinet shows.
 */
export const SHEATH_STUB_MM = 25;

/**
 * The cables at the entries (plan Phase 5c): every conductor that starts at an entry belongs to one
 * cable — the WLZ, or its circuit's cable — whose cores share the entry point and run along one stub
 * line from it. The sheath covers only the start of that stub: `SHEATH_STUB_MM` from the entry point,
 * cut back to stop before the first core bends off the line (one `WIRE_BEND_MM` before the shortest
 * stub's end, at most halfway along it) — it never reaches a bend. Past it every core runs bare, on
 * its own track (`routeConductors`). Both variants draw the same sheath. Cables in routing order.
 * Presentation only.
 */
export function buildDrawnCables(conductors: readonly Conductor[]): DrawnCable[] {
  const cables = new Map<string, { kind: "circuit" | "wlz"; cores: Conductor[] }>();
  for (const conductor of conductors) {
    if (conductor.from.type !== "entry" || conductor.kind === "feed" || conductor.path.length < 2) continue;
    const key = conductor.kind === "wlz" ? "wlz" : `c:${conductor.circuitId ?? conductor.key}`;
    const cable = cables.get(key);
    if (cable === undefined) cables.set(key, { kind: conductor.kind, cores: [conductor] });
    else cable.cores.push(conductor);
  }
  return [...cables].flatMap(([key, cable]) => {
    const points = sheathStub(cable.cores);
    if (points === null) return [];
    const d = points.map((point, i) => `${i === 0 ? "M" : "L"}${fmt(point.x)} ${fmt(point.y)}`).join(" ");
    return [{ key, kind: cable.kind, d, diameterMm: sheathDiameterMm(cable.cores) }];
  });
}

/** The sheath's stub: from the entry point along the shared stub line; null when it has no length. */
function sheathStub(cores: readonly Conductor[]): Point[] | null {
  const from = cores[0].path[0];
  let shortest: { to: Point; length: number } | null = null;
  for (const core of cores) {
    const to = core.path[1];
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (length > 0 && (shortest === null || length < shortest.length)) shortest = { to, length };
  }
  if (shortest === null) return null;
  const reach = Math.min(SHEATH_STUB_MM, Math.max(shortest.length - WIRE_BEND_MM, shortest.length / 2));
  return [from, towards(from, shortest.to, reach)];
}
