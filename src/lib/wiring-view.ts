import type { WiringVariant } from "@/lib/cabinet-drawing";

/**
 * The project page's "Widok: realistyczny / schematyczny" switch (S-11 Phase 7): which drawing variant
 * the "Układ w szafce" section shows. The choice travels in one query parameter, so the page renders
 * only that variant; the printout ignores it and stays schematic (S-09).
 */

/** The query parameter: `?wiring=schematic`. Absent or any other value means realistic. */
export const WIRING_VIEW_PARAM = "wiring";

export function wiringViewFromParam(value: string | null): WiringVariant {
  return value === "schematic" ? "schematic" : "realistic";
}

/**
 * The two links of the switch: the page at `pathname`, with the parameter only for the schematic view,
 * and the section's `anchor` kept so the page lands back on the drawing.
 */
export function wiringViewHrefs(pathname: string, anchor: string): Record<WiringVariant, string> {
  return {
    realistic: `${pathname}#${anchor}`,
    schematic: `${pathname}?${WIRING_VIEW_PARAM}=schematic#${anchor}`,
  };
}
