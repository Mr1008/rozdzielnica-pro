import { parseCabinetGeometry, type CabinetGeometry } from "./cabinet-geometry";

/**
 * Test fixtures for the layout suites: the three seed cabinets of `supabase/seed.sql`, copied
 * verbatim and parsed, so the tables and the property test run on the geometries the product ships.
 */

export function geometry(json: unknown): CabinetGeometry {
  const parsed = parseCabinetGeometry(json);
  if (!parsed.ok) throw new Error(`fixture geometry does not parse: ${JSON.stringify(parsed.issues)}`);
  return parsed.geometry;
}

export const TERMINALS = [
  { count: 12, minMm2: 1.5, maxMm2: 16 },
  { count: 2, minMm2: 6, maxMm2: 25 },
];

/** (a) PRZ-S1: 250 × 200, one 230 mm rail, top entry, no bars. */
export const SEED_A = geometry({
  version: 1,
  interior: { widthMm: 250, heightMm: 200, depthMm: 90 },
  rails: [{ xMm: 10, yMm: 80, lengthMm: 230 }],
  entries: [{ side: "top", offsetMm: 50, lengthMm: 150 }],
  bars: [],
});

/** (b) PRZ-M3: 400 × 500, three 320 mm rails, top + bottom entries, vertical PE (left) and N (right). */
export const SEED_B = geometry({
  version: 1,
  interior: { widthMm: 400, heightMm: 500, depthMm: 110 },
  rails: [
    { xMm: 40, yMm: 80, lengthMm: 320 },
    { xMm: 40, yMm: 200, lengthMm: 320 },
    { xMm: 40, yMm: 320, lengthMm: 320 },
  ],
  entries: [
    { side: "top", offsetMm: 50, lengthMm: 300 },
    { side: "bottom", offsetMm: 50, lengthMm: 300 },
  ],
  bars: [
    {
      kind: "PE",
      orientation: "vertical",
      xMm: 10,
      yMm: 50,
      lengthMm: 400,
      heightMm: 15,
      zMm: 20,
      terminalGroups: TERMINALS,
    },
    {
      kind: "N",
      orientation: "vertical",
      xMm: 375,
      yMm: 50,
      lengthMm: 400,
      heightMm: 15,
      zMm: 20,
      terminalGroups: TERMINALS,
    },
  ],
});

/** (c) PRZ-L4: 600 × 800, five rails (last row 240 + 240), bottom + left entries, horizontal PE and N. */
export const SEED_C = geometry({
  version: 1,
  interior: { widthMm: 600, heightMm: 800, depthMm: 130 },
  rails: [
    { xMm: 30, yMm: 100, lengthMm: 540 },
    { xMm: 30, yMm: 250, lengthMm: 540 },
    { xMm: 30, yMm: 400, lengthMm: 540 },
    { xMm: 30, yMm: 550, lengthMm: 240 },
    { xMm: 330, yMm: 550, lengthMm: 240 },
  ],
  entries: [
    { side: "bottom", offsetMm: 100, lengthMm: 400 },
    { side: "left", offsetMm: 200, lengthMm: 400 },
  ],
  bars: [
    {
      kind: "PE",
      orientation: "horizontal",
      xMm: 50,
      yMm: 680,
      lengthMm: 500,
      heightMm: 15,
      zMm: 20,
      terminalGroups: [
        { count: 20, minMm2: 1.5, maxMm2: 16 },
        { count: 3, minMm2: 6, maxMm2: 35 },
      ],
    },
    {
      kind: "N",
      orientation: "horizontal",
      xMm: 100,
      yMm: 685,
      lengthMm: 400,
      heightMm: 15,
      zMm: 40,
      terminalGroups: [
        { count: 16, minMm2: 1.5, maxMm2: 16 },
        { count: 2, minMm2: 6, maxMm2: 35 },
      ],
    },
  ],
});
