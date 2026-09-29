import { describe, expect, it } from "vitest";
import type { CabinetGeometry } from "./cabinet-geometry";
import { CIRCUIT_CROSS_SECTIONS_MM2, type CircuitInput } from "./circuit-params";
import {
  CU_1_5_MM2_AMPACITY_A,
  circuitAmpacityA,
  circuitWarningMessage,
  circuitWarnings,
  copperCableAmpacityA,
  type CircuitWarning,
} from "./circuit-warnings";
import type { SupplyParams } from "./supply-params";
import { LOADED_CONDUCTOR_COUNTS, REFERENCE_METHODS } from "./supply-warnings";

/** B16 on Cu 2.5 mm² single-phase in a flush conduit (B2, 23 A), entering from the top. */
const CIRCUIT: CircuitInput = {
  id: "c1",
  rcd_group_id: null,
  name: "Gniazda kuchnia",
  rated_current_a: 16,
  phase_count: 1,
  cross_section_mm2: 2.5,
  installation: "conduit_flush",
  entry_side: "top",
};

const SUPPLY: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-S",
  phase_count: 3,
  wlz_length_m: 15,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

function bar(kind: "PE" | "N", terminalGroups: CabinetGeometry["bars"][number]["terminalGroups"]) {
  return {
    kind,
    orientation: "horizontal",
    xMm: 0,
    yMm: 0,
    lengthMm: 100,
    heightMm: 10,
    zMm: 0,
    terminalGroups,
  } as const;
}

/** Top and bottom entries; one PE and one N bar, each 10 × 1.5–16 mm². */
const GEOMETRY: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 300, heightMm: 400, depthMm: 100 },
  rails: [{ xMm: 0, yMm: 100, lengthMm: 300 }],
  entries: [
    { side: "top", offsetMm: 0, lengthMm: 100 },
    { side: "bottom", offsetMm: 0, lengthMm: 100 },
  ],
  bars: [bar("PE", [{ count: 10, minMm2: 1.5, maxMm2: 16 }]), bar("N", [{ count: 10, minMm2: 1.5, maxMm2: 16 }])],
};

function codes(warnings: CircuitWarning[]): CircuitWarning["code"][] {
  return warnings.map((warning) => warning.code);
}

describe("circuit cable ampacity", () => {
  it("has a positive entry for every cross-section × method × loaded count", () => {
    for (const section of CIRCUIT_CROSS_SECTIONS_MM2) {
      for (const method of REFERENCE_METHODS) {
        for (const loaded of LOADED_CONDUCTOR_COUNTS) {
          const value: unknown = copperCableAmpacityA(section, loaded, method);
          expect(typeof value, `${String(section)} ${method} ${String(loaded)}`).toBe("number");
          expect(value).toBeGreaterThan(0);
        }
      }
    }
  });

  // Transcribed from HD 60364-5-52:2011 Tablica B.52.2 / B.52.4 (PVC, Cu, 1.5 mm²); still to be checked
  // by the electrician. Changing a pinned value means re-checking it against the standard.
  it("pins the 1.5 mm² values", () => {
    expect(CU_1_5_MM2_AMPACITY_A).toEqual({ 2: { B2: 16.5, C: 19.5, D1: 22 }, 3: { B2: 15, C: 17.5, D1: 18 } });
  });

  it("grows with the cross-section in every column", () => {
    for (const method of REFERENCE_METHODS) {
      for (const loaded of LOADED_CONDUCTOR_COUNTS) {
        const column = CIRCUIT_CROSS_SECTIONS_MM2.map((section) => copperCableAmpacityA(section, loaded, method));
        expect(column).toEqual([...column].sort((a, b) => a - b));
      }
    }
  });

  it("uses two loaded conductors single-phase and three three-phase", () => {
    expect(circuitAmpacityA(CIRCUIT)).toBe(23);
    expect(circuitAmpacityA({ ...CIRCUIT, phase_count: 3 })).toBe(20);
    expect(circuitAmpacityA({ ...CIRCUIT, cross_section_mm2: 1.5, installation: "in_ground" })).toBe(22);
  });
});

describe("circuitWarnings", () => {
  it("returns nothing for a compliant circuit", () => {
    expect(circuitWarnings([CIRCUIT], SUPPLY, GEOMETRY)).toEqual([]);
  });

  describe("cable_ampacity_below_in", () => {
    it("does not warn at exactly the ampacity (Cu 2.5 mm² three-phase B2 = 20 A, B20)", () => {
      expect(circuitWarnings([{ ...CIRCUIT, phase_count: 3, rated_current_a: 20 }], null, null)).toEqual([]);
    });

    it("warns just above the ampacity (B25 on the same cable)", () => {
      expect(circuitWarnings([{ ...CIRCUIT, phase_count: 3, rated_current_a: 25 }], null, null)).toEqual([
        { code: "cable_ampacity_below_in", circuitId: "c1", circuitName: "Gniazda kuchnia", ampacityA: 20, ratedA: 25 },
      ]);
    });

    it("warns for B16 on 1.5 mm² in a conduit (16.5 A is fine, 15 A three-phase is not)", () => {
      const thin = { ...CIRCUIT, cross_section_mm2: 1.5 as const };
      expect(circuitWarnings([thin], null, null)).toEqual([]);
      expect(codes(circuitWarnings([{ ...thin, phase_count: 3 }], null, null))).toEqual(["cable_ampacity_below_in"]);
    });
  });

  describe("entry_side_not_in_cabinet", () => {
    it("warns when the cabinet has no entry on the circuit's side", () => {
      expect(circuitWarnings([{ ...CIRCUIT, entry_side: "left" }], SUPPLY, GEOMETRY)).toEqual([
        { code: "entry_side_not_in_cabinet", circuitId: "c1", circuitName: "Gniazda kuchnia", side: "left" },
      ]);
    });

    it("is skipped without a geometry", () => {
      expect(circuitWarnings([{ ...CIRCUIT, entry_side: "left" }], SUPPLY, null)).toEqual([]);
    });
  });

  describe("bars", () => {
    it("raises a single bars_missing for a cabinet with no bars", () => {
      expect(circuitWarnings([CIRCUIT], SUPPLY, { ...GEOMETRY, bars: [] })).toEqual([{ code: "bars_missing" }]);
    });

    it("counts one conductor per circuit plus the WLZ on each kind", () => {
      const geometry: CabinetGeometry = {
        ...GEOMETRY,
        bars: [bar("PE", [{ count: 2, minMm2: 1.5, maxMm2: 16 }]), bar("N", [{ count: 3, minMm2: 1.5, maxMm2: 16 }])],
      };
      const circuits = [CIRCUIT, { ...CIRCUIT, id: "c2", phase_count: 3 as const }];
      expect(circuitWarnings(circuits, SUPPLY, geometry)).toEqual([
        { code: "bar_terminals_insufficient", kind: "PE", needed: 3, available: 2 },
      ]);
      // Without a supply the WLZ is left out, and two terminals are enough.
      expect(circuitWarnings(circuits, null, geometry)).toEqual([]);
    });

    it("warns when a terminal's range does not take the conductor", () => {
      // 10 terminals, but only up to 6 mm²: the 10 mm² WLZ fits nowhere.
      const geometry: CabinetGeometry = {
        ...GEOMETRY,
        bars: [bar("PE", [{ count: 10, minMm2: 1.5, maxMm2: 6 }]), bar("N", [{ count: 10, minMm2: 1.5, maxMm2: 16 }])],
      };
      expect(circuitWarnings([CIRCUIT], SUPPLY, geometry)).toEqual([
        { code: "bar_terminals_insufficient", kind: "PE", needed: 2, available: 1 },
      ]);
    });

    it("assigns conductors so a wide terminal is not wasted on a thin one", () => {
      // One 1.5–4 and one 1.5–16 terminal: 2.5 goes to the narrow one, 10 to the wide one.
      const geometry: CabinetGeometry = {
        ...GEOMETRY,
        bars: [
          bar("PE", [
            { count: 1, minMm2: 1.5, maxMm2: 16 },
            { count: 1, minMm2: 1.5, maxMm2: 4 },
          ]),
          bar("N", [{ count: 5, minMm2: 1.5, maxMm2: 16 }]),
        ],
      };
      expect(circuitWarnings([CIRCUIT], SUPPLY, geometry)).toEqual([]);
    });

    it("warns for a kind with no bar at all", () => {
      const geometry: CabinetGeometry = { ...GEOMETRY, bars: [bar("PE", [{ count: 10, minMm2: 1.5, maxMm2: 16 }])] };
      expect(circuitWarnings([CIRCUIT], SUPPLY, geometry)).toEqual([
        { code: "bar_terminals_insufficient", kind: "N", needed: 2, available: 0 },
      ]);
    });

    it("is skipped without a geometry", () => {
      expect(circuitWarnings([CIRCUIT], SUPPLY, null)).toEqual([]);
    });
  });

  it("lists warnings per circuit in circuit order, then the bars", () => {
    const circuits: CircuitInput[] = [
      { ...CIRCUIT, id: "a", name: "A", phase_count: 3, rated_current_a: 25, entry_side: "left" },
      { ...CIRCUIT, id: "b", name: "B", entry_side: "right" },
    ];
    const geometry: CabinetGeometry = { ...GEOMETRY, bars: [bar("N", [{ count: 10, minMm2: 1.5, maxMm2: 16 }])] };
    expect(
      circuitWarnings(circuits, SUPPLY, geometry).map((w) => ("circuitId" in w ? `${w.code}:${w.circuitId}` : w.code)),
    ).toEqual([
      "cable_ampacity_below_in:a",
      "entry_side_not_in_cabinet:a",
      "entry_side_not_in_cabinet:b",
      "bar_terminals_insufficient",
    ]);
  });
});

describe("circuitWarningMessage", () => {
  it("names the circuit and formats numbers the Polish way", () => {
    const message = circuitWarningMessage({
      code: "cable_ampacity_below_in",
      circuitId: "c1",
      circuitName: "Oświetlenie",
      ampacityA: 16.5,
      ratedA: 20,
    });
    expect(message).toContain("Oświetlenie");
    expect(message).toContain("16,5");
    expect(message).toContain("20");
  });

  it("names the side in Polish", () => {
    const message = circuitWarningMessage({
      code: "entry_side_not_in_cabinet",
      circuitId: "c1",
      circuitName: "Piec",
      side: "left",
    });
    expect(message).toContain("Piec");
    expect(message).toContain("Lewo");
  });

  it("has text for every code", () => {
    const warnings: CircuitWarning[] = [
      { code: "cable_ampacity_below_in", circuitId: "c1", circuitName: "A", ampacityA: 20, ratedA: 25 },
      { code: "bars_missing" },
      { code: "bar_terminals_insufficient", kind: "PE", needed: 3, available: 2 },
      { code: "entry_side_not_in_cabinet", circuitId: "c1", circuitName: "A", side: "bottom" },
    ];
    for (const warning of warnings) {
      expect(circuitWarningMessage(warning).length).toBeGreaterThan(0);
    }
  });
});
