import type { CabinetGeometry } from "@/lib/cabinet-geometry";

/**
 * A static demo cabinet for surfaces that must show a drawing without a database: the dev kitchen
 * sink (the landing hero uses the smaller `HERO_CABINET_GEOMETRY` below). It is not catalog data and is never written anywhere, but it
 * must still pass `parseCabinetGeometry` (`demo-cabinet.test.ts` asserts it), so the drawing it
 * feeds is one the product could really produce.
 *
 * 540 × 750 × 110 mm: three 420 mm DIN rails (24 modules of 17.5 mm each (`DIN_MODULE_MM`)), cable entries at the
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

/**
 * The landing hero's cabinet (`DraftingSheet`): small enough that its demo layout fills it and stays
 * legible at hero size. 320 × 380 × 110 mm: two 245 mm DIN rails (14 modules each), entries at the top
 * and bottom, a horizontal PE bar under the rails and a vertical N bar on the right. Same contract as
 * `DEMO_CABINET_GEOMETRY`: it must pass `parseCabinetGeometry`.
 */
export const HERO_CABINET_GEOMETRY: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 320, heightMm: 380, depthMm: 110 },
  rails: [
    { xMm: 25, yMm: 70, lengthMm: 245 },
    { xMm: 25, yMm: 190, lengthMm: 245 },
  ],
  entries: [
    { side: "top", offsetMm: 30, lengthMm: 160 },
    { side: "bottom", offsetMm: 60, lengthMm: 180 },
  ],
  bars: [
    {
      kind: "PE",
      orientation: "horizontal",
      xMm: 25,
      yMm: 300,
      lengthMm: 220,
      heightMm: 20,
      zMm: 20,
      terminalGroups: [{ count: 10, minMm2: 1.5, maxMm2: 16 }],
    },
    {
      kind: "N",
      orientation: "vertical",
      xMm: 288,
      yMm: 60,
      lengthMm: 230,
      heightMm: 20,
      zMm: 20,
      terminalGroups: [{ count: 10, minMm2: 1.5, maxMm2: 16 }],
    },
  ],
};
