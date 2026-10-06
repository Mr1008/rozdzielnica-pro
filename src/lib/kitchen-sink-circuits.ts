import { buildDrawnDevices, type DrawnDevice } from "@/lib/cabinet-drawing";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
import { SEED_B, SEED_C, geometry as parseFixtureGeometry } from "@/lib/cabinet-layout.fixtures";
import { payloadToDraft, type CircuitDraftState } from "@/lib/circuit-draft";
import {
  DEFAULT_RCD_MARGIN_PERCENT,
  type CircuitInput,
  type EntrySide,
  type RcdGroupInput,
} from "@/lib/circuit-params";
import { DEMO_CABINET_GEOMETRY } from "@/lib/demo-cabinet";
import { computeMatchView, type MatchContext, type MatchView, type SnapshotRow } from "@/lib/device-matching-server";
import { activeCatalog, type DeviceSpecWithId, type Selection } from "@/lib/device-matching";
import { deviceKindLabel, type DeviceKind, type NTerminalSide } from "@/lib/device-spec";
import { t } from "@/lib/i18n";
import { computeLayoutView, type LayoutView } from "@/lib/layout-server";
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
];

/** Raw `devices`-shaped rows, run through `activeCatalog` like the page's own load. */
const CATALOG_ROWS = DEVICE_FIXTURES.map((device, index) => ({
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

export const KS_CATALOG: DeviceSpecWithId[] = activeCatalog(CATALOG_ROWS);

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
  ];
}

// ——— Layout states ———

export interface LayoutFixture {
  key: string;
  caption: string;
  view: LayoutView | null;
  devices: DrawnDevice[];
  geometry: CabinetGeometry;
}

/** One 100 mm rail: far too short for the filled circuits' devices. */
const GEOMETRY_TOO_SMALL = parseFixtureGeometry({
  version: 1,
  interior: { widthMm: 200, heightMm: 250, depthMm: 90 },
  rails: [{ xMm: 20, yMm: 100, lengthMm: 100 }],
  entries: [{ side: "top", offsetMm: 20, lengthMm: 160 }],
  bars: [],
});

/**
 * Every layout state, each from the real `computeLayoutView`: a proposal is computed from an empty
 * placement set and then fed back as the stored layout to reach `placed`; `outdated` stores that
 * proposal with the second device moved onto the first.
 */
export function kitchenSinkLayoutStates(): LayoutFixture[] {
  const snapshot = snapshotFrom(freshSelections());
  const fixture = (
    key: string,
    caption: string,
    geometry: CabinetGeometry,
    stored: "none" | "proposal" | "broken",
    snapshotRows = snapshot,
  ): LayoutFixture => {
    const ctx = context({ geometry, snapshot: snapshotRows });
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
    const view = computeLayoutView(matchView, ctx, placements);
    const devices =
      view?.state === "placed" ? buildDrawnDevices(matchView.snapshot, view.placements, geometry, ctx.groups) : [];
    return { key, caption, view, devices, geometry };
  };
  const l = t.devTools.kitchenSink.layoutStates;
  return [
    fixture("placed-b", l.placedMedium, SEED_B, "proposal"),
    fixture("placed-c", l.placedLarge, SEED_C, "proposal"),
    fixture("missing", l.missing, SEED_B, "none"),
    fixture("does-not-fit", l.doesNotFit, GEOMETRY_TOO_SMALL, "none"),
    fixture("outdated", l.outdated, SEED_B, "broken"),
    fixture("not-current", l.notCurrent, SEED_B, "none", snapshotFrom(staleSelections())),
  ];
}
