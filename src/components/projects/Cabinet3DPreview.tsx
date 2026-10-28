import { Component, lazy, Suspense, useEffect, useMemo, useState, type JSX, type ReactNode } from "react";
import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { buildCabinetScene, type Cabinet3DData, type CabinetScene } from "@/lib/cabinet-3d";
import { routeWiring } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import { liftWiring, realisticWiring } from "@/lib/wiring-3d";
import type { Wiring3DView } from "@/components/projects/Cabinet3DScene";

// The only module that imports three.js; loaded on demand, so a browser without WebGL never fetches it.
const Cabinet3DScene = lazy(() => import("@/components/projects/Cabinet3DScene"));

/** True when the browser can create a WebGL context, tried on a scratch canvas. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null || canvas.getContext("webgl") !== null;
  } catch {
    return false;
  }
}

/** The routed wires lifted into depth. Deferred to an effect, like `useWiringDrawing`, so the first render matches. */
function useWiring3D(data: Cabinet3DData, scene: CabinetScene): Wiring3DView | null {
  const [lifted, setLifted] = useState<{ data: Cabinet3DData; wiring: Wiring3DView } | null>(null);
  useEffect(() => {
    const input = data.wiring;
    if (input === null) return;
    const timer = setTimeout(() => {
      const routed = routeWiring(input);
      const lift = liftWiring(routed, scene, data);
      setLifted({ data, wiring: { busbars: lift.busbars, ...realisticWiring(routed, lift) } });
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [data, scene]);
  return lifted !== null && lifted.data === data ? lifted.wiring : null;
}

interface UnavailableProps {
  /** The realistic 2D view of the same section. */
  fallbackHref: string;
}

/** Why there is no 3D view: no WebGL, or the canvas failed to start. Polish, with a link back to 2D. */
export function Cabinet3DUnavailable({ fallbackHref }: UnavailableProps): JSX.Element {
  const p = t.layout.section.preview3d;
  return (
    <Alert variant="destructive" role="status">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{p.unavailableTitle}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{p.unavailableBody}</span>
        <a href={fallbackHref} className="font-semibold underline underline-offset-4">
          {p.backTo2d}
        </a>
      </AlertDescription>
    </Alert>
  );
}

/** Turns a canvas or WebGL-context error into the unavailable state instead of a blank section. */
class SceneErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface Props {
  data: Cabinet3DData;
  /** The realistic view's link, offered when there is no 3D. */
  fallbackHref: string;
}

/**
 * The 3D view of a placed layout (GitHub #14): routed and lifted in the browser, drawn by the lazily
 * loaded `Cabinet3DScene`. Display-only — it never feeds a route, a length or the quote. Mounted
 * `client:only`, and only on `?wiring=3d`, so three.js never reaches the other views.
 */
export default function Cabinet3DPreview({ data, fallbackHref }: Props): JSX.Element {
  const [webgl] = useState(hasWebGL);
  const scene = useMemo(() => buildCabinetScene(data), [data]);
  const wiring = useWiring3D(data, scene);
  const p = t.layout.section.preview3d;
  const unavailable = <Cabinet3DUnavailable fallbackHref={fallbackHref} />;
  if (!webgl) return unavailable;
  const loading = (
    <p role="status" className="text-muted-foreground text-xs">
      {p.loading}
    </p>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="bg-drawing-paper mx-auto aspect-[4/3] w-full max-w-3xl overflow-hidden rounded-md border">
        <SceneErrorBoundary fallback={unavailable}>
          <Suspense fallback={loading}>
            <Cabinet3DScene scene={scene} devices={data.devices} wiring={wiring} />
          </Suspense>
        </SceneErrorBoundary>
      </div>
      {data.wiring !== null && wiring === null && (
        <p role="status" className="text-muted-foreground text-xs">
          {t.layout.section.wiresLoading}
        </p>
      )}
      <p className="text-muted-foreground text-center text-xs">{p.controlsHint}</p>
    </div>
  );
}
