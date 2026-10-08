import type { SVGProps } from "react";
import {
  LABEL_LINE_EM,
  clampRect,
  clipRect,
  elementRect,
  entryRect,
  groupOutlines,
  PEN_DASH,
  WIRE_STYLES,
  type DrawnCable,
  type DrawnDevice,
  type DrawnRole,
  type DrawnWire,
  type ElementRef,
} from "@/lib/cabinet-drawing";
import { BAR_LABEL_EXTENT, barLabelFontMm, barLabelSizeMm, barTerminalPoints, type Point } from "@/lib/cabinet-layout";
import { barRect, barsBehindAnother, railRect, type CabinetGeometry, type Rect } from "@/lib/cabinet-geometry";
import type { ConductorKind } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * What the layout editor island (S-06) adds to the drawing: props spread onto each device's `<g>` and
 * onto each group's label handle, and which devices to mark. The drawing stays hook-free — the island
 * owns all the state — and renders exactly as before when this is absent.
 */
export interface DrawingInteraction {
  deviceProps(deviceId: string): SVGProps<SVGGElement>;
  /** `groupId` is the RCD group's id; a group continued on a second rail has one handle per rail. */
  groupHandleProps(groupId: string): SVGProps<SVGGElement>;
  /** The device with focus: outlined. */
  selectedId?: string | null;
  /** The group handle with focus: outlined. */
  selectedGroupId?: string | null;
  /** Devices being dragged or picked up: outlined, tinted and painted over the others. */
  liftedIds?: readonly string[];
  /** Lifted devices whose drop was refused: outlined as errors. */
  refusedIds?: readonly string[];
}

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
  /** The cables' sheathed runs from their entry points, from `buildDrawnCables`. Omitted: none. */
  cables?: readonly DrawnCable[];
  /** Make devices and group labels interactive (the layout editor). Wires then ignore the pointer. */
  interactive?: DrawingInteraction;
  /** Draw no wires or cables — the editor hides them while the layout has unsaved changes. */
  hideWires?: boolean;
  className?: string;
}

type Bar = CabinetGeometry["bars"][number];
type Interior = CabinetGeometry["interior"];

/** Strokes stay a constant on-screen width whether the drawing is a thumbnail or full size. */
const HAIRLINE = { vectorEffect: "non-scaling-stroke", strokeWidth: 1 } as const;

/** Conductor colours per PN-EN 60445 (the `--wire-*` tokens): PE green with a yellow stripe, N blue. */
const BAR_CLASSES: Record<Bar["kind"], { body: string; label: string }> = {
  PE: { body: "fill-wire-pe stroke-drawing-frame", label: "fill-wire-pe-foreground" },
  N: { body: "fill-wire-n stroke-drawing-frame", label: "fill-wire-n-foreground" },
};

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

/** A cable's sheath, on screen: an outline in the frame colour around a paper core. */
const CABLE_OUTLINE_PX = 7;
const CABLE_CORE_PX = 4.5;

/** A bar terminal's screw mark: its radius in millimetres, from the bar's short side and the pitch. */
const SCREW_SHARE_OF_BAR = 0.22;
const SCREW_SHARE_OF_PITCH = 0.4;
const MAX_SCREW_MM = 3;
/** A wire end on a taken terminal fills this share of the screw mark. */
const WIRE_END_SHARE = 0.75;

interface Screw {
  point: Point;
  radiusMm: number;
}

/** Every terminal of a bar as a screw mark (plan Phase 5c). */
function barScrews(bar: Bar, interior: Interior): Screw[] {
  const terminals = barTerminalPoints(bar, interior);
  if (terminals.length === 0) return [];
  const rect = barRect(bar);
  const pitch =
    terminals.length > 1
      ? Math.hypot(terminals[1].point.x - terminals[0].point.x, terminals[1].point.y - terminals[0].point.y)
      : bar.lengthMm;
  const radiusMm = Math.min(MAX_SCREW_MM, Math.min(rect.w, rect.h) * SCREW_SHARE_OF_BAR, pitch * SCREW_SHARE_OF_PITCH);
  return terminals.map((terminal) => ({ point: terminal.point, radiusMm }));
}

function pointKey(point: Point): string {
  return `${point.x.toFixed(3)}:${point.y.toFixed(3)}`;
}

/** On-screen stroke width per conductor kind: the WLZ and the feeds are the heavy cross-section. */
const WIRE_WIDTH_PX: Record<ConductorKind, number> = { circuit: 1.5, wlz: 2.5, feed: 2.25 };

/** On-screen width of the invisible hover target laid over each wire. */
const WIRE_HOVER_WIDTH_PX = 10;

function WireShape({ wire, screwRadius }: { wire: DrawnWire; screwRadius: ReadonlyMap<string, number> }) {
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
      {style.penDash && (
        <path
          d={wire.d}
          className="stroke-wire-n fill-none"
          strokeWidth={width * 0.4}
          strokeDasharray={PEN_DASH}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {/* The bar terminal this wire takes: its end fills the screw mark in the wire's colour. */}
      {wire.barEnds.map((point) => {
        const radius = screwRadius.get(pointKey(point));
        return radius === undefined ? null : (
          <circle
            key={`end-${pointKey(point)}`}
            cx={point.x}
            cy={point.y}
            r={radius * WIRE_END_SHARE}
            className={cn("stroke-drawing-frame", style.fill)}
            {...HAIRLINE}
          />
        );
      })}
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

/** The outline an editor state paints over a device: focus, lifted (tinted) or a refused drop. */
const STATE_OUTLINE_CLASSES = {
  selected: "stroke-drawing-highlight fill-none",
  lifted: "stroke-drawing-highlight fill-drawing-highlight/20",
  refused: "stroke-destructive fill-destructive/20",
} as const;

function DeviceShape({
  device,
  barLabelSizeMm,
  interior,
  gProps,
  state,
}: {
  device: DrawnDevice;
  barLabelSizeMm: number;
  interior: Interior;
  gProps?: SVGProps<SVGGElement>;
  state?: keyof typeof STATE_OUTLINE_CLASSES | null;
}) {
  const { rect, lines, fontSizeMm } = device;
  // A catalog PE/N bar on a rail (plan Phase 5b) looks exactly like a built-in bar of its kind.
  const { bar } = device;
  const outline = state ? (
    <rect
      x={rect.x}
      y={rect.y}
      width={rect.w}
      height={rect.h}
      className={STATE_OUTLINE_CLASSES[state]}
      strokeDasharray={state === "lifted" ? "5 3" : undefined}
      pointerEvents="none"
      vectorEffect="non-scaling-stroke"
      strokeWidth={3}
    />
  ) : null;
  if (bar !== null) {
    return (
      <g {...gProps}>
        <BarBody bar={bar} labelSizeMm={barLabelSizeMm} />
        <BarLabel bar={bar} fontSizeMm={barLabelSizeMm} />
        <BarScrews bar={bar} interior={interior} />
        {outline}
      </g>
    );
  }
  const style = DEVICE_CLASSES[device.role];
  const lineHeight = fontSizeMm * LABEL_LINE_EM;
  const firstY = rect.y + rect.h / 2 - ((lines.length - 1) * lineHeight) / 2;
  return (
    <g {...gProps}>
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
      {outline}
    </g>
  );
}

/** `ref`'s rectangle cut to the interior, or `null` when it does not exist or lies wholly outside. */
function visibleRect(geometry: CabinetGeometry, ref: ElementRef | undefined): Rect | null {
  const rect = ref ? elementRect(geometry, ref) : null;
  return rect ? clipRect(rect, geometry.interior) : null;
}

/**
 * The yellow band of a PE bar's green-yellow pair: along the bar's length, centred across it, and
 * starting past the label so the label keeps its contrast on the green. `null` when the bar is too
 * short to carry one beside its label.
 */
function peStripeRect(bar: Bar, fontSizeMm: number): Rect | null {
  const rect = barRect(bar);
  const start = barLabelSizeMm(bar, fontSizeMm) * BAR_LABEL_EXTENT;
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

/** The bar's terminals as small screw marks, one per terminal (plan Phase 5c). */
function BarScrews({ bar, interior }: { bar: Bar; interior: Interior }) {
  return (
    <>
      {barScrews(bar, interior).map((screw, index) => (
        <circle
          key={`screw-${String(index)}`}
          cx={screw.point.x}
          cy={screw.point.y}
          r={screw.radiusMm}
          className="fill-drawing-paper stroke-drawing-frame"
          {...HAIRLINE}
        />
      ))}
    </>
  );
}

/** The kind label sits at the bar's starting end, so two overlapping bars do not stack labels. */
function BarLabel({ bar, fontSizeMm }: { bar: Bar; fontSizeMm: number }) {
  const rect = barRect(bar);
  const size = barLabelSizeMm(bar, fontSizeMm);
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
  cables = [],
  interactive,
  hideWires = false,
  className,
}: CabinetDrawingProps) {
  const { interior, rails, entries, bars } = geometry;
  const behind = barsBehindAnother(bars);
  // Nearer bars paint over farther ones; the dashed outlines of the farther ones go on top of both.
  const barOrder = bars.map((bar, index) => ({ bar, index })).sort((a, b) => a.bar.zMm - b.bar.zMm);
  const labelSizeMm = barLabelFontMm(interior);
  const outlines = groupOutlines(devices);
  // A group's outline is keyed by its group and its order among the group's outlines, not by its rail:
  // moving a group to another rail then keeps its handle's element (and the keyboard focus on it).
  const seenGroups = new Map<string, number>();
  const outlineKeys = outlines.map((outline) => {
    const id = outline.key.slice(0, outline.key.lastIndexOf(":"));
    const occurrence = seenGroups.get(id) ?? 0;
    seenGroups.set(id, occurrence + 1);
    return `${id}#${String(occurrence)}`;
  });
  const lifted = new Set(interactive?.liftedIds);
  const refused = new Set(interactive?.refusedIds);
  const stateOf = (id: string) =>
    refused.has(id) ? "refused" : lifted.has(id) ? "lifted" : interactive?.selectedId === id ? "selected" : null;
  // Where each screw mark is, so a wire ending on a bar terminal fills exactly that mark.
  const screwRadius = new Map(
    [...bars, ...devices.flatMap((device) => device.bar ?? [])]
      .flatMap((bar) => barScrews(bar, interior))
      .map((screw) => [pointKey(screw.point), screw.radiusMm] as const),
  );
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

        {bars.map((bar, index) => (
          <BarScrews key={`bar-screws-${String(index)}`} bar={bar} interior={interior} />
        ))}

        {devices.map((device) => (
          <DeviceShape
            key={`device-${device.id}`}
            device={device}
            barLabelSizeMm={labelSizeMm}
            interior={interior}
            gProps={interactive?.deviceProps(device.id)}
            state={interactive ? stateOf(device.id) : null}
          />
        ))}

        {interactive && lifted.size > 0 && (
          // A lifted device is painted again over everything the pointer passes it. The real, focusable
          // element keeps its place in the tree — moving it in the DOM would drop the keyboard focus.
          <g aria-hidden="true" pointerEvents="none">
            {devices
              .filter((device) => lifted.has(device.id))
              .map((device) => (
                <DeviceShape
                  key={`lifted-${device.id}`}
                  device={device}
                  barLabelSizeMm={labelSizeMm}
                  interior={interior}
                  state={stateOf(device.id)}
                />
              ))}
          </g>
        )}

        {!hideWires && wires.length > 0 && (
          // Hovering one wire dims every other, so a single conductor can be followed through a crowded
          // board; its <title> names it. CSS only — the drawing stays hook-free and server-rendered.
          // In the editor the wires ignore the pointer, so a device under one can still be picked up.
          <g
            aria-hidden="true"
            className={cn(
              "[&:has(.wire:hover)_.wire:not(:hover)]:opacity-20",
              interactive && "[&_*]:pointer-events-none",
            )}
          >
            {wires.map((wire) => (
              <WireShape key={`wire-${wire.key}`} wire={wire} screwRadius={screwRadius} />
            ))}
          </g>
        )}

        {!hideWires && cables.length > 0 && (
          // Each cable's sheath from its entry point, over its cores, which emerge where it ends.
          <g aria-hidden="true" pointerEvents="none">
            {cables.map((cable) => (
              <g key={`cable-${cable.key}`}>
                <path
                  d={cable.d}
                  className="stroke-drawing-frame fill-none"
                  strokeWidth={CABLE_OUTLINE_PX}
                  strokeLinecap="butt"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={cable.d}
                  className="stroke-drawing-paper fill-none"
                  strokeWidth={CABLE_CORE_PX}
                  strokeLinecap="butt"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </g>
        )}

        {outlines.map((group, outlineIndex) => {
          // The outline's key is "<group id>:<rail index>"; the handle names the group alone.
          const groupId = group.key.slice(0, group.key.lastIndexOf(":"));
          const handleSelected = interactive?.selectedGroupId === groupId;
          const label = (
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
          );
          return (
            <g key={`group-${outlineKeys[outlineIndex]}`}>
              <rect
                x={group.rect.x}
                y={group.rect.y}
                width={group.rect.w}
                height={group.rect.h}
                className="stroke-drawing-group fill-none"
                strokeDasharray="6 3"
                pointerEvents={interactive ? "none" : undefined}
                vectorEffect="non-scaling-stroke"
                strokeWidth={1.5}
              />
              {interactive ? (
                // The group's grab handle: a paper tab behind its label, so the whole tab is the target.
                <g {...interactive.groupHandleProps(groupId)}>
                  <rect
                    x={group.rect.x}
                    y={group.rect.y - GROUP_LABEL_MM * 1.7}
                    width={group.label.length * GROUP_LABEL_MM * 0.62 + 4}
                    height={GROUP_LABEL_MM * 1.7}
                    className={cn(
                      "fill-drawing-paper",
                      handleSelected ? "stroke-drawing-highlight" : "stroke-drawing-group",
                    )}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={handleSelected ? 3 : 1}
                  />
                  {label}
                </g>
              ) : (
                label
              )}
            </g>
          );
        })}
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
