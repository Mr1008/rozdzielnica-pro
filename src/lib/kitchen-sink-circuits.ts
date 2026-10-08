import {
  buildDrawnCables,
  buildDrawnDevices,
  buildDrawnWires,
  type DrawnCable,
  type DrawnDevice,
  type DrawnWire,
} from "@/lib/cabinet-drawing";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Placement } from "@/lib/cabinet-layout";
import { SEED_A, SEED_B, SEED_C, geometry as parseFixtureGeometry } from "@/lib/cabinet-layout.fixtures";
import { wireLengthsBySection, type WireLengthRow } from "@/lib/cabinet-wiring";
import { payloadToDraft, type CircuitDraftState } from "@/lib/circuit-draft";
import {
  DEFAULT_RCD_MARGIN_PERCENT,
  type CircuitInput,
  type EntrySide,
  type RcdGroupInput,
} from "@/lib/circuit-params";
import { DEMO_CABINET_GEOMETRY, HERO_CABINET_GEOMETRY } from "@/lib/demo-cabinet";
import { computeMatchView, type MatchContext, type MatchView, type SnapshotRow } from "@/lib/device-matching-server";
import { activeCatalog, type DeviceSpecWithId, type Selection } from "@/lib/device-matching";
import { deviceKindLabel, type DeviceKind, type NTerminalSide } from "@/lib/device-spec";
import { t } from "@/lib/i18n";
import { layoutIssueNames, toEditorDevices, type LayoutEditorData } from "@/lib/layout-editor-data";
import { editUnits, moveDevice, snapX, type LayoutDraft } from "@/lib/layout-editing";
import {
  buildLayoutDrawing,
  computeLayoutView,
  computeWiring,
  type LayoutDrawing,
  type LayoutView,
} from "@/lib/layout-server";
import type { BusinessProfile } from "@/lib/business-profile";
import type { PricingProfile } from "@/lib/pricing-profile";
import { computeQuoteView, estimateLabourMinutes, type QuoteView } from "@/lib/quote";
import { computePrintView, type PrintBlockReason, type PrintView } from "@/lib/quote-print";
import type { SupplyParams } from "@/lib/supply-params";

/**
 * Static fixtures for the kitchen sink's circuit section (dev only, never written anywhere): a small
 * catalog, supplies, groups and circuits with fixed UUIDs, and the match contexts behind every
 * `MatchResult` state. Each `MatchView` is computed by `computeMatchView`, so the states are the
 * matcher's real answers, not hand-built results.
 */

const k = t.devTools.kitchenSink.circuitFixtures;

/** A fixed, valid v4-shaped UUID per namespace digit and index, so every render is identical. */
function uuid(namespace: number, index: number): string {
  return `00000000-0000-4000-800${String(namespace)}-${String(index).padStart(12, "0")}`;
}

export const KS_PROJECT_ID = uuid(9, 1);

// ——— Catalog ———

interface DeviceFixture {
  kind: DeviceKind;
  model: string;
  priceGrosze: number;
  widthMm: number;
  poles: string;
  ratedCurrentA: number;
  residualCurrentMa?: number;
  rcdType?: string;
  breakingCapacityKa?: number;
  /** Required exactly when the poles carry N, like the catalog. */
  nTerminalSide?: NTerminalSide;
}

const DEVICE_FIXTURES: DeviceFixture[] = [
  {
    kind: "switch_disconnector",
    model: "FR-240",
    priceGrosze: 4990,
    widthMm: 36,
    poles: "2P",
    ratedCurrentA: 40,
    nTerminalSide: "left",
  },
  {
    kind: "rcd",
    model: "RCD-240-A",
    priceGrosze: 11900,
    widthMm: 36,
    poles: "2P",
    ratedCurrentA: 40,
    residualCurrentMa: 30,
    rcdType: "A",
    nTerminalSide: "right",
  },
  {
    kind: "rcbo",
    model: "RCBO-B10-A",
    priceGrosze: 14290,
    widthMm: 36,
    poles: "1P+N",
    ratedCurrentA: 10,
    residualCurrentMa: 30,
    rcdType: "A",
    breakingCapacityKa: 6,
    nTerminalSide: "left",
  },
  {
    kind: "mcb_b",
    model: "S-B10",
    priceGrosze: 1790,
    widthMm: 18,
    poles: "1P",
    ratedCurrentA: 10,
    breakingCapacityKa: 6,
  },
  {
    kind: "mcb_b",
    model: "S-B16",
    priceGrosze: 1850,
    widthMm: 18,
    poles: "1P",
    ratedCurrentA: 16,
    breakingCapacityKa: 6,
  },
  // The pricier B16 the stale snapshot still holds.
  {
    kind: "mcb_b",
    model: "S-B16-10K",
    priceGrosze: 2690,
    widthMm: 18,
    poles: "1P",
    ratedCurrentA: 16,
    breakingCapacityKa: 10,
  },
  {
    kind: "mcb_b",
    model: "S-B20",
    priceGrosze: 1890,
    widthMm: 18,
    poles: "1P",
    ratedCurrentA: 20,
    breakingCapacityKa: 6,
  },
  {
    kind: "mcb_b",
    model: "S-B25",
    priceGrosze: 1990,
    widthMm: 18,
    poles: "1P",
    ratedCurrentA: 25,
    breakingCapacityKa: 6,
  },
  // The TN-C main switch: the PEN is never switched, so single-phase TN-C takes a 1P FR. Last, so the
  // index-based ids above stay put; no other supply accepts a 1P main switch.
  {
    kind: "switch_disconnector",
    model: "FR-140",
    priceGrosze: 3490,
    widthMm: 18,
    poles: "1P",
    ratedCurrentA: 40,
  },
];

/** Raw `devices`-shaped rows, run through `activeCatalog` like the page's own load. */
const DEVICE_ROWS = DEVICE_FIXTURES.map((device, index) => ({
  id: uuid(1, index + 1),
  archived_at: null,
  kind: device.kind,
  name: deviceKindLabel(device.kind),
  manufacturer: k.manufacturer,
  model: device.model,
  price_grosze: device.priceGrosze,
  width_mm: device.widthMm,
  height_mm: 85,
  depth_mm: 70,
  poles: device.poles,
  rated_current_a: device.ratedCurrentA,
  residual_current_ma: device.residualCurrentMa ?? null,
  rcd_type: device.rcdType ?? null,
  breaking_capacity_ka: device.breakingCapacityKa ?? null,
  terminal_groups: null,
  n_terminal_side: device.nTerminalSide ?? null,
}));

/**
 * One PE and one N bar for a cabinet without built-in bars (plan Phase 5b): 1 TE wide, so the filled
 * circuits still fit cabinet (a)'s single rail; six terminals take the four circuits and the WLZ.
 * Ids follow the device rows, so theirs stay put.
 */
const BAR_TERMINALS = [
  { count: 5, minMm2: 1.5, maxMm2: 16 },
  { count: 1, minMm2: 6, maxMm2: 25 },
];
const BAR_ROWS = (["pe_bar", "n_bar"] as const).map((kind, index) => ({
  id: uuid(1, DEVICE_FIXTURES.length + index + 1),
  archived_at: null,
  kind,
  name: deviceKindLabel(kind),
  manufacturer: k.manufacturer,
  model: kind === "pe_bar" ? "PE-6" : "N-6",
  price_grosze: 990,
  width_mm: 18,
  height_mm: 15,
  depth_mm: 20,
  poles: null,
  rated_current_a: null,
  residual_current_ma: null,
  rcd_type: null,
  breaking_capacity_ka: null,
  terminal_groups: BAR_TERMINALS,
  n_terminal_side: null,
}));

export const KS_CATALOG: DeviceSpecWithId[] = activeCatalog([...DEVICE_ROWS, ...BAR_ROWS]);

/** The catalog with its N bar archived: a cabinet without built-in bars then has a bar catalog gap. */
const KS_CATALOG_WITHOUT_N_BAR: DeviceSpecWithId[] = KS_CATALOG.filter((device) => device.kind !== "n_bar");

const PRICIER_B16_ID = uuid(1, 6);

// ——— Supply and cabinet ———

const SUPPLY_TN_C_S: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-C-S",
  phase_count: 1,
  wlz_length_m: 12,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

const SUPPLY_TN_C: SupplyParams = { ...SUPPLY_TN_C_S, earthing_system: "TN-C" };

export const KS_GEOMETRY: CabinetGeometry = DEMO_CABINET_GEOMETRY;
const GEOMETRY_WITHOUT_BARS: CabinetGeometry = { ...DEMO_CABINET_GEOMETRY, bars: [] };

export const KS_ENTRY_SIDES: readonly EntrySide[] = [...new Set(KS_GEOMETRY.entries.map((entry) => entry.side))];

// ——— Groups and circuits ———

function group(index: number): RcdGroupInput {
  return {
    id: uuid(2, index),
    label: t.circuits.defaultGroupLabel(index),
    residual_current_ma: 30,
    min_rcd_type: "A",
    rcd_margin_percent: DEFAULT_RCD_MARGIN_PERCENT,
  };
}

function circuit(
  index: number,
  groupId: string | null,
  name: string,
  overrides: Partial<Omit<CircuitInput, "id" | "rcd_group_id" | "name">> = {},
): CircuitInput {
  return {
    id: uuid(3, index),
    rcd_group_id: groupId,
    name,
    rated_current_a: 16,
    phase_count: 1,
    cross_section_mm2: 2.5,
    installation: "conduit_flush",
    entry_side: "top",
    ...overrides,
  };
}

const GROUP_1 = group(1);
const GROUP_2 = group(2);

/** Two groups and one ungrouped circuit; group 2 has a single B20 circuit and the catalog no B20 RCBO. */
const FILLED_GROUPS = [GROUP_1, GROUP_2];
const KITCHEN = circuit(1, GROUP_1.id, k.circuits.kitchen);
const FILLED_CIRCUITS = [
  KITCHEN,
  circuit(2, GROUP_1.id, k.circuits.living, { entry_side: "bottom" }),
  circuit(3, GROUP_2.id, k.circuits.bathroom, { rated_current_a: 20 }),
  circuit(4, null, k.circuits.lighting, { rated_current_a: 10, cross_section_mm2: 1.5 }),
];

// ——— Editor states ———

export interface EditorFixture {
  key: string;
  caption: string;
  initial: CircuitDraftState;
  cabinetEntrySides: readonly EntrySide[];
  validateOnMount: boolean;
}

export const KS_EDITOR_STATES: EditorFixture[] = [
  {
    key: "empty",
    caption: k.editorStates.empty,
    initial: payloadToDraft(null),
    cabinetEntrySides: KS_ENTRY_SIDES,
    validateOnMount: false,
  },
  {
    key: "filled",
    caption: k.editorStates.filled,
    initial: payloadToDraft({ groups: FILLED_GROUPS, circuits: FILLED_CIRCUITS }),
    cabinetEntrySides: KS_ENTRY_SIDES,
    validateOnMount: false,
  },
  {
    key: "single",
    caption: k.editorStates.singleCircuitGroup,
    initial: payloadToDraft({ groups: [GROUP_1], circuits: [circuit(1, GROUP_1.id, k.circuits.bathroom)] }),
    cabinetEntrySides: KS_ENTRY_SIDES,
    validateOnMount: false,
  },
  {
    key: "invalid",
    caption: k.editorStates.invalidRow,
    initial: payloadToDraft({
      groups: [GROUP_1],
      circuits: [circuit(1, GROUP_1.id, k.circuits.kitchen), circuit(2, GROUP_1.id, "")],
    }),
    cabinetEntrySides: KS_ENTRY_SIDES,
    validateOnMount: true,
  },
  {
    key: "entry-side",
    caption: k.editorStates.entrySideMissing,
    initial: payloadToDraft({
      groups: [GROUP_1],
      circuits: [
        circuit(1, GROUP_1.id, k.circuits.kitchen),
        circuit(2, GROUP_1.id, k.circuits.heater, { entry_side: "left" }),
      ],
    }),
    cabinetEntrySides: KS_ENTRY_SIDES,
    validateOnMount: false,
  },
];

// ——— Match states ———

/** A `project_devices` snapshot as the RPC would store it: each selection with a copy of its device. */
function snapshotFrom(selections: readonly Selection[]): SnapshotRow[] {
  return selections.map((selection, position) => {
    const device = KS_CATALOG.find((entry) => entry.id === selection.deviceId);
    if (device === undefined) throw new Error(`kitchen-sink fixture: unknown device ${selection.deviceId}`);
    return {
      id: uuid(4, position + 1),
      project_id: KS_PROJECT_ID,
      created_at: "2026-09-29T10:00:00Z",
      position,
      device_id: device.id,
      role: selection.role,
      rcd_group_id: selection.groupId,
      circuit_id: selection.circuitId,
      notes: [...selection.notes],
      kind: device.kind,
      name: device.name,
      manufacturer: device.manufacturer,
      model: device.model,
      price_grosze: device.price_grosze,
      width_mm: device.width_mm,
      height_mm: device.height_mm,
      depth_mm: device.depth_mm,
      poles: device.poles,
      rated_current_a: device.rated_current_a,
      residual_current_ma: device.residual_current_ma,
      rcd_type: device.rcd_type,
      breaking_capacity_ka: device.breaking_capacity_ka,
      n_terminal_side: device.n_terminal_side,
      terminal_groups: device.terminal_groups,
    };
  });
}

function context(overrides: Partial<MatchContext>): MatchContext {
  return {
    supply: SUPPLY_TN_C_S,
    groups: FILLED_GROUPS,
    circuits: FILLED_CIRCUITS,
    geometry: KS_GEOMETRY,
    catalog: KS_CATALOG,
    snapshot: [],
    ...overrides,
  };
}

/** The selections the filled circuits get from the catalog — the base of the stored snapshots. */
function freshSelections(): Selection[] {
  const fresh = computeMatchView(context({})).fresh;
  if (fresh.status !== "matched") throw new Error("kitchen-sink fixture: the filled circuits must match");
  return fresh.selections;
}

/** The stale snapshot: saved while the pricier B16 was the pick for the first circuit. */
function staleSelections(): Selection[] {
  let swapped = false;
  return freshSelections().map((selection) => {
    if (!swapped && selection.role === "mcb" && selection.circuitId === KITCHEN.id) {
      swapped = true;
      return { ...selection, deviceId: PRICIER_B16_ID };
    }
    return selection;
  });
}

export interface MatchFixture {
  key: string;
  caption: string;
  context: MatchContext;
  view: MatchView;
}

function matchFixture(key: string, caption: string, ctx: MatchContext): MatchFixture {
  return { key, caption, context: ctx, view: computeMatchView(ctx) };
}

export function kitchenSinkMatchStates(): MatchFixture[] {
  return [
    matchFixture("matched", k.matchStates.matched, context({ snapshot: snapshotFrom(freshSelections()) })),
    matchFixture(
      "gaps",
      k.matchStates.gaps,
      context({
        groups: [GROUP_1, GROUP_2],
        circuits: [
          circuit(1, GROUP_1.id, k.circuits.kitchen),
          circuit(2, GROUP_1.id, k.circuits.living),
          circuit(3, GROUP_2.id, k.circuits.oven, { rated_current_a: 32, cross_section_mm2: 6 }),
        ],
      }),
    ),
    matchFixture("supply", k.matchStates.blockedSupply, context({ supply: null })),
    matchFixture("tn-c", k.matchStates.blockedTnC, context({ supply: SUPPLY_TN_C })),
    matchFixture("stale", k.matchStates.stale, context({ snapshot: snapshotFrom(staleSelections()) })),
    matchFixture(
      "warnings",
      k.matchStates.warnings,
      context({
        groups: [GROUP_1],
        circuits: [
          circuit(1, GROUP_1.id, k.circuits.kitchen),
          circuit(2, GROUP_1.id, k.circuits.heater, {
            rated_current_a: 25,
            cross_section_mm2: 1.5,
            entry_side: "left",
          }),
        ],
        geometry: GEOMETRY_WITHOUT_BARS,
      }),
    ),
    matchFixture(
      "bar-gap",
      k.matchStates.barGap,
      context({ geometry: GEOMETRY_WITHOUT_BARS, catalog: KS_CATALOG_WITHOUT_N_BAR }),
    ),
  ];
}

// ——— Layout states ———

export interface LayoutFixture {
  key: string;
  caption: string;
  view: LayoutView | null;
  devices: DrawnDevice[];
  wires: DrawnWire[];
  cables: DrawnCable[];
  lengths: WireLengthRow[];
  geometry: CabinetGeometry;
  /** What the editor island is mounted with; null unless the layout is `placed`. */
  editor: LayoutEditorData | null;
}

/** What a layout fixture adds on top of its stored layout (S-06). */
interface LayoutFixtureOptions {
  /** The stored layout carries the "edited manually" marker. */
  editedManually?: boolean;
  /** The editor starts from an unsaved draft: the main switch moved by the real move operation. */
  moved?: boolean;
}

/** One 100 mm rail: far too short for the filled circuits' devices. */
const GEOMETRY_TOO_SMALL = parseFixtureGeometry({
  version: 1,
  interior: { widthMm: 200, heightMm: 250, depthMm: 90 },
  rails: [{ xMm: 20, yMm: 100, lengthMm: 100 }],
  entries: [{ side: "top", offsetMm: 20, lengthMm: 160 }],
  bars: [],
});

/** TN-C forbids RCDs, so its circuits are all ungrouped; one comes in from the bottom. */
const TN_C_OVERRIDES: Partial<MatchContext> = {
  supply: SUPPLY_TN_C,
  groups: [],
  circuits: [
    circuit(1, null, k.circuits.kitchen),
    circuit(2, null, k.circuits.living, { entry_side: "bottom" }),
    circuit(4, null, k.circuits.lighting, { rated_current_a: 10, cross_section_mm2: 1.5 }),
  ],
};

function matchedSelections(ctx: MatchContext): Selection[] {
  const fresh = computeMatchView(ctx).fresh;
  if (fresh.status !== "matched") throw new Error("kitchen-sink fixture: the layout circuits must match");
  return fresh.selections;
}

function layoutFixture(
  key: string,
  caption: string,
  geometry: CabinetGeometry,
  stored: "none" | "proposal" | "broken",
  overrides: Partial<MatchContext> = {},
  snapshotRows?: SnapshotRow[],
  options: LayoutFixtureOptions = {},
): LayoutFixture {
  const base = context({ geometry, ...overrides });
  const ctx = { ...base, snapshot: snapshotRows ?? snapshotFrom(matchedSelections(base)) };
  const matchView = computeMatchView(ctx);
  const empty = computeLayoutView(matchView, ctx, []);
  const proposal = empty?.state === "missing" ? empty.proposal : [];
  const placements =
    stored === "none"
      ? []
      : stored === "proposal"
        ? proposal
        : proposal.map((placement, index) =>
            index === 1 ? { ...placement, railIndex: proposal[0].railIndex, xMm: proposal[0].xMm } : placement,
          );
  const view = computeLayoutView(matchView, ctx, placements, options.editedManually ?? false);
  const devices =
    view?.state === "placed" ? buildDrawnDevices(matchView.snapshot, view.placements, geometry, ctx.groups) : [];
  const conductors = computeWiring(view, matchView, ctx);
  return {
    key,
    caption,
    view,
    devices,
    wires: buildDrawnWires(conductors, {
      circuits: new Map(ctx.circuits.map((circuit) => [circuit.id, circuit.name])),
      devices,
    }),
    cables: buildDrawnCables(conductors),
    lengths: wireLengthsBySection(conductors),
    geometry,
    editor:
      view?.state === "placed"
        ? {
            devices: toEditorDevices(matchView.snapshot),
            groups: ctx.groups.map(({ id, label }) => ({ id, label })),
            placements: view.placements,
            names: layoutIssueNames(matchView.snapshot, ctx.groups, ctx.circuits),
            initialDraft: options.moved
              ? movedMainSwitch(toEditorDevices(matchView.snapshot), geometry, ctx.groups, view.placements)
              : undefined,
          }
        : null,
  };
}

/**
 * The stored layout with the main switch moved by `moveDevice` — the first rail end that accepts it, so the
 * kitchen sink's unsaved state is a draft the editor itself could have produced. Unchanged when no end does.
 */
function movedMainSwitch(
  devices: ReturnType<typeof toEditorDevices>,
  geometry: CabinetGeometry,
  groups: readonly Pick<RcdGroupInput, "id">[],
  placements: readonly Placement[],
): Placement[] {
  const unit = editUnits(devices, groups).find(
    (candidate) => candidate.kind === "device" && candidate.groupId === null,
  );
  const device = unit?.kind === "device" ? devices.find((candidate) => candidate.id === unit.deviceId) : undefined;
  const draft: LayoutDraft = { placements: [...placements] };
  if (device === undefined) return draft.placements;
  for (const [railIndex, rail] of [...geometry.rails.entries()].reverse()) {
    for (const xMm of [snapX(rail, rail.lengthMm, device.width_mm), 0]) {
      const result = moveDevice({ devices, geometry, groups }, draft, device.id, { railIndex, xMm });
      if (result.ok && JSON.stringify(result.draft) !== JSON.stringify(draft)) return result.draft.placements;
    }
  }
  return draft.placements;
}

/**
 * The landing page's hero layout: the filled circuits (two RCD groups and one ungrouped circuit,
 * single-phase TN-C-S) matched by the real matcher, placed by `proposeLayout` in the small hero cabinet and
 * wired by the real router. Computed once per Worker isolate: the hero shows everyone the same sheet
 * and the Worker's CPU budget is small.
 */
let landingLayout: LayoutFixture | undefined;
export function landingLayoutFixture(): LayoutFixture {
  landingLayout ??= layoutFixture("landing", "", HERO_CABINET_GEOMETRY, "proposal");
  return landingLayout;
}

/**
 * Every layout state, each from the real `computeLayoutView`: a proposal is computed from an empty
 * placement set and then fed back as the stored layout to reach `placed`; `outdated` stores that
 * proposal with the second device moved onto the first. A `placed` state carries its real wiring.
 */
export function kitchenSinkLayoutStates(): LayoutFixture[] {
  const l = t.devTools.kitchenSink.layoutStates;
  return [
    layoutFixture("placed-b", l.placedMedium, SEED_B, "proposal"),
    layoutFixture("placed-c", l.placedLarge, SEED_C, "proposal"),
    layoutFixture("placed-tn-c", l.placedTnC, SEED_B, "proposal", TN_C_OVERRIDES),
    layoutFixture("placed-no-bars", l.placedNoBars, SEED_A, "proposal"),
    layoutFixture("placed-manual", l.editorManual, SEED_B, "proposal", {}, undefined, { editedManually: true }),
    layoutFixture("placed-dirty", l.editorDirty, SEED_B, "proposal", {}, undefined, { moved: true }),
    layoutFixture("missing", l.missing, SEED_B, "none"),
    layoutFixture("does-not-fit", l.doesNotFit, GEOMETRY_TOO_SMALL, "none"),
    layoutFixture("outdated", l.outdated, SEED_B, "broken"),
    layoutFixture("not-current", l.notCurrent, SEED_B, "none", {}, snapshotFrom(staleSelections())),
  ];
}

// ——— Quote states ———

export interface QuoteFixture {
  key: string;
  caption: string;
  view: QuoteView;
}

const KS_PROFILE: PricingProfile = {
  hourly_rate_grosze: 12_050,
  mount_minutes_per_device: 15,
  project_overhead_minutes: 90,
};

const KS_QUOTE_CABINET = { name: k.cabinet, priceGrosze: 24_999 };

/** The labour time the override fixtures hold: 4 h 30 min. */
const KS_OVERRIDE_MINUTES = 270;

/**
 * Every quote state, each from the real `computeQuoteView` over the match fixtures: a current match for
 * the ready states, the stale snapshot for `not_current`, and a cabinet without built-in bars for the
 * catalog-bar line. The outdated override is stored against an estimate one minute off.
 */
export function kitchenSinkQuoteStates(): QuoteFixture[] {
  const s = t.devTools.kitchenSink.quoteStates;
  const current = computeMatchView(context({ snapshot: snapshotFrom(freshSelections()) }));
  const stale = computeMatchView(context({ snapshot: snapshotFrom(staleSelections()) }));
  const noBarsContext = context({ geometry: GEOMETRY_WITHOUT_BARS });
  const noBars = computeMatchView({ ...noBarsContext, snapshot: snapshotFrom(matchedSelections(noBarsContext)) });

  const fixture = (
    key: string,
    caption: string,
    matchView: MatchView,
    profile: PricingProfile | null,
    override: { minutes: number; baseMinutes: number } | null = null,
  ): QuoteFixture => ({
    key,
    caption,
    view: computeQuoteView({ matchView, cabinet: KS_QUOTE_CABINET, profile, override }),
  });

  const estimate = estimateLabourMinutes(current.snapshot.length, KS_PROFILE);
  return [
    fixture("no-profile", s.noProfile, current, null),
    fixture("not-current", s.notCurrent, stale, KS_PROFILE),
    fixture("ready", s.ready, current, KS_PROFILE),
    fixture("override", s.override, current, KS_PROFILE, { minutes: KS_OVERRIDE_MINUTES, baseMinutes: estimate }),
    fixture("outdated", s.outdated, current, KS_PROFILE, {
      minutes: KS_OVERRIDE_MINUTES,
      baseMinutes: estimate - 1,
    }),
    fixture("rate-warning", s.rateWarning, current, { ...KS_PROFILE, hourly_rate_grosze: 60_000 }),
    fixture("catalog-bars", s.catalogBars, noBars, KS_PROFILE),
  ];
}

// ——— Printout states ———

type ReadyPrintView = Extract<PrintView, { state: "ready" }>;

export interface PrintFixture {
  key: string;
  caption: string;
  view: ReadyPrintView;
  /** A wrapper class for the document: `grayscale` for the black-and-white check. */
  className?: string;
}

export interface PrintStates {
  geometry: CabinetGeometry;
  drawing: LayoutDrawing;
  project: {
    name: string;
    client_name: string | null;
    site_address: string | null;
    cabinet_name: string;
    cabinet_manufacturer: string;
    cabinet_model: string;
  };
  issuedAt: Date;
  documents: PrintFixture[];
  /** Every reason the print can be blocked, each from a real blocked `computePrintView`. */
  blockedReasons: PrintBlockReason[];
}

const KS_BUSINESS: BusinessProfile = {
  company_name: "Instalacje Elektryczne Jan Kowalski",
  nip: "1234563218",
  address: "ul. Przykładowa 12\n00-001 Warszawa",
  phone: "+48 600 100 200",
  email: "biuro@przyklad.pl",
};

/**
 * The printed quote's states, each through the real `computePrintView`: one current match, its placed
 * layout (SEED_B, wired by the real router) and quote feed the full letterhead, the fallback letterhead
 * (no company row, an outdated override and a high rate to raise screen notices) and the greyscale
 * check. The blocked reasons come from a view with no profile (also an unplaced layout) and one with a
 * stale match.
 */
export function kitchenSinkPrintStates(): PrintStates {
  const p = t.devTools.kitchenSink.printStates;
  const base = context({ geometry: SEED_B });
  const ctx = { ...base, snapshot: snapshotFrom(matchedSelections(base)) };
  const matchView = computeMatchView(ctx);
  const proposal = computeLayoutView(matchView, ctx, []);
  const placements = proposal?.state === "missing" ? proposal.proposal : [];
  const layout = computeLayoutView(matchView, ctx, placements);
  const drawing = buildLayoutDrawing(layout, matchView, ctx);
  const estimate = estimateLabourMinutes(matchView.snapshot.length, KS_PROFILE);

  const print = (
    profile: PricingProfile | null,
    options: {
      layout?: LayoutView | null;
      match?: MatchView;
      business?: BusinessProfile | null;
      override?: { minutes: number; baseMinutes: number } | null;
    } = {},
  ): PrintView => {
    const match = options.match ?? matchView;
    return computePrintView({
      quote: computeQuoteView({
        matchView: match,
        cabinet: KS_QUOTE_CABINET,
        profile,
        override: options.override ?? null,
      }),
      matchCurrent: match.state === "current",
      layout: options.layout === undefined ? layout : options.layout,
      snapshot: match.snapshot,
      business: options.business === undefined ? KS_BUSINESS : options.business,
      fullName: "Jan Kowalski",
      userEmail: "jan@przyklad.pl",
    });
  };
  const ready = (view: PrintView): ReadyPrintView => {
    if (view.state !== "ready") throw new Error("kitchen-sink fixture: the print view must be ready");
    return view;
  };

  const full = ready(print(KS_PROFILE));
  const fallback = ready(
    print(
      { ...KS_PROFILE, hourly_rate_grosze: 60_000 },
      { business: null, override: { minutes: KS_OVERRIDE_MINUTES, baseMinutes: estimate - 1 } },
    ),
  );
  const staleMatch = computeMatchView({ ...ctx, snapshot: snapshotFrom(staleSelections()) });
  const blocked = [print(null, { layout: null }), print(KS_PROFILE, { match: staleMatch, layout: null })].flatMap(
    (view) => (view.state === "blocked" ? view.reasons : []),
  );

  return {
    geometry: SEED_B,
    drawing,
    project: {
      name: "Dom Kowalskich",
      client_name: "Anna i Piotr Kowalscy",
      site_address: "ul. Leśna 5, 05-500 Piaseczno",
      cabinet_name: KS_QUOTE_CABINET.name,
      cabinet_manufacturer: k.manufacturer,
      cabinet_model: "KS-1",
    },
    issuedAt: new Date("2026-10-08T12:00:00Z"),
    documents: [
      { key: "full", caption: p.full, view: full },
      { key: "fallback", caption: p.fallback, view: fallback },
      { key: "grayscale", caption: p.grayscale, view: full, className: "grayscale" },
    ],
    blockedReasons: [...new Set(blocked)],
  };
}

// ——— Editor interaction states ———

export interface EditorDrawingFixture {
  key: string;
  caption: string;
  geometry: CabinetGeometry;
  devices: DrawnDevice[];
  selectedId: string | null;
  liftedIds: string[];
  refusedIds: string[];
}

/**
 * The drawing's transient editor states — a focused device, a lifted one, a lifted one whose drop was
 * refused — on the first placed layout's real devices. They have no island of their own to reach them
 * without a pointer, so the kitchen sink draws them from the drawing's own interaction props.
 */
export function kitchenSinkEditorDrawings(states: readonly LayoutFixture[]): EditorDrawingFixture[] {
  const l = t.devTools.kitchenSink.layoutStates;
  const base = states.find((state) => state.view?.state === "placed");
  if (base === undefined) return [];
  const mcbs = base.devices.filter((device) => device.role === "mcb");
  const first = mcbs.at(0)?.id ?? null;
  const second = mcbs.at(1)?.id ?? null;
  const drawing = (key: string, caption: string, fields: Partial<EditorDrawingFixture>): EditorDrawingFixture => ({
    key,
    caption,
    geometry: base.geometry,
    devices: base.devices,
    selectedId: null,
    liftedIds: [],
    refusedIds: [],
    ...fields,
  });
  return [
    drawing("selected", l.editorSelected, { selectedId: first }),
    drawing("lifted", l.editorLifted, { liftedIds: second === null ? [] : [second] }),
    drawing("refused", l.editorRefused, {
      liftedIds: second === null ? [] : [second],
      refusedIds: second === null ? [] : [second],
    }),
  ];
}
