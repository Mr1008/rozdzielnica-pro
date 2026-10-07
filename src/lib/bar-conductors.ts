import type { CabinetGeometry, TerminalGroup } from "@/lib/cabinet-geometry";
import type { CircuitInput } from "@/lib/circuit-params";
import type { SupplyParams } from "@/lib/supply-params";

/**
 * Which conductors land on a PE or an N bar, and how many of them a bar's terminals take — the one
 * count shared by the bar warnings (`src/lib/circuit-warnings.ts`) and the catalog-bar match
 * (`src/lib/device-matching.ts`, plan Phase 5b). Never copy it: the warning and the matcher must agree
 * on what "enough terminals" means, or the matcher could pick a bar the warning then calls too small.
 *
 * The count is deliberately simple and errs on the safe side:
 * - every circuit lands one conductor on each bar kind at its own cross-section — a three-phase
 *   circuit still brings one PE and one N (a grouped circuit's N really lands on its RCD, but the N
 *   bar then feeds that RCD instead, so one per circuit stays a fair upper bound);
 * - the WLZ, when the supply is configured, adds one more conductor to each kind at its
 *   cross-section;
 * - TN-C has no N conductor at all (every PEN lands on the PE bar), so it needs no N bar terminals;
 * - TN-C-S splits the PEN on the PE bar (user decision 2026-10-06): the split link from the PE bar to
 *   the main switch's N occupies one more PE-bar terminal, at the WLZ cross-section (user decision
 *   2026-10-07). When the main switch has no N pole the link lands on the N bar instead of the WLZ's N,
 *   which the WLZ's N terminal already counts.
 *
 * The wiring (`src/lib/cabinet-wiring.ts`) lands one conductor per terminal, so a shortfall here is
 * exactly the conductors it leaves unrouted on a built-in bar.
 */

export type BarKind = CabinetGeometry["bars"][number]["kind"];

/** Checked and matched in this order, so warnings, selections and gaps are stable. */
export const BAR_KINDS_IN_ORDER = ["PE", "N"] as const satisfies readonly BarKind[];

/** The cross-sections, one per conductor, that land on a bar of `kind`. */
export function barConductorSections(
  kind: BarKind,
  circuits: readonly Pick<CircuitInput, "cross_section_mm2">[],
  supply: Pick<SupplyParams, "earthing_system" | "wlz_cross_section_mm2"> | null,
): number[] {
  if (kind === "N" && supply?.earthing_system === "TN-C") return [];
  const sections: number[] = circuits.map((circuit) => circuit.cross_section_mm2);
  if (supply !== null) sections.push(supply.wlz_cross_section_mm2);
  if (kind === "PE" && supply?.earthing_system === "TN-C-S") sections.push(supply.wlz_cross_section_mm2);
  return sections;
}

/**
 * How many of `sections` get a terminal whose range accommodates them (`minMm2 ≤ s ≤ maxMm2`), one
 * conductor per terminal. Conductors go smallest first, each to the fitting group that closes
 * soonest (smallest `maxMm2`) — the standard greedy for matching points to intervals, so the count
 * is the best any assignment achieves.
 */
export function fittingTerminals(sections: readonly number[], groups: readonly TerminalGroup[]): number {
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

/** Every conductor gets a fitting terminal. */
export function terminalsFitAll(sections: readonly number[], groups: readonly TerminalGroup[]): boolean {
  return fittingTerminals(sections, groups) === sections.length;
}

/** The bar kinds a cabinet snapshot has built in, in `BAR_KINDS_IN_ORDER`. */
export function builtInBarKinds(geometry: Pick<CabinetGeometry, "bars">): BarKind[] {
  return BAR_KINDS_IN_ORDER.filter((kind) => geometry.bars.some((bar) => bar.kind === kind));
}
