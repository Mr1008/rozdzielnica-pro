import { barRect, RAIL_HEIGHT_MM, type CabinetGeometry, type Rect } from "@/lib/cabinet-geometry";
import {
  catalogBarAsCabinetBar,
  deviceRect,
  isCatalogBarRole,
  deviceTerminals,
  terminalGroupPoints,
  type DeviceTerminals,
  type LayoutDevice,
  type Placement,
  type Point,
  type Terminal,
  type TerminalPole,
} from "@/lib/cabinet-layout";
import type { CircuitInput } from "@/lib/circuit-params";
import type { SupplyParams } from "@/lib/supply-params";

/**
 * The wiring of a placed layout (S-05, plan Phase 5): which conductors run where, their orthogonal
 * routes and their lengths. Pure and deterministic, display-only — it decides nothing about devices
 * or placements, and runs only over a layout that already passed `validateLayout`.
 *
 * Conductors:
 * - **circuit cables in** — per circuit, from its cable entry: each phase (L, or L1–L3 for a
 *   three-phase circuit) to its MCB / RCBO load-side terminal; its N and its PE as below;
 * - **WLZ** — from `entries[0]` to the main switch's line-side terminals, its PE (PEN in TN-C and
 *   TN-C-S) to the PE bar;
 * - **feeds** — the main switch's load side to each RCD, RCBO and ungrouped MCB line side, and each
 *   RCD's load side to its MCBs.
 *
 * N routing (domain rule): a circuit in an RCD group takes N from that RCD's outgoing N terminal —
 * never from the shared N bar, which would bypass the RCD and trip it. A circuit whose own device
 * carries N (an RCBO, a 1P+N MCB) takes N from that device. An ungrouped circuit without an N pole
 * takes N from the N bar. The main switch's load-side N feeds the N bar, and the N bar feeds the
 * line-side N of every device the main switch feeds; an RCD feeds the line-side N of its own
 * N-carrying MCBs. TN-C has no N conductor at all: every PEN goes to the PE bar. TN-C-S splits the PEN
 * in the switchboard (user decision 2026-10-06, matching `supply-warnings`): the WLZ's PEN lands on the
 * PE bar, and a split link runs from the PE bar to the main switch's line-side N (or, for a main
 * switch without an N pole, to the N bar); from there N is wired as in TN-S. Without a PE bar there is
 * no split point, so the WLZ is drawn as separate PE and N.
 *
 * Routes: from each end a short stub leaves the terminal (vertically, into the free channel above or
 * below the rail), the entry (into a lane along the cabinet edge) or the bar terminal group (into a
 * lane beside the bar); the two stubs are joined orthogonally through the nearest vertical passage
 * that crosses no device body — a gap between blocks, a block end or the gutter beside the rails.
 *
 * Bars: the cabinet's built-in PE/N bars and the catalog bars the match placed on a rail (plan Phase
 * 5b) are the same kind of target — `nearestBar` sees both, so N/PE routing, the TN-C-S split and the
 * lengths need no special case. A project with no bar of a kind (a catalog gap) has no conductors to
 * it (the `bars_missing` / `bar_terminals_insufficient` circuit warnings explain it).
 *
 * Tracks: the router sends many conductors through the same lane and passage, so a last step
 * (`nudgeTracks`) gives each its own track — parallel segments whose extents overlap end up at least
 * `WIRE_TRACK_PITCH_MM` apart, ordered so they leave the channel without crossing. Horizontal runs
 * stay in their free channel; a crowded vertical passage may spread behind the devices beside it —
 * wires may run under the DIN rail, behind the devices (the electrician, 2026-10-06) — and the drawing
 * paints wires over the devices, so such a run stays traceable. The segments that touch an endpoint
 * never move: conductors sharing a terminal, an entry or a bar terminal group share its final stub.
 * Lengths are measured on the nudged path. The router itself still prefers passages clear of devices.
 */

/**
 * The installation reserve on every conductor: 30 % (user decision 2026-10-06 — raised from the
 * electrician's first 15 % the same day), applied as `length = routed × (1 + WIRE_SLACK_RATIO)`, with
 * no minimum.
 */
export const WIRE_SLACK_RATIO = 0.3;

/** The wire's length with the reserve included. */
export function withSlack(routedMm: number): number {
  return routedMm * (1 + WIRE_SLACK_RATIO);
}

/**
 * `terminal_groups` matters only for a catalog PE/N bar (role `pe_bar` / `n_bar`, plan Phase 5b): a
 * placed one is a bar target like a built-in bar. Without it such a bar has no terminals to land on.
 */
export type WiringDevice = Pick<
  LayoutDevice,
  "id" | "role" | "rcd_group_id" | "circuit_id" | "width_mm" | "height_mm" | "poles" | "n_terminal_side"
> & { terminal_groups?: unknown };
export type WiringCircuit = Pick<
  CircuitInput,
  "id" | "rcd_group_id" | "phase_count" | "cross_section_mm2" | "entry_side"
>;
export type WiringSupply = Pick<SupplyParams, "earthing_system" | "wlz_cross_section_mm2">;

export interface WiringInput {
  geometry: CabinetGeometry;
  devices: readonly WiringDevice[];
  /** A layout that passed `validateLayout`. A device without a placement has no wires. */
  placements: readonly Placement[];
  /** Ordered by position. */
  circuits: readonly WiringCircuit[];
  supply: WiringSupply;
}

export type ConductorKind = "circuit" | "wlz" | "feed";
export type ConductorRole = "L" | "L1" | "L2" | "L3" | "N" | "PE" | "PEN";
/** The lengths table's grouping: every phase is one class. */
export type WireClass = "L" | "N" | "PE" | "PEN";

export const WIRE_CLASSES = ["L", "N", "PE", "PEN"] as const satisfies readonly WireClass[];
export const CONDUCTOR_KINDS = ["circuit", "wlz", "feed"] as const satisfies readonly ConductorKind[];

export type Endpoint =
  | { type: "entry"; entryIndex: number }
  | { type: "terminal"; deviceId: string; side: "line" | "load"; pole: TerminalPole }
  /**
   * `barIndex` counts the cabinet's built-in bars (`geometry.bars`), then the placed catalog bars in
   * placement order.
   */
  | { type: "bar"; kind: "PE" | "N"; barIndex: number; groupIndex: number };

export interface Conductor {
  /** Unique within one wiring, stable for the same input. */
  key: string;
  kind: ConductorKind;
  role: ConductorRole;
  /** The circuit a circuit cable belongs to; null for the WLZ and the feeds. */
  circuitId: string | null;
  crossSectionMm2: number;
  from: Endpoint;
  to: Endpoint;
  /** Orthogonal polyline from `from` to `to`, in millimetres, without repeated or collinear points. */
  path: Point[];
  routedMm: number;
  /** `routedMm` with `WIRE_SLACK_RATIO` added. */
  lengthMm: number;
}

export function wireClass(role: ConductorRole): WireClass {
  return role === "N" || role === "PE" || role === "PEN" ? role : "L";
}

// ---------------------------------------------------------------------------------------------
// Routing constants
// ---------------------------------------------------------------------------------------------

/** The first terminal channel's distance from the device edge; each conductor role takes its own lane. */
const CHANNEL_BASE_MM = 6;
const CHANNEL_STEP_MM = 2;
const CHANNEL_LANE: Record<ConductorRole, number> = { L: 0, L1: 0, L2: 1, L3: 2, N: 3, PE: 4, PEN: 4 };
/** The gutter beside the rails, measured from the outermost rail end. */
const GUTTER_MM = 10;
/** A bar's approach lane, measured from the bar's edge. */
const BAR_LANE_MM = 6;
/** How far beside a device body a vertical run passes. */
const CLEARANCE_MM = 3;
const EPS = 1e-6;

type Axis = "h" | "v";

/** One end of a conductor: the point it lands on, and the stub where its free run begins. */
interface Stub {
  point: Point;
  stub: Point;
  /** The direction the run travels from the stub: along a horizontal or a vertical lane. */
  axis: Axis;
}

/** An alternating orthogonal route; see `Router.route`. */
interface RawRoute {
  points: Point[];
  firstVertical: boolean;
}

interface Located {
  device: WiringDevice;
  rect: Rect;
  terminals: DeviceTerminals;
}

interface Band {
  top: number;
  bottom: number;
  /** Merged occupied x intervals, sorted. */
  spans: { start: number; end: number }[];
}

interface BarTarget {
  kind: "PE" | "N";
  barIndex: number;
  groupIndex: number;
  point: Point;
  rect: Rect;
  orientation: "horizontal" | "vertical";
}

function pathLength(path: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
  }
  return total;
}

/** Drops repeated points and the middle of three collinear ones. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - point.x) < EPS && Math.abs(last.y - point.y) < EPS) continue;
    const before = out.at(-2);
    if (before && last) {
      const vertical = Math.abs(before.x - last.x) < EPS && Math.abs(last.x - point.x) < EPS;
      const horizontal = Math.abs(before.y - last.y) < EPS && Math.abs(last.y - point.y) < EPS;
      if (vertical || horizontal) out.pop();
    }
    out.push(point);
  }
  return out;
}

class Router {
  readonly bands: Band[];
  readonly gutterLeft: number;
  readonly gutterRight: number;
  readonly topLane: number;
  readonly bottomLane: number;
  readonly railsCentre: Point;
  readonly barRects: Rect[];

  /**
   * A placed catalog bar is an obstacle like a built-in bar, not part of its row's device band: it is
   * much lower than the devices beside it, so its conductors leave it straight up or down through the
   * free column over it, as they leave a built-in bar.
   */
  constructor(
    readonly geometry: CabinetGeometry,
    allLocated: readonly Located[],
  ) {
    const { interior, rails, bars } = geometry;
    const clampX = (x: number) => Math.min(Math.max(x, 2), interior.widthMm - 2);
    this.gutterLeft = clampX(Math.min(...rails.map((rail) => rail.xMm)) - GUTTER_MM);
    this.gutterRight = clampX(Math.max(...rails.map((rail) => rail.xMm + rail.lengthMm)) + GUTTER_MM);

    const located = allLocated.filter((item) => !isCatalogBarRole(item.device.role));
    const catalogBarRects = allLocated.filter((item) => isCatalogBarRole(item.device.role)).map((item) => item.rect);
    this.barRects = [...bars.map(barRect), ...catalogBarRects];
    const obstacles = [...located.map((item) => item.rect), ...this.barRects];
    const top = Math.min(interior.heightMm, ...obstacles.map((rect) => rect.y));
    const bottom = Math.max(0, ...obstacles.map((rect) => rect.y + rect.h));
    this.topLane = top / 2;
    this.bottomLane = (interior.heightMm + bottom) / 2;

    const xs = rails.map((rail) => rail.xMm + rail.lengthMm / 2);
    const ys = rails.map((rail) => rail.yMm + RAIL_HEIGHT_MM / 2);
    this.railsCentre = {
      x: xs.reduce((sum, x) => sum + x, 0) / xs.length,
      y: ys.reduce((sum, y) => sum + y, 0) / ys.length,
    };

    // One band per row of devices: devices on the same rail share it.
    const byRail = new Map<number, Rect[]>();
    for (const item of located) {
      const key = item.rect.y + item.rect.h / 2;
      const list = byRail.get(key) ?? [];
      list.push(item.rect);
      byRail.set(key, list);
    }
    this.bands = [...byRail.values()].map((rects) => {
      const sorted = [...rects].sort((a, b) => a.x - b.x);
      const spans: Band["spans"] = [];
      for (const rect of sorted) {
        const last = spans.at(-1);
        if (last && rect.x <= last.end + EPS) last.end = Math.max(last.end, rect.x + rect.w);
        else spans.push({ start: rect.x, end: rect.x + rect.w });
      }
      return {
        top: Math.min(...rects.map((rect) => rect.y)),
        bottom: Math.max(...rects.map((rect) => rect.y + rect.h)),
        spans,
      };
    });
  }

  /** A vertical run at `x` between `y1` and `y2` passes through no device body. */
  verticalClear(x: number, y1: number, y2: number): boolean {
    const low = Math.min(y1, y2);
    const high = Math.max(y1, y2);
    return this.bands.every(
      (band) =>
        band.top >= high - EPS ||
        band.bottom <= low + EPS ||
        band.spans.every((span) => x <= span.start + EPS || x >= span.end - EPS),
    );
  }

  /** A horizontal run at `y` between `x1` and `x2` passes through no device body. */
  horizontalClear(y: number, x1: number, x2: number): boolean {
    const low = Math.min(x1, x2);
    const high = Math.max(x1, x2);
    return this.bands.every(
      (band) =>
        y <= band.top + EPS ||
        y >= band.bottom - EPS ||
        band.spans.every((span) => span.end <= low + EPS || span.start >= high - EPS),
    );
  }

  terminalStub(terminal: Terminal, side: "line" | "load", role: ConductorRole): Stub {
    const offset = CHANNEL_BASE_MM + CHANNEL_STEP_MM * CHANNEL_LANE[role];
    return {
      point: { x: terminal.x, y: terminal.y },
      stub: { x: terminal.x, y: side === "line" ? terminal.y - offset : terminal.y + offset },
      axis: "h",
    };
  }

  /** The entry's midpoint on the cabinet edge. */
  entryStub(entryIndex: number): Stub {
    const { interior, entries } = this.geometry;
    const entry = entries[entryIndex];
    const mid = entry.offsetMm + entry.lengthMm / 2;
    switch (entry.side) {
      case "top":
        return { point: { x: mid, y: 0 }, stub: { x: mid, y: this.topLane }, axis: "h" };
      case "bottom":
        return { point: { x: mid, y: interior.heightMm }, stub: { x: mid, y: this.bottomLane }, axis: "h" };
      case "left":
        return { point: { x: 0, y: mid }, stub: { x: this.gutterLeft, y: mid }, axis: "v" };
      case "right":
        return { point: { x: interior.widthMm, y: mid }, stub: { x: this.gutterRight, y: mid }, axis: "v" };
    }
  }

  /** A bar is approached from the side facing the rails. */
  barStub(target: BarTarget): Stub {
    const { point, rect } = target;
    if (target.orientation === "horizontal") {
      const fromAbove = rect.y + rect.h / 2 >= this.railsCentre.y;
      return {
        point,
        stub: { x: point.x, y: fromAbove ? rect.y - BAR_LANE_MM : rect.y + rect.h + BAR_LANE_MM },
        axis: "h",
      };
    }
    const fromLeft = rect.x + rect.w / 2 >= this.railsCentre.x;
    return {
      point,
      stub: { x: fromLeft ? rect.x - BAR_LANE_MM : rect.x + rect.w + BAR_LANE_MM, y: point.y },
      axis: "v",
    };
  }

  /**
   * Two horizontal lanes joined by one vertical run: the clear `x` with the shortest detour, among the
   * two ends, the passages beside every device row the run crosses, and the two gutters. Nothing clear
   * (an unusually tight cabinet) falls back to the cheaper gutter.
   */
  joinHorizontalLanes(a: Point, b: Point): Point[] {
    const low = Math.min(a.y, b.y);
    const high = Math.max(a.y, b.y);
    const candidates = new Set<number>([a.x, b.x, this.gutterLeft, this.gutterRight]);
    for (const band of this.bands) {
      if (band.top >= high - EPS || band.bottom <= low + EPS) continue;
      for (const span of band.spans) {
        candidates.add(span.start - CLEARANCE_MM);
        candidates.add(span.end + CLEARANCE_MM);
      }
    }
    const cost = (x: number) => Math.abs(a.x - x) + Math.abs(x - b.x);
    const ordered = [...candidates].sort((p, q) => cost(p) - cost(q) || p - q);
    const clear = ordered.find(
      (x) => this.verticalClear(x, a.y, b.y) && this.horizontalClear(a.y, a.x, x) && this.horizontalClear(b.y, x, b.x),
    );
    const x = clear ?? (cost(this.gutterLeft) <= cost(this.gutterRight) ? this.gutterLeft : this.gutterRight);
    return [a, { x, y: a.y }, { x, y: b.y }, b];
  }

  /** Two vertical lanes joined by one horizontal run, at the ends' heights or along an edge lane. */
  joinVerticalLanes(a: Point, b: Point): Point[] {
    const candidates = [a.y, b.y, this.topLane, this.bottomLane];
    const cost = (y: number) => Math.abs(a.y - y) + Math.abs(y - b.y);
    const ordered = [...candidates].sort((p, q) => cost(p) - cost(q) || p - q);
    const clear = ordered.find(
      (y) => this.horizontalClear(y, a.x, b.x) && this.verticalClear(a.x, a.y, y) && this.verticalClear(b.x, y, b.y),
    );
    const y = clear ?? b.y;
    return [a, { x: a.x, y }, { x: b.x, y }, b];
  }

  /**
   * The raw route, before nudging and simplifying: segments strictly alternate between vertical and
   * horizontal, starting with the `from` stub (vertical when it leaves into a horizontal lane), and a
   * segment may have zero length — where the passage continues straight on from a stub, say. Keeping
   * the stub as its own segment lets the nudging move the passage off it with a jog.
   */
  route(from: Stub, to: Stub): RawRoute {
    let middle: Point[];
    if (from.axis === "h" && to.axis === "h") middle = this.joinHorizontalLanes(from.stub, to.stub);
    else if (from.axis === "h") middle = [from.stub, { x: to.stub.x, y: from.stub.y }, to.stub];
    else if (to.axis === "h") middle = [from.stub, { x: from.stub.x, y: to.stub.y }, to.stub];
    else middle = this.joinVerticalLanes(from.stub, to.stub);
    return { points: [from.point, ...middle, to.point], firstVertical: from.axis === "h" };
  }

  /**
   * The range a movable segment's track may take: the free gap around it, between the nearest device
   * row span, bar or interior edge on either side (over the segment's extent, touching included). The
   * preferred range keeps `CLEARANCE_MM` off both sides; the hard one, used only when a crowded gap
   * cannot hold its conductors otherwise, is described on `TrackRange`. Either is widened to the segment's own
   * coordinate when the router placed it closer than that. An obstacle the segment already runs through
   * (a tight cabinet's fallback, or a run across a bar) is not a bound. A vertical segment at `coord`
   * spans `a…b` in y; a horizontal one, in x.
   */
  trackRange(axis: Axis, coord: number, a: number, b: number): TrackRange {
    let low = 0;
    let high = axis === "v" ? this.geometry.interior.widthMm : this.geometry.interior.heightMm;
    const bound = (start: number, end: number) => {
      if (end <= coord + EPS) low = Math.max(low, end);
      else if (start >= coord - EPS) high = Math.min(high, start);
    };
    for (const band of this.bands) {
      // The spans are sorted and disjoint: the first one ending past the coordinate (or past `a`)
      // and the one before it are the only candidates.
      const { spans } = band;
      const threshold = axis === "v" ? coord + EPS : a - EPS;
      let first = 0;
      let last = spans.length;
      while (first < last) {
        const mid = (first + last) >> 1;
        if (spans[mid].end <= threshold) first = mid + 1;
        else last = mid;
      }
      if (axis === "v") {
        if (band.top >= b + EPS || band.bottom <= a - EPS) continue;
        if (first > 0) bound(spans[first - 1].start, spans[first - 1].end);
        if (first < spans.length) bound(spans[first].start, spans[first].end);
        // A span the segment runs through is no bound (the router's last resort); look past it.
        if (first + 1 < spans.length && spans[first].start < coord - EPS)
          bound(spans[first + 1].start, spans[first + 1].end);
      } else if (first < spans.length && spans[first].start < b + EPS) {
        bound(band.top, band.bottom);
      }
    }
    for (const rect of this.barRects) {
      if (axis === "v") {
        if (rect.y < b + EPS && rect.y + rect.h > a - EPS) bound(rect.x, rect.x + rect.w);
      } else if (rect.x < b + EPS && rect.x + rect.w > a - EPS) {
        bound(rect.y, rect.y + rect.h);
      }
    }
    // Wires may run behind the devices, under the DIN rail (the electrician, 2026-10-06): a crowded
    // vertical passage may spread up to `BEHIND_DEVICES_MM` behind the devices on either side; only
    // its preferred range keeps clear of them. Horizontal runs keep to their channel between the device
    // rows, so no route turns or ends behind a device.
    const hardLow = axis === "v" ? Math.max(0, low - BEHIND_DEVICES_MM) : low;
    const hardHigh = axis === "v" ? Math.min(this.geometry.interior.widthMm, high + BEHIND_DEVICES_MM) : high;
    return {
      lo: Math.min(low + CLEARANCE_MM, coord),
      hi: Math.max(high - CLEARANCE_MM, coord),
      loHard: Math.min(hardLow + TRACK_EDGE_MM, coord),
      hiHard: Math.max(hardHigh - TRACK_EDGE_MM, coord),
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Track assignment (nudging)
// ---------------------------------------------------------------------------------------------

/**
 * The distance between two parallel conductors sharing a channel or a passage. The drawing renders
 * a seed cabinet at roughly 1.3–2 px per millimetre, and its strokes are 1.5 px (circuit), 2.25 px
 * (feed) and 2.5 px (WLZ), PE 1.6× and PEN 2.2× heavier (`CabinetDrawing.tsx`): 3 mm is 4–6 px
 * centre to centre, so two ordinary strokes always keep a visible gap and two heavy protective ones
 * at most touch, never merge. A wider pitch would empty the 1-TE block gaps (11.5 mm usable) after
 * four conductors.
 */
export const WIRE_TRACK_PITCH_MM = 3;

/**
 * The nudging passes, in order: verticals first, because moving a passage off the stub it continues
 * gives length to the horizontal joining them (zero until then), and only then can the horizontals be
 * spread knowing their real extents.
 */
const NUDGE_PASSES: readonly Axis[] = ["v", "h"];

/**
 * How far a crowded vertical passage may spread behind the devices beside it: ten tracks either side,
 * which holds every passage of the seed cabinets at full pitch while keeping a run near the gap the
 * router chose (and the search for pins around it short).
 */
const BEHIND_DEVICES_MM = 10 * WIRE_TRACK_PITCH_MM;

/** The closest a track may come to a device, a bar or the interior edge when a gap is crowded. */
const TRACK_EDGE_MM = 1;

interface TrackRange {
  /** Preferred: `CLEARANCE_MM` off the devices, bars and interior edges on either side. */
  lo: number;
  hi: number;
  /**
   * The last resort for a crowded gap: for a horizontal run `TRACK_EDGE_MM` off the device rows, for a
   * vertical one up to `BEHIND_DEVICES_MM` behind the devices beside its passage.
   */
  loHard: number;
  hiHard: number;
}

interface Segment {
  /** Index into the paths. */
  path: number;
  /** The segment runs from point `index` to point `index + 1`. */
  index: number;
  /** The coordinate before this pass — the track it would rather keep. */
  desired: number;
  range: TrackRange;
  /** The extent along the segment, fixed for the pass. */
  from: number;
  to: number;
}

function coordinate(point: Point, axis: Axis): number {
  return axis === "v" ? point.x : point.y;
}

function along(point: Point, axis: Axis): number {
  return axis === "v" ? point.y : point.x;
}

/** A key part: millimetres to 0.001 mm, offset so a cabinet up to ±4 m stays positive. */
const KEY_PART = 2 ** 23;

function keyPart(mm: number): number {
  return Math.min(KEY_PART - 1, Math.max(0, Math.round(mm * 1000) + KEY_PART / 2));
}

/**
 * The order of parallel segments in a channel, chosen so they leave it without crossing each other:
 * by the side the conductor turns to at the end it travels towards (left / up first), then — among
 * those turning the same way — the one turning off sooner sits on the outside of the turn. The same
 * comparison at the other end breaks ties. Packed into one number (exact below 2^53).
 */
function sign(value: number): number {
  return value > EPS ? 1 : value < -EPS ? -1 : 0;
}

/** The side a route turns to off a track at `at`: read from the first point that leaves it. */
function turnAt(path: readonly Point[], start: number, step: 1 | -1, at: Point, axis: Axis): number {
  for (let i = start; i >= 0 && i < path.length; i += step) {
    const change = sign(coordinate(path[i], axis) - coordinate(at, axis));
    if (change !== 0) return change;
  }
  return 0;
}

function segmentKey(path: readonly Point[], index: number, axis: Axis): number {
  const a = path[index];
  const b = path[index + 1];
  const travel = sign(along(b, axis) - along(a, axis));
  // Past a zero-length neighbour, the turn is read further on.
  const turnOut = turnAt(path, index + 2, 1, b, axis);
  const turnIn = turnAt(path, index - 1, -1, a, axis);
  const outKey = (turnOut + 1) * KEY_PART + keyPart(-turnOut * travel * along(b, axis));
  const inKey = (turnIn + 1) * KEY_PART + keyPart(turnIn * travel * along(a, axis));
  return outKey * 3 * KEY_PART + inKey;
}

/** A route's first or last segment: it passes through its endpoint, so it never moves. */
interface Pin {
  at: number;
  from: number;
  to: number;
  /** The endpoint the stub lands on. */
  end: Point;
}

/**
 * `range` narrowed so the segment keeps a pitch off every other conductor's end segment it runs
 * alongside. The pins cut the range into cells; the segment keeps the cell it starts in, unless that
 * cell has room for fewer than three tracks or the segment starts on a pin — then it takes whichever
 * neighbouring cell has the most room. A stub into one of the segment's own endpoints is no obstacle:
 * conductors sharing an endpoint share its stub, and a run continuing straight into it merges with it.
 * The cell is chosen on the hard range and applies to both; when it leaves no room at all the range is
 * left as it was (an overlap beats crossing a device), and a preferred range it empties falls back to
 * the hard one.
 */
function avoidPins(
  range: TrackRange,
  pins: readonly Pin[],
  ends: readonly [Point, Point],
  desired: number,
  from: number,
  to: number,
): TrackRange {
  const pitch = WIRE_TRACK_PITCH_MM;
  const [start, finish] = ends;
  const relevant = (pin: Pin) => {
    if (Math.min(pin.to, to) - Math.max(pin.from, from) <= EPS) return false;
    const { x, y } = pin.end;
    const own =
      (Math.abs(start.x - x) < EPS && Math.abs(start.y - y) < EPS) ||
      (Math.abs(finish.x - x) < EPS && Math.abs(finish.y - y) < EPS);
    return !own;
  };

  // The first pin at or above `desired`; then the two nearest relevant pins on each side, within reach.
  let first = 0;
  let last = pins.length;
  while (first < last) {
    const mid = (first + last) >> 1;
    if (pins[mid].at < desired - EPS) first = mid + 1;
    else last = mid;
  }
  const above: number[] = [];
  for (let i = first; i < pins.length && above.length < 2 && pins[i].at < range.hiHard + pitch; i++) {
    if (relevant(pins[i])) above.push(pins[i].at);
  }
  const below: number[] = [];
  for (let i = first - 1; i >= 0 && below.length < 2 && pins[i].at > range.loHard - pitch; i--) {
    if (relevant(pins[i])) below.push(pins[i].at);
  }
  if (above.length === 0 && below.length === 0) return range;

  const cell = (low: number | undefined, high: number | undefined): [number, number] => [
    Math.max(range.loHard, low === undefined ? -Infinity : low + pitch),
    Math.min(range.hiHard, high === undefined ? Infinity : high - pitch),
  ];
  const room = ([low, high]: [number, number]) => high - low;
  const onPin = above.length > 0 && above[0] < desired + EPS;
  const cells: [number, number][] = onPin
    ? [cell(below[0], above[0]), cell(above[0], above[1])]
    : [cell(below[0], above[0]), cell(above[0], above[1]), cell(below[1], below[0])];
  let chosen = cells[0];
  if (onPin || room(chosen) < 2 * pitch) {
    for (const candidate of cells) if (room(candidate) > room(chosen) + EPS) chosen = candidate;
  }
  const [loHard, hiHard] = chosen;
  if (loHard > hiHard + EPS) return range;
  const lo = Math.max(range.lo, loHard);
  const hi = Math.min(range.hi, hiHard);
  return lo > hi + EPS ? { lo: loHard, hi: hiHard, loHard, hiHard } : { lo, hi, loHard, hiHard };
}

/** Indices below this pack into one sort key with their value; see `sortIndices`. */
const INDEX_SPAN = 4096;

/**
 * `indices` sorted by `value` (to 0.000001), ties by index — through the engine's numeric sort of
 * packed keys rather than a comparator, which is several times cheaper on code that has not warmed
 * up. Values must be non-negative and below 10⁶; more indices than `INDEX_SPAN` fall back to a
 * comparator.
 */
function sortIndices(indices: readonly number[], value: (i: number) => number): number[] {
  if (indices.length < 2) return [...indices];
  if (indices.length < 16 || indices.length > INDEX_SPAN || indices.some((i) => i >= INDEX_SPAN)) {
    return [...indices].sort((p, q) => value(p) - value(q) || p - q);
  }
  const keys = new Float64Array(indices.length);
  for (let n = 0; n < indices.length; n++) keys[n] = Math.round(value(indices[n]) * 1e6) * INDEX_SPAN + indices[n];
  keys.sort();
  return Array.from(keys, (key) => key % INDEX_SPAN);
}

/**
 * Segments laid out together. While bundles are being merged, `slots` is an upper bound on the slots
 * they need (the merged bundles' slots added up) and `lo`…`hi` the span that many would take; the
 * final layout (`layBundle`) needs no more, centred on the same track.
 */
interface Bundle {
  members: number[];
  slots: number;
  desiredSum: number;
  lo: number;
  hi: number;
  from: number;
  to: number;
  range: TrackRange;
}

/** The first track of `slots` tracks `pitch` apart centred on `centre`, inside a range; and the pitch. */
function place(slots: number, centre: number, range: TrackRange): { start: number; pitch: number } | null {
  if (range.loHard > range.hiHard + EPS) return null;
  const gaps = slots - 1;
  let pitch = WIRE_TRACK_PITCH_MM;
  const soft = range.hi - range.lo >= gaps * pitch - EPS;
  const low = soft ? range.lo : range.loHard;
  const high = soft ? range.hi : range.hiHard;
  if (high - low < gaps * pitch) pitch = gaps > 0 ? (high - low) / gaps : 0;
  return { start: Math.min(Math.max(centre - (gaps * pitch) / 2, low), high - gaps * pitch), pitch };
}

/**
 * Each member's slot: members in order of where they start take the first slot whose last member has
 * ended (interval partitioning — no two overlapping members share a slot, and no more slots than the
 * deepest overlap needs). The slots are then numbered in key order (by their members' mean key rank),
 * so the bundle leaves its channel without needless crossings.
 */
function assignSlots(
  members: readonly number[],
  segments: readonly Segment[],
  keyOf: ((segment: number) => number) | null,
): { slots: number; slotOf: Map<number, number> } {
  const ends: number[] = [];
  const slotOf = new Map<number, number>();
  if (members.length === 1) {
    slotOf.set(members[0], 0);
    return { slots: 1, slotOf };
  }
  for (const m of sortIndices(members, (i) => segments[i].from)) {
    const { from, to } = segments[m];
    let slot = 0;
    while (slot < ends.length && ends[slot] > from + EPS) slot++;
    if (slot === ends.length) ends.push(to);
    else ends[slot] = to;
    slotOf.set(m, slot);
  }
  if (ends.length < 2 || keyOf === null) return { slots: ends.length, slotOf };
  const keySum = ends.map(() => 0);
  const count = ends.map(() => 0);
  for (const [m, slot] of slotOf) {
    keySum[slot] += keyOf(m);
    count[slot] += 1;
  }
  const position = ends.map((_, slot) => slot).sort((p, q) => keySum[p] / count[p] - keySum[q] / count[q] || p - q);
  const renumber = position.map(() => 0);
  position.forEach((slot, n) => (renumber[slot] = n));
  for (const [m, slot] of slotOf) slotOf.set(m, renumber[slot]);
  return { slots: ends.length, slotOf };
}

function bundleOf(members: number[], slots: number, segments: readonly Segment[]): Bundle {
  const range: TrackRange = { lo: -Infinity, hi: Infinity, loHard: -Infinity, hiHard: Infinity };
  let desiredSum = 0;
  let from = Infinity;
  let to = -Infinity;
  for (const m of members) {
    const segment = segments[m];
    range.lo = Math.max(range.lo, segment.range.lo);
    range.hi = Math.min(range.hi, segment.range.hi);
    range.loHard = Math.max(range.loHard, segment.range.loHard);
    range.hiHard = Math.min(range.hiHard, segment.range.hiHard);
    desiredSum += segment.desired;
    from = Math.min(from, segment.from);
    to = Math.max(to, segment.to);
  }
  return withSpan({ members, slots, desiredSum, lo: 0, hi: 0, from, to, range });
}

/** Sets the bundle's span from its slots, centre and range; returns it. */
function withSpan(bundle: Bundle): Bundle {
  const placed = place(bundle.slots, bundle.desiredSum / bundle.members.length, bundle.range);
  if (placed === null) {
    // No common range (pins on both sides): the members keep their own clamped tracks.
    bundle.lo = bundle.range.loHard;
    bundle.hi = bundle.range.hiHard;
  } else {
    bundle.lo = placed.start;
    bundle.hi = placed.start + (bundle.slots - 1) * placed.pitch;
  }
  return bundle;
}

/** `a` with `b` merged into it — `a`'s member list is extended in place, so a long chain stays linear. */
function merge(a: Bundle, b: Bundle): Bundle {
  for (const m of b.members) a.members.push(m);
  a.slots += b.slots;
  a.desiredSum += b.desiredSum;
  a.from = Math.min(a.from, b.from);
  a.to = Math.max(a.to, b.to);
  a.range.lo = Math.max(a.range.lo, b.range.lo);
  a.range.hi = Math.min(a.range.hi, b.range.hi);
  a.range.loHard = Math.max(a.range.loHard, b.range.loHard);
  a.range.hiHard = Math.min(a.range.hiHard, b.range.hiHard);
  return withSpan(a);
}

/**
 * The final layout of a bundle, into `track`, by `assignSlots`: members that merely share the channel
 * share a slot, and the key order runs from the first slot up. The slots are a pitch apart, centred on
 * the members' mean desired track and shifted into their common range: the preferred one when it holds them, else
 * the hard one. Crowding fallback: when even that is too narrow, the slots close up evenly to fill it
 * — closer than the pitch, but still distinct. Members whose ranges have nothing in common (pins on
 * both sides) keep their own clamped tracks.
 */
function layBundle(
  bundle: Bundle,
  segments: readonly Segment[],
  keyOf: (segment: number) => number,
  track: number[],
): void {
  const { slots, slotOf } = assignSlots(bundle.members, segments, keyOf);
  const placed = place(slots, bundle.desiredSum / bundle.members.length, bundle.range);
  for (const m of bundle.members) {
    const { range, desired } = segments[m];
    track[m] =
      placed === null
        ? Math.min(Math.max(desired, range.loHard), range.hiHard)
        : placed.start + (slotOf.get(m) ?? 0) * placed.pitch;
  }
}

/**
 * Moves the interior segments of `axis` (vertical ones in x, horizontal ones in y) so that no two
 * whose extents overlap share a track. One sweep in track order: segments on one track form a bundle,
 * a bundle within a pitch of the previous one (extents overlapping) merges into it, and each final
 * bundle is laid out once (`layBundle`) — O(n log n) plus the slot assignment. A route's first and
 * last segments stay put — they pass through the endpoint — and the segments beside a moved one only
 * change length. A segment within a pitch of another conductor's stub is pushed off it (`avoidPins`).
 */
function nudgeAxis(routes: readonly RawRoute[], axis: Axis, router: Router): void {
  // By parity, not by geometry: a zero-length segment still has its orientation.
  const isAxis = (route: RawRoute, index: number) => ((index % 2 === 0) === route.firstVertical) === (axis === "v");
  const paths = routes.map((route) => route.points);

  // The end segments of `axis` cannot move; a movable one keeps a pitch off them. The stubs into one
  // endpoint are one pin, spanning all of them.
  const byEnd = new Map<number, Pin>();
  for (const route of routes) {
    const path = route.points;
    const last = path.length - 2;
    for (let index = 0; index <= last; index += last > 0 ? last : 1) {
      if (!isAxis(route, index)) continue;
      const a = path[index];
      const b = path[index + 1];
      const end = index === 0 ? a : b;
      const from = Math.min(along(a, axis), along(b, axis));
      const to = Math.max(along(a, axis), along(b, axis));
      // One number per endpoint: micrometre coordinates, exact below 2^53 for any cabinet.
      const id = Math.round(end.x * 1000) * 1e8 + Math.round(end.y * 1000);
      const pin = byEnd.get(id);
      if (pin === undefined) {
        byEnd.set(id, { at: coordinate(a, axis), from, to, end });
      } else {
        pin.from = Math.min(pin.from, from);
        pin.to = Math.max(pin.to, to);
      }
    }
  }
  const pins = [...byEnd.values()].sort((p, q) => p.at - q.at);

  const vertical = axis === "v";
  const segments: Segment[] = [];
  routes.forEach((route, pathIndex) => {
    const path = route.points;
    const ends = [path[0], path[path.length - 1]] as const;
    // By parity: the movable segments of this axis are every other one from the first or the second.
    const first = route.firstVertical === vertical ? 2 : 1;
    for (let index = first; index <= path.length - 3; index += 2) {
      const a = path[index];
      const b = path[index + 1];
      const [p, q] = vertical ? [a.y, b.y] : [a.x, b.x];
      const from = Math.min(p, q);
      const to = Math.max(p, q);
      // A zero-length segment overlaps nothing, so it never needs a track of its own.
      if (to - from <= EPS) continue;
      const desired = vertical ? a.x : a.y;
      const range = avoidPins(router.trackRange(axis, desired, from, to), pins, ends, desired, from, to);
      segments.push({ path: pathIndex, index, desired, range, from, to });
    }
  });
  if (segments.length === 0) return;

  // Keys are needed only where a bundle has more than one slot, so they are computed on demand.
  const keys = new Map<number, number>();
  const keyOf = (i: number) => {
    let key = keys.get(i);
    if (key === undefined) {
      key = segmentKey(paths[segments[i].path], segments[i].index, axis);
      keys.set(i, key);
    }
    return key;
  };
  const track = segments.map((segment) => segment.desired);

  // Bundles, swept in order of their track: segments on one track start as one bundle; a bundle that
  // comes within a pitch of the one before it, with extents that overlap, merges with it — until it
  // stands clear of everything before it. Each bundle is laid out once, at the end.
  const order = sortIndices(
    segments.map((_, i) => i),
    (i) => segments[i].desired,
  );
  const stack: Bundle[] = [];
  for (let i = 0; i < order.length;) {
    let end = i + 1;
    while (end < order.length && segments[order[end]].desired - segments[order[i]].desired < EPS) end++;
    const members = order.slice(i, end);
    let bundle = bundleOf(members, assignSlots(members, segments, null).slots, segments);
    i = end;
    for (let top = stack.at(-1); top !== undefined; top = stack.at(-1)) {
      const near = top.hi + WIRE_TRACK_PITCH_MM - EPS > bundle.lo && bundle.hi + WIRE_TRACK_PITCH_MM - EPS > top.lo;
      const alongside = Math.min(top.to, bundle.to) - Math.max(top.from, bundle.from) > EPS;
      if (!near || !alongside) break;
      stack.pop();
      bundle = merge(top, bundle);
    }
    stack.push(bundle);
  }
  for (const bundle of stack) layBundle(bundle, segments, keyOf, track);

  segments.forEach((segment, i) => {
    const path = paths[segment.path];
    for (const point of [path[segment.index], path[segment.index + 1]]) {
      if (axis === "v") point.x = track[i];
      else point.y = track[i];
    }
  });
}

/**
 * Every conductor on its own track (see `NUDGE_PASSES`). Horizontal runs stay in the free channel
 * they run in, so no route turns or ends behind a device; vertical runs may spread behind the devices
 * when their passage is crowded. Endpoints never move. Returns new paths, simplified (a move can line
 * two segments up, and the zero-length joins of the raw routes drop out).
 */
function nudgeTracks(routes: readonly RawRoute[], router: Router): Point[][] {
  const working = routes.map((route) => ({
    points: route.points.map((point) => ({ ...point })),
    firstVertical: route.firstVertical,
  }));
  for (const axis of NUDGE_PASSES) nudgeAxis(working, axis, router);
  return working.map((route) => simplify(route.points));
}

// ---------------------------------------------------------------------------------------------
// Conductors
// ---------------------------------------------------------------------------------------------

const PHASES: readonly TerminalPole[] = ["L", "L1", "L2", "L3"];

function isPhase(terminal: Terminal): boolean {
  return terminal.pole !== "N";
}

/** The source terminal that feeds `pole`: N from N, a phase from the same phase (or L ↔ L1). */
function sourceTerminal(terminals: readonly Terminal[], pole: TerminalPole): Terminal | undefined {
  const exact = terminals.find((terminal) => terminal.pole === pole);
  if (exact || pole === "N") return exact;
  if (pole === "L") return terminals.find((terminal) => terminal.pole === "L1");
  if (pole === "L1") return terminals.find((terminal) => terminal.pole === "L");
  return undefined;
}

function phaseRole(pole: TerminalPole): ConductorRole {
  return PHASES.includes(pole) ? pole : "L";
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Every conductor of a placed layout, in a stable order: circuits, WLZ, feeds. */
export function routeConductors(input: WiringInput): Conductor[] {
  const { geometry, supply } = input;
  const tnC = supply.earthing_system === "TN-C";
  const tnCS = supply.earthing_system === "TN-C-S";
  const byId = new Map(input.devices.map((device) => [device.id, device]));

  const located = new Map<string, Located>();
  for (const placement of input.placements) {
    const device = byId.get(placement.projectDeviceId);
    const rect = device ? deviceRect(placement, device, geometry) : null;
    if (!device || !rect || located.has(device.id)) continue;
    located.set(device.id, { device, rect, terminals: deviceTerminals(device, rect) });
  }
  const router = new Router(geometry, [...located.values()]);

  // Built-in bars first, then the placed catalog bars, each seen as a horizontal bar over its rect.
  const catalogBars = [...located.values()].flatMap((item) => catalogBarAsCabinetBar(item.device, item.rect) ?? []);
  const barTargets: BarTarget[] = [...geometry.bars, ...catalogBars].flatMap((bar, barIndex) =>
    terminalGroupPoints(bar).map((point, groupIndex) => ({
      kind: bar.kind,
      barIndex,
      groupIndex,
      point,
      rect: barRect(bar),
      orientation: bar.orientation,
    })),
  );
  /** The bar terminal group of `kind` nearest `from`, straight-line; ties go to the earlier one. */
  const nearestBar = (kind: "PE" | "N", from: Point): BarTarget | null => {
    let best: BarTarget | null = null;
    for (const target of barTargets) {
      if (target.kind !== kind) continue;
      if (best === null || distance(from, target.point) < distance(from, best.point) - EPS) best = target;
    }
    return best;
  };

  const conductors: Conductor[] = [];
  const routes: RawRoute[] = [];
  const add = (
    kind: ConductorKind,
    role: ConductorRole,
    circuitId: string | null,
    crossSectionMm2: number,
    from: { endpoint: Endpoint; stub: Stub },
    to: { endpoint: Endpoint; stub: Stub },
  ) => {
    // The path and its lengths are filled in after nudging.
    routes.push(router.route(from.stub, to.stub));
    conductors.push({
      key: `w${String(conductors.length)}`,
      kind,
      role,
      circuitId,
      crossSectionMm2,
      from: from.endpoint,
      to: to.endpoint,
      path: [],
      routedMm: 0,
      lengthMm: 0,
    });
  };

  const entryEnd = (entryIndex: number) => ({
    endpoint: { type: "entry", entryIndex } as Endpoint,
    stub: router.entryStub(entryIndex),
  });
  const terminalEnd = (item: Located, side: "line" | "load", terminal: Terminal, role: ConductorRole) => ({
    endpoint: { type: "terminal", deviceId: item.device.id, side, pole: terminal.pole } as Endpoint,
    stub: router.terminalStub(terminal, side, role),
  });
  const barEnd = (target: BarTarget) => ({
    endpoint: { type: "bar", kind: target.kind, barIndex: target.barIndex, groupIndex: target.groupIndex } as Endpoint,
    stub: router.barStub(target),
  });

  const all = [...located.values()];
  const groupRcd = (groupId: string | null) =>
    groupId === null
      ? undefined
      : all.find((item) => item.device.role === "rcd" && item.device.rcd_group_id === groupId);

  // Circuit cables in.
  for (const circuit of input.circuits) {
    const protection = all.find(
      (item) => item.device.circuit_id === circuit.id && (item.device.role === "mcb" || item.device.role === "rcbo"),
    );
    if (protection === undefined) continue;
    const entryIndex = Math.max(
      0,
      geometry.entries.findIndex((entry) => entry.side === circuit.entry_side),
    );
    const entry = entryEnd(entryIndex);
    const section = circuit.cross_section_mm2;

    for (const terminal of protection.terminals.load.filter(isPhase)) {
      const role = phaseRole(terminal.pole);
      add("circuit", role, circuit.id, section, entry, terminalEnd(protection, "load", terminal, role));
    }

    if (!tnC) {
      const ownN = protection.terminals.load.find((terminal) => terminal.pole === "N");
      const rcd = groupRcd(protection.device.rcd_group_id);
      const rcdN = rcd?.terminals.load.find((terminal) => terminal.pole === "N");
      if (ownN) {
        add("circuit", "N", circuit.id, section, entry, terminalEnd(protection, "load", ownN, "N"));
      } else if (rcd && rcdN) {
        add("circuit", "N", circuit.id, section, entry, terminalEnd(rcd, "load", rcdN, "N"));
      } else if (!rcd) {
        const bar = nearestBar("N", entry.stub.point);
        if (bar) add("circuit", "N", circuit.id, section, entry, barEnd(bar));
      }
    }

    const pe = nearestBar("PE", entry.stub.point);
    if (pe) add("circuit", tnC ? "PEN" : "PE", circuit.id, section, entry, barEnd(pe));
  }

  // WLZ.
  const wlzSection = supply.wlz_cross_section_mm2;
  const main = all.find((item) => item.device.role === "main_switch");
  if (main) {
    const entry = entryEnd(0);
    for (const terminal of main.terminals.line.filter(isPhase)) {
      const role = phaseRole(terminal.pole);
      add("wlz", role, null, wlzSection, entry, terminalEnd(main, "line", terminal, role));
    }
    const pe = nearestBar("PE", entry.stub.point);
    const mainN = main.terminals.line.find((terminal) => terminal.pole === "N");
    // TN-C-S splits the PEN on the PE bar; with no PE bar there is no split point.
    const splitsPen = tnCS && pe !== null;
    if (!tnC && !splitsPen) {
      const bar = mainN ? null : nearestBar("N", entry.stub.point);
      if (mainN) add("wlz", "N", null, wlzSection, entry, terminalEnd(main, "line", mainN, "N"));
      else if (bar) add("wlz", "N", null, wlzSection, entry, barEnd(bar));
    }
    if (pe) add("wlz", tnC || splitsPen ? "PEN" : "PE", null, wlzSection, entry, barEnd(pe));
    if (splitsPen) {
      const nBar = mainN ? null : nearestBar("N", pe.point);
      if (mainN) add("feed", "N", null, wlzSection, barEnd(pe), terminalEnd(main, "line", mainN, "N"));
      else if (nBar) add("feed", "N", null, wlzSection, barEnd(pe), barEnd(nBar));
    }
  }

  // Feeds.
  if (main) {
    const mainLoadN = main.terminals.load.find((terminal) => terminal.pole === "N");
    if (!tnC && mainLoadN) {
      const bar = nearestBar("N", mainLoadN);
      if (bar) add("feed", "N", null, wlzSection, terminalEnd(main, "load", mainLoadN, "N"), barEnd(bar));
    }
    const fedByMain = all.filter(
      (item) =>
        item.device.role === "rcd" ||
        item.device.role === "rcbo" ||
        (item.device.role === "mcb" && groupRcd(item.device.rcd_group_id) === undefined),
    );
    for (const target of fedByMain) {
      for (const terminal of target.terminals.line) {
        if (terminal.pole === "N") {
          if (tnC) continue;
          const bar = nearestBar("N", terminal);
          if (bar) add("feed", "N", null, wlzSection, barEnd(bar), terminalEnd(target, "line", terminal, "N"));
          continue;
        }
        const source = sourceTerminal(main.terminals.load, terminal.pole);
        if (source === undefined) continue;
        const role = phaseRole(terminal.pole);
        add(
          "feed",
          role,
          null,
          wlzSection,
          terminalEnd(main, "load", source, role),
          terminalEnd(target, "line", terminal, role),
        );
      }
    }
  }
  for (const rcd of all.filter((item) => item.device.role === "rcd")) {
    const members = all.filter(
      (item) => item.device.role === "mcb" && item.device.rcd_group_id === rcd.device.rcd_group_id,
    );
    for (const mcb of members) {
      for (const terminal of mcb.terminals.line) {
        if (terminal.pole === "N" && tnC) continue;
        const source = sourceTerminal(rcd.terminals.load, terminal.pole);
        if (source === undefined) continue;
        const role = terminal.pole === "N" ? "N" : phaseRole(terminal.pole);
        add(
          "feed",
          role,
          null,
          wlzSection,
          terminalEnd(rcd, "load", source, role),
          terminalEnd(mcb, "line", terminal, role),
        );
      }
    }
  }

  const paths = nudgeTracks(routes, router);
  return conductors.map((conductor, index) => {
    const path = paths[index];
    const routedMm = pathLength(path);
    return { ...conductor, path, routedMm, lengthMm: withSlack(routedMm) };
  });
}

// ---------------------------------------------------------------------------------------------
// Lengths
// ---------------------------------------------------------------------------------------------

export interface WireLengthRow {
  crossSectionMm2: number;
  wireClass: WireClass;
  /** What the conductors of the row are, in `CONDUCTOR_KINDS` order. */
  kinds: ConductorKind[];
  count: number;
  /** With slack. */
  totalMm: number;
}

/** Total length per cross-section and wire class, by ascending cross-section, then L, N, PE, PEN. */
export function wireLengthsBySection(conductors: readonly Conductor[]): WireLengthRow[] {
  const rows = new Map<string, WireLengthRow & { kindSet: Set<ConductorKind> }>();
  for (const conductor of conductors) {
    const cls = wireClass(conductor.role);
    const key = `${String(conductor.crossSectionMm2)}:${cls}`;
    let row = rows.get(key);
    if (row === undefined) {
      row = {
        crossSectionMm2: conductor.crossSectionMm2,
        wireClass: cls,
        kinds: [],
        count: 0,
        totalMm: 0,
        kindSet: new Set(),
      };
      rows.set(key, row);
    }
    row.count += 1;
    row.totalMm += conductor.lengthMm;
    row.kindSet.add(conductor.kind);
  }
  return [...rows.values()]
    .map(({ kindSet, ...row }) => ({ ...row, kinds: CONDUCTOR_KINDS.filter((kind) => kindSet.has(kind)) }))
    .sort(
      (a, b) =>
        a.crossSectionMm2 - b.crossSectionMm2 || WIRE_CLASSES.indexOf(a.wireClass) - WIRE_CLASSES.indexOf(b.wireClass),
    );
}
