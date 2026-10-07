import {
  barRect,
  RAIL_HEIGHT_MM,
  terminalGroupSchema,
  type CabinetGeometry,
  type Rect,
  type TerminalGroup,
} from "@/lib/cabinet-geometry";
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
 * - **Catalog bars** (plan Phase 5b). PE/N bars the match took from the catalog — for a cabinet
 *   without built-in bars of that kind — form one block (PE, then N), placed after every other block,
 *   on the rail ranked first for `entries[0]`'s side, filled from the end opposite the main switch
 *   (either end only when that one fits nowhere). They count toward `does_not_fit` like any device.
 *   Being placed last, they take no part in rule 3 for the other blocks.
 *
 * `validateLayout` checks any placement set — proposed or stored — against the same invariants. A
 * stored layout is not proof of validity, so the page validates it on every render.
 */

/** The gap between adjacent blocks on a rail: one DIN module (user decision 2026-10-06). */
export const GROUP_GAP_MM = DIN_MODULE_MM;

/** The snapshot roles of PE/N bars taken from the catalog (plan Phase 5b), in block order. */
export const CATALOG_BAR_ROLES = ["pe_bar", "n_bar"] as const;

export function isCatalogBarRole(role: string): role is (typeof CATALOG_BAR_ROLES)[number] {
  return (CATALOG_BAR_ROLES as readonly string[]).includes(role);
}

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

/** A built-in cabinet bar, or a catalog bar seen as one. */
export type CabinetBar = Bar;

/**
 * A placed catalog PE/N bar (plan Phase 5b) as a cabinet bar: horizontal, along its rail, over its
 * device rectangle, with the terminal groups its snapshot copied from the catalog. The wiring and the
 * drawing treat it exactly like a built-in bar of its kind. `zMm` is unknown for a device and unused
 * by both, so it is 0. Null for a device that is not a catalog bar.
 */
export function catalogBarAsCabinetBar(
  device: { role: string; terminal_groups?: unknown },
  rect: Rect,
): CabinetBar | null {
  const kind = device.role === "pe_bar" ? "PE" : device.role === "n_bar" ? "N" : null;
  if (kind === null) return null;
  return {
    kind,
    orientation: "horizontal",
    xMm: rect.x,
    yMm: rect.y,
    lengthMm: rect.w,
    heightMm: rect.h,
    zMm: 0,
    terminalGroups: snapshotTerminalGroups(device.terminal_groups),
  };
}

const terminalGroupsSchema = terminalGroupSchema.array();

/**
 * A snapshot's `terminal_groups` jsonb, parsed. Anything that does not parse (unreachable: the trigger
 * copies a catalog row `parseDeviceSpec` accepted) gives no groups — a bar nothing can land on,
 * never invented terminals.
 */
export function snapshotTerminalGroups(value: unknown): TerminalGroup[] {
  const parsed = terminalGroupsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

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

/**
 * A device's terminals on its top and bottom edges. FR, RCD, RCBO and MCB are bidirectional (plan
 * Phase 5c): neither edge is "line" or "load" by construction — the wiring decides which edge a device
 * is fed on (`supplyEdge` in `src/lib/cabinet-wiring.ts`).
 */
export type DeviceEdge = "top" | "bottom";

export interface DeviceTerminals {
  top: Terminal[];
  bottom: Terminal[];
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
  if (device.poles === null) return { top: [], bottom: [] };
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
  return { top: at(rect.y), bottom: at(rect.y + rect.h) };
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
  if (total === 0) return [];
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

/** One screw terminal of a bar, with the cross-section range of the group it belongs to. */
export interface BarTerminal {
  /** 0-based along the bar, across its groups in order. */
  index: number;
  groupIndex: number;
  point: Point;
  minMm2: number;
  maxMm2: number;
}

/**
 * Every individual terminal of a bar (plan Phase 5c): each group's `count` terminals spread evenly
 * along the group's share of the bar (the share `terminalGroupPoints` uses), each in the centre of its
 * own slot on the bar's centre line. One conductor lands on one terminal.
 */
/** The bar label's font size in the cabinet drawing, from the interior; the drawing and the terminals share it. */
export function barLabelFontMm(interior: Pick<CabinetGeometry["interior"], "widthMm" | "heightMm">): number {
  return Math.max(8, Math.min(interior.widthMm, interior.heightMm) * 0.04);
}

/** How far along the bar its label reaches, in label heights — the PE stripe and the terminals start beyond it. */
export const BAR_LABEL_EXTENT = 2.2;

/** The label's height on this bar: the interior's label size, shrunk to fit a narrow bar. */
export function barLabelSizeMm(bar: Bar, fontMm: number): number {
  const rect = barRect(bar);
  return Math.min(fontMm, Math.min(rect.w, rect.h) * 0.8);
}

/**
 * Every terminal of a bar, evenly along it. With `interior`, the terminals start past the bar's label
 * (at most half the bar), so a screw mark never covers "PE" / "N"; without it they span the whole bar.
 */
export function barTerminalPoints(
  bar: Bar,
  interior?: Pick<CabinetGeometry["interior"], "widthMm" | "heightMm">,
): BarTerminal[] {
  const rect = barRect(bar);
  const total = bar.terminalGroups.reduce((sum, group) => sum + group.count, 0);
  if (total === 0) return [];
  const lead =
    interior === undefined
      ? 0
      : Math.min(barLabelSizeMm(bar, barLabelFontMm(interior)) * BAR_LABEL_EXTENT, bar.lengthMm / 2);
  const span = bar.lengthMm - lead;
  const terminals: BarTerminal[] = [];
  bar.terminalGroups.forEach((group, groupIndex) => {
    for (let k = 0; k < group.count; k++) {
      const index = terminals.length;
      const along = lead + (span * (index + 0.5)) / total;
      terminals.push({
        index,
        groupIndex,
        point:
          bar.orientation === "horizontal"
            ? { x: rect.x + along, y: rect.y + rect.h / 2 }
            : { x: rect.x + rect.w / 2, y: rect.y + along },
        minMm2: group.minMm2,
        maxMm2: group.maxMm2,
      });
    }
  });
  return terminals;
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

type BlockKind = "main_switch" | "group" | "ungrouped" | "bars";

/**
 * The points whose conductor runs to the N bar, for one device of a block (plan review F3):
 * - the main switch and a group's RCD / RCBO: the line-side N terminal;
 * - in the ungrouped block, every MCB: its line-side N when it carries one; a 1P MCB's circuit N
 *   also goes to the N bar, and its point is taken where that circuit's cable lands — the MCB's
 *   load-side terminal. A 3P MCB contributes nothing (the record names only 1P circuits);
 * - a group's MCBs contribute nothing: their N runs to the group RCD, not to the bar.
 *
 * "Line side" is read as the top edge and "load side" as the bottom one, as the decision record was
 * written. The wiring made devices bidirectional later (plan Phase 5c); this score keeps the reading so
 * stored proposals and the rule-3 tables stay as they were — it is a tie-break distance, not a route.
 */
function nBarPoints(kind: BlockKind, device: LayoutDevice, rect: Rect): Point[] {
  if (kind === "bars") return [];
  if (kind === "group" && device.role !== "rcd" && device.role !== "rcbo") return [];
  const terminals = deviceTerminals(device, rect);
  const lineN = terminals.top.filter((terminal) => terminal.pole === "N");
  if (lineN.length > 0) return lineN;
  if (kind === "ungrouped" && device.poles === "1P") return terminals.bottom;
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
    devices.filter(
      (device) => device.role !== "main_switch" && !isCatalogBarRole(device.role) && device.rcd_group_id === null,
    ),
  );

  // Catalog bars last, PE then N, ranked for the WLZ's entry like the main switch.
  make(
    "bars",
    t.layout.blocks.bars,
    CATALOG_BAR_ROLES.flatMap((role) => devices.filter((device) => device.role === role)),
    input.geometry.entries[0].side,
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
  /** The end the main switch went to, once placed; catalog bars fill from the other one. */
  mainAnchor: Anchor | null = null;
  /** Set while catalog bars retry on either end, after the end opposite the main switch fit nowhere. */
  barsOnEitherEnd = false;

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
    if (block.kind === "bars" && !this.barsOnEitherEnd) return [this.mainAnchor === "start" ? "end" : "start"];
    if (block.kind === "bars") return ["start", "end"];
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
    if (block.kind === "main_switch") this.mainAnchor = best.anchor;
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
    const place = () => (block.widthMm > placer.maxRailMm + EPS ? placer.placeSplit(block) : placer.placeWhole(block));
    let placed = place();
    if (!placed && block.kind === "bars" && block.widthMm <= placer.maxRailMm + EPS) {
      // The end opposite the main switch fits nowhere: either end, before giving up. (A split block
      // has already committed its first chunks, so it is never retried.)
      placer.barsOnEitherEnd = true;
      placed = place();
    }
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

/**
 * Display names for issue messages, keyed by project device id and by RCD group id — serialisable,
 * so an island can take them as props. A missing name falls back to the id.
 */
export interface LayoutIssueNames {
  devices: Readonly<Record<string, string>>;
  groups: Readonly<Record<string, string>>;
}

/** Polish text for one issue. The `Record` keeps it exhaustive over `LayoutIssueCode`. */
export function layoutIssueMessage(issue: LayoutIssue, names: LayoutIssueNames): string {
  const m = t.layout.issues;
  const device = (id: string) => names.devices[id] ?? id;
  const group = (id: string) => names.groups[id] ?? id;
  const messages: { [C in LayoutIssueCode]: (issue: Extract<LayoutIssue, { code: C }>) => string } = {
    device_not_placed: (i) => m.deviceNotPlaced(device(i.deviceId)),
    device_placed_twice: (i) => m.devicePlacedTwice(device(i.deviceId)),
    unknown_device: (i) => m.unknownDevice(device(i.deviceId)),
    outside_rail: (i) => m.outsideRail(device(i.deviceId)),
    overlaps_device: (i) => m.overlapsDevice(device(i.deviceId), device(i.otherDeviceId)),
    outside_interior: (i) => m.outsideInterior(device(i.deviceId)),
    overlaps_bar: (i) => m.overlapsBar(device(i.deviceId)),
    overlaps_other_rail_device: (i) => m.overlapsOtherRailDevice(device(i.deviceId), device(i.otherDeviceId)),
    group_not_contiguous: (i) => m.groupNotContiguous(group(i.groupId)),
    rcbo_not_alone: (i) => m.rcboNotAlone(group(i.groupId)),
  };
  return (messages[issue.code] as (issue: LayoutIssue) => string)(issue);
}

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
