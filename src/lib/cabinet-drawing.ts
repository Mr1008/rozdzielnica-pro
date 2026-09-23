import {
  barRect,
  railRect,
  type CabinetGeometry,
  type GeometryElementKind,
  type GeometryIssue,
  type Rect,
} from "@/lib/cabinet-geometry";

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
