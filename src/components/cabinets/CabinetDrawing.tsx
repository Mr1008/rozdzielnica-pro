import { clampRect, clipRect, elementRect, entryRect, type ElementRef } from "@/lib/cabinet-drawing";
import { barRect, barsBehindAnother, railRect, type CabinetGeometry, type Rect } from "@/lib/cabinet-geometry";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CabinetDrawingProps {
  geometry: CabinetGeometry;
  /** The element to outline, e.g. the row being edited. `index` is 0-based. */
  highlight?: ElementRef;
  /** Elements to mark as failing validation, e.g. the editor's geometry issues. */
  invalid?: readonly ElementRef[];
  className?: string;
}

type Bar = CabinetGeometry["bars"][number];

/** Strokes stay a constant on-screen width whether the drawing is a thumbnail or full size. */
const HAIRLINE = { vectorEffect: "non-scaling-stroke", strokeWidth: 1 } as const;

const BAR_CLASSES: Record<Bar["kind"], { body: string; label: string }> = {
  PE: { body: "fill-yellow-400 stroke-green-700", label: "fill-green-900" },
  N: { body: "fill-sky-500 stroke-sky-800", label: "fill-white" },
};

/** `ref`'s rectangle cut to the interior, or `null` when it does not exist or lies wholly outside. */
function visibleRect(geometry: CabinetGeometry, ref: ElementRef | undefined): Rect | null {
  const rect = ref ? elementRect(geometry, ref) : null;
  return rect ? clipRect(rect, geometry.interior) : null;
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
 *
 * Nothing is painted outside the interior, even for a geometry `parseCabinetGeometry` rejects: the
 * elements sit in a nested `<svg>` the size of the interior, which clips its content by default. It
 * has no `viewBox`, so it neither scales nor translates — its coordinates are the outer ones — and,
 * unlike a `clipPath`, it needs no id that would have to be unique across a page of thumbnails.
 * Overlays are drawn above it from rectangles already cut to the interior.
 */
export function CabinetDrawing({ geometry, highlight, invalid = [], className }: CabinetDrawingProps) {
  const { interior, rails, entries, bars } = geometry;
  const behind = barsBehindAnother(bars);
  // Nearer bars paint over farther ones; the dashed outlines of the farther ones go on top of both.
  const barOrder = bars.map((bar, index) => ({ bar, index })).sort((a, b) => a.bar.zMm - b.bar.zMm);
  const labelSizeMm = Math.max(8, Math.min(interior.widthMm, interior.heightMm) * 0.04);
  const outline = visibleRect(geometry, highlight);
  const invalidRects = invalid.flatMap((ref) => visibleRect(geometry, ref) ?? []);
  // An invalid element with nothing inside the interior is marked on the edge it lies beyond.
  const offInteriorMarks = invalid.flatMap((ref) => {
    const rect = elementRect(geometry, ref);
    return rect && !clipRect(rect, interior) ? [clampRect(rect, interior)] : [];
  });

  return (
    <svg
      viewBox={`0 0 ${String(interior.widthMm)} ${String(interior.heightMm)}`}
      role="img"
      aria-label={t.cabinets.drawing.label(interior.widthMm, interior.heightMm)}
      className={cn("h-auto w-full overflow-visible", className)}
    >
      <svg x={0} y={0} width={interior.widthMm} height={interior.heightMm} overflow="hidden">
        <rect x={0} y={0} width={interior.widthMm} height={interior.heightMm} className="fill-white" />

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
      </svg>

      <rect
        x={0}
        y={0}
        width={interior.widthMm}
        height={interior.heightMm}
        className="fill-none stroke-zinc-700"
        {...HAIRLINE}
      />

      {invalidRects.map((rect, index) => (
        <rect
          key={`invalid-${String(index)}`}
          x={rect.x}
          y={rect.y}
          width={rect.w}
          height={rect.h}
          className="fill-destructive/15 stroke-destructive"
          vectorEffect="non-scaling-stroke"
          strokeWidth={2}
        />
      ))}

      {offInteriorMarks.map((mark, index) => (
        <line
          key={`off-interior-${String(index)}`}
          x1={mark.x}
          y1={mark.y}
          x2={mark.x + mark.w}
          y2={mark.y + mark.h}
          className="stroke-destructive"
          vectorEffect="non-scaling-stroke"
          strokeWidth={4}
          strokeDasharray="6 4"
        />
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
