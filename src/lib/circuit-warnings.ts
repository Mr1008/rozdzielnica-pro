import {
  BAR_KINDS_IN_ORDER,
  barConductorSections,
  builtInBarKinds,
  fittingTerminals,
  type BarKind,
} from "@/lib/bar-conductors";
import type { CabinetGeometry } from "@/lib/cabinet-geometry";
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

export type { BarKind };

export type CircuitWarning =
  | { code: "cable_ampacity_below_in"; circuitId: string; circuitName: string; ampacityA: number; ratedA: number }
  | { code: "bars_missing" }
  | { code: "bar_terminals_insufficient"; kind: BarKind; needed: number; available: number }
  | { code: "entry_side_not_in_cabinet"; circuitId: string; circuitName: string; side: CircuitInput["entry_side"] };

export type CircuitWarningCode = CircuitWarning["code"];

/**
 * The PE/N bar checks, over the one conductor count in `src/lib/bar-conductors.ts` (shared with the
 * catalog-bar match). Each bar kind built into the cabinet warns when not every conductor gets a
 * fitting terminal (`available` is how many do). A kind the match supplies from the catalog
 * (`suppliedBarKinds`) is not checked: the matcher only ever selects a bar whose terminals take every
 * conductor. A kind the project lacks altogether warns with `available: 0` — and a project with
 * neither kind (no built-in bar, none supplied — e.g. a catalog gap) raises a single `bars_missing`
 * instead. A kind no conductor lands on (N in TN-C) never warns.
 */
function barWarnings(
  circuits: readonly CircuitInput[],
  supply: SupplyParams | null,
  geometry: CabinetGeometry,
  suppliedBarKinds: readonly BarKind[],
): CircuitWarning[] {
  const builtIn = builtInBarKinds(geometry);
  const supplied = suppliedBarKinds.filter((kind) => !builtIn.includes(kind));
  if (builtIn.length === 0 && supplied.length === 0) return [{ code: "bars_missing" }];

  const warnings: CircuitWarning[] = [];
  for (const kind of BAR_KINDS_IN_ORDER) {
    if (supplied.includes(kind)) continue;
    const sections = barConductorSections(kind, circuits, supply);
    if (sections.length === 0) continue;
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
 * leaves the WLZ out of the bar count. `suppliedBarKinds` are the bar kinds the project's match takes
 * from the catalog (`matchedBarKinds` in `src/lib/device-matching.ts`).
 */
export function circuitWarnings(
  circuits: readonly CircuitInput[],
  supply: SupplyParams | null,
  geometry: CabinetGeometry | null,
  suppliedBarKinds: readonly BarKind[] = [],
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

  if (geometry !== null) warnings.push(...barWarnings(circuits, supply, geometry, suppliedBarKinds));
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
