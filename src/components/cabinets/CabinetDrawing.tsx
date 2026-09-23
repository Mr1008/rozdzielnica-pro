import {
  barRect,
  barsBehindAnother,
  railRect,
  type CabinetGeometry,
  type GeometryElementKind,
  type Rect,
} from "@/lib/cabinet-geometry";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CabinetDrawingProps {
  geometry: CabinetGeometry;
  /** The element to outline, e.g. the row being edited. `index` is 0-based. */
  highlight?: { kind: GeometryElementKind; index: number };
  className?: string;
}

type Entry = CabinetGeometry["entries"][number];
type Bar = CabinetGeometry["bars"][number];

/** Strokes stay a constant on-screen width whether the drawing is a thumbnail or full size. */
const HAIRLINE = { vectorEffect: "non-scaling-stroke", strokeWidth: 1 } as const;

const BAR_CLASSES: Record<Bar["kind"], { body: string; label: string }> = {
  PE: { body: "fill-yellow-400 stroke-green-700", label: "fill-green-900" },
  N: { body: "fill-sky-500 stroke-sky-800", label: "fill-white" },
};

/** Entry zones are drawn as a strip along their edge, inside the interior. */
function entryThicknessMm(interior: CabinetGeometry["interior"]): number {
  return Math.max(4, Math.round(Math.min(interior.widthMm, interior.heightMm) * 0.03));
}

function entryRect(entry: Entry, interior: CabinetGeometry["interior"]): Rect {
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

function highlightRect(geometry: CabinetGeometry, highlight: CabinetDrawingProps["highlight"]): Rect | null {
  if (!highlight) return null;
  const { kind, index } = highlight;
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

/** The kind label sits at the bar's starting end, so two overlapping bars do not stack labels. */
function BarLabel({ bar, fontSizeMm }: { bar: Bar; fontSizeMm: number }) {
  const rect = barRect(bar);
  const size = Math.min(fontSizeMm, Math.min(rect.w, rect.h) * 0.8);
  const horizontal = bar.orientation === "horizontal";
  return (
    <text
      x={horizontal ? rect.x + size * 0.4 : rect.x + rect.w / 2}
      y={horizontal ? rect.y + rect.h / 2 : rect.y + size}
      fontSize={size}
      textAnchor={horizontal ? "start" : "middle"}
      dominantBaseline="central"
      className={cn("font-sans font-semibold select-none", BAR_CLASSES[bar.kind].label)}
    >
      {t.cabinets.drawing.barLabels[bar.kind]}
    </text>
  );
}

/**
 * A cabinet's interior seen from the front. One SVG unit is one millimetre and nothing is
 * transformed, so a pointer position maps to millimetres through the SVG's screen CTM alone.
 * Deliberately hook-free: `.astro` pages render it without hydration, and the editor island reuses it.
 */
export function CabinetDrawing({ geometry, highlight, className }: CabinetDrawingProps) {
  const { interior, rails, entries, bars } = geometry;
  const behind = barsBehindAnother(bars);
  // Nearer bars paint over farther ones; the dashed outlines of the farther ones go on top of both.
  const barOrder = bars.map((bar, index) => ({ bar, index })).sort((a, b) => a.bar.zMm - b.bar.zMm);
  const labelSizeMm = Math.max(8, Math.min(interior.widthMm, interior.heightMm) * 0.04);
  const outline = highlightRect(geometry, highlight);

  return (
    <svg
      viewBox={`0 0 ${String(interior.widthMm)} ${String(interior.heightMm)}`}
      role="img"
      aria-label={t.cabinets.drawing.label(interior.widthMm, interior.heightMm)}
      className={cn("h-auto w-full overflow-visible", className)}
    >
      <rect
        x={0}
        y={0}
        width={interior.widthMm}
        height={interior.heightMm}
        className="fill-white stroke-zinc-700"
        {...HAIRLINE}
      />

      {rails.map((rail, index) => {
        const rect = railRect(rail);
        return (
          <rect
            key={`rail-${String(index)}`}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            className="fill-zinc-300 stroke-zinc-500"
            {...HAIRLINE}
          />
        );
      })}

      {entries.map((entry, index) => {
        const rect = entryRect(entry, interior);
        return (
          <rect
            key={`entry-${String(index)}`}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            className="fill-amber-400/70 stroke-amber-600"
            {...HAIRLINE}
          />
        );
      })}

      {barOrder.map(({ bar, index }) => {
        const rect = barRect(bar);
        return (
          <rect
            key={`bar-${String(index)}`}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            className={BAR_CLASSES[bar.kind].body}
            {...HAIRLINE}
          />
        );
      })}

      {bars.map((bar, index) => {
        if (!behind[index]) return null;
        const rect = barRect(bar);
        return (
          <rect
            key={`bar-behind-${String(index)}`}
            x={rect.x}
            y={rect.y}
            width={rect.w}
            height={rect.h}
            className="fill-none stroke-zinc-900"
            strokeDasharray="4 3"
            {...HAIRLINE}
          />
        );
      })}

      {bars.map((bar, index) => (
        <BarLabel key={`bar-label-${String(index)}`} bar={bar} fontSizeMm={labelSizeMm} />
      ))}

      {outline && (
        <rect
          x={outline.x}
          y={outline.y}
          width={outline.w}
          height={outline.h}
          className="fill-none stroke-fuchsia-600"
          vectorEffect="non-scaling-stroke"
          strokeWidth={3}
        />
      )}
    </svg>
  );
}
