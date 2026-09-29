import type { CabinetGeometry } from "@/lib/cabinet-geometry";

/**
 * A static demo cabinet for surfaces that must show a drawing without a database: the dev kitchen
 * sink and, later, the landing page. It is not catalog data and is never written anywhere, but it
 * must still pass `parseCabinetGeometry` (`demo-cabinet.test.ts` asserts it), so the drawing it
 * feeds is one the product could really produce.
 *
 * 540 × 750 × 110 mm: three 420 mm DIN rails (about 23 modules of 18 mm each), cable entries at the
 * top and bottom, a horizontal PE bar under the rails and a vertical N bar on the right.
 */
export const DEMO_CABINET_GEOMETRY: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 540, heightMm: 750, depthMm: 110 },
  rails: [
    { xMm: 40, yMm: 110, lengthMm: 420 },
    { xMm: 40, yMm: 280, lengthMm: 420 },
    { xMm: 40, yMm: 450, lengthMm: 420 },
  ],
  entries: [
    { side: "top", offsetMm: 60, lengthMm: 240 },
    { side: "bottom", offsetMm: 200, lengthMm: 280 },
  ],
  bars: [
    {
      kind: "PE",
      orientation: "horizontal",
      xMm: 40,
      yMm: 600,
      lengthMm: 300,
      heightMm: 20,
      zMm: 20,
      terminalGroups: [{ count: 12, minMm2: 1.5, maxMm2: 16 }],
    },
    {
      kind: "N",
      orientation: "vertical",
      xMm: 490,
      yMm: 110,
      lengthMm: 400,
      heightMm: 20,
      zMm: 20,
      terminalGroups: [{ count: 12, minMm2: 1.5, maxMm2: 16 }],
    },
  ],
};
