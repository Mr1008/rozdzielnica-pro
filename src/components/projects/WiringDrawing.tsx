import { useEffect, useState, type JSX } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { CabinetDrawing } from "@/components/cabinets/CabinetDrawing";
import { IslandErrorBoundary } from "@/components/IslandErrorBoundary";
import { WiringFailed } from "@/components/projects/WiringFailed";
import { LayoutLegend } from "@/components/projects/LayoutLegend";
import { WireLengthsTable } from "@/components/projects/WireLengthsTable";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DrawnDevice, WiringVariant } from "@/lib/cabinet-drawing";
import { reportClientError } from "@/lib/client-error-reporter";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import { wiringWarningMessage } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import { buildWiringDrawing, type WiringData, type WiringDrawing as Wiring } from "@/lib/wiring-island";

/** Fired on `window` once an island has drawn its wires; the print page waits for it. */
export const WIRING_READY_EVENT = "wiring-ready";
/** Fired on `window` when routing threw; the print page then explains why it cannot print. */
export const WIRING_FAILED_EVENT = "wiring-failed";

export interface WiringDrawingState {
  drawn: Wiring | null;
  /** Routing threw; `drawn` stays null and the failure is already reported. */
  failed: boolean;
}

/**
 * The placed layout's wires, routed in the browser (S-11 Phase 5). Starts as null on the server and on
 * the first client render, so hydration matches, then routes after mount. A timeout lets the page
 * paint the devices first. Null data stays null. `variant` must match the drawing's `wiring` prop.
 * A throw inside the router is caught: it becomes `failed`, is reported as `client.wiring` with the
 * `projectId`, and fires `WIRING_FAILED_EVENT` instead of leaving the page waiting for wires.
 */
export function useWiringDrawing(
  wiring: WiringData | null,
  devices: readonly DrawnDevice[],
  variant: WiringVariant = "realistic",
  projectId?: string,
): WiringDrawingState {
  // Kept with the inputs it was routed from, so new inputs read as "not drawn yet" without a reset.
  const [routed, setRouted] = useState<{
    wiring: WiringData;
    devices: readonly DrawnDevice[];
    variant: WiringVariant;
    drawn: Wiring | null;
  } | null>(null);
  useEffect(() => {
    if (wiring === null) return;
    const timer = setTimeout(() => {
      let drawn: Wiring | null = null;
      try {
        drawn = buildWiringDrawing(wiring, devices, variant);
      } catch (error) {
        reportClientError("wiring", error, { projectId });
      }
      setRouted({ wiring, devices, variant, drawn });
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [wiring, devices, variant, projectId]);
  const current =
    routed !== null && routed.wiring === wiring && routed.devices === devices && routed.variant === variant
      ? routed
      : null;
  const drawn = current?.drawn ?? null;
  const failed = current !== null && current.drawn === null;
  useEffect(() => {
    if (drawn !== null) window.dispatchEvent(new Event(WIRING_READY_EVENT));
  }, [drawn]);
  useEffect(() => {
    if (failed) window.dispatchEvent(new Event(WIRING_FAILED_EVENT));
  }, [failed]);
  return { drawn, failed };
}

interface Props {
  geometry: CabinetGeometry;
  /** The placed devices, from `buildDrawnDevices` on the server. */
  devices: DrawnDevice[];
  /** The router's input; null draws the devices alone. */
  wiring: WiringData | null;
  /** Show the lengths table, with this slack share in percent. Omitted: no table (the printout). */
  slackPercent?: number;
  /** The look of the wires; the printout keeps the schematic one (S-09). */
  variant?: WiringVariant;
  /** Classes of the drawing's wrapper. */
  drawingWrapperClassName?: string;
  /** Classes of the drawing's `<svg>`. */
  drawingClassName?: string;
  /** Sent with a routing failure report. */
  projectId?: string;
}

/**
 * The cabinet drawing with its wires, legend, overflow warning and, optionally, the lengths table. The
 * project page's static layout and the printout mount it as an island. Until the wires are routed, a
 * hidden `data-wiring-pending` marker is in the DOM, and a status line stands where the lengths go.
 * If routing fails, the marker is replaced by a `data-wiring-failed` alert.
 */
function WiringDrawingBody({
  geometry,
  devices,
  wiring,
  slackPercent,
  variant = "realistic",
  drawingWrapperClassName,
  drawingClassName,
  projectId,
}: Props): JSX.Element {
  const { drawn, failed } = useWiringDrawing(wiring, devices, variant, projectId);
  const pending = wiring !== null && drawn === null && !failed;
  const s = t.layout.section;
  return (
    <>
      <div className={drawingWrapperClassName}>
        <CabinetDrawing
          geometry={geometry}
          devices={devices}
          wires={drawn?.wires ?? []}
          cables={drawn?.cables ?? []}
          ties={drawn?.ties ?? []}
          busbars={drawn?.busbars ?? []}
          wiring={variant}
          className={drawingClassName}
        />
      </div>
      {failed && <WiringFailed />}
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
      <LayoutLegend
        geometry={geometry}
        devices={devices}
        wires={drawn?.wires ?? []}
        cables={drawn?.cables ?? []}
        ties={drawn?.ties ?? []}
        busbars={drawn?.busbars ?? []}
        wiring={variant}
      />
      {slackPercent !== undefined && drawn !== null && drawn.lengths.length > 0 && (
        <WireLengthsTable lengths={drawn.lengths} slackPercent={slackPercent} />
      )}
    </>
  );
}

export default function WiringDrawing(props: Props): JSX.Element {
  return (
    <IslandErrorBoundary component="WiringDrawing">
      <WiringDrawingBody {...props} />
    </IslandErrorBoundary>
  );
}
