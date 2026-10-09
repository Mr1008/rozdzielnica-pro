import type { JSX } from "react";
import {
  ferruleStyle,
  type DrawnBusbar,
  type DrawnCable,
  type DrawnDevice,
  type DrawnTie,
  type DrawnWire,
  type WiringVariant,
} from "@/lib/cabinet-drawing";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The legends and notes under the layout drawing: devices, wires and the cabinet notes. Hook-free —
 * `LayoutSection.astro` renders it without hydration (the static fallback) and the layout editor island
 * renders it hydrated, so both show the same legend. The wire legend follows the drawing's variant
 * (wiring), so its swatches look like the wires above it.
 */
type LegendWire = Pick<DrawnWire, "role" | "barEnds" | "crossSectionMm2" | "overflow">;
type LegendCable = Pick<DrawnCable, "key">;

interface Props {
  geometry: CabinetGeometry;
  devices: readonly Pick<DrawnDevice, "role">[];
  wires: readonly LegendWire[];
  cables: readonly LegendCable[];
  ties?: readonly Pick<DrawnTie, "key">[];
  /** The drawn comb busbars; a legend entry appears when there is at least one. */
  busbars?: readonly Pick<DrawnBusbar, "key">[];
  wiring?: WiringVariant;
}

const s = t.layout.section;
const legendBox = "inline-block h-4 w-6 shrink-0 rounded-xs";
const legendLine = "h-2 w-6 shrink-0";
const legendList = "flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground";

export function LayoutLegend({
  geometry,
  devices,
  wires,
  cables,
  ties = [],
  busbars = [],
  wiring = "realistic",
}: Props): JSX.Element {
  // A cabinet without built-in bars gets them from the catalog (plan Phase 5b), placed on a DIN rail.
  const catalogBars = devices.some((device) => device.role === "pe_bar" || device.role === "n_bar");
  const noBars = geometry.bars.length === 0 && !catalogBars;
  return (
    <>
      <ul aria-label={s.legendLabel} className={legendList}>
        <li className="flex items-center gap-2">
          <span className={cn(legendBox, "border-drawing-frame bg-drawing-frame border")} aria-hidden="true" />
          {s.legend.mainSwitch}
        </li>
        <li className="flex items-center gap-2">
          <span
            className={cn(legendBox, "border-drawing-frame bg-drawing-device-protect border-2")}
            aria-hidden="true"
          />
          {s.legend.protection}
        </li>
        <li className="flex items-center gap-2">
          <span className={cn(legendBox, "border-drawing-frame bg-drawing-paper border")} aria-hidden="true" />
          {s.legend.mcb}
        </li>
        <li className="flex items-center gap-2">
          <span className={cn(legendBox, "border-drawing-group border border-dashed")} aria-hidden="true" />
          {s.legend.group}
        </li>
        {busbars.length > 0 && (
          <li className="flex items-center gap-2">
            <BusbarSwatch wiring={wiring} />
            {s.legend.busbar}
          </li>
        )}
      </ul>
      {wires.length > 0 &&
        (wiring === "realistic" ? (
          <RealisticWireLegend wires={wires} cables={cables} ties={ties} />
        ) : (
          <SchematicWireLegend wires={wires} cables={cables} />
        ))}
      {noBars && <p className="text-muted-foreground text-xs">{s.noBarsNote}</p>}
      {catalogBars && <p className="text-muted-foreground text-xs">{s.catalogBarsNote}</p>}
    </>
  );
}

/** The busbar swatch in the variant's own look: a copper-toothed strip, or a heavy line with ticks. */
function BusbarSwatch({ wiring }: { wiring: WiringVariant }) {
  return (
    <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
      {wiring === "realistic" ? (
        <>
          {[5, 12, 19].map((x) => (
            <rect
              key={x}
              x={x - 1}
              y="3"
              width="2"
              height="5"
              className="fill-busbar-copper stroke-drawing-frame"
              strokeWidth="0.4"
            />
          ))}
          <rect
            x="1"
            y="1"
            width="22"
            height="3.5"
            rx="0.8"
            className="fill-busbar-insulation stroke-drawing-frame"
            strokeWidth="0.5"
          />
        </>
      ) : (
        <>
          {[5, 12, 19].map((x) => (
            <line key={x} x1={x} y1="2.5" x2={x} y2="7.5" className="stroke-drawing-frame" strokeWidth="1" />
          ))}
          <line x1="1" y1="2.5" x2="23" y2="2.5" className="stroke-drawing-frame" strokeWidth="2.4" />
        </>
      )}
    </svg>
  );
}

/** The schematic wire legend: thin lines with the greyscale-safe patterns. */
function SchematicWireLegend({ wires, cables }: { wires: readonly LegendWire[]; cables: readonly LegendCable[] }) {
  return (
    <ul aria-label={s.wireLegendLabel} className={legendList}>
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
          <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-l1" strokeWidth="2" />
        </svg>
        {s.wireLegend.l}
      </li>
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
          <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-n" strokeWidth="2" strokeDasharray="6 3" />
        </svg>
        {s.wireLegend.n}
      </li>
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
          <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-pe" strokeWidth="2" />
          <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-pe-stripe" strokeWidth="1" strokeDasharray="3 3" />
        </svg>
        {s.wireLegend.pe}
      </li>
      {wires.some((wire) => wire.role === "PEN") && (
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
            <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-pe" strokeWidth="3.5" />
            <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-pe-stripe" strokeWidth="1.5" />
            <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-n" strokeWidth="1.5" strokeDasharray="3 3" />
          </svg>
          {s.wireLegend.pen}
        </li>
      )}
      {wires.some((wire) => wire.barEnds.length > 0) && (
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
            <circle cx="6" cy="4" r="3" className="fill-drawing-paper stroke-drawing-frame" strokeWidth="0.75" />
            <circle cx="17" cy="4" r="3" className="fill-drawing-paper stroke-drawing-frame" strokeWidth="0.75" />
            <circle cx="17" cy="4" r="2.2" className="fill-wire-pe stroke-drawing-frame" strokeWidth="0.5" />
          </svg>
          {s.wireLegend.terminal}
        </li>
      )}
      {cables.length > 0 && (
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
            <line x1="0" y1="4" x2="24" y2="4" className="stroke-drawing-frame" strokeWidth="6" />
            <line x1="0" y1="4" x2="24" y2="4" className="stroke-drawing-paper" strokeWidth="3.5" />
          </svg>
          {s.wireLegend.cable}
        </li>
      )}
    </ul>
  );
}

/** A realistic wire swatch: outline, body and the PE dashes, as the drawing paints them (in px here). */
function RealisticSwatch({ body, dash, width = 4 }: { body: string; dash?: string; width?: number }) {
  return (
    <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
      <line
        x1="1"
        y1="4"
        x2="23"
        y2="4"
        className="stroke-drawing-frame"
        strokeWidth={width + 0.6}
        strokeLinecap="round"
      />
      <line x1="1" y1="4" x2="23" y2="4" className={body} strokeWidth={width} strokeLinecap="round" />
      {dash !== undefined && (
        <line x1="1" y1="4" x2="23" y2="4" className={dash} strokeWidth={width} strokeDasharray="5 4" />
      )}
    </svg>
  );
}

/** The realistic wire legend (S-11): colours, thickness, ferrules, ties, packs and the overflow layer. */
function RealisticWireLegend({
  wires,
  cables,
  ties,
}: {
  wires: readonly LegendWire[];
  cables: readonly LegendCable[];
  ties: readonly Pick<DrawnTie, "key">[];
}) {
  const r = s.realisticWireLegend;
  const sections = [...new Set(wires.map((wire) => wire.crossSectionMm2))].sort((a, b) => a - b);
  const ferrules = sections.flatMap((mm2) => {
    const style = ferruleStyle(mm2);
    return style === null ? [] : [{ mm2, stroke: style.stroke }];
  });
  return (
    <ul aria-label={s.wireLegendLabel} className={legendList}>
      <li className="flex items-center gap-2">
        <RealisticSwatch body="stroke-wire-l1" />
        {r.l}
      </li>
      <li className="flex items-center gap-2">
        <RealisticSwatch body="stroke-wire-n" />
        {r.n}
      </li>
      <li className="flex items-center gap-2">
        <RealisticSwatch body="stroke-wire-pe-stripe" dash="stroke-wire-pe" />
        {r.pe}
      </li>
      {wires.some((wire) => wire.role === "PEN") && (
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
            <line x1="1" y1="4" x2="23" y2="4" className="stroke-drawing-frame" strokeWidth="4.6" />
            <line x1="1" y1="4" x2="23" y2="4" className="stroke-wire-pe-stripe" strokeWidth="4" />
            <line x1="1" y1="4" x2="23" y2="4" className="stroke-wire-pe" strokeWidth="4" strokeDasharray="3 6" />
            <line
              x1="1"
              y1="4"
              x2="23"
              y2="4"
              className="stroke-wire-n"
              strokeWidth="4"
              strokeDasharray="3 6"
              strokeDashoffset="-4.5"
            />
          </svg>
          {r.pen}
        </li>
      )}
      <li className="flex items-center gap-2">
        <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
          <line x1="1" y1="2" x2="23" y2="2" className="stroke-wire-l2" strokeWidth="1" />
          <line x1="1" y1="4.5" x2="23" y2="4.5" className="stroke-wire-l2" strokeWidth="2" />
          <line x1="1" y1="7" x2="23" y2="7" className="stroke-wire-l2" strokeWidth="1.5" />
        </svg>
        {r.thickness}
      </li>
      {ferrules.length > 0 && (
        <li className="flex flex-wrap items-center gap-2">
          {r.ferrules}
          {ferrules.map((ferrule) => (
            <span key={String(ferrule.mm2)} className="inline-flex items-center gap-1">
              <svg viewBox="0 0 12 8" className="h-2 w-3 shrink-0" aria-hidden="true">
                <line x1="1" y1="4" x2="11" y2="4" className="stroke-drawing-frame" strokeWidth="6.6" />
                <line x1="1.3" y1="4" x2="10.7" y2="4" className={ferrule.stroke} strokeWidth="6" />
              </svg>
              {s.crossSection(ferrule.mm2)}
            </span>
          ))}
        </li>
      )}
      {wires.some((wire) => wire.barEnds.length > 0) && (
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
            <circle cx="6" cy="4" r="3" className="fill-drawing-paper stroke-drawing-frame" strokeWidth="0.75" />
            <circle cx="17" cy="4" r="3" className="fill-drawing-paper stroke-drawing-frame" strokeWidth="0.75" />
            <circle cx="17" cy="4" r="2.2" className="fill-wire-pe stroke-drawing-frame" strokeWidth="0.5" />
          </svg>
          {s.wireLegend.terminal}
        </li>
      )}
      {cables.length > 0 && (
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
            <line x1="0" y1="4" x2="24" y2="4" className="stroke-drawing-frame" strokeWidth="6.6" />
            <line x1="0" y1="4" x2="24" y2="4" className="stroke-wire-sheath" strokeWidth="6" />
          </svg>
          {s.wireLegend.cable}
        </li>
      )}
      {ties.length > 0 && (
        <li className="flex items-center gap-2">
          <svg viewBox="0 0 24 8" className={legendLine} aria-hidden="true">
            <line x1="0" y1="2.5" x2="24" y2="2.5" className="stroke-wire-l1" strokeWidth="2" />
            <line x1="0" y1="5.5" x2="24" y2="5.5" className="stroke-wire-n" strokeWidth="2" />
            <rect
              x="10.5"
              y="0.5"
              width="3"
              height="7"
              rx="1"
              className="fill-wire-tie stroke-drawing-frame"
              strokeWidth="0.5"
            />
          </svg>
          {r.tie}
        </li>
      )}
      <li className="flex items-center gap-2">{r.pack}</li>
      {wires.some((wire) => wire.overflow) && <li className="flex items-center gap-2">{r.overflow}</li>}
    </ul>
  );
}
