import {
  builtinBarTerminalZ,
  RAIL_FRONT_Z_MM,
  RAIL_STANDOFF_MM,
  TERMINAL_DEPTH_RATIO,
  terminalZ,
  WALL_THICKNESS_MM,
  type Box3Mm,
  type Cabinet3DData,
  type CabinetScene,
  type Scene3DDevice,
} from "@/lib/cabinet-3d";
import { BUSBAR_TOOTH_MM, SHEATH_STUB_MM } from "@/lib/cabinet-drawing";
import type { Rect } from "@/lib/cabinet-geometry";
import { deviceRect, isCatalogBarRole, type Point } from "@/lib/cabinet-layout";
import {
  packBundleWidthMm,
  type Busbar,
  type Conductor,
  type ConductorRole,
  type Endpoint,
  type PackLayer,
  type Wiring,
} from "@/lib/cabinet-wiring";

/**
 * The wires and comb busbars of the 3D preview (GitHub #14): the router's 2D routes lifted into depth
 * by fixed rules, in the cabinet millimetres of `cabinet-3d.ts` (z from the back plate toward the
 * viewer). A pure lift after routing: every depth change is a pure-z step at a corner or an end, so
 * the front view of a lifted wire is exactly its 2D `path`. It never changes a route, and the 3D path
 * being longer than `routedMm` / `lengthMm` is accepted — lengths, the quote and the printout read the
 * router, never this. Display-only, bundle-safe and three-free, like `cabinet-3d.ts`.
 *
 * Depth of a `path` segment, first rule that applies:
 * 1. **an end stub** touching a device or bar terminal stays at that terminal's z (`terminalZ`,
 *    `builtinBarTerminalZ`; a catalog bar is a device);
 * 2. **behind the devices** — a segment whose front view crosses a device body other than its own
 *    ends' devices (the router may spread a crowded vertical run there) runs at `RAIL_STANDOFF_MM / 2`,
 *    between the plate and the rail;
 * 3. **a tied bundle** (a side pack or a crowded channel) — layer `bundle` at channel z, layer
 *    `overflow` one bundle width further back, never closer than `WALL_THICKNESS_MM` to the plate; the
 *    members of one bundle layer are spread across its width in z, ordered by conductor key;
 * 4. **the channel** — anything else, at channel z: the rail's front plus the shallowest terminal
 *    offset of the placed devices, so no channel wire stands proud of the nearest terminal.
 * An entry end sits at channel z: the cable comes through the wall at wiring depth.
 */

/** Display assumption, not catalog data: a comb busbar strip's depth, centred on its group's terminals. */
export const BUSBAR_DEPTH_MM = 6;

/** A point in cabinet millimetres. */
export interface Point3Mm {
  x: number;
  y: number;
  z: number;
}

export interface Conductor3D {
  key: string;
  role: ConductorRole;
  diameterMm: number;
  /** From `from` to `to`; dropping z and merging collinear points gives back `Conductor.path`. */
  points: Point3Mm[];
  /**
   * A circuit or WLZ core's sheathed start: the first `SHEATH_STUB_MM` of `points` from its entry,
   * never past its entry stub, drawn as a thicker tube. Null for a feed.
   */
  sheath: Point3Mm[] | null;
}

export interface Busbar3D {
  key: string;
  phases: 1 | 3;
  body: Box3Mm;
  /** One per `Busbar.teeth`, from the body's device-facing edge to the tooth's terminal. */
  teeth: Box3Mm[];
}

export interface Wiring3D {
  conductors: Conductor3D[];
  busbars: Busbar3D[];
}

const EPS = 1e-6;

/** The z a path end sits at, and the device whose body it may lie in (never "behind" for its own wire). */
interface EndDepth {
  z: number;
  deviceId: string | null;
  /** A terminal or bar end: its stub segment keeps this z. An entry's does not. */
  pinsStub: boolean;
}

/**
 * Lifts every routed conductor and every busbar into 3D. `wiring` is `routeWiring(data.wiring)`; a
 * conductor without a route (an empty path) gives none. Deterministic. Throws on an endpoint the data
 * cannot place — the wiring was routed from this same data, so that is a programming error.
 */
export function liftWiring(wiring: Wiring, scene: CabinetScene, data: Cabinet3DData): Wiring3D {
  const devices = new Map(data.devices.map((device) => [device.id, device]));
  const channelZ = channelDepthMm(data.devices);
  const barDepths = barTerminalDepths(data, devices);
  const layers = bundleLayers(wiring.conductors, channelZ);
  const bodies = scene.devices.map((device) => ({
    id: device.id,
    rect: { x: device.box.x, y: device.box.y, w: device.box.w, h: device.box.h },
  }));

  const endDepth = (endpoint: Endpoint): EndDepth => {
    if (endpoint.type === "entry") return { z: channelZ, deviceId: null, pinsStub: false };
    if (endpoint.type === "terminal") {
      return {
        z: terminalZ(found(devices.get(endpoint.deviceId), endpoint)),
        deviceId: endpoint.deviceId,
        pinsStub: true,
      };
    }
    const bar = found(barDepths[endpoint.barIndex], endpoint);
    return { z: bar.z, deviceId: bar.deviceId, pinsStub: true };
  };

  const conductors = wiring.conductors.flatMap((conductor): Conductor3D[] => {
    if (conductor.path.length < 2) return [];
    const from = endDepth(conductor.from);
    const to = endDepth(conductor.to);
    const own = new Set([from.deviceId, to.deviceId]);
    const last = conductor.path.length - 2;
    const tiedBySegment = new Map(conductor.tied.map((tie) => [tie.segment, tie]));
    const segmentZ = conductor.path.slice(1).map((b, i) => {
      if (i === 0 && from.pinsStub) return from.z;
      if (i === last && to.pinsStub) return to.z;
      const a = conductor.path[i];
      if (bodies.some((body) => !own.has(body.id) && crossesBody(a, b, body.rect))) return RAIL_STANDOFF_MM / 2;
      const tie = tiedBySegment.get(i);
      if (tie !== undefined)
        return found(layers.get(layerKey(tie.bundle, tie.layer)), tie).zByKey.get(conductor.key) ?? channelZ;
      return channelZ;
    });
    const points = liftPath(conductor.path, segmentZ, from.z, to.z);
    const cable = conductor.kind !== "feed" && conductor.from.type === "entry";
    return [
      {
        key: conductor.key,
        role: conductor.role,
        diameterMm: conductor.diameterMm,
        points,
        sheath: cable ? sheathOf(conductor, points) : null,
      },
    ];
  });

  return { conductors, busbars: wiring.busbars.map((busbar) => liftBusbar(busbar, devices)) };
}

function found<T>(value: T | undefined, what: unknown): T {
  if (value === undefined) throw new Error(`3D lift cannot place ${JSON.stringify(what)}`);
  return value;
}

/** The rail's front plus the shallowest terminal offset among the placed devices. */
function channelDepthMm(devices: readonly Scene3DDevice[]): number {
  if (devices.length === 0) return RAIL_FRONT_Z_MM;
  return RAIL_FRONT_Z_MM + Math.min(...devices.map((device) => device.depthMm)) * TERMINAL_DEPTH_RATIO;
}

/**
 * Each bar's terminal z, indexed like `Endpoint.barIndex`: the built-in bars, then the placed catalog
 * bars in placement order — the order `routeWiring` builds its bar targets in.
 */
function barTerminalDepths(
  data: Cabinet3DData,
  devices: ReadonlyMap<string, Scene3DDevice>,
): { z: number; deviceId: string | null }[] {
  const builtin = data.geometry.bars.map((bar) => ({ z: builtinBarTerminalZ(bar), deviceId: null }));
  const wiring = data.wiring;
  if (wiring === null) return builtin;
  const byId = new Map(wiring.devices.map((device) => [device.id, device]));
  const seen = new Set<string>();
  const catalog: { z: number; deviceId: string }[] = [];
  for (const placement of wiring.placements) {
    const device = byId.get(placement.projectDeviceId);
    if (!device || seen.has(device.id) || deviceRect(placement, device, wiring.geometry) === null) continue;
    seen.add(device.id);
    if (!isCatalogBarRole(device.role)) continue;
    catalog.push({ z: terminalZ(found(devices.get(device.id), device.id)), deviceId: device.id });
  }
  return [...builtin, ...catalog];
}

function layerKey(bundle: number, layer: PackLayer): string {
  return `${String(bundle)}:${layer}`;
}

/**
 * The z of every member of every tied bundle layer: `bundle` centred at channel z, `overflow` one
 * bundle width behind it (its own width when the bundle layer is empty), kept `WALL_THICKNESS_MM` off
 * the plate. Members are spread evenly across the layer's width, ordered by conductor key.
 */
function bundleLayers(
  conductors: readonly Conductor[],
  channelZ: number,
): Map<string, { widthMm: number; zByKey: Map<string, number> }> {
  const members = new Map<string, Map<string, number>>();
  for (const conductor of conductors) {
    if (conductor.path.length < 2) continue;
    for (const tie of conductor.tied) {
      const key = layerKey(tie.bundle, tie.layer);
      const layer = members.get(key) ?? new Map<string, number>();
      layer.set(conductor.key, conductor.diameterMm);
      members.set(key, layer);
    }
  }
  const widthOf = (key: string): number | null => {
    const layer = members.get(key);
    return layer === undefined ? null : packBundleWidthMm([...layer.values()]);
  };
  const result = new Map<string, { widthMm: number; zByKey: Map<string, number> }>();
  for (const [key, layer] of members) {
    const widthMm = widthOf(key) ?? 0;
    const [bundle, kind] = key.split(":");
    let centre = channelZ;
    if (kind === "overflow") {
      const bundleWidth = widthOf(layerKey(Number(bundle), "bundle")) ?? widthMm;
      centre = Math.max(channelZ - bundleWidth, WALL_THICKNESS_MM + widthMm / 2);
    }
    const keys = [...layer.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const zByKey = new Map(keys.map((k, i) => [k, centre - widthMm / 2 + (widthMm * (i + 0.5)) / keys.length]));
    result.set(key, { widthMm, zByKey });
  }
  return result;
}

/** Strictly crosses the body's interior; running along an edge or ending on it does not count. */
function crossesBody(a: Point, b: Point, rect: Rect): boolean {
  const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return x1 > rect.x + EPS && x0 < rect.x + rect.w - EPS && y1 > rect.y + EPS && y0 < rect.y + rect.h - EPS;
}

/** The path with each segment at its z, every change of z a pure-z step at the shared point. */
function liftPath(path: readonly Point[], segmentZ: readonly number[], fromZ: number, toZ: number): Point3Mm[] {
  const points: Point3Mm[] = [];
  const push = (p: Point, z: number) => {
    const prev = points.at(-1);
    if (prev?.x === p.x && prev.y === p.y && Math.abs(prev.z - z) < EPS) return;
    points.push({ x: p.x, y: p.y, z });
  };
  push(path[0], fromZ);
  segmentZ.forEach((z, i) => {
    push(path[i], z);
    push(path[i + 1], z);
  });
  push(path[path.length - 1], toZ);
  return points;
}

/** The first `SHEATH_STUB_MM` of `points`, measured in 3D but never past the 2D entry stub. */
function sheathOf(conductor: Conductor, points: readonly Point3Mm[]): Point3Mm[] | null {
  const [a, b] = conductor.path;
  const stubMm = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  let remaining = Math.min(SHEATH_STUB_MM, stubMm);
  if (remaining <= EPS) return null;
  const sheath: Point3Mm[] = [points[0]];
  for (let i = 1; i < points.length && remaining > EPS; i++) {
    const [p, q] = [points[i - 1], points[i]];
    const length = Math.abs(q.x - p.x) + Math.abs(q.y - p.y) + Math.abs(q.z - p.z);
    if (length <= remaining) {
      sheath.push(q);
      remaining -= length;
      continue;
    }
    const share = remaining / length;
    sheath.push({ x: p.x + (q.x - p.x) * share, y: p.y + (q.y - p.y) * share, z: p.z + (q.z - p.z) * share });
    remaining = 0;
  }
  return sheath;
}

/**
 * The strip at `Busbar.rect`, centred in z on its group's terminals — the shallowest terminal z among
 * the devices its teeth reach, so the strip never sits behind a terminal it feeds — with a tooth from
 * the edge facing the devices to each tooth's terminal point.
 */
function liftBusbar(busbar: Busbar, devices: ReadonlyMap<string, Scene3DDevice>): Busbar3D {
  const groupZ = Math.min(...busbar.teeth.map((tooth) => terminalZ(found(devices.get(tooth.deviceId), tooth))));
  const z = groupZ - BUSBAR_DEPTH_MM / 2;
  const { rect } = busbar;
  const edgeY = busbar.edge === "top" ? rect.y + rect.h : rect.y;
  return {
    key: busbar.key,
    phases: busbar.phases,
    body: { x: rect.x, y: rect.y, z, w: rect.w, h: rect.h, d: BUSBAR_DEPTH_MM },
    teeth: busbar.teeth.map((tooth) => ({
      x: tooth.x - BUSBAR_TOOTH_MM / 2,
      y: Math.min(edgeY, tooth.y),
      z,
      w: BUSBAR_TOOTH_MM,
      h: Math.abs(tooth.y - edgeY),
      d: BUSBAR_DEPTH_MM,
    })),
  };
}
