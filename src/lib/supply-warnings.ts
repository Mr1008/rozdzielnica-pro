import { t } from "@/lib/i18n";
import {
  WLZ_CROSS_SECTIONS_MM2,
  type ConductorMaterial,
  type PhaseCount,
  type SupplyParams,
  type WlzCrossSectionMm2,
  type WlzInstallation,
} from "@/lib/supply-params";

/**
 * Informational checks over a project's saved supply parameters (FR-005). They never block a save
 * and are no standards calculation (PRD `## Non-Goals`): no temperature or grouping correction
 * factors, and the voltage drop is taken at the full pre-meter protection current, so it errs on the
 * high side. Computed on render, never stored. Checks that need circuits (TN-C and an RCD, the FR
 * rating) belong to S-04.
 */

/** The reference installation methods the WLZ installations map to. */
export const REFERENCE_METHODS = ["B2", "C", "D1"] as const;
export type ReferenceMethod = (typeof REFERENCE_METHODS)[number];

/** Loaded conductors: 2 for a single-phase WLZ (L + N), 3 for a three-phase one (L1–L3). */
export const LOADED_CONDUCTOR_COUNTS = [2, 3] as const;
export type LoadedConductors = (typeof LOADED_CONDUCTOR_COUNTS)[number];

/**
 * Installation method → reference method of PN-HD 60364-5-52:2011, Annex B (table B.52.1):
 * `surface` (natynkowo) → C, `conduit_surface` (w rurce natynkowo) → B2,
 * `conduit_flush` (w rurce podtynkowo) → B2, `in_wall` (bezpośrednio w ścianie/tynku) → C,
 * `in_ground` (w gruncie) → D1. A multi-core cable in conduit is B2; clipped direct or embedded in
 * the wall is C; in a duct in the ground is D1.
 */
export const REFERENCE_METHOD_BY_INSTALLATION = {
  surface: "C",
  conduit_surface: "B2",
  conduit_flush: "B2",
  in_wall: "C",
  in_ground: "D1",
} as const satisfies Record<WlzInstallation, ReferenceMethod>;

export function loadedConductors(phaseCount: PhaseCount): LoadedConductors {
  return phaseCount === 1 ? 2 : 3;
}

type SectionValues = readonly [number, number, number, number, number, number, number];

/** One column of the standard's table: values in `WLZ_CROSS_SECTIONS_MM2` order (2.5 … 35 mm²). */
function bySection(values: SectionValues): Record<WlzCrossSectionMm2, number> {
  return Object.fromEntries(WLZ_CROSS_SECTIONS_MM2.map((section, i) => [section, values[i]])) as Record<
    WlzCrossSectionMm2,
    number
  >;
}

/**
 * Current-carrying capacity in amperes, `AMPACITY_A[material][loaded conductors][method][mm²]`.
 *
 * TRANSCRIBED DATA — an electrician must check it against the standard before relying on it.
 * Source: PN-HD 60364-5-52:2011 (IEC 60364-5-52:2009), Annex B — table B.52.2 (PVC insulation,
 * two loaded conductors) and table B.52.4 (PVC insulation, three loaded conductors), copper and
 * aluminium rows, reference methods B2, C and D1. PVC at 70 °C conductor temperature, 30 °C ambient
 * air (B2, C) / 20 °C ground at 2.5 K·m/W (D1), and no correction factors. The XLPE tables
 * (B.52.3, B.52.5) are not used: PVC is the conservative choice for an unknown insulation.
 *
 * Aluminium: the standard tabulates aluminium from 2.5 mm² in these columns, and those values are
 * used as printed. Aluminium below 16 mm² raises its own warning anyway (`aluminium_below_minimum`).
 *
 * Verified 2026-09-25 by the electrician against HD 60364-5-52:2011 Tablica B.52.2 (PVC, two loaded
 * conductors) and Tablica B.52.4 (PVC, three loaded conductors), Cu and Al: every value below, pinned
 * in `supply-warnings.test.ts`. The first transcription had D1 too high in all four blocks; the
 * standard's values replaced it.
 *
 * Every combination must be present — `supply-warnings.test.ts` asserts it — so a gap can never
 * silently suppress the ampacity warning.
 */
export const AMPACITY_A: Record<
  ConductorMaterial,
  Record<LoadedConductors, Record<ReferenceMethod, Record<WlzCrossSectionMm2, number>>>
> = {
  Cu: {
    // B.52.2, copper, 2 loaded conductors. Sections: 2.5, 4, 6, 10, 16, 25, 35.
    2: {
      B2: bySection([23, 30, 38, 52, 69, 90, 111]),
      C: bySection([27, 36, 46, 63, 85, 112, 138]),
      D1: bySection([29, 37, 46, 60, 78, 99, 119]),
    },
    // B.52.4, copper, 3 loaded conductors.
    3: {
      B2: bySection([20, 27, 34, 46, 62, 80, 99]),
      C: bySection([24, 32, 41, 57, 76, 96, 119]),
      D1: bySection([24, 30, 38, 50, 64, 82, 98]),
    },
  },
  Al: {
    // B.52.2, aluminium, 2 loaded conductors.
    2: {
      B2: bySection([17.5, 24, 30, 41, 54, 71, 86]),
      C: bySection([21, 28, 36, 49, 66, 83, 103]),
      D1: bySection([22, 29, 36, 47, 61, 77, 93]),
    },
    // B.52.4, aluminium, 3 loaded conductors.
    3: {
      B2: bySection([15.5, 21, 27, 36, 48, 62, 77]),
      C: bySection([18.5, 25, 32, 44, 59, 73, 90]),
      D1: bySection([18.5, 24, 30, 39, 50, 64, 77]),
    },
  },
};

/** The tabulated ampacity for this supply's WLZ. */
export function wlzAmpacityA(params: SupplyParams): number {
  const method = REFERENCE_METHOD_BY_INSTALLATION[params.wlz_installation];
  return AMPACITY_A[params.wlz_material][loadedConductors(params.phase_count)][method][params.wlz_cross_section_mm2];
}

/** Aluminium WLZ conductors below this cross-section warn. */
export const ALUMINIUM_MIN_MM2 = 16;

/**
 * The smallest PEN conductor, per material. Checked for TN-C and TN-C-S: in TN-C-S the PEN is assumed
 * to split in the switchboard (the usual arrangement for a single-family house), so the WLZ feeding it
 * still carries a PEN. Where the split is in the connection box this warning is a false positive —
 * informational, never blocking.
 */
export const PEN_MIN_MM2 = { Cu: 10, Al: 16 } as const satisfies Record<ConductorMaterial, number>;

/** Conductivity γ in m/(Ω·mm²). */
export const CONDUCTIVITY = { Cu: 56, Al: 34 } as const satisfies Record<ConductorMaterial, number>;

/** N SEP-E-002: the WLZ voltage-drop limit for a supply up to 100 kVA, in percent. */
export const VOLTAGE_DROP_LIMIT_PERCENT = 0.5;

const PHASE_VOLTAGE_V = 230;
const LINE_VOLTAGE_V = 400;

/**
 * The WLZ voltage drop in percent, at cos φ = 1 and I = the pre-meter protection current — the
 * worst case the protection lets through, so the result errs on the high side.
 * Single-phase: ΔU% = 200·L·I / (γ·S·230). Three-phase: ΔU% = 100·√3·L·I / (γ·S·400).
 */
export function voltageDropPercent(params: SupplyParams): number {
  const length = params.wlz_length_m;
  const current = params.premeter_protection_a;
  const gammaTimesSection = CONDUCTIVITY[params.wlz_material] * params.wlz_cross_section_mm2;
  if (params.phase_count === 1) {
    return (200 * length * current) / (gammaTimesSection * PHASE_VOLTAGE_V);
  }
  return (100 * Math.sqrt(3) * length * current) / (gammaTimesSection * LINE_VOLTAGE_V);
}

export type SupplyWarning =
  | { code: "wlz_ampacity_below_protection"; ampacityA: number; protectionA: number }
  | { code: "aluminium_below_minimum" }
  | { code: "pen_below_minimum"; minimumMm2: number }
  | { code: "voltage_drop_high"; percent: number; limitPercent: number };

export type SupplyWarningCode = SupplyWarning["code"];

/** Rounded up to 0.01, so a displayed drop is never at or below the limit it exceeds. */
function ceilTo2(value: number): number {
  return Math.ceil(value * 100) / 100;
}

/** Every warning the supply raises, in a stable order: ampacity, aluminium, PEN, voltage drop. */
export function supplyWarnings(params: SupplyParams): SupplyWarning[] {
  const warnings: SupplyWarning[] = [];

  const ampacityA = wlzAmpacityA(params);
  if (ampacityA < params.premeter_protection_a) {
    warnings.push({ code: "wlz_ampacity_below_protection", ampacityA, protectionA: params.premeter_protection_a });
  }

  if (params.wlz_material === "Al" && params.wlz_cross_section_mm2 < ALUMINIUM_MIN_MM2) {
    warnings.push({ code: "aluminium_below_minimum" });
  }

  const penMinimum = PEN_MIN_MM2[params.wlz_material];
  const carriesPen = params.earthing_system === "TN-C" || params.earthing_system === "TN-C-S";
  if (carriesPen && params.wlz_cross_section_mm2 < penMinimum) {
    warnings.push({ code: "pen_below_minimum", minimumMm2: penMinimum });
  }

  // The raw value is compared, so no drop above the limit is rounded away; only the display rounds.
  const percent = voltageDropPercent(params);
  if (percent > VOLTAGE_DROP_LIMIT_PERCENT) {
    warnings.push({ code: "voltage_drop_high", percent: ceilTo2(percent), limitPercent: VOLTAGE_DROP_LIMIT_PERCENT });
  }

  return warnings;
}

/** Polish text for one warning. The switch is exhaustive over `SupplyWarningCode`. */
export function supplyWarningMessage(warning: SupplyWarning): string {
  const m = t.supplyWarnings;
  switch (warning.code) {
    case "wlz_ampacity_below_protection":
      return m.wlzAmpacityBelowProtection(warning.ampacityA, warning.protectionA);
    case "aluminium_below_minimum":
      return m.aluminiumBelowMinimum(ALUMINIUM_MIN_MM2);
    case "pen_below_minimum":
      return m.penBelowMinimum(warning.minimumMm2);
    case "voltage_drop_high":
      return m.voltageDropHigh(warning.percent, warning.limitPercent);
  }
}
