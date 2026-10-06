import { barRect, RAIL_HEIGHT_MM, type CabinetGeometry, type Rect } from "@/lib/cabinet-geometry";
import type { CircuitInput, EntrySide, RcdGroupInput } from "@/lib/circuit-params";
import type { Tables } from "@/lib/database.types";
import { polesCarryN, type PoleConfig } from "@/lib/device-spec";
import { DIN_MODULE_MM } from "@/lib/din-module";
import { t } from "@/lib/i18n";

/**
 * The cabinet layout proposal (FR-008, S-05): where each matched device sits on the cabinet
 * snapshot's DIN rails. A pure, deterministic greedy pass — a heuristic applied as written, never an
 * optimiser (PRD `## Non-Goals`). The precedence is strict, rule 1 > rule 2 > rule 3 (PRD Open
 * Question #2, user decision 2026-10-06), and every rule below is quoted from the plan's decision
 * record (`context/changes/cabinet-layout-proposal/plan.md`, "Precedence and placement rules"):
 *
 * - **Blocks.** The main switch is its own block. Each non-empty RCD group is one block — its RCD (or
 *   RCBO, or the RCD of an RCBO fallback) first, then its MCBs in snapshot order. Ungrouped MCBs form
 *   one block.
 * - **Rule 1 (hard).** A block occupies one rail, contiguous. It continues onto the next rail in its
 *   rail order only when it is wider than every rail.
 * - **Rule 2 (orders blocks).** A block's side is the entry side most of its circuits use (tie: the
 *   earliest circuit's side; sides without an entry are skipped; none usable → `top`). Rails are
 *   ranked per side; `left` blocks fill from the rail start, `right` blocks from the rail end.
 * - **Rule 3 (tie-break only).** For `top`/`bottom` blocks the fill end, and any tie between equally
 *   ranked rails, go to the smaller N + PE score (see `rule3Score`). No bars, or equal scores: the
 *   rail start and the earlier rail.
 * - **Fit.** The first rail in the ranking with enough contiguous free length where every device,
 *   centred on the rail, stays inside the interior and clears every bar and every device on another
 *   rail. Nothing fits → `does_not_fit`.
 * - **Gaps.** A 1-TE gap between adjacent blocks on a rail with room for all of them; gaps open
 *   toward the rail's free middle and never cause `does_not_fit`.
 *
 * `validateLayout` checks any placement set — proposed or stored — against the same invariants. A
 * stored layout is not proof of validity, so the page validates it on every render.
 */

/** The gap between adjacent blocks on a rail: one DIN module (user decision 2026-10-06). */
export const GROUP_GAP_MM = DIN_MODULE_MM;

/** Float tolerance for millimetre comparisons; every real quantity is a multiple of 0.01 mm. */
const EPS = 1e-6;

/** The snapshot fields the layout reads. A `project_devices` row is one as is. */
export type LayoutDevice = Pick<
  Tables<"project_devices">,
  | "id"
  | "role"
  | "rcd_group_id"
  | "circuit_id"
  | "kind"
  | "width_mm"
  | "height_mm"
  | "poles"
  | "n_terminal_side"
  | "position"
>;

export type LayoutGroup = Pick<RcdGroupInput, "id" | "label">;
export type LayoutCircuit = Pick<CircuitInput, "id" | "entry_side">;

/** Built from a `MatchContext`: its snapshot, groups, circuits and parsed geometry. */
export interface LayoutInput {
  devices: readonly LayoutDevice[];
  /** Ordered by position. */
  groups: readonly LayoutGroup[];
  /** Ordered by position. */
  circuits: readonly LayoutCircuit[];
  geometry: CabinetGeometry;
}

/** One device on one rail. `xMm` is measured from the rail's start, rounded to 2 decimals. */
export interface Placement {
  projectDeviceId: string;
  railIndex: number;
  xMm: number;
}

export interface LayoutFailure {
  code: "does_not_fit";
  /** The devices' total width in TE, rounded up to 0.5 TE. */
  requiredModules: number;
  /** The rails' total length in TE, each rail rounded down to 0.5 TE. */
  availableModules: number;
  /** The first block that did not fit, in Polish. */
  blockLabel: string;
}

export type LayoutFailureCode = LayoutFailure["code"];

export type LayoutResult = { ok: true; placements: Placement[] } | { ok: false; reason: LayoutFailure };

// ---------------------------------------------------------------------------------------------
// Geometry helpers shared with the drawing (Phase 4) and the wiring (Phase 5)
// ---------------------------------------------------------------------------------------------

type Rail = CabinetGeometry["rails"][number];
type Bar = CabinetGeometry["bars"][number];

function railCentreY(rail: Rail): number {
  return rail.yMm + RAIL_HEIGHT_MM / 2;
}

function rectOnRail(rail: Rail, xMm: number, device: Pick<LayoutDevice, "width_mm" | "height_mm">): Rect {
  return {
    x: rail.xMm + xMm,
    y: railCentreY(rail) - device.height_mm / 2,
    w: device.width_mm,
    h: device.height_mm,
  };
}

/**
 * The device's front-view rectangle, centred vertically on its rail, or null when the placement
 * names a rail the geometry does not have.
 */
export function deviceRect(
  placement: Pick<Placement, "railIndex" | "xMm">,
  device: Pick<LayoutDevice, "width_mm" | "height_mm">,
  geometry: CabinetGeometry,
): Rect | null {
  const rail = geometry.rails.at(placement.railIndex);
  if (!Number.isInteger(placement.railIndex) || placement.railIndex < 0 || rail === undefined) return null;
  return rectOnRail(rail, placement.xMm, device);
}

export type TerminalPole = "L" | "L1" | "L2" | "L3" | "N";

export interface Terminal {
  pole: TerminalPole;
  x: number;
  y: number;
}

/** Line side is the top edge (the feed), load side the bottom edge (the outgoing circuit). */
export interface DeviceTerminals {
  line: Terminal[];
  load: Terminal[];
}

/** The phase poles per pole set, left to right; the N pole is added by `n_terminal_side`. */
const PHASE_POLES: Record<PoleConfig, readonly TerminalPole[]> = {
  "1P": ["L"],
  "1P+N": ["L"],
  "2P": ["L"],
  "3P": ["L1", "L2", "L3"],
  "3P+N": ["L1", "L2", "L3"],
  "4P": ["L1", "L2", "L3"],
};

/**
 * Terminal positions per pole: the poles split the width into equal slots, each terminal in its
 * slot's centre, with N in the leftmost or rightmost slot by `n_terminal_side`. A device without
 * poles has no terminals. An N-carrying device without a side is a bug (the CHECK forbids it), not a
 * state, so it throws.
 */
export function deviceTerminals(
  device: Pick<LayoutDevice, "id" | "poles" | "n_terminal_side">,
  rect: Rect,
): DeviceTerminals {
  if (device.poles === null) return { line: [], load: [] };
  const phases = PHASE_POLES[device.poles];
  let poles: readonly TerminalPole[] = phases;
  if (polesCarryN(device.poles)) {
    if (device.n_terminal_side === null) {
      throw new Error(`device ${device.id} carries N but has no n_terminal_side`);
    }
    poles = device.n_terminal_side === "left" ? ["N", ...phases] : [...phases, "N"];
  }
  const slot = rect.w / poles.length;
  const at = (y: number) => poles.map((pole, index) => ({ pole, x: rect.x + slot * (index + 0.5), y }));
  return { line: at(rect.y), load: at(rect.y + rect.h) };
}

// ---------------------------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------------------------

/** Strict with a tolerance, so rectangles that only touch along an edge do not overlap. */
function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w - EPS && b.x < a.x + a.w - EPS && a.y < b.y + b.h - EPS && b.y < a.y + a.h - EPS;
}

function insideInterior(rect: Rect, interior: CabinetGeometry["interior"]): boolean {
  return (
    rect.x >= -EPS &&
    rect.y >= -EPS &&
    rect.x + rect.w <= interior.widthMm + EPS &&
    rect.y + rect.h <= interior.heightMm + EPS
  );
}

/** The bar check is 2D (front view) and ignores `zMm`. */
function overlapsAnyBar(rect: Rect, bars: readonly Bar[]): boolean {
  return bars.some((bar) => rectsOverlap(rect, barRect(bar)));
}

function roundMm(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------------------------
// Rule 3 — the N + PE score
// ---------------------------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToRect(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.w));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.h));
  return Math.hypot(dx, dy);
}

/**
 * Where each terminal group of a bar sits: the bar's length is split among its groups in proportion
 * to their terminal counts, and a group's point is its segment's centre on the bar's centre line.
 * The geometry records only counts, not positions, so this is the simplest reading of "the nearest
 * N-bar terminal group". The wiring (`src/lib/cabinet-wiring.ts`) lands its bar conductors here too.
 */
export function terminalGroupPoints(bar: Bar): Point[] {
  const rect = barRect(bar);
  const total = bar.terminalGroups.reduce((sum, group) => sum + group.count, 0);
  const points: Point[] = [];
  let before = 0;
  for (const group of bar.terminalGroups) {
    const along = (bar.lengthMm * (before + group.count / 2)) / total;
    before += group.count;
    points.push(
      bar.orientation === "horizontal"
        ? { x: rect.x + along, y: rect.y + rect.h / 2 }
        : { x: rect.x + rect.w / 2, y: rect.y + along },
    );
  }
  return points;
}

interface BarTargets {
  nPoints: Point[];
  peRects: Rect[];
}

function barTargets(geometry: CabinetGeometry): BarTargets {
  return {
    nPoints: geometry.bars.filter((bar) => bar.kind === "N").flatMap(terminalGroupPoints),
    peRects: geometry.bars.filter((bar) => bar.kind === "PE").map(barRect),
  };
}

type BlockKind = "main_switch" | "group" | "ungrouped";

/**
 * The points whose conductor runs to the N bar, for one device of a block (plan review F3):
 * - the main switch and a group's RCD / RCBO: the line-side N terminal;
 * - in the ungrouped block, every MCB: its line-side N when it carries one; a 1P MCB's circuit N
 *   also goes to the N bar, and its point is taken where that circuit's cable lands — the MCB's
 *   load-side terminal. A 3P MCB contributes nothing (the record names only 1P circuits);
 * - a group's MCBs contribute nothing: their N runs to the group RCD, not to the bar.
 */
function nBarPoints(kind: BlockKind, device: LayoutDevice, rect: Rect): Point[] {
  if (kind === "group" && device.role !== "rcd" && device.role !== "rcbo") return [];
  const terminals = deviceTerminals(device, rect);
  const lineN = terminals.line.filter((terminal) => terminal.pole === "N");
  if (lineN.length > 0) return lineN;
  if (kind === "ungrouped" && device.poles === "1P") return terminals.load;
  return [];
}

/**
 * Rule 3: the N term (each N point to its nearest N-bar terminal group) plus the PE term (the
 * block's centre to the nearest PE bar). A missing bar kind contributes 0, so with no bars every
 * position scores 0 and the defaults (rail start, earlier rail) decide. Distances are straight-line.
 */
function rule3Score(kind: BlockKind, items: readonly PlacedItem[], targets: BarTargets): number {
  let score = 0;
  if (targets.nPoints.length > 0) {
    for (const item of items) {
      for (const point of nBarPoints(kind, item.device, item.rect)) {
        score += Math.min(...targets.nPoints.map((target) => distance(point, target)));
      }
    }
  }
  if (targets.peRects.length > 0 && items.length > 0) {
    const left = Math.min(...items.map((item) => item.rect.x));
    const right = Math.max(...items.map((item) => item.rect.x + item.rect.w));
    const first = items[0].rect;
    const centre = { x: (left + right) / 2, y: first.y + first.h / 2 };
    score += Math.min(...targets.peRects.map((rect) => distanceToRect(centre, rect)));
  }
  return score;
}

// ---------------------------------------------------------------------------------------------
// Blocks and rule 2
// ---------------------------------------------------------------------------------------------

interface Block {
  kind: BlockKind;
  label: string;
  side: EntrySide;
  devices: LayoutDevice[];
  widthMm: number;
}

function widthOf(devices: readonly LayoutDevice[]): number {
  return devices.reduce((sum, device) => sum + device.width_mm, 0);
}

/**
 * Rule 2: the entry side most of the block's circuits use, among sides the cabinet has an entry on;
 * a tie goes to the side of the earliest circuit (in stored circuit order); no usable side → `top`.
 */
function majoritySide(
  devices: readonly LayoutDevice[],
  circuits: readonly LayoutCircuit[],
  usable: ReadonlySet<EntrySide>,
): EntrySide {
  const ids = new Set(devices.flatMap((device) => (device.circuit_id === null ? [] : [device.circuit_id])));
  const counts = new Map<EntrySide, { count: number; first: number }>();
  circuits.forEach((circuit, index) => {
    if (!ids.has(circuit.id) || !usable.has(circuit.entry_side)) return;
    const current = counts.get(circuit.entry_side);
    if (current === undefined) counts.set(circuit.entry_side, { count: 1, first: index });
    else current.count += 1;
  });
  let best: { side: EntrySide; count: number; first: number } | null = null;
  for (const [side, { count, first }] of counts) {
    if (best === null || count > best.count || (count === best.count && first < best.first)) {
      best = { side, count, first };
    }
  }
  return best?.side ?? "top";
}

/** RCD / RCBO first, then the rest; otherwise snapshot order. */
function blockOrder(devices: readonly LayoutDevice[]): LayoutDevice[] {
  const lead = devices.filter((device) => device.role === "rcd" || device.role === "rcbo");
  return [...lead, ...devices.filter((device) => !lead.includes(device))];
}

function buildBlocks(input: LayoutInput): Block[] {
  const devices = [...input.devices].sort((a, b) => a.position - b.position);
  const usable = new Set(input.geometry.entries.map((entry) => entry.side));
  const blocks: Block[] = [];
  const make = (kind: BlockKind, label: string, members: LayoutDevice[], side?: EntrySide) => {
    if (members.length === 0) return;
    blocks.push({
      kind,
      label,
      side: side ?? majoritySide(members, input.circuits, usable),
      devices: members,
      widthMm: widthOf(members),
    });
  };

  const mainSwitches = devices.filter((device) => device.role === "main_switch");
  make("main_switch", t.layout.blocks.mainSwitch, mainSwitches, input.geometry.entries[0].side);

  // Stored group order first; a group id the list lacks (unreachable for a current match) follows in
  // order of first appearance, so no device is ever left out.
  const groupIds = input.groups.map((group) => group.id);
  for (const device of devices) {
    if (device.rcd_group_id !== null && !groupIds.includes(device.rcd_group_id)) groupIds.push(device.rcd_group_id);
  }
  for (const groupId of groupIds) {
    const label = input.groups.find((group) => group.id === groupId)?.label ?? groupId;
    const members = devices.filter((device) => device.role !== "main_switch" && device.rcd_group_id === groupId);
    make("group", t.circuitSection.servesGroup(label), blockOrder(members));
  }

  make(
    "ungrouped",
    t.layout.blocks.ungrouped,
    devices.filter((device) => device.role !== "main_switch" && device.rcd_group_id === null),
  );
  return blocks;
}

/** The midpoint of the span a side's entries cover, measured along that side. */
function entriesMidpoint(geometry: CabinetGeometry, side: EntrySide): number | null {
  const entries = geometry.entries.filter((entry) => entry.side === side);
  if (entries.length === 0) return null;
  const start = Math.min(...entries.map((entry) => entry.offsetMm));
  const end = Math.max(...entries.map((entry) => entry.offsetMm + entry.lengthMm));
  return (start + end) / 2;
}

/**
 * Rule 2's rail ranking for a side; a smaller key ranks first, equal keys tie. `top` ranks by
 * ascending `yMm`, `bottom` by descending `yMm`, `left`/`right` by the vertical distance from the
 * rail centre to the midpoint of that side's entries.
 */
function rankKey(side: EntrySide, rail: Rail, geometry: CabinetGeometry): number {
  if (side === "bottom") return -rail.yMm;
  if (side === "left" || side === "right") {
    const midpoint = entriesMidpoint(geometry, side);
    if (midpoint !== null) return Math.abs(railCentreY(rail) - midpoint);
  }
  return rail.yMm;
}

// ---------------------------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------------------------

type Anchor = "start" | "end";

interface PlacedItem {
  device: LayoutDevice;
  xMm: number;
  rect: Rect;
}

interface Segment {
  anchor: Anchor;
  items: PlacedItem[];
}

interface RailState {
  startUsed: number;
  endUsed: number;
  segments: Segment[];
}

interface Option {
  railIndex: number;
  anchor: Anchor;
  key: number;
  /** The main switch's distance from the rail end to the entry; 0 for every other block. */
  entryDistance: number;
  score: number;
  items: PlacedItem[];
}

class Placer {
  readonly rails: RailState[];
  readonly targets: BarTargets;
  readonly maxRailMm: number;

  constructor(readonly geometry: CabinetGeometry) {
    this.rails = geometry.rails.map(() => ({ startUsed: 0, endUsed: 0, segments: [] }));
    this.targets = barTargets(geometry);
    this.maxRailMm = Math.max(...geometry.rails.map((rail) => rail.lengthMm));
  }

  freeMm(railIndex: number): number {
    const state = this.rails[railIndex];
    return this.geometry.rails[railIndex].lengthMm - state.startUsed - state.endUsed;
  }

  /** The packed devices at the anchor end, or null when they do not fit length- or height-wise. */
  tryItems(railIndex: number, anchor: Anchor, devices: readonly LayoutDevice[]): PlacedItem[] | null {
    const width = widthOf(devices);
    if (width > this.freeMm(railIndex) + EPS) return null;
    const rail = this.geometry.rails[railIndex];
    const state = this.rails[railIndex];
    let x = anchor === "start" ? state.startUsed : rail.lengthMm - state.endUsed - width;
    const items: PlacedItem[] = [];
    for (const device of devices) {
      const rect = rectOnRail(rail, x, device);
      if (!this.clearsVertically(railIndex, rect)) return null;
      items.push({ device, xMm: x, rect });
      x += device.width_mm;
    }
    return items;
  }

  /**
   * Fit, vertically: inside the interior, clear of every bar and of every device on another rail.
   */
  clearsVertically(railIndex: number, rect: Rect): boolean {
    if (!insideInterior(rect, this.geometry.interior) || overlapsAnyBar(rect, this.geometry.bars)) return false;
    return this.rails.every(
      (state, index) =>
        index === railIndex ||
        state.segments.every((segment) => segment.items.every((item) => !rectsOverlap(rect, item.rect))),
    );
  }

  commit(railIndex: number, anchor: Anchor, items: PlacedItem[]): void {
    const state = this.rails[railIndex];
    const width = widthOf(items.map((item) => item.device));
    if (anchor === "start") state.startUsed += width;
    else state.endUsed += width;
    state.segments.push({ anchor, items });
  }

  /** The ends a block may fill from: rule 2 for `left`/`right`, both (rule 3 decides) otherwise. */
  anchorsFor(block: Block): Anchor[] {
    if (block.side === "left") return ["start"];
    if (block.side === "right") return ["end"];
    return ["start", "end"];
  }

  /**
   * The main switch sits at the end of its rail nearest the entry (`entries[0]`); for a top/bottom
   * entry, "nearest" compares the rail ends' x with the entry's midpoint.
   */
  entryDistance(block: Block, railIndex: number, anchor: Anchor): number {
    if (block.kind !== "main_switch" || (block.side !== "top" && block.side !== "bottom")) return 0;
    const entry = this.geometry.entries[0];
    const rail = this.geometry.rails[railIndex];
    const endX = anchor === "start" ? rail.xMm : rail.xMm + rail.lengthMm;
    return Math.abs(endX - (entry.offsetMm + entry.lengthMm / 2));
  }

  /** A block no wider than some rail: the best option across every rail, or null. */
  placeWhole(block: Block): boolean {
    const options: Option[] = [];
    this.geometry.rails.forEach((rail, railIndex) => {
      for (const anchor of this.anchorsFor(block)) {
        const items = this.tryItems(railIndex, anchor, block.devices);
        if (items === null) continue;
        options.push({
          railIndex,
          anchor,
          key: rankKey(block.side, rail, this.geometry),
          entryDistance: this.entryDistance(block, railIndex, anchor),
          score: rule3Score(block.kind, items, this.targets),
          items,
        });
      }
    });
    options.sort(compareOptions);
    const best = options.at(0);
    if (best === undefined) return false;
    this.commit(best.railIndex, best.anchor, best.items);
    return true;
  }

  /**
   * Rule 1's one exception: a block wider than every rail continues rail by rail in its ranking
   * (ties: the earlier rail). Each rail takes the longest leading run of the remaining devices that
   * fits there, at the end rule 2 / rule 3 picks.
   */
  placeSplit(block: Block): boolean {
    const order = this.geometry.rails
      .map((rail, railIndex) => ({ railIndex, key: rankKey(block.side, rail, this.geometry) }))
      .sort((a, b) => a.key - b.key || a.railIndex - b.railIndex);
    let remaining = block.devices;
    for (const { railIndex } of order) {
      if (remaining.length === 0) break;
      const chunk = this.splitChunk(block, railIndex, remaining);
      if (chunk === null) continue;
      this.commit(railIndex, chunk.anchor, chunk.items);
      remaining = remaining.slice(chunk.items.length);
    }
    return remaining.length === 0;
  }

  splitChunk(
    block: Block,
    railIndex: number,
    remaining: readonly LayoutDevice[],
  ): { anchor: Anchor; items: PlacedItem[] } | null {
    for (let count = remaining.length; count > 0; count--) {
      const devices = remaining.slice(0, count);
      const candidates = this.anchorsFor(block)
        .flatMap((anchor) => {
          const items = this.tryItems(railIndex, anchor, devices);
          return items === null ? [] : [{ anchor, items, score: rule3Score(block.kind, items, this.targets) }];
        })
        .sort((a, b) => (Math.abs(a.score - b.score) > EPS ? a.score - b.score : 0));
      const best = candidates.at(0);
      if (best !== undefined) return best;
    }
    return null;
  }

  /**
   * One 1-TE gap between adjacent blocks on every rail with room for all of them. Start-anchored
   * blocks shift toward the end, end-anchored ones toward the start, so each keeps its anchor end
   * and the free middle shrinks. A rail whose gapped devices would collide vertically (a bar, or a
   * device on another rail) stays packed, like a rail without room — gaps never break a layout.
   */
  applyGaps(): void {
    this.rails.forEach((state, railIndex) => {
      const blocks = state.segments.length;
      if (blocks < 2) return;
      const used = state.segments.reduce((sum, segment) => sum + widthOf(segment.items.map((i) => i.device)), 0);
      const free = this.geometry.rails[railIndex].lengthMm - used;
      if (free + EPS < GROUP_GAP_MM * (blocks - 1)) return;

      const rail = this.geometry.rails[railIndex];
      const shifted = new Map<Segment, PlacedItem[]>();
      const shiftSegments = (segments: Segment[], direction: 1 | -1) => {
        segments.forEach((segment, order) => {
          const offset = direction * order * GROUP_GAP_MM;
          shifted.set(
            segment,
            segment.items.map((item) => ({
              device: item.device,
              xMm: item.xMm + offset,
              rect: rectOnRail(rail, item.xMm + offset, item.device),
            })),
          );
        });
      };
      // Start blocks in x order from the start; end blocks in x order from the end.
      const byX = (segment: Segment) => segment.items[0].xMm;
      shiftSegments(
        state.segments.filter((s) => s.anchor === "start").sort((a, b) => byX(a) - byX(b)),
        1,
      );
      shiftSegments(
        state.segments.filter((s) => s.anchor === "end").sort((a, b) => byX(b) - byX(a)),
        -1,
      );
      const clear = [...shifted.values()].every((items) =>
        items.every((item) => this.clearsVertically(railIndex, item.rect)),
      );
      if (!clear) return;
      for (const segment of state.segments) segment.items = shifted.get(segment) ?? segment.items;
    });
  }

  placements(): Placement[] {
    return this.rails.flatMap((state, railIndex) =>
      state.segments.flatMap((segment) =>
        segment.items.map((item) => ({ projectDeviceId: item.device.id, railIndex, xMm: roundMm(item.xMm) })),
      ),
    );
  }
}

/** Rail rank first; then the main switch's entry end; then rule 3; then the earlier rail and the start. */
function compareOptions(a: Option, b: Option): number {
  if (a.key !== b.key) return a.key - b.key;
  if (Math.abs(a.entryDistance - b.entryDistance) > EPS) return a.entryDistance - b.entryDistance;
  if (Math.abs(a.score - b.score) > EPS) return a.score - b.score;
  if (a.railIndex !== b.railIndex) return a.railIndex - b.railIndex;
  return a.anchor === b.anchor ? 0 : a.anchor === "start" ? -1 : 1;
}

/** Half-TE rounding: up for what is needed, down for what a rail offers. */
function modulesUp(mm: number): number {
  return Math.ceil((mm / DIN_MODULE_MM) * 2 - 1e-9) / 2;
}

function modulesDown(mm: number): number {
  return Math.floor((mm / DIN_MODULE_MM) * 2 + 1e-9) / 2;
}

/**
 * The proposal. Blocks go in placement order — the main switch, the groups in stored order, the
 * ungrouped block — each on the first rail of its ranking that fits it. The placements come back in
 * snapshot (`position`) order.
 */
export function proposeLayout(input: LayoutInput): LayoutResult {
  const placer = new Placer(input.geometry);
  for (const block of buildBlocks(input)) {
    const placed = block.widthMm > placer.maxRailMm + EPS ? placer.placeSplit(block) : placer.placeWhole(block);
    if (!placed) {
      return {
        ok: false,
        reason: {
          code: "does_not_fit",
          requiredModules: modulesUp(widthOf(input.devices)),
          availableModules: input.geometry.rails.reduce((sum, rail) => sum + modulesDown(rail.lengthMm), 0),
          blockLabel: block.label,
        },
      };
    }
  }
  placer.applyGaps();

  const byId = new Map(placer.placements().map((placement) => [placement.projectDeviceId, placement]));
  const placements = [...input.devices]
    .sort((a, b) => a.position - b.position)
    .flatMap((device) => {
      const placement = byId.get(device.id);
      return placement === undefined ? [] : [placement];
    });
  return { ok: true, placements };
}

/** Polish text for a failure. The `Record` keeps it exhaustive over `LayoutFailureCode`. */
export function layoutFailureMessage(failure: LayoutFailure): string {
  const messages: Record<LayoutFailureCode, () => string> = {
    does_not_fit: () =>
      t.layout.failures.doesNotFit(failure.requiredModules, failure.availableModules, failure.blockLabel),
  };
  return messages[failure.code]();
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export type LayoutIssue =
  | { code: "device_not_placed"; deviceId: string }
  | { code: "device_placed_twice"; deviceId: string }
  | { code: "unknown_device"; deviceId: string }
  | { code: "outside_rail"; deviceId: string }
  | { code: "overlaps_device"; deviceId: string; otherDeviceId: string }
  | { code: "outside_interior"; deviceId: string }
  | { code: "overlaps_bar"; deviceId: string }
  | { code: "overlaps_other_rail_device"; deviceId: string; otherDeviceId: string }
  | { code: "group_not_contiguous"; groupId: string }
  | { code: "rcbo_not_alone"; groupId: string };

export type LayoutIssueCode = LayoutIssue["code"];

interface Located {
  device: LayoutDevice;
  railIndex: number;
  xMm: number;
  rect: Rect;
}

/**
 * Every way a placement set breaks the layout invariants; empty means valid. Checks, in order:
 * coverage (each device placed exactly once, no unknown ids), each device inside its rail, no overlap
 * on a rail, vertical fit (interior, bars, devices on other rails), each RCD group contiguous on one
 * rail (several rails only when the group is wider than every rail, each part contiguous), and an
 * RCBO alone in its group. A device that fails coverage or its rail is left out of the later checks.
 */
export function validateLayout(
  devices: readonly LayoutDevice[],
  placements: readonly Placement[],
  geometry: CabinetGeometry,
  groups: readonly Pick<LayoutGroup, "id">[],
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const byId = new Map(devices.map((device) => [device.id, device]));
  const seen = new Map<string, Placement>();
  const twice = new Set<string>();

  for (const placement of placements) {
    const id = placement.projectDeviceId;
    if (!byId.has(id)) {
      issues.push({ code: "unknown_device", deviceId: id });
      continue;
    }
    if (seen.has(id)) {
      if (!twice.has(id)) issues.push({ code: "device_placed_twice", deviceId: id });
      twice.add(id);
      continue;
    }
    seen.set(id, placement);
  }
  for (const device of devices) {
    if (!seen.has(device.id)) issues.push({ code: "device_not_placed", deviceId: device.id });
  }

  const located: Located[] = [];
  for (const device of devices) {
    const placement = seen.get(device.id);
    if (placement === undefined || twice.has(device.id)) continue;
    const rail = geometry.rails.at(placement.railIndex);
    const rect = deviceRect(placement, device, geometry);
    if (
      rail === undefined ||
      rect === null ||
      !Number.isFinite(placement.xMm) ||
      placement.xMm < -EPS ||
      placement.xMm + device.width_mm > rail.lengthMm + EPS
    ) {
      issues.push({ code: "outside_rail", deviceId: device.id });
      continue;
    }
    located.push({ device, railIndex: placement.railIndex, xMm: placement.xMm, rect });
  }

  located.forEach((item, index) => {
    for (const other of located.slice(index + 1)) {
      if (!rectsOverlap(item.rect, other.rect)) continue;
      issues.push({
        code: item.railIndex === other.railIndex ? "overlaps_device" : "overlaps_other_rail_device",
        deviceId: item.device.id,
        otherDeviceId: other.device.id,
      });
    }
    if (!insideInterior(item.rect, geometry.interior)) {
      issues.push({ code: "outside_interior", deviceId: item.device.id });
    }
    if (overlapsAnyBar(item.rect, geometry.bars)) issues.push({ code: "overlaps_bar", deviceId: item.device.id });
  });

  const groupIds = groups.map((group) => group.id);
  for (const device of devices) {
    if (device.rcd_group_id !== null && !groupIds.includes(device.rcd_group_id)) groupIds.push(device.rcd_group_id);
  }
  const maxRailMm = Math.max(...geometry.rails.map((rail) => rail.lengthMm));
  for (const groupId of groupIds) {
    const members = devices.filter((device) => device.role !== "main_switch" && device.rcd_group_id === groupId);
    if (members.length === 0) continue;
    if (!groupContiguous(groupId, members, located, maxRailMm)) {
      issues.push({ code: "group_not_contiguous", groupId });
    }
    if (members.some((device) => device.role === "rcbo") && members.length > 1) {
      issues.push({ code: "rcbo_not_alone", groupId });
    }
  }
  return issues;
}

/**
 * A group is contiguous when, on every rail it uses, no other device sits between its devices in x
 * order — and it uses one rail, unless it is wider than every rail (rule 1's continuation).
 */
function groupContiguous(
  groupId: string,
  members: readonly LayoutDevice[],
  located: readonly Located[],
  maxRailMm: number,
): boolean {
  const isMember = (item: Located) => item.device.role !== "main_switch" && item.device.rcd_group_id === groupId;
  const rails = new Set(located.filter(isMember).map((item) => item.railIndex));
  if (rails.size > 1 && widthOf(members) <= maxRailMm + EPS) return false;
  for (const railIndex of rails) {
    const onRail = located.filter((item) => item.railIndex === railIndex).sort((a, b) => a.xMm - b.xMm);
    const indices = onRail.flatMap((item, index) => (isMember(item) ? [index] : []));
    if (indices[indices.length - 1] - indices[0] !== indices.length - 1) return false;
  }
  return true;
}
