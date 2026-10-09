import { useEffect, useState, type JSX } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { CabinetDrawing } from "@/components/cabinets/CabinetDrawing";
import { LayoutLegend } from "@/components/projects/LayoutLegend";
import { WireLengthsTable } from "@/components/projects/WireLengthsTable";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DrawnDevice } from "@/lib/cabinet-drawing";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import { wiringWarningMessage } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import { buildWiringDrawing, type WiringData, type WiringDrawing as Wiring } from "@/lib/wiring-island";

/** Fired on `window` once an island has drawn its wires; the print page waits for it. */
export const WIRING_READY_EVENT = "wiring-ready";

/**
 * The placed layout's wires, routed in the browser (S-11 Phase 5). Starts as null on the server and on
 * the first client render, so hydration matches, then routes after mount. A timeout lets the page
 * paint the devices first. Null data stays null.
 */
export function useWiringDrawing(wiring: WiringData | null, devices: readonly DrawnDevice[]): Wiring | null {
  // Kept with the inputs it was routed from, so new inputs read as "not drawn yet" without a reset.
  const [routed, setRouted] = useState<{
    wiring: WiringData;
    devices: readonly DrawnDevice[];
    drawn: Wiring;
  } | null>(null);
  useEffect(() => {
    if (wiring === null) return;
    const timer = setTimeout(() => {
      setRouted({ wiring, devices, drawn: buildWiringDrawing(wiring, devices) });
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [wiring, devices]);
  const drawn = routed !== null && routed.wiring === wiring && routed.devices === devices ? routed.drawn : null;
  useEffect(() => {
    if (drawn !== null) window.dispatchEvent(new Event(WIRING_READY_EVENT));
  }, [drawn]);
  return drawn;
}

interface Props {
  geometry: CabinetGeometry;
  /** The placed devices, from `buildDrawnDevices` on the server. */
  devices: DrawnDevice[];
  /** The router's input; null draws the devices alone. */
  wiring: WiringData | null;
  /** Show the lengths table, with this slack share in percent. Omitted: no table (the printout). */
  slackPercent?: number;
  /** Classes of the drawing's wrapper. */
  drawingWrapperClassName?: string;
  /** Classes of the drawing's `<svg>`. */
  drawingClassName?: string;
}

/**
 * The cabinet drawing with its wires, legend, overflow warning and, optionally, the lengths table. The
 * project page's static layout and the printout mount it as an island. Until the wires are routed, a
 * hidden `data-wiring-pending` marker is in the DOM, and a status line stands where the lengths go.
 */
export default function WiringDrawing({
  geometry,
  devices,
  wiring,
  slackPercent,
  drawingWrapperClassName,
  drawingClassName,
}: Props): JSX.Element {
  const drawn = useWiringDrawing(wiring, devices);
  const pending = wiring !== null && drawn === null;
  const s = t.layout.section;
  return (
    <>
      <div className={drawingWrapperClassName}>
        <CabinetDrawing
          geometry={geometry}
          devices={devices}
          wires={drawn?.wires ?? []}
          cables={drawn?.cables ?? []}
          className={drawingClassName}
        />
      </div>
      {pending && (
        <p data-wiring-pending="" role="status" className="text-muted-foreground text-xs">
          {s.wiresLoading}
        </p>
      )}
      {drawn?.warnings.map((warning) => (
        <Alert key={warning.code} variant="warning" role="status">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="block">{wiringWarningMessage(warning)}</AlertDescription>
        </Alert>
      ))}
      <LayoutLegend geometry={geometry} devices={devices} wires={drawn?.wires ?? []} cables={drawn?.cables ?? []} />
      {slackPercent !== undefined && drawn !== null && drawn.lengths.length > 0 && (
        <WireLengthsTable lengths={drawn.lengths} slackPercent={slackPercent} />
      )}
    </>
  );
}
