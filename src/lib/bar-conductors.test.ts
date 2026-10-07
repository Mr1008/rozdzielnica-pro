import { describe, expect, it } from "vitest";
import { barConductorSections, builtInBarKinds, fittingTerminals, terminalsFitAll } from "./bar-conductors";
import type { CabinetGeometry } from "./cabinet-geometry";

const TN_S = { earthing_system: "TN-S", wlz_cross_section_mm2: 10 } as const;
const circuits = [{ cross_section_mm2: 2.5 }, { cross_section_mm2: 1.5 }] as const;

describe("barConductorSections", () => {
  it("lands one conductor per circuit plus the WLZ on each kind", () => {
    expect(barConductorSections("PE", circuits, TN_S)).toEqual([2.5, 1.5, 10]);
    expect(barConductorSections("N", circuits, TN_S)).toEqual([2.5, 1.5, 10]);
  });

  it("leaves the WLZ out without a supply", () => {
    expect(barConductorSections("PE", circuits, null)).toEqual([2.5, 1.5]);
  });

  it("lands nothing on an N bar in TN-C, everything on the PE bar", () => {
    const tnC = { ...TN_S, earthing_system: "TN-C" } as const;
    expect(barConductorSections("N", circuits, tnC)).toEqual([]);
    expect(barConductorSections("PE", circuits, tnC)).toEqual([2.5, 1.5, 10]);
  });
});

describe("fittingTerminals / terminalsFitAll", () => {
  it("counts one conductor per terminal whose range takes it", () => {
    expect(fittingTerminals([2.5, 2.5, 10], [{ count: 2, minMm2: 1.5, maxMm2: 6 }])).toBe(2);
    expect(terminalsFitAll([2.5, 2.5, 10], [{ count: 2, minMm2: 1.5, maxMm2: 6 }])).toBe(false);
  });

  it("does not waste a wide terminal on a thin conductor", () => {
    const groups = [
      { count: 1, minMm2: 1.5, maxMm2: 16 },
      { count: 1, minMm2: 1.5, maxMm2: 4 },
    ];
    expect(terminalsFitAll([2.5, 10], groups)).toBe(true);
  });

  it("fits exactly, and not with one terminal fewer", () => {
    expect(terminalsFitAll([1.5, 2.5, 10], [{ count: 3, minMm2: 1.5, maxMm2: 10 }])).toBe(true);
    expect(terminalsFitAll([1.5, 2.5, 10], [{ count: 2, minMm2: 1.5, maxMm2: 10 }])).toBe(false);
  });
});

describe("builtInBarKinds", () => {
  const bar = (kind: "PE" | "N") => ({ kind }) as CabinetGeometry["bars"][number];
  it("lists the kinds present, PE then N", () => {
    expect(builtInBarKinds({ bars: [] })).toEqual([]);
    expect(builtInBarKinds({ bars: [bar("N"), bar("PE"), bar("N")] })).toEqual(["PE", "N"]);
    expect(builtInBarKinds({ bars: [bar("N")] })).toEqual(["N"]);
  });
});

describe("barConductorSections — the TN-C-S PEN split", () => {
  it("counts the split link as one more PE-bar conductor at the WLZ cross-section, and nothing more on N", () => {
    const tnCS = { ...TN_S, earthing_system: "TN-C-S" } as const;
    expect(barConductorSections("PE", circuits, tnCS)).toEqual([2.5, 1.5, 10, 10]);
    expect(barConductorSections("N", circuits, tnCS)).toEqual([2.5, 1.5, 10]);
  });
});
