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
import {
  bendRadiusMm,
  buildCableTies,
  buildDrawnCables,
  BUSBAR_TOOTH_MM,
  FERRULE_EXTRA_MM,
  isWireCrossSection,
  realisticSagLimits,
  runSagMm,
  SAG_CONTROL_FACTOR,
  SHEATH_STUB_MM,
  type DrawnTie,
} from "@/lib/cabinet-drawing";
import type { Rect } from "@/lib/cabinet-geometry";
import { deviceRect, isCatalogBarRole, type Point } from "@/lib/cabinet-layout";
import {
  packBundleWidthMm,
  type Busbar,
  type Conductor,
  type ConductorKind,
  type ConductorRole,
  type Endpoint,
  type PackLayer,
  type Wiring,
} from "@/lib/cabinet-wiring";
import { FERRULE, type FerruleColourToken } from "@/lib/wire-dimensions";

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
 *
 * `realisticWiring` then dresses the lifted wires with the rules of the 2D realistic variant, reusing
 * its helpers and never restating a number: every corner (pure-z steps included) is a bend of
 * `bendRadiusMm`, capped at half of each adjacent run and kept clear of a terminal end's ferrule; only
 * feeds sag (`realisticSagLimits`, the 2D curve), downward in y and never in z, while circuit and WLZ
 * runs stay taut; a ferrule (`FERRULE`) sits on every terminal or bar end and never on an entry end; a
 * cable tie (`buildCableTies`) rings the runs it holds, centred on their depth; a cable's sheath is
 * drawn at its `buildDrawnCables` diameter. Display-only: it never moves a route's ends.
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
  kind: ConductorKind;
  crossSectionMm2: number;
  /** An entry end is a cable's entry through the wall: no ferrule. */
  fromEntry: boolean;
  toEntry: boolean;
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
        kind: conductor.kind,
        crossSectionMm2: conductor.crossSectionMm2,
        fromEntry: conductor.from.type === "entry",
        toEntry: conductor.to.type === "entry",
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

/** Display tessellation (not geometry): segments per bend arc and per sagging run. */
export const BEND_SAMPLES = 6;
export const SAG_SAMPLES = 12;
/**
 * Display assumptions, not catalog data. The ferrule sleeve is `FERRULE_EXTRA_MM` wider than its core,
 * as in the 2D drawing; the insulating collar on the wire side of a real ferrule is a share of the
 * sleeve's length and a little wider again.
 */
export const FERRULE_COLLAR_LENGTH_SHARE = 0.4;
export const FERRULE_COLLAR_EXTRA_MM = 0.5;

export interface Ferrule3D {
  /** The wire's end on the terminal or bar. */
  at: Point3Mm;
  /** Unit vector from `at` into the wire. */
  direction: Point3Mm;
  /**
   * Where the sleeve starts along `direction` from `at`: 0, or negative when the end run is shorter than
   * the ferrule and the rest of it sits inside the terminal (as in 2D).
   */
  offsetMm: number;
  lengthMm: number;
  diameterMm: number;
  colourToken: FerruleColourToken;
  /** The insulating collar: the last `lengthMm` of the sleeve, at its wire side. */
  collar: { lengthMm: number; diameterMm: number };
}

export interface Tie3D {
  key: string;
  /** The tie's centre; its z is centred on the held runs' z range. */
  centre: Point3Mm;
  /** The direction the held runs go: the ring lies across it. */
  axis: "x" | "y";
  /** The strap's width along `axis` (`TIE_BAND_MM`). */
  bandMm: number;
  /** The 2D tie's width across the runs (along x for a y-axis tie, along y for an x-axis one). */
  widthMm: number;
  /** The ring's extent in z: encloses every held run. */
  depthMm: number;
}

export interface RealisticWire {
  key: string;
  role: ConductorRole;
  diameterMm: number;
  /** The lifted route with rounded corners and sagging feeds; first and last point are the lifted ends. */
  smooth: Point3Mm[];
  ferrules: Ferrule3D[];
  sheath: { points: Point3Mm[]; diameterMm: number } | null;
}

export interface RealisticWiring {
  wires: RealisticWire[];
  ties: Tie3D[];
}

const at3 = (p: Point3Mm, q: Point3Mm, distanceMm: number): Point3Mm => {
  const length = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  if (length === 0 || distanceMm === 0) return { x: p.x, y: p.y, z: p.z };
  const share = distanceMm / length;
  return { x: p.x + (q.x - p.x) * share, y: p.y + (q.y - p.y) * share, z: p.z + (q.z - p.z) * share };
};

const length3 = (p: Point3Mm, q: Point3Mm) => Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);

const ferruleOf = (crossSectionMm2: number) => (isWireCrossSection(crossSectionMm2) ? FERRULE[crossSectionMm2] : null);

/**
 * A lifted conductor with rounded corners and sagging feeds (the 3D twin of 2D `wirePathD` in the
 * realistic variant). `sagLimitsMm[k]` caps the sag of the k-th run that moves in the front view — each
 * 2D path segment maps to exactly one such constant-z run, pure-z steps being the only others — as
 * `realisticSagLimits` gives it; a missing entry means no cap. Circuit and WLZ cores never sag. First and
 * last point are the conductor's ends.
 */
export function smoothConductor3D(
  conductor: Conductor3D,
  _variant: "realistic",
  sagLimitsMm: readonly number[] = [],
): Point3Mm[] {
  const points = conductor.points;
  const last = points.length - 1;
  if (last < 1) return points.map((p) => ({ ...p }));
  const bendMm = bendRadiusMm(conductor.diameterMm, "realistic");
  const ferruleMm = ferruleOf(conductor.crossSectionMm2)?.lengthMm ?? 0;
  const straightStart = conductor.fromEntry ? 0 : ferruleMm;
  const straightEnd = conductor.toEntry ? 0 : ferruleMm;

  const radius = points.map((point, i) => {
    if (i === 0 || i === last) return 0;
    const before = length3(points[i - 1], point);
    const after = length3(point, points[i + 1]);
    let r = Math.min(bendMm, before / 2, after / 2);
    if (i === 1) r = Math.min(r, Math.max(0, before - straightStart));
    if (i === last - 1) r = Math.min(r, Math.max(0, after - straightEnd));
    return r;
  });

  const out: Point3Mm[] = [{ ...points[0] }];
  const push = (p: Point3Mm) => {
    const prev = out[out.length - 1];
    if (prev.x === p.x && prev.y === p.y && prev.z === p.z) return;
    out.push(p);
  };
  let runIndex = 0;
  let start = points[0];
  for (let i = 1; i <= last; i++) {
    const corner = points[i];
    const end = at3(corner, points[i - 1], radius[i]);
    const [a, b] = [points[i - 1], corner];
    const moves = a.x !== b.x || a.y !== b.y;
    const limit = moves ? (sagLimitsMm.at(runIndex) ?? Infinity) : 0;
    if (moves) runIndex++;
    const horizontal = a.y === b.y && a.x !== b.x;
    const sag =
      conductor.kind === "feed" && horizontal && Math.abs(end.y - start.y) < 1e-9
        ? runSagMm(Math.abs(end.x - start.x), limit)
        : 0;
    if (sag > 0) {
      const control = { x: (start.x + end.x) / 2, y: start.y + SAG_CONTROL_FACTOR * sag };
      for (let k = 1; k <= SAG_SAMPLES; k++) {
        const t = k / SAG_SAMPLES;
        const [u, v, w] = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
        push({
          x: u * start.x + v * control.x + w * end.x,
          y: u * start.y + v * control.y + w * end.y,
          z: start.z,
        });
      }
      out[out.length - 1] = { ...end };
    } else {
      push({ ...end });
    }
    if (i < last) {
      const next = at3(corner, points[i + 1], radius[i]);
      if (radius[i] > 0) {
        for (let k = 1; k <= BEND_SAMPLES; k++) {
          const t = k / BEND_SAMPLES;
          const [u, v, w] = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
          push({
            x: u * end.x + v * corner.x + w * next.x,
            y: u * end.y + v * corner.y + w * next.y,
            z: u * end.z + v * corner.z + w * next.z,
          });
        }
        out[out.length - 1] = { ...next };
      }
      start = next;
    }
  }
  return out;
}

/** The ferrules of a conductor: one per terminal or bar end, never an entry end. Empty when untabulated. */
function ferrulesOf(conductor: Conductor3D): Ferrule3D[] {
  const ferrule = ferruleOf(conductor.crossSectionMm2);
  const { points } = conductor;
  if (ferrule === null || points.length < 2) return [];
  const make = (end: Point3Mm, next: Point3Mm): Ferrule3D => {
    const runMm = length3(end, next);
    return {
      at: { ...end },
      direction: at3({ x: 0, y: 0, z: 0 }, { x: next.x - end.x, y: next.y - end.y, z: next.z - end.z }, 1),
      offsetMm: Math.min(0, runMm - ferrule.lengthMm),
      lengthMm: ferrule.lengthMm,
      diameterMm: conductor.diameterMm + FERRULE_EXTRA_MM,
      colourToken: ferrule.colourToken,
      collar: {
        lengthMm: ferrule.lengthMm * FERRULE_COLLAR_LENGTH_SHARE,
        diameterMm: conductor.diameterMm + FERRULE_EXTRA_MM + FERRULE_COLLAR_EXTRA_MM,
      },
    };
  };
  return [
    ...(conductor.fromEntry ? [] : [make(points[0], points[1])]),
    ...(conductor.toEntry ? [] : [make(points[points.length - 1], points[points.length - 2])]),
  ];
}

/** The z of each front-view-moving run of a lifted conductor, in order: one per 2D path segment. */
function runDepths(points: readonly Point3Mm[]): number[] {
  const z: number[] = [];
  for (const [i, q] of points.slice(1).entries()) {
    const p = points[i];
    if (p.x !== q.x || p.y !== q.y) z.push(p.z);
  }
  return z;
}

/** The depth range one 2D tie holds: the runs it crosses, as `tieLayout` picks them, with their bodies. */
function tieDepth(tie: DrawnTie, wiring: Wiring, depths: ReadonlyMap<string, number[]>): { lo: number; hi: number } {
  const axisY = tie.key.startsWith("v");
  const { rect } = tie;
  const [centreAlong, acrossLo, acrossHi] = axisY
    ? [rect.y + rect.h / 2, rect.x, rect.x + rect.w]
    : [rect.x + rect.w / 2, rect.y, rect.y + rect.h];
  const all: { lo: number; hi: number; standoff: boolean }[] = [];
  for (const conductor of wiring.conductors) {
    const z = depths.get(conductor.key);
    if (z === undefined) continue;
    const behind = new Set(conductor.tied.filter((t) => t.layer === "overflow").map((t) => t.segment));
    for (let segment = 1; segment + 2 < conductor.path.length; segment++) {
      if (behind.has(segment)) continue;
      const [a, b] = [conductor.path[segment], conductor.path[segment + 1]];
      const [across, p, q] = axisY ? [a.x, a.y, b.y] : [a.y, a.x, b.x];
      if ((axisY ? a.x !== b.x : a.y !== b.y) || p === q) continue;
      if (across < acrossLo - EPS || across > acrossHi + EPS) continue;
      if (!(Math.min(p, q) < centreAlong - EPS && Math.max(p, q) > centreAlong + EPS)) continue;
      const runZ = z[segment];
      const r = conductor.diameterMm / 2;
      all.push({ lo: runZ - r, hi: runZ + r, standoff: runZ === RAIL_STANDOFF_MM / 2 });
    }
  }
  // A run behind the devices has left the bundle in depth; it only counts when nothing else is held.
  const held = all.some((run) => !run.standoff) ? all.filter((run) => !run.standoff) : all;
  if (held.length === 0) throw new Error(`3D cable tie ${tie.key} holds no run`);
  return { lo: Math.min(...held.map((r) => r.lo)), hi: Math.max(...held.map((r) => r.hi)) };
}

/**
 * The realistic 3D wiring: every lifted wire smoothed, with its ferrules and sheath, and the cable ties
 * of the 2D drawing placed on the lifted paths. `wiring` is the router output `lifted` was made from.
 * Deterministic and pure; meant for the island's deferred effect.
 */
export function realisticWiring(wiring: Wiring, lifted: Wiring3D): RealisticWiring {
  const limits = realisticSagLimits(wiring.conductors);
  const limitsByKey = new Map(wiring.conductors.map((c, i) => [c.key, limits[i]]));
  const cableKey = (c: Conductor) => (c.kind === "wlz" ? "wlz" : `c:${c.circuitId ?? c.key}`);
  const cableByConductor = new Map(wiring.conductors.map((c) => [c.key, cableKey(c)]));
  const sheathDiameters = new Map(buildDrawnCables(wiring.conductors).map((cable) => [cable.key, cable.diameterMm]));

  const wires = lifted.conductors.map((conductor): RealisticWire => {
    const sheathDiameter = sheathDiameters.get(cableByConductor.get(conductor.key) ?? "");
    return {
      key: conductor.key,
      role: conductor.role,
      diameterMm: conductor.diameterMm,
      smooth: smoothConductor3D(conductor, "realistic", limitsByKey.get(conductor.key)),
      ferrules: ferrulesOf(conductor),
      sheath:
        conductor.sheath === null || sheathDiameter === undefined
          ? null
          : { points: conductor.sheath.map((p) => ({ ...p })), diameterMm: sheathDiameter },
    };
  });

  const depths = new Map(lifted.conductors.map((c) => [c.key, runDepths(c.points)]));
  const ties = buildCableTies(wiring.conductors).map((tie): Tie3D => {
    const { lo, hi } = tieDepth(tie, wiring, depths);
    const axisY = tie.key.startsWith("v");
    return {
      key: tie.key,
      centre: { x: tie.rect.x + tie.rect.w / 2, y: tie.rect.y + tie.rect.h / 2, z: (lo + hi) / 2 },
      axis: axisY ? "y" : "x",
      bandMm: axisY ? tie.rect.h : tie.rect.w,
      widthMm: axisY ? tie.rect.w : tie.rect.h,
      depthMm: hi - lo,
    };
  });
  return { wires, ties };
}
