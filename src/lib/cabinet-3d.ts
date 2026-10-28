import type { DrawnDevice, DrawnRole } from "@/lib/cabinet-drawing";
import { barRect, railRect, type CabinetGeometry, type Rect } from "@/lib/cabinet-geometry";
import type { WiringData } from "@/lib/wiring-island";

/**
 * The static part of the 3D preview (GitHub #14): the cabinet, its rails, the placed devices and the
 * built-in PE/N bars as boxes in cabinet millimetres. x grows right and y down, as in
 * `cabinet-geometry.ts`; z is the distance from the back mounting plate (0) toward the viewer. Only the
 * island maps these to three.js.
 *
 * Bundle-safe and renderer-agnostic on purpose: no three.js, nothing that touches Supabase. The island
 * that draws it is display-only, so nothing here may feed a route, a length or the quote.
 */

/** Display assumption, not catalog data: the cabinet's wall and back-plate thickness. */
export const WALL_THICKNESS_MM = 2;

/** Display assumption, not catalog data: from the back plate to the back of a DIN rail. */
export const RAIL_STANDOFF_MM = 20;

/** A TS35×7.5 DIN rail's depth — the standard top-hat profile, not a per-cabinet value. */
export const DIN_RAIL_DEPTH_MM = 7.5;

/** Display assumption, not catalog data: the share of a device's depth, from its back, where its terminals sit. */
export const TERMINAL_DEPTH_RATIO = 0.5;

/** Display assumption, not catalog data: a built-in PE/N bar's depth, measured forward from its `zMm`. */
export const BUILTIN_BAR_DEPTH_MM = 10;

/** The front face of every rail, which is where a device's back sits. */
export const RAIL_FRONT_Z_MM = RAIL_STANDOFF_MM + DIN_RAIL_DEPTH_MM;

/** A box in cabinet millimetres; `(x, y, z)` is its top-left-back corner. */
export interface Box3Mm {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

/** A placed device as the scene needs it: the drawing's front-view rectangle plus its snapshot depth. */
export type Scene3DDevice = Pick<DrawnDevice, "id" | "role" | "railIndex" | "rect"> & { depthMm: number };

/** The island's whole prop payload. No prices or other snapshot columns. */
export interface Cabinet3DData {
  geometry: CabinetGeometry;
  devices: Scene3DDevice[];
  /** The router input of the `placed` layout, or null when there is nothing to wire. */
  wiring: WiringData | null;
}

export interface CabinetScene {
  interior: Box3Mm;
  backPlate: Box3Mm;
  /** Left, right, top, bottom — outside the interior; the front is open. */
  walls: Box3Mm[];
  rails: Box3Mm[];
  /** Catalog PE/N bars are here too, like any placed device. */
  devices: { id: string; role: DrawnRole; box: Box3Mm }[];
  /** The cabinet's built-in bars only. */
  bars: { kind: CabinetGeometry["bars"][number]["kind"]; box: Box3Mm }[];
}

/** The depth of a device's terminals: it sits on the rail's front face. */
export function terminalZ(device: Pick<Scene3DDevice, "depthMm">): number {
  return RAIL_FRONT_Z_MM + device.depthMm * TERMINAL_DEPTH_RATIO;
}

/** The depth of a built-in bar's terminals: halfway through the bar. */
export function builtinBarTerminalZ(bar: Pick<CabinetGeometry["bars"][number], "zMm">): number {
  return bar.zMm + BUILTIN_BAR_DEPTH_MM / 2;
}

/**
 * Joins each drawn device to its snapshot row's `depth_mm`. A drawn device with no row is a
 * programming error — the drawing is built from that same snapshot — so it throws.
 */
export function toScene3DDevices(
  drawn: readonly Pick<DrawnDevice, "id" | "role" | "railIndex" | "rect">[],
  snapshot: readonly { id: string; depth_mm: number }[],
): Scene3DDevice[] {
  const depthById = new Map(snapshot.map((row) => [row.id, row.depth_mm]));
  return drawn.map((device) => {
    const depthMm = depthById.get(device.id);
    if (depthMm === undefined) throw new Error(`no snapshot row for drawn device ${device.id}`);
    return { id: device.id, role: device.role, railIndex: device.railIndex, rect: device.rect, depthMm };
  });
}

function box(rect: Rect, z: number, d: number): Box3Mm {
  return { x: rect.x, y: rect.y, z, w: rect.w, h: rect.h, d };
}

/**
 * The scene's boxes. Deterministic and unclamped: a device deeper than the cabinet is drawn as it is,
 * because nothing validates depth fit and the preview shows the data, not a corrected version of it.
 */
export function buildCabinetScene(data: Cabinet3DData): CabinetScene {
  const { widthMm: w, heightMm: h, depthMm: d } = data.geometry.interior;
  const t = WALL_THICKNESS_MM;
  return {
    interior: { x: 0, y: 0, z: 0, w, h, d },
    backPlate: { x: -t, y: -t, z: -t, w: w + 2 * t, h: h + 2 * t, d: t },
    walls: [
      { x: -t, y: -t, z: 0, w: t, h: h + 2 * t, d },
      { x: w, y: -t, z: 0, w: t, h: h + 2 * t, d },
      { x: 0, y: -t, z: 0, w, h: t, d },
      { x: 0, y: h, z: 0, w, h: t, d },
    ],
    rails: data.geometry.rails.map((rail) => box(railRect(rail), RAIL_STANDOFF_MM, DIN_RAIL_DEPTH_MM)),
    devices: data.devices.map((device) => ({
      id: device.id,
      role: device.role,
      box: box(device.rect, RAIL_FRONT_Z_MM, device.depthMm),
    })),
    bars: data.geometry.bars.map((bar) => ({ kind: bar.kind, box: box(barRect(bar), bar.zMm, BUILTIN_BAR_DEPTH_MM) })),
  };
}
