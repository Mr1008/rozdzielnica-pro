import type { WiringVariant } from "@/lib/cabinet-drawing";

/**
 * The project page's "Widok: realistyczny / schematyczny / 3D" switch (S-11 Phase 7, GitHub #14): what
 * the "Układ w szafce" section shows. The choice travels in one query parameter, so the page renders
 * only that view; the printout ignores it and stays schematic (S-09).
 *
 * `3d` is its own `DrawingView`, never a third `WiringVariant`: the variant drives the 2D drawing and the
 * printout, which must not see it. The 3D view's 2D fallback is drawn realistic (`wiringVariantOf`).
 */
export type DrawingView = WiringVariant | "3d";
export const DRAWING_VIEWS = ["realistic", "schematic", "3d"] as const satisfies readonly DrawingView[];

/** The query parameter: `?wiring=schematic` or `?wiring=3d`. Absent or any other value means realistic. */
export const WIRING_VIEW_PARAM = "wiring";

export function drawingViewFromParam(value: string | null): DrawingView {
  if (value === "schematic") return "schematic";
  if (value === "3d") return "3d";
  return "realistic";
}

/** The 2D variant a view draws with: the 3D view's fallback drawing is the realistic one. */
export function wiringVariantOf(view: DrawingView): WiringVariant {
  return view === "3d" ? "realistic" : view;
}

/** The 2D variant the parameter asks for; `3d` reads as realistic. */
export function wiringViewFromParam(value: string | null): WiringVariant {
  return wiringVariantOf(drawingViewFromParam(value));
}

/**
 * The links of the switch: the page at `pathname`, with the parameter only for the non-default views,
 * and the section's `anchor` kept so the page lands back on the drawing.
 */
export function wiringViewHrefs(pathname: string, anchor: string): Record<DrawingView, string> {
  return {
    realistic: `${pathname}#${anchor}`,
    schematic: `${pathname}?${WIRING_VIEW_PARAM}=schematic#${anchor}`,
    "3d": `${pathname}?${WIRING_VIEW_PARAM}=3d#${anchor}`,
  };
}
