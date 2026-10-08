import type { JSX } from "react";
import type { DrawnCable, DrawnDevice, DrawnWire } from "@/lib/cabinet-drawing";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * The legends and notes under the layout drawing: devices, wires and the cabinet notes. Hook-free —
 * `LayoutSection.astro` renders it without hydration (the static fallback) and the layout editor island
 * renders it hydrated, so both show the same legend.
 */
interface Props {
  geometry: CabinetGeometry;
  devices: readonly Pick<DrawnDevice, "role">[];
  wires: readonly Pick<DrawnWire, "role" | "barEnds">[];
  cables: readonly Pick<DrawnCable, "key">[];
}

const s = t.layout.section;
const legendBox = "inline-block h-4 w-6 shrink-0 rounded-xs";
const legendLine = "h-2 w-6 shrink-0";
const legendList = "flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground";

export function LayoutLegend({ geometry, devices, wires, cables }: Props): JSX.Element {
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
      </ul>
      {wires.length > 0 && (
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
              <line
                x1="0"
                y1="4"
                x2="24"
                y2="4"
                className="stroke-wire-pe-stripe"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
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
      )}
      {noBars && <p className="text-muted-foreground text-xs">{s.noBarsNote}</p>}
      {catalogBars && <p className="text-muted-foreground text-xs">{s.catalogBarsNote}</p>}
    </>
  );
}
