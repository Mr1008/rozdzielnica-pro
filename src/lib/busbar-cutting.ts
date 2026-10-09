import { busbarPins } from "@/lib/device-spec";
import type { DeviceSpecWithId } from "@/lib/device-matching";
import { DIN_MODULE_MM } from "@/lib/din-module";

/**
 * Comb busbar cutting (plan `rcd-group-busbars`, Phase 2): which catalog busbar piece each RCD group
 * is cut from. A pure, deterministic greedy first-fit-decreasing pass — a heuristic, never a cutting
 * optimiser (PRD `## Non-Goals`).
 *
 * The guardrail is the matcher's: a segment never comes from a busbar whose rated current is below
 * the group RCD's, whether the piece is bought or an offcut, and phases must match. Compliance is
 * filtered before price; "cheapest" is chosen among compliant pieces only.
 *
 * - **Excluded.** A group wider than the widest rail (`maxRailMm`) keeps its wire jumpers: reason
 *   `group_too_wide`.
 * - **Pass 1.** Groups with at least two MCBs, widest first (ties: stored group order). Take the first
 *   open piece (piece-number order) of the same phases, rated current ≥ the RCD's, with enough pins
 *   left; otherwise buy the cheapest compliant catalog busbar; none compliant: `busbar_missing`.
 * - **Pass 2.** Single-MCB groups (including the RCBO fallback), same order, from open pieces only. A
 *   miss is silent: such a group is not worth a bought piece.
 *
 * A miss is information, never a catalog gap — the group keeps its wire jumpers.
 */

export type CatalogBusbar = Extract<DeviceSpecWithId, { kind: "comb_busbar" }>;

/** The busbar a group needs: derived by the matcher from the group's matched RCD and MCBs. */
export interface BusbarDemand {
  groupId: string;
  mcbCount: number;
  /** 3 when the group RCD is 4P, otherwise 1. */
  phases: 1 | 3;
  /** The group RCD's rated current: the least a busbar for it may carry. */
  minRatedA: number;
  /** The summed width of the group's RCD and MCBs, in millimetres. */
  groupWidthMm: number;
}

export type BusbarReason = "busbar_missing" | "group_too_wide";

export interface BusbarSegment {
  groupId: string;
  deviceId: string;
  /** 0-based within the project; segments cut from one bought piece share it. */
  piece: number;
}

export interface BusbarPlan {
  /** In demand order. */
  segments: BusbarSegment[];
  reasons: { groupId: string; reason: BusbarReason }[];
}

/** Picks the cheapest of already-compliant candidates; the matcher's own tie-break. */
export type PickCheapest = <T extends DeviceSpecWithId>(candidates: readonly T[]) => T | null;

interface OpenPiece {
  piece: number;
  deviceId: string;
  phases: 1 | 3;
  ratedA: number;
  remainingPins: number;
}

function busbarPhases(busbar: CatalogBusbar): 1 | 3 {
  return busbar.poles === "3P" ? 3 : 1;
}

/** The pins a demand takes: its width in modules, rounded up. */
export function demandPins(groupWidthMm: number): number {
  return Math.ceil(groupWidthMm / DIN_MODULE_MM - 1e-9);
}

export function planBusbarCuts(
  demands: readonly BusbarDemand[],
  catalog: readonly DeviceSpecWithId[],
  maxRailMm: number,
  pickCheapest: PickCheapest,
): BusbarPlan {
  const busbars = catalog.filter((device): device is CatalogBusbar => device.kind === "comb_busbar");
  const reasons: BusbarPlan["reasons"] = [];
  const cut = new Map<string, BusbarSegment>();
  const open: OpenPiece[] = [];
  let pieceCount = 0;

  const eligible = demands.filter((demand) => {
    if (demand.groupWidthMm > maxRailMm + 1e-6) {
      reasons.push({ groupId: demand.groupId, reason: "group_too_wide" });
      return false;
    }
    return true;
  });

  // Widest first; `Array.prototype.sort` is stable, so ties keep the stored group order.
  const byWidth = (list: readonly BusbarDemand[]) =>
    [...list].sort((a, b) => demandPins(b.groupWidthMm) - demandPins(a.groupWidthMm));

  const fromOpenPiece = (demand: BusbarDemand): boolean => {
    const pins = demandPins(demand.groupWidthMm);
    const piece = open.find(
      (candidate) =>
        candidate.phases === demand.phases && candidate.ratedA >= demand.minRatedA && candidate.remainingPins >= pins,
    );
    if (piece === undefined) return false;
    piece.remainingPins -= pins;
    cut.set(demand.groupId, { groupId: demand.groupId, deviceId: piece.deviceId, piece: piece.piece });
    return true;
  };

  for (const demand of byWidth(eligible.filter((d) => d.mcbCount >= 2))) {
    if (fromOpenPiece(demand)) continue;
    const pins = demandPins(demand.groupWidthMm);
    const bought = pickCheapest(
      busbars.filter(
        (busbar) =>
          busbarPhases(busbar) === demand.phases &&
          busbar.rated_current_a >= demand.minRatedA &&
          busbarPins(busbar.width_mm) >= pins,
      ),
    );
    if (bought === null) {
      reasons.push({ groupId: demand.groupId, reason: "busbar_missing" });
      continue;
    }
    const piece = pieceCount;
    pieceCount += 1;
    open.push({
      piece,
      deviceId: bought.id,
      phases: busbarPhases(bought),
      ratedA: bought.rated_current_a,
      remainingPins: busbarPins(bought.width_mm) - pins,
    });
    cut.set(demand.groupId, { groupId: demand.groupId, deviceId: bought.id, piece });
  }

  for (const demand of byWidth(eligible.filter((d) => d.mcbCount < 2))) fromOpenPiece(demand);

  return {
    segments: demands.flatMap((demand) => {
      const segment = cut.get(demand.groupId);
      return segment === undefined ? [] : [segment];
    }),
    reasons,
  };
}
