import { z } from "zod";
import { t } from "@/lib/i18n";

/**
 * A cabinet's front-view geometry, in integer millimetres. The origin is the interior's top-left
 * corner and y grows downward. This document is the grid the layout heuristic places devices on and
 * the drawing the admin, the electrician and the printed quote all render, so every write of it must
 * go through `parseCabinetGeometry` — the database checks only that it is an object at version 1.
 */

/** A TH35 DIN rail: every rail is horizontal and this tall. */
export const RAIL_HEIGHT_MM = 35;

/** Two PE/N bars may overlap in the front view only when this far apart in depth. */
export const BAR_Z_CLEARANCE_MM = 10;

export const ENTRY_SIDES = ["top", "bottom", "left", "right"] as const;
export const BAR_KINDS = ["PE", "N"] as const;
export const BAR_ORIENTATIONS = ["horizontal", "vertical"] as const;

/**
 * Every way a geometry can be rejected. Closed on purpose: the island and the server both report
 * these codes, and each one has a Polish message in `t.geometryIssues`.
 */
export const GEOMETRY_ISSUE_CODES = [
  "malformed",
  "size_not_positive_integer",
  "position_not_non_negative_integer",
  "no_rails",
  "no_entries",
  "rail_outside_interior",
  "rails_overlap",
  "rail_overlaps_bar",
  "bar_outside_interior",
  "bar_depth_outside_interior",
  "bars_too_close",
  "entry_exceeds_side",
  "entries_overlap",
  "bar_no_terminal_groups",
  "terminal_count_invalid",
  "terminal_range_invalid",
] as const;

export type GeometryIssueCode = (typeof GEOMETRY_ISSUE_CODES)[number];

export type GeometryElementKind = "rail" | "entry" | "bar";

/** `index` is 0-based; messages show it 1-based. */
export interface GeometryIssue {
  code: GeometryIssueCode;
  element?: { kind: GeometryElementKind; index: number };
}

const sizeMm = z.number().int().positive();
const positionMm = z.number().int().nonnegative();

const railSchema = z.object({ xMm: positionMm, yMm: positionMm, lengthMm: sizeMm });

const entrySchema = z.object({
  side: z.enum(ENTRY_SIDES),
  /** Measured from the left edge (top/bottom) or from the top edge (left/right). */
  offsetMm: positionMm,
  lengthMm: sizeMm,
});

/**
 * One group of identical terminals on a PE/N bar. Shared with the device catalog, whose PE and N
 * bars carry the same shape. It does not check `minMm2 ≤ maxMm2` — callers do (see
 * `findGeometryIssues` here, `parseDeviceSpec` for devices).
 */
export const terminalGroupSchema = z.object({
  count: z.number().int().positive(),
  minMm2: z.number().positive(),
  maxMm2: z.number().positive(),
});

export type TerminalGroup = z.infer<typeof terminalGroupSchema>;

const barSchema = z.object({
  kind: z.enum(BAR_KINDS),
  orientation: z.enum(BAR_ORIENTATIONS),
  xMm: positionMm,
  yMm: positionMm,
  /** Along the orientation axis. */
  lengthMm: sizeMm,
  /** Across the orientation axis. */
  heightMm: sizeMm,
  /** Distance from the back mounting plate. */
  zMm: positionMm,
  terminalGroups: z.array(terminalGroupSchema).min(1),
});

const geometryShapeSchema = z.object({
  version: z.literal(1),
  interior: z.object({ widthMm: sizeMm, heightMm: sizeMm, depthMm: sizeMm }),
  rails: z.array(railSchema).min(1),
  entries: z.array(entrySchema).min(1),
  bars: z.array(barSchema),
});

export type CabinetGeometry = z.infer<typeof geometryShapeSchema>;

const COLLECTION_BY_KIND: Record<GeometryElementKind, string> = { rail: "rails", entry: "entries", bar: "bars" };

/**
 * The complete schema — shape plus every cross-element rule — for callers that want zod directly.
 * Its issue messages are codes, not text; use `parseCabinetGeometry` for coded, deduplicated issues.
 */
export const cabinetGeometrySchema = geometryShapeSchema.superRefine((geometry, ctx) => {
  for (const issue of findGeometryIssues(geometry)) {
    ctx.addIssue({
      code: "custom",
      message: issue.code,
      path: issue.element ? [COLLECTION_BY_KIND[issue.element.kind], issue.element.index] : [],
    });
  }
});

/** Never throws, and never returns zod's English text. */
export function parseCabinetGeometry(
  input: unknown,
): { ok: true; geometry: CabinetGeometry } | { ok: false; issues: GeometryIssue[] } {
  const shape = geometryShapeSchema.safeParse(input);
  const issues = shape.success ? findGeometryIssues(shape.data) : shape.error.issues.map(shapeIssue);
  if (shape.success && issues.length === 0) return { ok: true, geometry: shape.data };
  return { ok: false, issues: dedupe(issues) };
}

/** A front-view rectangle in millimetres, origin at the interior's top-left corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Bar = CabinetGeometry["bars"][number];

export function railRect(rail: CabinetGeometry["rails"][number]): Rect {
  return { x: rail.xMm, y: rail.yMm, w: rail.lengthMm, h: RAIL_HEIGHT_MM };
}

/** A vertical bar is a horizontal one turned 90°: its length runs down, its height across. */
export function barRect(bar: Bar): Rect {
  return bar.orientation === "horizontal"
    ? { x: bar.xMm, y: bar.yMm, w: bar.lengthMm, h: bar.heightMm }
    : { x: bar.xMm, y: bar.yMm, w: bar.heightMm, h: bar.lengthMm };
}

/** Strict, so rectangles that only touch along an edge do not overlap. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * For each bar, whether another bar overlapping it in the front view sits nearer the viewer (a
 * larger `zMm`). Such a bar is partly hidden, so the drawing renders it dashed.
 */
export function barsBehindAnother(bars: readonly Bar[]): boolean[] {
  const rects = bars.map(barRect);
  return bars.map((bar, index) =>
    bars.some((other, otherIndex) => other.zMm > bar.zMm && overlaps(rects[index], rects[otherIndex])),
  );
}

function fitsInterior(rect: Rect, interior: CabinetGeometry["interior"]): boolean {
  return rect.x + rect.w <= interior.widthMm && rect.y + rect.h <= interior.heightMm;
}

/** Rules that span fields or elements; runs only on a document whose shape already passed. */
function findGeometryIssues(geometry: CabinetGeometry): GeometryIssue[] {
  const { interior, rails, entries, bars } = geometry;
  const issues: GeometryIssue[] = [];
  const railRects = rails.map(railRect);
  const barRects = bars.map(barRect);

  railRects.forEach((rect, index) => {
    const element = { kind: "rail", index } as const;
    if (!fitsInterior(rect, interior)) issues.push({ code: "rail_outside_interior", element });
    if (railRects.slice(0, index).some((other) => overlaps(rect, other))) {
      issues.push({ code: "rails_overlap", element });
    }
    if (barRects.some((bar) => overlaps(rect, bar))) issues.push({ code: "rail_overlaps_bar", element });
  });

  bars.forEach((bar, index) => {
    const element = { kind: "bar", index } as const;
    const rect = barRects[index];
    if (!fitsInterior(rect, interior)) issues.push({ code: "bar_outside_interior", element });
    if (bar.zMm > interior.depthMm) issues.push({ code: "bar_depth_outside_interior", element });
    const tooClose = bars
      .slice(0, index)
      .some(
        (other, otherIndex) =>
          overlaps(rect, barRects[otherIndex]) && Math.abs(bar.zMm - other.zMm) < BAR_Z_CLEARANCE_MM,
      );
    if (tooClose) issues.push({ code: "bars_too_close", element });
    if (bar.terminalGroups.some((group) => group.minMm2 > group.maxMm2)) {
      issues.push({ code: "terminal_range_invalid", element });
    }
  });

  entries.forEach((entry, index) => {
    const element = { kind: "entry", index } as const;
    const sideMm = entry.side === "top" || entry.side === "bottom" ? interior.widthMm : interior.heightMm;
    if (entry.offsetMm + entry.lengthMm > sideMm) issues.push({ code: "entry_exceeds_side", element });
    const overlapsSameSide = entries
      .slice(0, index)
      .some(
        (other) =>
          other.side === entry.side &&
          entry.offsetMm < other.offsetMm + other.lengthMm &&
          other.offsetMm < entry.offsetMm + entry.lengthMm,
      );
    if (overlapsSameSide) issues.push({ code: "entries_overlap", element });
  });

  return issues;
}

const KIND_BY_COLLECTION = new Map<PropertyKey, GeometryElementKind>([
  ["rails", "rail"],
  ["entries", "entry"],
  ["bars", "bar"],
]);
const SIZE_FIELDS = new Set<PropertyKey>(["widthMm", "heightMm", "depthMm", "lengthMm"]);
const POSITION_FIELDS = new Set<PropertyKey>(["xMm", "yMm", "offsetMm", "zMm"]);

/** Maps a zod shape issue to a code by where it sits in the document, not by zod's message. */
function shapeIssue(issue: z.ZodError["issues"][number]): GeometryIssue {
  const [collection, index, field, groupIndex, groupField] = [0, 1, 2, 3, 4].map((i) => issue.path.at(i));

  if (collection === "interior") {
    return { code: index !== undefined && SIZE_FIELDS.has(index) ? "size_not_positive_integer" : "malformed" };
  }

  const kind = collection === undefined ? undefined : KIND_BY_COLLECTION.get(collection);
  if (kind === undefined) return { code: "malformed" };
  if (index === undefined) {
    if (issue.code === "too_small" && kind === "rail") return { code: "no_rails" };
    if (issue.code === "too_small" && kind === "entry") return { code: "no_entries" };
    return { code: "malformed" };
  }
  if (typeof index !== "number") return { code: "malformed" };

  const element = { kind, index };
  if (field !== undefined && SIZE_FIELDS.has(field)) return { code: "size_not_positive_integer", element };
  if (field !== undefined && POSITION_FIELDS.has(field)) {
    return { code: "position_not_non_negative_integer", element };
  }
  if (field === "terminalGroups") {
    if (groupIndex === undefined && issue.code === "too_small") return { code: "bar_no_terminal_groups", element };
    if (groupField === "count") return { code: "terminal_count_invalid", element };
    if (groupField === "minMm2" || groupField === "maxMm2") return { code: "terminal_range_invalid", element };
  }
  return { code: "malformed", element };
}

function dedupe(issues: GeometryIssue[]): GeometryIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.element?.kind ?? ""}:${String(issue.element?.index ?? "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function elementSubject(issue: GeometryIssue): string {
  if (!issue.element) return t.cabinets.geometry;
  return t.cabinets.elementNumbered[issue.element.kind](issue.element.index + 1);
}

/** Polish text for one issue. The `Record` keeps it exhaustive over `GeometryIssueCode`. */
export function geometryIssueMessage(issue: GeometryIssue): string {
  const n = (issue.element?.index ?? 0) + 1;
  const m = t.geometryIssues;
  const messages: Record<GeometryIssueCode, () => string> = {
    malformed: () => m.malformed(elementSubject(issue)),
    size_not_positive_integer: () =>
      m.sizeNotPositiveInteger(issue.element ? elementSubject(issue) : t.cabinets.interior),
    position_not_non_negative_integer: () => m.positionNotNonNegativeInteger(elementSubject(issue)),
    no_rails: () => m.noRails,
    no_entries: () => m.noEntries,
    rail_outside_interior: () => m.railOutsideInterior(n),
    rails_overlap: () => m.railsOverlap(n),
    rail_overlaps_bar: () => m.railOverlapsBar(n),
    bar_outside_interior: () => m.barOutsideInterior(n),
    bar_depth_outside_interior: () => m.barDepthOutsideInterior(n),
    bars_too_close: () => m.barsTooClose(n, BAR_Z_CLEARANCE_MM),
    entry_exceeds_side: () => m.entryExceedsSide(n),
    entries_overlap: () => m.entriesOverlap(n),
    bar_no_terminal_groups: () => m.barNoTerminalGroups(n),
    terminal_count_invalid: () => m.terminalCountInvalid(n),
    terminal_range_invalid: () => m.terminalRangeInvalid(n),
  };
  return messages[issue.code]();
}
