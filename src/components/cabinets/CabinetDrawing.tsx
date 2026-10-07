import {
  LABEL_LINE_EM,
  clampRect,
  clipRect,
  elementRect,
  entryRect,
  groupOutlines,
  type DrawnDevice,
  type DrawnRole,
  type DrawnWire,
  type ElementRef,
} from "@/lib/cabinet-drawing";
import { catalogBarAsCabinetBar } from "@/lib/cabinet-layout";
import { barRect, barsBehindAnother, railRect, type CabinetGeometry, type Rect } from "@/lib/cabinet-geometry";
import type { ConductorKind, ConductorRole } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface CabinetDrawingProps {
  geometry: CabinetGeometry;
  /** The element to outline, e.g. the row being edited. `index` is 0-based. */
  highlight?: ElementRef;
  /** Elements to mark as failing validation, e.g. the editor's geometry issues. */
  invalid?: readonly ElementRef[];
  /** Devices to draw on the rails, from `buildDrawnDevices`. Omitted: the bare cabinet. */
  devices?: readonly DrawnDevice[];
  /** Conductors to draw over the devices, from `buildDrawnWires`. Omitted: no wires. */
  wires?: readonly DrawnWire[];
  className?: string;
}

type Bar = CabinetGeometry["bars"][number];

/** Strokes stay a constant on-screen width whether the drawing is a thumbnail or full size. */
const HAIRLINE = { vectorEffect: "non-scaling-stroke", strokeWidth: 1 } as const;

/** Conductor colours per PN-EN 60445 (the `--wire-*` tokens): PE green with a yellow stripe, N blue. */
const BAR_CLASSES: Record<Bar["kind"], { body: string; label: string }> = {
  PE: { body: "fill-wire-pe stroke-drawing-frame", label: "fill-wire-pe-foreground" },
  N: { body: "fill-wire-n stroke-drawing-frame", label: "fill-wire-n-foreground" },
};

/** How far along the bar the label reaches, in label heights — the PE stripe starts beyond it. */
const LABEL_EXTENT = 2.2;
/** The PE stripe's share of the bar's short side, centred. */
const STRIPE_SHARE = 0.3;

/**
 * Devices read apart without hue: the main switch is solid dark, an RCD / RCBO is mid-tone with a heavy
 * stroke, an MCB is paper with a hairline. The label's fill is the one that contrasts with its body.
 */
const DEVICE_CLASSES: Record<DrawnRole, { body: string; label: string; strokeWidth: number }> = {
  main_switch: { body: "fill-drawing-frame stroke-drawing-frame", label: "fill-drawing-paper", strokeWidth: 1 },
  rcd: { body: "fill-drawing-device-protect stroke-drawing-frame", label: "fill-drawing-frame", strokeWidth: 2.5 },
  rcbo: { body: "fill-drawing-device-protect stroke-drawing-frame", label: "fill-drawing-frame", strokeWidth: 2.5 },
  mcb: { body: "fill-drawing-paper stroke-drawing-frame", label: "fill-drawing-frame", strokeWidth: 1 },
  // A catalog bar is drawn by `BarBody` / `BarLabel` like a built-in bar; these are never used.
  pe_bar: { body: BAR_CLASSES.PE.body, label: BAR_CLASSES.PE.label, strokeWidth: 1 },
  n_bar: { body: BAR_CLASSES.N.body, label: BAR_CLASSES.N.label, strokeWidth: 1 },
};

/** The group label's font size, and the N marker's, in millimetres. */
const GROUP_LABEL_MM = 5;
const N_MARK_MM = 5;

/**
 * Conductor colours per PN-EN 60445 (the `--wire-*` tokens), plus a pattern per role so a greyscale
 * print still tells them apart: phases solid (L1 brown, L2 black, L3 grey), N dashed, PE a wider solid
 * green line with a solid yellow centre stripe — a hollow double line in greyscale, never mistaken for
 * the dashed N — and PEN the PE pair drawn heavier. Single-phase L is drawn in L1's colour
 * (no phase balancing in the MVP).
 */
const WIRE_STYLES: Record<ConductorRole, { stroke: string; dash?: string; stripe: boolean; weight: number }> = {
  L: { stroke: "stroke-wire-l1", stripe: false, weight: 1 },
  L1: { stroke: "stroke-wire-l1", stripe: false, weight: 1 },
  L2: { stroke: "stroke-wire-l2", stripe: false, weight: 1 },
  L3: { stroke: "stroke-wire-l3", stripe: false, weight: 1 },
  N: { stroke: "stroke-wire-n", dash: "6 3", stripe: false, weight: 1 },
  PE: { stroke: "stroke-wire-pe", stripe: true, weight: 1.6 },
  PEN: { stroke: "stroke-wire-pe", stripe: true, weight: 2.2 },
};

/** On-screen stroke width per conductor kind: the WLZ and the feeds are the heavy cross-section. */
const WIRE_WIDTH_PX: Record<ConductorKind, number> = { circuit: 1.5, wlz: 2.5, feed: 2.25 };

/** On-screen width of the invisible hover target laid over each wire. */
const WIRE_HOVER_WIDTH_PX = 10;

function WireShape({ wire }: { wire: DrawnWire }) {
  const style = WIRE_STYLES[wire.role];
  const width = WIRE_WIDTH_PX[wire.kind] * style.weight;
  return (
    <g className="wire transition-opacity">
      {wire.title !== "" && <title>{wire.title}</title>}
      <path
        d={wire.d}
        className={cn("fill-none", style.stroke)}
        strokeDasharray={style.dash}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {style.stripe && (
        <path
          d={wire.d}
          className="stroke-wire-pe-stripe fill-none"
          strokeWidth={width * 0.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* A wide invisible stroke, so a thin wire — even one running behind a device — is easy to hover. */}
      <path
        d={wire.d}
        className="fill-none stroke-transparent"
        strokeWidth={WIRE_HOVER_WIDTH_PX}
        pointerEvents="stroke"
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function DeviceShape({ device, barLabelSizeMm }: { device: DrawnDevice; barLabelSizeMm: number }) {
  const { rect, lines, fontSizeMm } = device;
  // A catalog PE/N bar on a rail (plan Phase 5b) looks exactly like a built-in bar of its kind.
  const bar = catalogBarAsCabinetBar({ role: device.role }, rect);
  if (bar !== null) {
    return (
      <g>
        <BarBody bar={bar} labelSizeMm={barLabelSizeMm} />
        <BarLabel bar={bar} fontSizeMm={barLabelSizeMm} />
      </g>
    );
  }
  const style = DEVICE_CLASSES[device.role];
  const lineHeight = fontSizeMm * LABEL_LINE_EM;
  const firstY = rect.y + rect.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  return (
    <g>
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.w}
        height={rect.h}
        className={style.body}
        vectorEffect="non-scaling-stroke"
        strokeWidth={style.strokeWidth}
      />
      {lines.map((line, index) => (
        <text
          key={`${String(index)}-${line}`}
          x={rect.x + rect.w / 2}
          y={firstY + index * lineHeight}
          fontSize={fontSizeMm}
          textAnchor="middle"
          dominantBaseline="central"
          className={cn("font-mono font-medium select-none", style.label)}
        >
          {line}
        </text>
      ))}
      {device.nTerminalSide && (
        <text
          x={device.nTerminalSide === "left" ? rect.x + 1.5 : rect.x + rect.w - 1.5}
          y={rect.y + N_MARK_MM}
          fontSize={N_MARK_MM}
          textAnchor={device.nTerminalSide === "left" ? "start" : "end"}
          dominantBaseline="central"
          className={cn("font-mono font-semibold select-none", style.label)}
        >
          {t.layout.drawing.nTerminal}
        </text>
      )}
    </g>
  );
}

/** `ref`'s rectangle cut to the interior, or `null` when it does not exist or lies wholly outside. */
function visibleRect(geometry: CabinetGeometry, ref: ElementRef | undefined): Rect | null {
  const rect = ref ? elementRect(geometry, ref) : null;
  return rect ? clipRect(rect, geometry.interior) : null;
}

function barLabelSize(bar: Bar, fontSizeMm: number): number {
  const rect = barRect(bar);
  return Math.min(fontSizeMm, Math.min(rect.w, rect.h) * 0.8);
}

/**
 * The yellow band of a PE bar's green-yellow pair: along the bar's length, centred across it, and
 * starting past the label so the label keeps its contrast on the green. `null` when the bar is too
 * short to carry one beside its label.
 */
function peStripeRect(bar: Bar, fontSizeMm: number): Rect | null {
  const rect = barRect(bar);
  const start = barLabelSize(bar, fontSizeMm) * LABEL_EXTENT;
  if (bar.orientation === "horizontal") {
    const w = rect.w - start;
    const h = rect.h * STRIPE_SHARE;
    return w > 0 ? { x: rect.x + start, y: rect.y + (rect.h - h) / 2, w, h } : null;
  }
  const w = rect.w * STRIPE_SHARE;
  const h = rect.h - start;
  return h > 0 ? { x: rect.x + (rect.w - w) / 2, y: rect.y + start, w, h } : null;
}

/** A bar's body, with the yellow stripe of a PE bar. */
function BarBody({ bar, labelSizeMm }: { bar: Bar; labelSizeMm: number }) {
  const rect = barRect(bar);
  const stripe = bar.kind === "PE" ? peStripeRect(bar, labelSizeMm) : null;
  return (
    <>
      <rect x={rect.x} y={rect.y} width={rect.w} height={rect.h} className={BAR_CLASSES[bar.kind].body} {...HAIRLINE} />
      {stripe && <rect x={stripe.x} y={stripe.y} width={stripe.w} height={stripe.h} className="fill-wire-pe-stripe" />}
    </>
  );
}

/** The kind label sits at the bar's starting end, so two overlapping bars do not stack labels. */
function BarLabel({ bar, fontSizeMm }: { bar: Bar; fontSizeMm: number }) {
  const rect = barRect(bar);
  const size = barLabelSize(bar, fontSizeMm);
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
export function CabinetDrawing({
  geometry,
  highlight,
  invalid = [],
  devices = [],
  wires = [],
  className,
}: CabinetDrawingProps) {
  const { interior, rails, entries, bars } = geometry;
  const behind = barsBehindAnother(bars);
  // Nearer bars paint over farther ones; the dashed outlines of the farther ones go on top of both.
  const barOrder = bars.map((bar, index) => ({ bar, index })).sort((a, b) => a.bar.zMm - b.bar.zMm);
  const labelSizeMm = Math.max(8, Math.min(interior.widthMm, interior.heightMm) * 0.04);
  const outlines = groupOutlines(devices);
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
        <rect x={0} y={0} width={interior.widthMm} height={interior.heightMm} className="fill-drawing-paper" />

        {rails.map((rail, index) => {
          const rect = railRect(rail);
          return (
            <rect
              key={`rail-${String(index)}`}
              x={rect.x}
              y={rect.y}
              width={rect.w}
              height={rect.h}
              className="fill-drawing-rail stroke-drawing-rail-stroke"
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
              className="fill-drawing-entry stroke-drawing-entry-stroke"
              {...HAIRLINE}
            />
          );
        })}

        {barOrder.map(({ bar, index }) => (
          <g key={`bar-${String(index)}`}>
            <BarBody bar={bar} labelSizeMm={labelSizeMm} />
          </g>
        ))}

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
              className="stroke-drawing-frame fill-none"
              strokeDasharray="4 3"
              {...HAIRLINE}
            />
          );
        })}

        {bars.map((bar, index) => (
          <BarLabel key={`bar-label-${String(index)}`} bar={bar} fontSizeMm={labelSizeMm} />
        ))}

        {devices.map((device) => (
          <DeviceShape key={`device-${device.id}`} device={device} barLabelSizeMm={labelSizeMm} />
        ))}

        {wires.length > 0 && (
          // Hovering one wire dims every other, so a single conductor can be followed through a crowded
          // board; its <title> names it. CSS only — the drawing stays hook-free and server-rendered.
          <g aria-hidden="true" className="[&:has(.wire:hover)_.wire:not(:hover)]:opacity-20">
            {wires.map((wire) => (
              <WireShape key={`wire-${wire.key}`} wire={wire} />
            ))}
          </g>
        )}

        {outlines.map((group) => (
          <g key={`group-${group.key}`}>
            <rect
              x={group.rect.x}
              y={group.rect.y}
              width={group.rect.w}
              height={group.rect.h}
              className="stroke-drawing-group fill-none"
              strokeDasharray="6 3"
              vectorEffect="non-scaling-stroke"
              strokeWidth={1.5}
            />
            <text
              x={group.rect.x + 1}
              y={group.rect.y - GROUP_LABEL_MM * 0.6}
              fontSize={GROUP_LABEL_MM}
              // A paper halo keeps the label legible where wires run along the group's top channel.
              className="fill-drawing-group stroke-drawing-paper font-mono font-semibold select-none"
              strokeWidth={GROUP_LABEL_MM * 0.35}
              strokeLinejoin="round"
              paintOrder="stroke"
            >
              {group.label}
            </text>
          </g>
        ))}
      </svg>

      <rect
        x={0}
        y={0}
        width={interior.widthMm}
        height={interior.heightMm}
        className="stroke-drawing-frame fill-none"
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
          className="stroke-drawing-highlight fill-none"
          vectorEffect="non-scaling-stroke"
          strokeWidth={3}
        />
      )}
    </svg>
  );
}
