import type { CircuitCrossSectionMm2 } from "@/lib/circuit-params";
import type { WlzCrossSectionMm2 } from "@/lib/supply-params";

/**
 * Physical sizes of conductors, cables and ferrules for the realistic cabinet wiring drawing
 * (S-11): the single source the router and the drawing read, so a wire is drawn at true scale.
 *
 * TRANSCRIBED DATA — an electrician must check it against the sources before relying on it.
 * The values are typical catalogue figures, one representative number each, not measurements.
 * Verified 2026-10-09 by the electrician against the sources below: every core and cable diameter
 * and every ferrule colour and length, accepted as listed.
 *
 * Sources (typical values; manufacturers differ by roughly +-0.3 mm):
 * - Single insulated core, H07V-K (flexible, PVC 450/750 V): outer diameter from manufacturer
 *   datasheets (e.g. HELUKABEL, Lapp) against the limits of PN-EN 50525-2-31 (IEC 60227-3 class 5).
 * - Sheathed round cable, YDY (PVC, 300/500 V) / YKY (PVC, 0.6/1 kV): outer diameter from
 *   manufacturer catalogues (e.g. Elektrokabel, Tele-Fonika Kable, NKT), PN-HD 603 / PN-HD 21.5 style
 *   constructions. A solid conductor is assumed up to 16 mm2 and a stranded one above; the catalogue
 *   figure is used as is.
 * - Ferrules: colour code of DIN 46228-4 (not the French NF C 63-023 code) and typical sleeve lengths
 *   of the common 8 / 10 / 12 / 16 mm series from ferrule manufacturers' catalogues.
 *
 * Cable core counts. The router (`src/lib/cabinet-wiring.ts`) builds one cable per circuit (and one
 * for the WLZ) whose cores are its conductors: L (or L1-L3), N and PE; a TN-C circuit has L + PEN,
 * and a TN-C-S WLZ with a PE bar has phases + PEN (the split link is a separate feed). That gives
 * 2 cores (TN-C or TN-C-S WLZ, single-phase), 3 (single-phase L + N + PE), 4 (three-phase TN-C /
 * TN-C-S WLZ, or a three-phase circuit without N) and 5 (three-phase L1-L3 + N + PE). Every
 * combination of 2-5 cores and cross-section is tabulated anyway, so a rule change in the router
 * cannot hit a gap; sizes above 16 mm2 never occur for circuits but the WLZ goes up to 35 mm2.
 */

/** Every cross-section a conductor can have: circuits (1.5 ... 16) and the WLZ (2.5 ... 35). */
export type WireCrossSectionMm2 = CircuitCrossSectionMm2 | WlzCrossSectionMm2;

export const WIRE_CROSS_SECTIONS_MM2 = [
  1.5, 2.5, 4, 6, 10, 16, 25, 35,
] as const satisfies readonly WireCrossSectionMm2[];

/** Cores of a sheathed cable the router can produce (see the header). */
export const CABLE_CORE_COUNTS = [2, 3, 4, 5] as const;
export type CableCores = (typeof CABLE_CORE_COUNTS)[number];

type SectionValues = readonly [number, number, number, number, number, number, number, number];

/** One column of a table: values in `WIRE_CROSS_SECTIONS_MM2` order (1.5 ... 35 mm2). */
function bySection(values: SectionValues): Record<WireCrossSectionMm2, number> {
  return Object.fromEntries(WIRE_CROSS_SECTIONS_MM2.map((section, i) => [section, values[i]])) as Record<
    WireCrossSectionMm2,
    number
  >;
}

/** Outer diameter of one insulated core (H07V-K), in mm, by cross-section. */
export const CONDUCTOR_OUTER_DIAMETER_MM: Record<WireCrossSectionMm2, number> = bySection([
  3.0, 3.6, 4.2, 4.8, 6.4, 7.8, 9.6, 10.9,
]);

/** Outer diameter of a sheathed round cable (YDY / YKY), in mm, by core count and cross-section. */
export const CABLE_OUTER_DIAMETER_MM: Record<CableCores, Record<WireCrossSectionMm2, number>> = {
  2: bySection([7.4, 8.4, 9.6, 10.6, 12.6, 14.6, 17.6, 19.6]),
  3: bySection([7.9, 9.0, 10.4, 11.4, 13.8, 15.8, 19.2, 21.4]),
  4: bySection([8.4, 9.8, 11.3, 12.5, 15.2, 17.4, 21.4, 23.8]),
  5: bySection([9.1, 10.6, 12.4, 13.8, 16.8, 19.2, 23.6, 26.4]),
};

/** The ferrule colours in use: each is a `--ferrule-*` token in `src/styles/global.css`. */
export const FERRULE_COLOUR_TOKENS = [
  "ferrule-black",
  "ferrule-blue",
  "ferrule-grey",
  "ferrule-yellow",
  "ferrule-red",
] as const;
export type FerruleColourToken = (typeof FERRULE_COLOUR_TOKENS)[number];

export interface Ferrule {
  /** The token name without `--`; the drawing reads it as `var(--<colourToken>)`. */
  colourToken: FerruleColourToken;
  lengthMm: number;
}

/** DIN 46228-4 colour code and typical sleeve length, by cross-section. */
export const FERRULE: Record<WireCrossSectionMm2, Ferrule> = {
  1.5: { colourToken: "ferrule-black", lengthMm: 8 },
  2.5: { colourToken: "ferrule-blue", lengthMm: 8 },
  4: { colourToken: "ferrule-grey", lengthMm: 10 },
  6: { colourToken: "ferrule-yellow", lengthMm: 10 },
  10: { colourToken: "ferrule-red", lengthMm: 12 },
  16: { colourToken: "ferrule-blue", lengthMm: 12 },
  25: { colourToken: "ferrule-yellow", lengthMm: 16 },
  35: { colourToken: "ferrule-red", lengthMm: 16 },
};

/** The outer diameter of one insulated core of this cross-section, in mm. */
export function conductorDiameterMm(crossSectionMm2: WireCrossSectionMm2): number {
  return CONDUCTOR_OUTER_DIAMETER_MM[crossSectionMm2];
}

/** The outer diameter of a sheathed cable of this core count and cross-section, in mm. */
export function cableDiameterMm(cores: CableCores, crossSectionMm2: WireCrossSectionMm2): number {
  return CABLE_OUTER_DIAMETER_MM[cores][crossSectionMm2];
}
