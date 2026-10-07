import { fittingTerminals } from "@/lib/bar-conductors";
import { barRect, RAIL_HEIGHT_MM, type CabinetGeometry, type Rect } from "@/lib/cabinet-geometry";
import {
  barTerminalPoints,
  catalogBarAsCabinetBar,
  deviceRect,
  isCatalogBarRole,
  deviceTerminals,
  type DeviceEdge,
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
 *   three-phase circuit) to its MCB / RCBO outgoing terminal; its N and its PE as below;
 * - **WLZ** — from `entries[0]` to the main switch's supply terminals, its PE (PEN in TN-C and
 *   TN-C-S) to the PE bar;
 * - **feeds** — the main switch's outgoing side to each RCD, RCBO and ungrouped MCB supply side, and
 *   each RCD's outgoing side to its MCBs.
 *
 * ## Bidirectional devices
 *
 * Plan Phase 5c, the electrician's rules (user 2026-10-07): FR, RCD, RCBO and MCB have no fixed line or
 * load edge, so the wiring picks each device's supply edge, deterministically, to keep routes short
 * and free of loops around the devices:
 * - **A group's MCBs take their supply on the edge its RCD gives out on**, so every RCD → MCB feed is
 *   a short jumper along that one edge of the group, and the circuit cables leave the MCBs on the
 *   other edge. Which edge: the circuits leave on the edge facing their cable entry points (their mean
 *   height against the rail's centre — `facingEdge`); the jumpers take the opposite edge, and the RCD
 *   takes its own supply on the circuits' edge. Level (a side entry at the rail's height): circuits on
 *   top, jumpers at the bottom — the default.
 * - **An RCBO or an ungrouped MCB** sends its circuit out on the edge facing its cable's entry point
 *   and takes its supply on the other; level → supply on top.
 * - **The main switch** takes the WLZ on the edge facing the WLZ's entry point and gives out on the
 *   other; level → WLZ at the bottom, out on top.
 * Feeds from the main switch run between whatever edges these rules chose. (Comb busbars would later
 * replace the jumpers — roadmap `## Parked`.)
 *
 * Cables at the entry (plan Phase 5c): each cable — the WLZ, each circuit's cable — enters at its own
 * point along its entry's span, evenly spaced and ordered by where the cable goes, so cables do not
 * cross right after the entry; its cores share that point and leave it together along one stub. Two
 * cables never share a point, however many there are (the spacing closes up instead). The cores then
 * leave the stub one at a time, each at its own lane — a progressive split, like stripping a cable (the
 * electrician, 2026-10-07): a core that has turned off keeps a pitch off its own cable's stub, and at
 * most the last one carries straight on along its line (`avoidPins`, `place`). The drawing's sheath runs
 * to the last turn-off (`buildDrawnCables`).
 *
 * Bar terminals (plan Phase 5c): every conductor landing on a PE or N bar takes its own terminal whose
 * cross-section range fits it — the nearest free one; never two conductors on one terminal. When a
 * built-in bar has too few fitting terminals the conductors that do not get one are left unrouted —
 * the `bar_terminals_insufficient` circuit warning names the shortfall, from the same count
 * (`src/lib/bar-conductors.ts`). The TN-C-S split link takes a PE-bar terminal like any conductor.
 *
 * N routing (domain rule): a circuit in an RCD group takes N from that RCD's outgoing N terminal —
 * never from the shared N bar, which would bypass the RCD and trip it. A circuit whose own device
 * carries N (an RCBO, a 1P+N MCB) takes N from that device. An ungrouped circuit without an N pole
 * takes N from the N bar. The main switch's load-side N feeds the N bar, and the N bar feeds the
 * line-side N of every device the main switch feeds; an RCD feeds the line-side N of its own
 * N-carrying MCBs. TN-C has no N conductor at all: every PEN goes to the PE bar. TN-C-S splits the PEN
 * in the switchboard (user decision 2026-10-06, matching `supply-warnings`): the WLZ's PEN lands on the
 * PE bar, and a split link runs from the PE bar to the main switch's supply-side N (or, for a main
 * switch without an N pole, to the N bar); from there N is wired as in TN-S. Without a PE bar there is
 * no split point, so the WLZ is drawn as separate PE and N.
 *
 * Routes: from each end a short stub leaves the terminal (vertically, into the free channel above or
 * below the rail), the cable's entry point (into a lane along the cabinet edge) or the bar terminal
 * (into a lane beside the bar); the two stubs are joined orthogonally through the nearest vertical passage
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
 * never move: conductors sharing a device terminal share its stub, as the cores of one cable share
 * their entry point and its stub.
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
  /** `slot` is the cable's 0-based position along the entry, in the entry's own direction. */
  | { type: "entry"; entryIndex: number; slot: number }
  /** `side` is the device edge the terminal is on; which edge is the supply is the router's choice. */
  | { type: "terminal"; deviceId: string; side: DeviceEdge; pole: TerminalPole }
  /**
   * `barIndex` counts the cabinet's built-in bars (`geometry.bars`), then the placed catalog bars in
   * placement order. `terminalIndex` is the terminal along the bar (0-based, across its groups) —
   * one conductor per terminal.
   */
  | { type: "bar"; kind: "PE" | "N"; barIndex: number; groupIndex: number; terminalIndex: number };

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
  /** The route starts at a cable entry: its first segment is its cable's stub (see `avoidPins`). */
  fromEntry: boolean;
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
  terminalIndex: number;
  point: Point;
  rect: Rect;
  orientation: "horizontal" | "vertical";
  minMm2: number;
  maxMm2: number;
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

  terminalStub(terminal: Terminal, side: DeviceEdge, role: ConductorRole): Stub {
    const offset = CHANNEL_BASE_MM + CHANNEL_STEP_MM * CHANNEL_LANE[role];
    return {
      point: { x: terminal.x, y: terminal.y },
      stub: { x: terminal.x, y: side === "top" ? terminal.y - offset : terminal.y + offset },
      axis: "h",
    };
  }

  /** A cable's own point on its entry's cabinet edge, `along` millimetres along that edge. */
  entryStub(entryIndex: number, along: number): Stub {
    const { interior, entries } = this.geometry;
    switch (entries[entryIndex].side) {
      case "top":
        return { point: { x: along, y: 0 }, stub: { x: along, y: this.topLane }, axis: "h" };
      case "bottom":
        return { point: { x: along, y: interior.heightMm }, stub: { x: along, y: this.bottomLane }, axis: "h" };
      case "left":
        return { point: { x: 0, y: along }, stub: { x: this.gutterLeft, y: along }, axis: "v" };
      case "right":
        return { point: { x: interior.widthMm, y: along }, stub: { x: this.gutterRight, y: along }, axis: "v" };
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
    return { points: [from.point, ...middle, to.point], firstVertical: from.axis === "h", fromEntry: false };
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
    // A vertical run may spread behind the devices beside it, but never so far that one of its ends —
    // a corner where a horizontal stub joins it — lands inside a device of a row that end lies in.
    let frontLow = -Infinity;
    let frontHigh = Infinity;
    const keepFront = (start: number, end: number) => {
      if (end <= coord + EPS) frontLow = Math.max(frontLow, end);
      else if (start >= coord - EPS) frontHigh = Math.min(frontHigh, start);
    };
    const insideRow = (y: number, band: Band) => y > band.top + EPS && y < band.bottom - EPS;
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
        if (insideRow(a, band) || insideRow(b, band)) {
          if (first > 0) keepFront(spans[first - 1].start, spans[first - 1].end);
          if (first < spans.length) keepFront(spans[first].start, spans[first].end);
          if (first + 1 < spans.length && spans[first].start < coord - EPS)
            keepFront(spans[first + 1].start, spans[first + 1].end);
        }
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
    const hardLow = axis === "v" ? Math.max(0, low - BEHIND_DEVICES_MM, Math.min(low, frontLow)) : low;
    const hardHigh =
      axis === "v"
        ? Math.min(this.geometry.interior.widthMm, high + BEHIND_DEVICES_MM, Math.max(high, frontHigh))
        : high;
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

/**
 * How far past its ends a vertical run counts as alongside another (see `nudgeAxis`): the horizontal
 * pass after it moves a run's end by a few tracks at most. Needed since every bar conductor has a
 * terminal of its own (plan Phase 5c), so their verticals often meet end to end.
 */
const VERTICAL_REACH_MM = 3 * WIRE_TRACK_PITCH_MM;

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
  /** The coordinate of its own cable's stub when the segment lies on that stub's line; else null. */
  anchor: number | null;
  /** For an anchored segment, the side it turns to at its far end (-1, 0, 1); else 0. */
  lean: number;
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
  /** A cable's stub from its entry point: an obstacle even to its own cores (see `avoidPins`). */
  cable: boolean;
}

/**
 * `range` narrowed so the segment keeps a pitch off every other conductor's end segment it runs
 * alongside. The pins cut the range into cells; the segment keeps the cell it starts in, unless that
 * cell has room for fewer than three tracks or the segment starts on a pin — then it takes whichever
 * neighbouring cell has the most room. A stub into one of the segment's own endpoints is no obstacle:
 * conductors sharing an endpoint share its stub, and a run continuing straight into it merges with it.
 * Except a cable's stub (plan Phase 5c, progressive split): a core leaves its cable one at a time, at its
 * own lane, and from there runs on its own track — so its passage keeps a pitch off its own cable's stub
 * too, which the other cores still run along until they turn off. The later pass still moves where each
 * core turns off (by `reach`), so that stub counts as alongside within `reach` of the segment's extent.
 * A run lying on the stub's own line is the exception: it continues the cable, and its bundle keeps
 * one slot exactly on that line and the others whole pitches off it (`Bundle.anchor`), so only the last
 * core stays on the line.
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
  reach: number,
): TrackRange {
  const pitch = WIRE_TRACK_PITCH_MM;
  const [start, finish] = ends;
  const relevant = (pin: Pin) => {
    const { x, y } = pin.end;
    const own =
      (Math.abs(start.x - x) < EPS && Math.abs(start.y - y) < EPS) ||
      (Math.abs(finish.x - x) < EPS && Math.abs(finish.y - y) < EPS);
    if (own && pin.cable) {
      // A run on the stub's own line continues the cable: its bundle keeps a slot on that line (`anchor`).
      if (Math.abs(pin.at - desired) < EPS) return false;
      return Math.min(pin.to, to + reach) - Math.max(pin.from, from - reach) > EPS;
    }
    if (Math.min(pin.to, to) - Math.max(pin.from, from) <= EPS) return false;
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
  /** Every member lies on its own cable's stub line, here: one slot stays on it (see `place`). */
  anchor: number | null;
  /** The anchored members' summed `lean`: which way an even bundle steps off the anchor. */
  lean: number;
}

/** `slots` tracks a pitch apart centred on `centre` inside `low…high`, closing up when it is too narrow. */
function spread(slots: number, centre: number, low: number, high: number): { start: number; pitch: number } {
  const gaps = slots - 1;
  let pitch = WIRE_TRACK_PITCH_MM;
  if (high - low < gaps * pitch) pitch = gaps > 0 ? (high - low) / gaps : 0;
  return { start: Math.min(Math.max(centre - (gaps * pitch) / 2, low), high - gaps * pitch), pitch };
}

/**
 * The first track of `slots` tracks `pitch` apart centred on `centre`, inside a range; and the pitch.
 *
 * With an `anchor` (its members' cable stub line, see `avoidPins`) the tracks keep to that line's
 * grid: shifted by whole pitches so one lies exactly on the anchor — the core there continues the
 * cable, the others leave it on tracks whole pitches off it. Of two shifts equally near the centred
 * span, the one towards the side the members turn to (`lean`) wins. When the range cannot hold a track
 * on the anchor at full pitch, the whole bundle keeps at least a pitch off it, on the side with more
 * room — closing up there if it must, never onto the stub.
 */
function place(
  slots: number,
  centre: number,
  range: TrackRange,
  anchor: number | null = null,
  lean = 0,
): { start: number; pitch: number } | null {
  if (range.loHard > range.hiHard + EPS) return null;
  const pitch = WIRE_TRACK_PITCH_MM;
  const gaps = slots - 1;
  const soft = range.hi - range.lo >= gaps * pitch - EPS;
  const low = soft ? range.lo : range.loHard;
  const high = soft ? range.hi : range.hiHard;
  const plain = spread(slots, centre, low, high);
  if (anchor === null) return plain;

  if (plain.pitch === pitch) {
    const below = anchor - Math.ceil((anchor - plain.start) / pitch - EPS) * pitch;
    const candidates = [below, below + pitch, below - pitch, below + 2 * pitch].sort(
      (p, q) => Math.abs(p - plain.start) - Math.abs(q - plain.start) || lean * (q - p),
    );
    for (const candidate of candidates) {
      const onAnchor = candidate <= anchor + EPS && anchor <= candidate + gaps * pitch + EPS;
      if (onAnchor && candidate >= low - EPS && candidate + gaps * pitch <= high + EPS)
        return { start: candidate, pitch };
    }
  }

  let best: [number, number] | null = null;
  for (const [lo, hi] of [
    [range.lo, range.hi],
    [range.loHard, range.hiHard],
  ]) {
    const sides: [number, number][] = [
      [lo, Math.min(hi, anchor - pitch)],
      [Math.max(lo, anchor + pitch), hi],
    ];
    for (const side of sides) {
      if (side[1] - side[0] < -EPS) continue;
      if (best === null || side[1] - side[0] > best[1] - best[0] + EPS) best = side;
    }
    if (best !== null && best[1] - best[0] >= gaps * pitch - EPS) break;
  }
  return best === null ? plain : spread(slots, centre, best[0], best[1]);
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
  const anchor = segments[members[0]].anchor;
  const shared = members.every((m) => segments[m].anchor === anchor) ? anchor : null;
  const lean = members.reduce((sum, m) => sum + segments[m].lean, 0);
  return withSpan({ members, slots, desiredSum, lo: 0, hi: 0, from, to, range, anchor: shared, lean });
}

/** Sets the bundle's span from its slots, centre and range; returns it. */
function withSpan(bundle: Bundle): Bundle {
  const placed = place(
    bundle.slots,
    bundle.desiredSum / bundle.members.length,
    bundle.range,
    bundle.anchor,
    bundle.lean,
  );
  if (placed === null) {
    // No common range (pins on both sides): the members split into runs (`layBundle`).
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
  if (a.anchor !== b.anchor) a.anchor = null;
  a.lean += b.lean;
  return withSpan(a);
}

/**
 * The final layout of a bundle, into `track`, by `assignSlots`: members that merely share the channel
 * share a slot, and the key order runs from the first slot up. The slots are a pitch apart, centred on
 * the members' mean desired track and shifted into their common range: the preferred one when it holds them, else
 * the hard one. Crowding fallback: when even that is too narrow, the slots close up evenly to fill it
 * — closer than the pitch, but still distinct. Members whose ranges have nothing in common (pins on
 * both sides) split into runs whose ranges do — by the low end of their hard range, each run taking
 * members while their common range lasts — and each run is laid out on its own; the runs' common
 * ranges are disjoint and ordered, so they never share a track.
 */
function layBundle(
  bundle: Bundle,
  segments: readonly Segment[],
  keyOf: (segment: number) => number,
  track: number[],
): void {
  const { slots, slotOf } = assignSlots(bundle.members, segments, keyOf);
  const placed = place(slots, bundle.desiredSum / bundle.members.length, bundle.range, bundle.anchor, bundle.lean);
  if (placed !== null) {
    for (const m of bundle.members) track[m] = placed.start + (slotOf.get(m) ?? 0) * placed.pitch;
    return;
  }
  if (bundle.members.length === 1) {
    const { range, desired } = segments[bundle.members[0]];
    track[bundle.members[0]] = Math.min(Math.max(desired, range.loHard), range.hiHard);
    return;
  }
  const ordered = sortIndices(bundle.members, (m) => segments[m].range.loHard);
  let run: number[] = [];
  let runHigh = Infinity;
  const flush = () => {
    if (run.length === 0) return;
    layBundle(bundleOf(run, assignSlots(run, segments, null).slots, segments), segments, keyOf, track);
    run = [];
    runHigh = Infinity;
  };
  for (const m of ordered) {
    const { loHard, hiHard } = segments[m].range;
    if (loHard > runHigh + EPS) flush();
    run.push(m);
    runHigh = Math.min(runHigh, hiHard);
  }
  flush();
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
        byEnd.set(id, { at: coordinate(a, axis), from, to, end, cable: index === 0 && route.fromEntry });
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
      // The horizontal pass still moves the runs a vertical one ends on, which can stretch two
      // end-to-end verticals into overlap: verticals within `VERTICAL_REACH_MM` count as alongside.
      const reach = vertical ? VERTICAL_REACH_MM : 0;
      const range = avoidPins(router.trackRange(axis, desired, from, to), pins, ends, desired, from, to, reach);
      // The cable's stub is this axis's first segment; a run on its line continues the cable.
      const onStub = route.fromEntry && route.firstVertical === vertical;
      const anchor = onStub && Math.abs(coordinate(path[0], axis) - desired) < EPS ? desired : null;
      const lean = anchor === null ? 0 : turnAt(path, index + 2, 1, b, axis);
      segments.push({ path: pathIndex, index, desired, range, from: from - reach, to: to + reach, anchor, lean });
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
    fromEntry: route.fromEntry,
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

function oppositeEdge(edge: DeviceEdge): DeviceEdge {
  return edge === "top" ? "bottom" : "top";
}

/**
 * The device edge facing a point above or below it: `top` when the point is higher than `centreY`,
 * `bottom` when lower, null when level with it (a side entry at the device's own height).
 */
export function facingEdge(pointY: number, centreY: number): DeviceEdge | null {
  if (pointY < centreY - EPS) return "top";
  if (pointY > centreY + EPS) return "bottom";
  return null;
}

/**
 * The edge on which a group's circuits leave its MCBs: the edge facing their cable entry points (the
 * mean height of their points against the group's rail centre). Level with it → `top`, so the
 * jumpers take the default bottom side.
 */
function groupCircuitEdge(entryYs: readonly number[], centreY: number): DeviceEdge {
  if (entryYs.length === 0) return "top";
  const mean = entryYs.reduce((sum, y) => sum + y, 0) / entryYs.length;
  return facingEdge(mean, centreY) ?? "top";
}

/** One cable entering the cabinet: the WLZ or a circuit's cable. */
interface Cable {
  entryIndex: number;
  /** Where the cable goes — its device's centre; orders the cables along the entry. */
  toward: Point;
  /** Filled by `spreadCables`. */
  slot: number;
  along: number;
}

/**
 * Each cable's own point along its entry (plan Phase 5c): the cables of one entry, ordered by where
 * they go (x along a top or bottom entry, y along a side one; ties keep their order), split the
 * entry's span into equal slots and enter at the centre of theirs. However many cables an entry takes,
 * no two share a point: the slots only close up.
 */
function spreadCables(cables: readonly Cable[], geometry: CabinetGeometry): void {
  const byEntry = new Map<number, Cable[]>();
  for (const cable of cables) {
    const list = byEntry.get(cable.entryIndex) ?? [];
    list.push(cable);
    byEntry.set(cable.entryIndex, list);
  }
  for (const [entryIndex, list] of byEntry) {
    const entry = geometry.entries[entryIndex];
    const horizontal = entry.side === "top" || entry.side === "bottom";
    const coordinateOf = (cable: Cable) => (horizontal ? cable.toward.x : cable.toward.y);
    const ordered = list.map((cable, order) => ({ cable, order }));
    ordered.sort((a, b) => coordinateOf(a.cable) - coordinateOf(b.cable) || a.order - b.order);
    ordered.forEach(({ cable }, slot) => {
      cable.slot = slot;
      cable.along = entry.offsetMm + (entry.lengthMm * (slot + 0.5)) / ordered.length;
    });
  }
}

/** A conductor end before routing; a bar end gets its terminal from `assignBarTerminals`. */
type PendingEnd =
  | { type: "entry"; cable: Cable }
  | { type: "terminal"; item: Located; side: DeviceEdge; terminal: Terminal }
  | { type: "bar"; kind: "PE" | "N"; near: Point; target: BarTarget | null };

type PendingBarEnd = Extract<PendingEnd, { type: "bar" }>;

interface Pending {
  kind: ConductorKind;
  role: ConductorRole;
  circuitId: string | null;
  crossSectionMm2: number;
  from: PendingEnd;
  to: PendingEnd;
}

/** The order bar terminals are handed out in: the supply's own conductors first, then the circuits. */
const ASSIGN_RANK: Record<ConductorKind, number> = { wlz: 0, feed: 1, circuit: 2 };

function fits(target: BarTarget, section: number): boolean {
  return target.minMm2 <= section && section <= target.maxMm2;
}

/**
 * One terminal per conductor (plan Phase 5c). Per bar kind, every bar end takes the nearest free
 * terminal whose cross-section range fits its conductor — the WLZ first, then the feeds, then the
 * circuits, each in routing order. Nearest-first can strand a conductor that a different choice would
 * have fitted (a thin conductor taking the only wide terminal); when it lands fewer conductors than
 * the best possible count — `fittingTerminals`, the count the bar warning and the catalog-bar match
 * use — the kind is handed out again the way that count is reached: thinnest conductor first, each to
 * the fitting terminal whose range closes soonest, the nearer of equals. A bar end left without a
 * terminal stays `null`: its conductor is not routed, never doubled up.
 */
function assignBarTerminals(pending: readonly Pending[], targets: readonly BarTarget[]): void {
  const ordered = pending
    .map((item, order) => ({ item, order }))
    .sort((a, b) => ASSIGN_RANK[a.item.kind] - ASSIGN_RANK[b.item.kind] || a.order - b.order);
  for (const kind of ["PE", "N"] as const) {
    const ends: { end: PendingBarEnd; section: number }[] = [];
    for (const { item } of ordered) {
      for (const end of [item.from, item.to]) {
        if (end.type === "bar" && end.kind === kind) ends.push({ end, section: item.crossSectionMm2 });
      }
    }
    if (ends.length === 0) continue;
    const terminals = targets.filter((target) => target.kind === kind);

    const handOut = (order: readonly number[], tighter: boolean): (BarTarget | null)[] => {
      const taken = new Set<BarTarget>();
      const chosen: (BarTarget | null)[] = ends.map(() => null);
      for (const i of order) {
        const { end, section } = ends[i];
        let best: BarTarget | null = null;
        let bestDistance = Infinity;
        for (const target of terminals) {
          if (taken.has(target) || !fits(target, section)) continue;
          const d = distance(end.near, target.point);
          const better =
            best === null ||
            (tighter && target.maxMm2 < best.maxMm2) ||
            ((!tighter || target.maxMm2 === best.maxMm2) && d < bestDistance - EPS);
          if (better) {
            best = target;
            bestDistance = d;
          }
        }
        if (best !== null) taken.add(best);
        chosen[i] = best;
      }
      return chosen;
    };

    let chosen = handOut(
      ends.map((_, i) => i),
      false,
    );
    const landed = chosen.filter((target) => target !== null).length;
    const best = fittingTerminals(
      ends.map((end) => end.section),
      terminals.map((target) => ({ count: 1, minMm2: target.minMm2, maxMm2: target.maxMm2 })),
    );
    if (landed < best) {
      const bySection = ends.map((_, i) => i).sort((a, b) => ends[a].section - ends[b].section || a - b);
      chosen = handOut(bySection, true);
    }
    ends.forEach(({ end }, i) => (end.target = chosen[i]));
  }
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

  // Built-in bars first, then the placed catalog bars, each seen as a horizontal bar over its rect;
  // every terminal of every bar is a target of its own.
  const catalogBars = [...located.values()].flatMap((item) => catalogBarAsCabinetBar(item.device, item.rect) ?? []);
  const barTargets: BarTarget[] = [...geometry.bars, ...catalogBars].flatMap((bar, barIndex) =>
    barTerminalPoints(bar, geometry.interior).map((terminal) => ({
      kind: bar.kind,
      barIndex,
      groupIndex: terminal.groupIndex,
      terminalIndex: terminal.index,
      point: terminal.point,
      rect: barRect(bar),
      orientation: bar.orientation,
      minMm2: terminal.minMm2,
      maxMm2: terminal.maxMm2,
    })),
  );
  const hasBar = (kind: "PE" | "N") => barTargets.some((target) => target.kind === kind);

  const all = [...located.values()];
  const groupRcd = (groupId: string | null) =>
    groupId === null
      ? undefined
      : all.find((item) => item.device.role === "rcd" && item.device.rcd_group_id === groupId);
  const centre = (rect: Rect): Point => ({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });

  // The cables, each at its own point along its entry.
  const main = all.find((item) => item.device.role === "main_switch");
  const circuitCables = input.circuits.flatMap((circuit) => {
    const protection = all.find(
      (item) => item.device.circuit_id === circuit.id && (item.device.role === "mcb" || item.device.role === "rcbo"),
    );
    if (protection === undefined) return [];
    const entryIndex = Math.max(
      0,
      geometry.entries.findIndex((entry) => entry.side === circuit.entry_side),
    );
    const cable: Cable = { entryIndex, toward: centre(protection.rect), slot: 0, along: 0 };
    return [{ circuit, protection, cable }];
  });
  const wlzCable: Cable | null = main ? { entryIndex: 0, toward: centre(main.rect), slot: 0, along: 0 } : null;
  spreadCables([...circuitCables.map((item) => item.cable), ...(wlzCable ? [wlzCable] : [])], geometry);
  const entryPoint = (cable: Cable) => router.entryStub(cable.entryIndex, cable.along).point;

  // Each device's supply edge (see `## Bidirectional devices` in the module comment).
  const supplyEdges = new Map<string, DeviceEdge>();
  if (main && wlzCable) {
    supplyEdges.set(main.device.id, facingEdge(entryPoint(wlzCable).y, centre(main.rect).y) ?? "bottom");
  }
  const cableYOf = new Map(circuitCables.map((item) => [item.protection.device.id, entryPoint(item.cable).y]));
  for (const item of all) {
    const { role, rcd_group_id: groupId } = item.device;
    if (role === "rcd") {
      const members = all.filter((other) => other.device.role === "mcb" && other.device.rcd_group_id === groupId);
      const circuitsEdge = groupCircuitEdge(
        members.flatMap((mcb) => cableYOf.get(mcb.device.id) ?? []),
        centre(item.rect).y,
      );
      // The RCD gives out on the jumper side, opposite the circuits; its MCBs take their supply there.
      supplyEdges.set(item.device.id, circuitsEdge);
      for (const mcb of members) supplyEdges.set(mcb.device.id, oppositeEdge(circuitsEdge));
    } else if ((role === "rcbo" || role === "mcb") && (role === "rcbo" || groupRcd(groupId) === undefined)) {
      const cableY = cableYOf.get(item.device.id);
      const circuitsEdge = cableY === undefined ? null : facingEdge(cableY, centre(item.rect).y);
      supplyEdges.set(item.device.id, circuitsEdge === null ? "top" : oppositeEdge(circuitsEdge));
    }
  }
  const supplySide = (item: Located): DeviceEdge => supplyEdges.get(item.device.id) ?? "top";
  const outSide = (item: Located): DeviceEdge => oppositeEdge(supplySide(item));

  const pending: Pending[] = [];
  const add = (
    kind: ConductorKind,
    role: ConductorRole,
    circuitId: string | null,
    crossSectionMm2: number,
    from: PendingEnd,
    to: PendingEnd,
  ) => {
    pending.push({ kind, role, circuitId, crossSectionMm2, from, to });
  };
  const entryEnd = (cable: Cable): PendingEnd => ({ type: "entry", cable });
  const terminalEnd = (item: Located, side: DeviceEdge, terminal: Terminal): PendingEnd => ({
    type: "terminal",
    item,
    side,
    terminal,
  });
  const barEnd = (kind: "PE" | "N", near: Point): PendingEnd => ({ type: "bar", kind, near, target: null });

  // Circuit cables in: the phases to the device's outgoing edge.
  for (const { circuit, protection, cable } of circuitCables) {
    const entry = entryEnd(cable);
    const near = entryPoint(cable);
    const section = circuit.cross_section_mm2;
    const out = outSide(protection);

    for (const terminal of protection.terminals[out].filter(isPhase)) {
      add("circuit", phaseRole(terminal.pole), circuit.id, section, entry, terminalEnd(protection, out, terminal));
    }

    if (!tnC) {
      const ownN = protection.terminals[out].find((terminal) => terminal.pole === "N");
      const rcd = groupRcd(protection.device.rcd_group_id);
      const rcdN = rcd?.terminals[outSide(rcd)].find((terminal) => terminal.pole === "N");
      if (ownN) {
        add("circuit", "N", circuit.id, section, entry, terminalEnd(protection, out, ownN));
      } else if (rcd && rcdN) {
        add("circuit", "N", circuit.id, section, entry, terminalEnd(rcd, outSide(rcd), rcdN));
      } else if (!rcd && hasBar("N")) {
        add("circuit", "N", circuit.id, section, entry, barEnd("N", near));
      }
    }

    if (hasBar("PE")) add("circuit", tnC ? "PEN" : "PE", circuit.id, section, entry, barEnd("PE", near));
  }

  // WLZ, onto the main switch's supply edge.
  const wlzSection = supply.wlz_cross_section_mm2;
  if (main && wlzCable) {
    const entry = entryEnd(wlzCable);
    const near = entryPoint(wlzCable);
    const into = supplySide(main);
    for (const terminal of main.terminals[into].filter(isPhase)) {
      add("wlz", phaseRole(terminal.pole), null, wlzSection, entry, terminalEnd(main, into, terminal));
    }
    const mainN = main.terminals[into].find((terminal) => terminal.pole === "N");
    // TN-C-S splits the PEN on the PE bar; with no PE bar there is no split point.
    const splitsPen = tnCS && hasBar("PE");
    if (!tnC && !splitsPen) {
      if (mainN) add("wlz", "N", null, wlzSection, entry, terminalEnd(main, into, mainN));
      else if (hasBar("N")) add("wlz", "N", null, wlzSection, entry, barEnd("N", near));
    }
    if (hasBar("PE")) add("wlz", tnC || splitsPen ? "PEN" : "PE", null, wlzSection, entry, barEnd("PE", near));
    if (splitsPen) {
      // The split link takes a PE-bar terminal of its own (user decision 2026-10-07).
      if (mainN) add("feed", "N", null, wlzSection, barEnd("PE", mainN), terminalEnd(main, into, mainN));
      else if (hasBar("N")) add("feed", "N", null, wlzSection, barEnd("PE", near), barEnd("N", near));
    }
  }

  // Feeds: the main switch's outgoing edge to each device it feeds, then each RCD to its MCBs.
  if (main) {
    const mainOut = outSide(main);
    const mainOutN = main.terminals[mainOut].find((terminal) => terminal.pole === "N");
    if (!tnC && mainOutN && hasBar("N")) {
      add("feed", "N", null, wlzSection, terminalEnd(main, mainOut, mainOutN), barEnd("N", mainOutN));
    }
    const fedByMain = all.filter(
      (item) =>
        item.device.role === "rcd" ||
        item.device.role === "rcbo" ||
        (item.device.role === "mcb" && groupRcd(item.device.rcd_group_id) === undefined),
    );
    for (const target of fedByMain) {
      const into = supplySide(target);
      for (const terminal of target.terminals[into]) {
        if (terminal.pole === "N") {
          if (tnC || !hasBar("N")) continue;
          add("feed", "N", null, wlzSection, barEnd("N", terminal), terminalEnd(target, into, terminal));
          continue;
        }
        const source = sourceTerminal(main.terminals[mainOut], terminal.pole);
        if (source === undefined) continue;
        add(
          "feed",
          phaseRole(terminal.pole),
          null,
          wlzSection,
          terminalEnd(main, mainOut, source),
          terminalEnd(target, into, terminal),
        );
      }
    }
  }
  for (const rcd of all.filter((item) => item.device.role === "rcd")) {
    const rcdOut = outSide(rcd);
    const members = all.filter(
      (item) => item.device.role === "mcb" && item.device.rcd_group_id === rcd.device.rcd_group_id,
    );
    for (const mcb of members) {
      const into = supplySide(mcb);
      for (const terminal of mcb.terminals[into]) {
        if (terminal.pole === "N" && tnC) continue;
        const source = sourceTerminal(rcd.terminals[rcdOut], terminal.pole);
        if (source === undefined) continue;
        const role = terminal.pole === "N" ? "N" : phaseRole(terminal.pole);
        add("feed", role, null, wlzSection, terminalEnd(rcd, rcdOut, source), terminalEnd(mcb, into, terminal));
      }
    }
  }

  // One conductor per bar terminal; a conductor left without one is not routed.
  assignBarTerminals(pending, barTargets);
  const routable = pending.filter((item) =>
    [item.from, item.to].every((end) => end.type !== "bar" || end.target !== null),
  );

  const resolve = (end: PendingEnd, role: ConductorRole): { endpoint: Endpoint; stub: Stub } => {
    switch (end.type) {
      case "entry":
        return {
          endpoint: { type: "entry", entryIndex: end.cable.entryIndex, slot: end.cable.slot },
          stub: router.entryStub(end.cable.entryIndex, end.cable.along),
        };
      case "terminal":
        return {
          endpoint: { type: "terminal", deviceId: end.item.device.id, side: end.side, pole: end.terminal.pole },
          stub: router.terminalStub(end.terminal, end.side, role),
        };
      case "bar": {
        // `routable` holds only bar ends that got a terminal.
        const target = end.target;
        if (target === null) throw new Error("an unassigned bar end reached routing");
        return {
          endpoint: {
            type: "bar",
            kind: target.kind,
            barIndex: target.barIndex,
            groupIndex: target.groupIndex,
            terminalIndex: target.terminalIndex,
          },
          stub: router.barStub(target),
        };
      }
    }
  };

  const routes: RawRoute[] = [];
  const conductors: Conductor[] = routable.map((item, index) => {
    const from = resolve(item.from, item.role);
    const to = resolve(item.to, item.role);
    // The path and its lengths are filled in after nudging.
    routes.push({ ...router.route(from.stub, to.stub), fromEntry: item.from.type === "entry" });
    return {
      key: `w${String(index)}`,
      kind: item.kind,
      role: item.role,
      circuitId: item.circuitId,
      crossSectionMm2: item.crossSectionMm2,
      from: from.endpoint,
      to: to.endpoint,
      path: [],
      routedMm: 0,
      lengthMm: 0,
    };
  });

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
