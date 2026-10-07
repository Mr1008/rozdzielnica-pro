import { BAR_KINDS_IN_ORDER, barConductorSections, terminalsFitAll, type BarKind } from "@/lib/bar-conductors";
import { isUuid } from "@/lib/catalog";
import type { CircuitInput, RcdGroupInput, RcdMarginPercent, ResidualCurrentMa } from "@/lib/circuit-params";
import { parseDeviceSpec, type DeviceKind, type DeviceSpec, type PoleConfig, type RcdType } from "@/lib/device-spec";
import { t } from "@/lib/i18n";
import type { SupplyParams } from "@/lib/supply-params";

/**
 * The device matcher (FR-007) — the product's guardrail. A pure function: given the supply, the RCD
 * groups and the circuits, it picks one catalog device per role, or reports exactly which devices the
 * catalog lacks. It never proposes a device that fails a circuit's parameters:
 *
 * 1. the correctness filter runs FIRST, and only compliant devices are ever sorted;
 * 2. "cheapest" is chosen among the compliant ones only;
 * 3. no compliant device is a catalog gap — reported, never answered with a nearby rating.
 *
 * The result is all-or-nothing: a partial selection is never returned as `matched`, because a quote
 * over a partial set would understate the job.
 *
 * Rules per role (from the plan's rule table):
 * - main switch: `switch_disconnector`, In ≥ pre-meter protection; poles 2P single-phase (1P in
 *   TN-C), 4P three-phase (3P in TN-C);
 * - MCB: `mcb_b`, In = circuit In exactly; poles {1P, 1P+N, 2P} single-phase, {3P, 3P+N, 4P}
 *   three-phase, only 1P / 3P in TN-C (the PEN is never switched);
 * - group RCD (≥ 2 circuits, and the RCD of an RCBO fallback): `rcd`, In ≥ the sum of the group's
 *   circuit In × (100 + the group's `rcd_margin_percent`) / 100, IΔn exact, type rank ≥ the group
 *   minimum; 4P when any circuit is three-phase, else {2P, 4P}. The sum ignores how single-phase
 *   circuits spread across phases — it errs on the high side;
 * - single-circuit group: `rcbo`, In exact, IΔn exact, type rank ≥ minimum; poles {1P+N, 2P} or
 *   {3P+N, 4P}. With no compliant RCBO, a compliant RCD + MCB pair (note `rcbo_fallback`);
 * - ungrouped circuit: MCB as above, note `no_rcd`;
 * - PE / N bar (plan Phase 5b), only for a bar kind the cabinet snapshot lacks (`cabinetBarKinds`):
 *   `pe_bar` / `n_bar` whose terminal groups give every conductor landing on that kind a fitting
 *   terminal (`barConductorSections` in `src/lib/bar-conductors.ts`, the count the bar warnings use).
 *   TN-C lands no conductor on an N bar, so it needs only the PE bar.
 *
 * An empty group (0 circuits) is skipped: it protects nothing, so it needs no RCD and yields no
 * selection. Kinds are filtered strictly — an FR is a plain switch-disconnector and is never used
 * as overcurrent or residual-current protection.
 */

export type DeviceSpecWithId = DeviceSpec & { id: string };

export interface MatchInput {
  supply: SupplyParams | null;
  groups: readonly RcdGroupInput[];
  circuits: readonly CircuitInput[];
  /**
   * The bar kinds built into the project's cabinet snapshot (`builtInBarKinds`); a kind missing here
   * is matched from the catalog. Absent or null means the cabinet is unknown (its snapshot does not
   * parse): no bar is required — nothing is invented for a cabinet the matcher cannot see.
   */
  cabinetBarKinds?: readonly BarKind[] | null;
}

export type SelectionRole = "main_switch" | "rcd" | "rcbo" | "mcb" | "pe_bar" | "n_bar";

/** Every selection role — the list a stored role is checked against. */
export const SELECTION_ROLES = [
  "main_switch",
  "rcd",
  "rcbo",
  "mcb",
  "pe_bar",
  "n_bar",
] as const satisfies readonly SelectionRole[];

/** The selection role — equal to the catalog kind — of each bar kind. */
export const BAR_ROLE = { PE: "pe_bar", N: "n_bar" } as const satisfies Record<BarKind, SelectionRole & DeviceKind>;
export type SelectionNote = "rcbo_fallback" | "no_rcd";

export interface Selection {
  role: SelectionRole;
  deviceId: string;
  groupId: string | null;
  circuitId: string | null;
  notes: SelectionNote[];
}

export type BlockReason =
  | { code: "supply_missing" }
  | { code: "no_circuits" }
  | { code: "tn_c_with_rcd" }
  | { code: "circuit_phase_exceeds_supply"; circuitId: string; circuitName: string }
  | { code: "circuit_group_unknown"; circuitId: string; circuitName: string };

export type BlockReasonCode = BlockReason["code"];

/**
 * One device the catalog lacks, with the exact requirement that nothing met. `poles` is the allowed
 * set; `fallback` marks an RCD or MCB that is part of the RCD + MCB alternative to a missing RCBO.
 */
export type CatalogGap =
  | { role: "main_switch"; kind: "switch_disconnector"; poles: readonly PoleConfig[]; minRatedCurrentA: number }
  | {
      role: "rcd";
      kind: "rcd";
      poles: readonly PoleConfig[];
      /** `circuitsSumA` × (100 + `marginPercent`) / 100 — not necessarily a whole number. */
      minRatedCurrentA: number;
      circuitsSumA: number;
      marginPercent: RcdMarginPercent;
      residualCurrentMa: ResidualCurrentMa;
      minRcdType: RcdType;
      groupId: string;
      groupLabel: string;
      fallback: boolean;
    }
  | {
      role: "rcbo";
      kind: "rcbo";
      poles: readonly PoleConfig[];
      ratedCurrentA: number;
      residualCurrentMa: ResidualCurrentMa;
      minRcdType: RcdType;
      groupId: string;
      groupLabel: string;
      circuitId: string;
      circuitName: string;
    }
  | {
      role: "mcb";
      kind: "mcb_b";
      poles: readonly PoleConfig[];
      ratedCurrentA: number;
      groupId: string | null;
      circuitId: string;
      circuitName: string;
      fallback: boolean;
    }
  | {
      role: "pe_bar" | "n_bar";
      kind: "pe_bar" | "n_bar";
      barKind: BarKind;
      /** One entry per conductor that lands on the bar: its cross-section, ascending. */
      sections: readonly number[];
    };

export type MatchResult =
  | { status: "blocked"; reasons: BlockReason[] }
  | { status: "gaps"; gaps: CatalogGap[] }
  | { status: "matched"; selections: Selection[] };

const RCD_TYPE_RANK: Record<RcdType, number> = { AC: 0, A: 1, F: 2, B: 3 };

/** AC < A < F < B: a device of a higher rank covers every fault current a lower one does. */
export function rcdTypeRank(type: RcdType): number {
  return RCD_TYPE_RANK[type];
}

/**
 * The active, well-formed catalog: rows with a non-null `archived_at`, a missing or non-UUID `id`,
 * or a spec that fails `parseDeviceSpec` are dropped — never repaired or guessed.
 */
export function activeCatalog(rows: readonly unknown[]): DeviceSpecWithId[] {
  const result: DeviceSpecWithId[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    const record = row as Record<string, unknown>;
    if (record.archived_at !== null && record.archived_at !== undefined) continue;
    if (!isUuid(record.id)) continue;
    const parsed = parseDeviceSpec(record);
    if (!parsed.ok) continue;
    result.push({ ...parsed.spec, id: record.id });
  }
  return result;
}

/** Code-unit comparison: locale-independent, so the order is the same on every runtime. */
function compareText(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The cheapest of the already-compliant candidates. Ties on price go to manufacturer, then model,
 * then id — a deterministic but deliberately arbitrary order: equal-priced compliant devices are
 * interchangeable, and the only requirement is that the same catalog always yields the same pick.
 */
function cheapest<T extends DeviceSpecWithId>(candidates: readonly T[]): T | null {
  const sorted = [...candidates].sort(
    (a, b) =>
      a.price_grosze - b.price_grosze ||
      compareText(a.manufacturer, b.manufacturer) ||
      compareText(a.model, b.model) ||
      compareText(a.id, b.id),
  );
  return sorted.at(0) ?? null;
}

type OfKind<K extends DeviceKind> = Extract<DeviceSpecWithId, { kind: K }>;

function ofKind<K extends DeviceKind>(catalog: readonly DeviceSpecWithId[], kind: K): OfKind<K>[] {
  return catalog.filter((device): device is OfKind<K> => device.kind === kind);
}

function mainSwitchPoles(supply: SupplyParams): readonly PoleConfig[] {
  const tnC = supply.earthing_system === "TN-C";
  if (supply.phase_count === 1) return tnC ? ["1P"] : ["2P"];
  return tnC ? ["3P"] : ["4P"];
}

function mcbPoles(circuit: CircuitInput, supply: SupplyParams): readonly PoleConfig[] {
  const tnC = supply.earthing_system === "TN-C";
  if (circuit.phase_count === 1) return tnC ? ["1P"] : ["1P", "1P+N", "2P"];
  return tnC ? ["3P"] : ["3P", "3P+N", "4P"];
}

function rcdPoles(circuits: readonly CircuitInput[]): readonly PoleConfig[] {
  return circuits.some((circuit) => circuit.phase_count === 3) ? ["4P"] : ["2P", "4P"];
}

function rcboPoles(circuit: CircuitInput): readonly PoleConfig[] {
  return circuit.phase_count === 1 ? ["1P+N", "2P"] : ["3P+N", "4P"];
}

function polesAllowed(poles: PoleConfig, allowed: readonly PoleConfig[]): boolean {
  return allowed.includes(poles);
}

function matchMcb(
  catalog: readonly DeviceSpecWithId[],
  circuit: CircuitInput,
  supply: SupplyParams,
): { device: OfKind<"mcb_b"> | null; poles: readonly PoleConfig[] } {
  const poles = mcbPoles(circuit, supply);
  const device = cheapest(
    ofKind(catalog, "mcb_b").filter(
      (mcb) => mcb.rated_current_a === circuit.rated_current_a && polesAllowed(mcb.poles, poles),
    ),
  );
  return { device, poles };
}

function matchRcd(
  catalog: readonly DeviceSpecWithId[],
  group: RcdGroupInput,
  circuits: readonly CircuitInput[],
): {
  device: OfKind<"rcd"> | null;
  poles: readonly PoleConfig[];
  minRatedCurrentA: number;
  circuitsSumA: number;
} {
  const poles = rcdPoles(circuits);
  // The RCD carries the whole group's load plus the electrician's safety margin. Compared in
  // integers (In × 100 ≥ ΣIn × (100 + margin)), so no float rounding can let an under-rated RCD in.
  const circuitsSumA = circuits.reduce((sum, circuit) => sum + circuit.rated_current_a, 0);
  const requiredTimes100 = circuitsSumA * (100 + group.rcd_margin_percent);
  const minRank = rcdTypeRank(group.min_rcd_type);
  const device = cheapest(
    ofKind(catalog, "rcd").filter(
      (rcd) =>
        rcd.rated_current_a * 100 >= requiredTimes100 &&
        rcd.residual_current_ma === group.residual_current_ma &&
        rcdTypeRank(rcd.rcd_type) >= minRank &&
        polesAllowed(rcd.poles, poles),
    ),
  );
  return { device, poles, minRatedCurrentA: requiredTimes100 / 100, circuitsSumA };
}

function matchRcbo(
  catalog: readonly DeviceSpecWithId[],
  group: RcdGroupInput,
  circuit: CircuitInput,
): { device: OfKind<"rcbo"> | null; poles: readonly PoleConfig[] } {
  const poles = rcboPoles(circuit);
  const minRank = rcdTypeRank(group.min_rcd_type);
  const device = cheapest(
    ofKind(catalog, "rcbo").filter(
      (rcbo) =>
        rcbo.rated_current_a === circuit.rated_current_a &&
        rcbo.residual_current_ma === group.residual_current_ma &&
        rcdTypeRank(rcbo.rcd_type) >= minRank &&
        polesAllowed(rcbo.poles, poles),
    ),
  );
  return { device, poles };
}

function blockReasons(input: MatchInput): BlockReason[] {
  const reasons: BlockReason[] = [];
  const { supply, groups, circuits } = input;
  const groupIds = new Set(groups.map((group) => group.id));

  if (supply === null) reasons.push({ code: "supply_missing" });
  if (circuits.length === 0) reasons.push({ code: "no_circuits" });

  // A circuit pointing at a group that does not exist would otherwise be matched as ungrouped —
  // silently dropping its residual-current protection. Blocked instead.
  for (const circuit of circuits) {
    if (circuit.rcd_group_id !== null && !groupIds.has(circuit.rcd_group_id)) {
      reasons.push({ code: "circuit_group_unknown", circuitId: circuit.id, circuitName: circuit.name });
    }
  }

  // `supply_missing` short-circuits every supply-dependent check.
  if (supply !== null) {
    const anyGroupUsed = circuits.some(
      (circuit) => circuit.rcd_group_id !== null && groupIds.has(circuit.rcd_group_id),
    );
    if (supply.earthing_system === "TN-C" && anyGroupUsed) reasons.push({ code: "tn_c_with_rcd" });
    if (supply.phase_count === 1) {
      for (const circuit of circuits) {
        if (circuit.phase_count === 3) {
          reasons.push({ code: "circuit_phase_exceeds_supply", circuitId: circuit.id, circuitName: circuit.name });
        }
      }
    }
  }
  return reasons;
}

/**
 * The guardrail. Blocked when a precondition fails (no matching is attempted); otherwise every role
 * is matched, and a single missing device turns the whole result into `gaps` listing every one.
 */
export function matchDevices(input: MatchInput, catalog: readonly DeviceSpecWithId[]): MatchResult {
  const reasons = blockReasons(input);
  const supply = input.supply;
  if (reasons.length > 0 || supply === null) {
    return { status: "blocked", reasons: reasons.length > 0 ? reasons : [{ code: "supply_missing" }] };
  }

  const selections: Selection[] = [];
  const gaps: CatalogGap[] = [];

  const mainPoles = mainSwitchPoles(supply);
  const mainSwitch = cheapest(
    ofKind(catalog, "switch_disconnector").filter(
      (fr) => fr.rated_current_a >= supply.premeter_protection_a && polesAllowed(fr.poles, mainPoles),
    ),
  );
  if (mainSwitch === null) {
    gaps.push({
      role: "main_switch",
      kind: "switch_disconnector",
      poles: mainPoles,
      minRatedCurrentA: supply.premeter_protection_a,
    });
  } else {
    selections.push({ role: "main_switch", deviceId: mainSwitch.id, groupId: null, circuitId: null, notes: [] });
  }

  const pushMcb = (circuit: CircuitInput, groupId: string | null, notes: SelectionNote[], fallback: boolean) => {
    const { device, poles } = matchMcb(catalog, circuit, supply);
    if (device === null) {
      gaps.push({
        role: "mcb",
        kind: "mcb_b",
        poles,
        ratedCurrentA: circuit.rated_current_a,
        groupId,
        circuitId: circuit.id,
        circuitName: circuit.name,
        fallback,
      });
    } else {
      selections.push({ role: "mcb", deviceId: device.id, groupId, circuitId: circuit.id, notes });
    }
  };

  for (const group of input.groups) {
    const members = input.circuits.filter((circuit) => circuit.rcd_group_id === group.id);
    if (members.length === 0) continue; // An empty group protects nothing and needs no device.

    const single = members.length === 1 ? members[0] : undefined;
    if (single !== undefined) {
      const rcbo = matchRcbo(catalog, group, single);
      if (rcbo.device !== null) {
        selections.push({ role: "rcbo", deviceId: rcbo.device.id, groupId: group.id, circuitId: single.id, notes: [] });
        continue;
      }
      // No compliant RCBO: try the RCD + MCB pair, which gives the same protection in two devices.
      // Only if the pair fails too is it a gap — and then the RCBO gap is reported alongside every
      // failing part of the pair (flagged `fallback`), so the admin sees both ways to close it.
      const rcd = matchRcd(catalog, group, members);
      const mcb = matchMcb(catalog, single, supply);
      if (rcd.device !== null && mcb.device !== null) {
        selections.push({
          role: "rcd",
          deviceId: rcd.device.id,
          groupId: group.id,
          circuitId: null,
          notes: ["rcbo_fallback"],
        });
        selections.push({
          role: "mcb",
          deviceId: mcb.device.id,
          groupId: group.id,
          circuitId: single.id,
          notes: ["rcbo_fallback"],
        });
        continue;
      }
      gaps.push({
        role: "rcbo",
        kind: "rcbo",
        poles: rcbo.poles,
        ratedCurrentA: single.rated_current_a,
        residualCurrentMa: group.residual_current_ma,
        minRcdType: group.min_rcd_type,
        groupId: group.id,
        groupLabel: group.label,
        circuitId: single.id,
        circuitName: single.name,
      });
      if (rcd.device === null) {
        gaps.push({
          role: "rcd",
          kind: "rcd",
          poles: rcd.poles,
          minRatedCurrentA: rcd.minRatedCurrentA,
          circuitsSumA: rcd.circuitsSumA,
          marginPercent: group.rcd_margin_percent,
          residualCurrentMa: group.residual_current_ma,
          minRcdType: group.min_rcd_type,
          groupId: group.id,
          groupLabel: group.label,
          fallback: true,
        });
      }
      if (mcb.device === null) {
        gaps.push({
          role: "mcb",
          kind: "mcb_b",
          poles: mcb.poles,
          ratedCurrentA: single.rated_current_a,
          groupId: group.id,
          circuitId: single.id,
          circuitName: single.name,
          fallback: true,
        });
      }
      continue;
    }

    const rcd = matchRcd(catalog, group, members);
    if (rcd.device === null) {
      gaps.push({
        role: "rcd",
        kind: "rcd",
        poles: rcd.poles,
        minRatedCurrentA: rcd.minRatedCurrentA,
        circuitsSumA: rcd.circuitsSumA,
        marginPercent: group.rcd_margin_percent,
        residualCurrentMa: group.residual_current_ma,
        minRcdType: group.min_rcd_type,
        groupId: group.id,
        groupLabel: group.label,
        fallback: false,
      });
    } else {
      selections.push({ role: "rcd", deviceId: rcd.device.id, groupId: group.id, circuitId: null, notes: [] });
    }
    for (const circuit of members) pushMcb(circuit, group.id, [], false);
  }

  for (const circuit of input.circuits) {
    if (circuit.rcd_group_id === null) pushMcb(circuit, null, ["no_rcd"], false);
  }

  // A bar kind the cabinet lacks: the cheapest catalog bar whose terminals take every conductor that
  // lands on it — correctness first, like every other role. Never a bar with too few terminals.
  const cabinetBarKinds = input.cabinetBarKinds ?? null;
  if (cabinetBarKinds !== null) {
    for (const barKind of BAR_KINDS_IN_ORDER) {
      if (cabinetBarKinds.includes(barKind)) continue;
      const sections = barConductorSections(barKind, input.circuits, supply).sort((a, b) => a - b);
      if (sections.length === 0) continue;
      const role = BAR_ROLE[barKind];
      const bar = cheapest(
        catalog.filter(
          (device): device is OfKind<"pe_bar" | "n_bar"> =>
            device.kind === role && terminalsFitAll(sections, device.terminal_groups),
        ),
      );
      if (bar === null) gaps.push({ role, kind: role, barKind, sections });
      else selections.push({ role, deviceId: bar.id, groupId: null, circuitId: null, notes: [] });
    }
  }

  if (gaps.length > 0) return { status: "gaps", gaps };
  return { status: "matched", selections };
}

/** The bar kinds a match takes from the catalog — none unless it is `matched`. */
export function matchedBarKinds(result: MatchResult): BarKind[] {
  if (result.status !== "matched") return [];
  return BAR_KINDS_IN_ORDER.filter((kind) => result.selections.some((selection) => selection.role === BAR_ROLE[kind]));
}

/** Two selection lists are the same when they match element by element, in order. */
export function sameSelection(a: readonly Selection[], b: readonly Selection[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((left, i) => {
    // Same length, so `b[i]` exists.
    const right = b[i];
    return (
      left.role === right.role &&
      left.deviceId === right.deviceId &&
      left.groupId === right.groupId &&
      left.circuitId === right.circuitId &&
      left.notes.length === right.notes.length &&
      left.notes.every((note, j) => note === right.notes[j])
    );
  });
}

/** "3 × 2,5 mm², 1 × 10 mm²": the conductors a bar must take, grouped by cross-section. */
function sectionsText(sections: readonly number[]): string {
  const counts = new Map<number, number>();
  for (const section of sections) counts.set(section, (counts.get(section) ?? 0) + 1);
  return [...counts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([section, count]) => t.matching.barSections(count, section))
    .join(t.matching.barSectionsSeparator);
}

function polesText(poles: readonly PoleConfig[]): string {
  return poles.map((pole) => t.devices.poles[pole]).join(t.matching.polesSeparator);
}

/**
 * Polish text for one gap: exactly the device that is missing, what it serves, and the line asking
 * the electrician to contact the admin. It never suggests a substitute device.
 */
export function catalogGapMessage(gap: CatalogGap): string {
  const m = t.matching.gaps;
  let text: string;
  switch (gap.role) {
    case "main_switch":
      text = m.mainSwitch(gap.minRatedCurrentA, polesText(gap.poles));
      break;
    case "rcd":
      text =
        m.rcd(
          gap.minRatedCurrentA,
          gap.circuitsSumA,
          gap.marginPercent,
          gap.residualCurrentMa,
          gap.minRcdType,
          polesText(gap.poles),
          gap.groupLabel,
        ) + (gap.fallback ? m.fallbackSuffix : "");
      break;
    case "rcbo":
      text = m.rcbo(gap.ratedCurrentA, gap.residualCurrentMa, gap.minRcdType, polesText(gap.poles), gap.circuitName);
      break;
    case "mcb":
      text = m.mcb(gap.ratedCurrentA, polesText(gap.poles), gap.circuitName) + (gap.fallback ? m.fallbackSuffix : "");
      break;
    case "pe_bar":
    case "n_bar":
      text = m.bar(gap.barKind, gap.sections.length, sectionsText(gap.sections));
      break;
  }
  return `${text} ${m.contactAdmin}`;
}

/** Polish text for one blocker. The switch is exhaustive over `BlockReasonCode`. */
export function blockReasonMessage(reason: BlockReason): string {
  const m = t.matching.blockReasons;
  switch (reason.code) {
    case "supply_missing":
      return m.supplyMissing;
    case "no_circuits":
      return m.noCircuits;
    case "tn_c_with_rcd":
      return m.tnCWithRcd;
    case "circuit_phase_exceeds_supply":
      return m.circuitPhaseExceedsSupply(reason.circuitName);
    case "circuit_group_unknown":
      return m.circuitGroupUnknown(reason.circuitName);
  }
}

const ROLE_LABEL_KEYS: Record<SelectionRole, keyof typeof t.matching.roles> = {
  main_switch: "mainSwitch",
  rcd: "rcd",
  rcbo: "rcbo",
  mcb: "mcb",
  pe_bar: "peBar",
  n_bar: "nBar",
};

export function selectionRoleLabel(role: SelectionRole): string {
  return t.matching.roles[ROLE_LABEL_KEYS[role]];
}

const NOTE_LABEL_KEYS: Record<SelectionNote, keyof typeof t.matching.notes> = {
  rcbo_fallback: "rcboFallback",
  no_rcd: "noRcd",
};

export function selectionNoteMessage(note: SelectionNote): string {
  return t.matching.notes[NOTE_LABEL_KEYS[note]];
}
