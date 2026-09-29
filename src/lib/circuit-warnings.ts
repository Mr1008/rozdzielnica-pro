import type { CabinetGeometry, TerminalGroup } from "@/lib/cabinet-geometry";
import type { CircuitCrossSectionMm2, CircuitInput } from "@/lib/circuit-params";
import { t } from "@/lib/i18n";
import type { SupplyParams } from "@/lib/supply-params";
import {
  AMPACITY_A,
  REFERENCE_METHOD_BY_INSTALLATION,
  loadedConductors,
  type LoadedConductors,
  type ReferenceMethod,
} from "@/lib/supply-warnings";

/**
 * Informational checks over a project's circuits (FR-006) against their cable, the cabinet snapshot
 * and the WLZ. They never block a save and are no standards calculation (PRD `## Non-Goals`): circuit
 * cables are assumed copper with PVC insulation, with no temperature or grouping correction factors.
 * Computed on render, never stored.
 */

/**
 * Copper 1.5 mm² ampacity in amperes, `[loaded conductors][method]` — the one circuit cross-section
 * `AMPACITY_A` (built for the WLZ, 2.5 mm² and up) does not carry.
 *
 * TRANSCRIBED DATA — an electrician must check it against the standard before relying on it.
 * Source: PN-HD 60364-5-52:2011 (IEC 60364-5-52:2009), Annex B — table B.52.2 (PVC insulation,
 * two loaded conductors) and table B.52.4 (PVC insulation, three loaded conductors), copper,
 * 1.5 mm² row, reference methods B2, C and D1. Same conditions as `AMPACITY_A`: PVC at 70 °C, 30 °C
 * ambient air (B2, C) / 20 °C ground at 2.5 K·m/W (D1), no correction factors.
 *
 * Verified 2026-09-29 by the electrician against HD 60364-5-52:2011 Tablica B.52.2 (PVC, two loaded
 * conductors) and Tablica B.52.4 (PVC, three loaded conductors), copper 1.5 mm²: every value below,
 * pinned in `circuit-warnings.test.ts`. Every combination must be present — `circuit-warnings.test.ts` asserts it — so a gap can never silently suppress the warning.
 */
export const CU_1_5_MM2_AMPACITY_A: Record<LoadedConductors, Record<ReferenceMethod, number>> = {
  // B.52.2, copper, 2 loaded conductors, 1.5 mm².
  2: { B2: 16.5, C: 19.5, D1: 22 },
  // B.52.4, copper, 3 loaded conductors, 1.5 mm².
  3: { B2: 15, C: 17.5, D1: 18 },
};

/** The tabulated copper ampacity for a circuit cross-section, loaded-conductor count and method. */
export function copperCableAmpacityA(
  section: CircuitCrossSectionMm2,
  loaded: LoadedConductors,
  method: ReferenceMethod,
): number {
  if (section === 1.5) return CU_1_5_MM2_AMPACITY_A[loaded][method];
  return AMPACITY_A.Cu[loaded][method][section];
}

/** The tabulated ampacity of a circuit's cable: 2 loaded conductors single-phase, 3 three-phase. */
export function circuitAmpacityA(circuit: CircuitInput): number {
  return copperCableAmpacityA(
    circuit.cross_section_mm2,
    loadedConductors(circuit.phase_count),
    REFERENCE_METHOD_BY_INSTALLATION[circuit.installation],
  );
}

export type BarKind = CabinetGeometry["bars"][number]["kind"];

/** Checked in this order, so bar warnings are stable. */
const CHECKED_BAR_KINDS = ["PE", "N"] as const satisfies readonly BarKind[];

export type CircuitWarning =
  | { code: "cable_ampacity_below_in"; circuitId: string; circuitName: string; ampacityA: number; ratedA: number }
  | { code: "bars_missing" }
  | { code: "bar_terminals_insufficient"; kind: BarKind; needed: number; available: number }
  | { code: "entry_side_not_in_cabinet"; circuitId: string; circuitName: string; side: CircuitInput["entry_side"] };

export type CircuitWarningCode = CircuitWarning["code"];

/**
 * How many of `sections` get a terminal whose range accommodates them (`minMm2 ≤ s ≤ maxMm2`), one
 * conductor per terminal. Conductors go smallest first, each to the fitting group that closes
 * soonest (smallest `maxMm2`) — the standard greedy for matching points to intervals, so the count
 * is the best any assignment achieves.
 */
function fittingTerminals(sections: readonly number[], groups: readonly TerminalGroup[]): number {
  const free = groups.map((group) => ({ ...group }));
  let fitted = 0;
  for (const section of [...sections].sort((a, b) => a - b)) {
    let best: (typeof free)[number] | undefined;
    for (const group of free) {
      if (group.count > 0 && group.minMm2 <= section && section <= group.maxMm2) {
        if (best === undefined || group.maxMm2 < best.maxMm2) best = group;
      }
    }
    if (best !== undefined) {
      best.count -= 1;
      fitted += 1;
    }
  }
  return fitted;
}

/**
 * The PE/N bar checks. Every circuit lands one conductor on each bar kind — a three-phase circuit
 * still brings one PE and one N — at its own cross-section. The WLZ, when the supply is configured,
 * adds one more conductor to each kind at its cross-section; in TN-C the WLZ really carries a single
 * PEN, but it is counted once per kind to keep the check simple and on the safe side. A bar kind
 * warns when not every conductor gets a fitting terminal; `available` is how many do.
 */
function barWarnings(
  circuits: readonly CircuitInput[],
  supply: SupplyParams | null,
  geometry: CabinetGeometry,
): CircuitWarning[] {
  if (geometry.bars.length === 0) return [{ code: "bars_missing" }];

  const sections: number[] = circuits.map((circuit) => circuit.cross_section_mm2);
  if (supply !== null) sections.push(supply.wlz_cross_section_mm2);
  if (sections.length === 0) return [];

  const warnings: CircuitWarning[] = [];
  for (const kind of CHECKED_BAR_KINDS) {
    const groups = geometry.bars.filter((bar) => bar.kind === kind).flatMap((bar) => bar.terminalGroups);
    const available = fittingTerminals(sections, groups);
    if (available < sections.length) {
      warnings.push({ code: "bar_terminals_insufficient", kind, needed: sections.length, available });
    }
  }
  return warnings;
}

/**
 * Every warning the circuits raise, in a stable order: per circuit (in input order) its ampacity then
 * its entry side, then the bars. A null geometry skips the entry-side and bar checks; a null supply
 * leaves the WLZ out of the bar count.
 */
export function circuitWarnings(
  circuits: readonly CircuitInput[],
  supply: SupplyParams | null,
  geometry: CabinetGeometry | null,
): CircuitWarning[] {
  const warnings: CircuitWarning[] = [];
  const sides = new Set(geometry?.entries.map((entry) => entry.side));

  for (const circuit of circuits) {
    const ampacityA = circuitAmpacityA(circuit);
    if (circuit.rated_current_a > ampacityA) {
      warnings.push({
        code: "cable_ampacity_below_in",
        circuitId: circuit.id,
        circuitName: circuit.name,
        ampacityA,
        ratedA: circuit.rated_current_a,
      });
    }
    if (geometry !== null && !sides.has(circuit.entry_side)) {
      warnings.push({
        code: "entry_side_not_in_cabinet",
        circuitId: circuit.id,
        circuitName: circuit.name,
        side: circuit.entry_side,
      });
    }
  }

  if (geometry !== null) warnings.push(...barWarnings(circuits, supply, geometry));
  return warnings;
}

/** Polish text for one warning. The switch is exhaustive over `CircuitWarningCode`. */
export function circuitWarningMessage(warning: CircuitWarning): string {
  const m = t.circuitWarnings;
  switch (warning.code) {
    case "cable_ampacity_below_in":
      return m.cableAmpacityBelowIn(warning.circuitName, warning.ampacityA, warning.ratedA);
    case "bars_missing":
      return m.barsMissing;
    case "bar_terminals_insufficient":
      return m.barTerminalsInsufficient(warning.kind, warning.needed, warning.available);
    case "entry_side_not_in_cabinet":
      return m.entrySideNotInCabinet(warning.circuitName, t.cabinets.sides[warning.side]);
  }
}
