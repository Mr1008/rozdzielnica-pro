import { describe, expect, it } from "vitest";
import { CONDUCTOR_MATERIALS, WLZ_CROSS_SECTIONS_MM2, WLZ_INSTALLATIONS, type SupplyParams } from "./supply-params";
import {
  AMPACITY_A,
  LOADED_CONDUCTOR_COUNTS,
  REFERENCE_METHODS,
  REFERENCE_METHOD_BY_INSTALLATION,
  VOLTAGE_DROP_LIMIT_PERCENT,
  supplyWarningMessage,
  supplyWarnings,
  voltageDropPercent,
  type SupplyWarning,
} from "./supply-warnings";

/**
 * 25 A, TN-S, three-phase, 15 m of Cu 10 mm² in a flush conduit: raises nothing. TN-S so that the
 * PEN check stays out of tests that vary the cross-section or material for another warning.
 */
const COMPLIANT: SupplyParams = {
  premeter_protection_a: 25,
  earthing_system: "TN-S",
  phase_count: 3,
  wlz_length_m: 15,
  wlz_cross_section_mm2: 10,
  wlz_material: "Cu",
  wlz_installation: "conduit_flush",
};

function codes(params: SupplyParams): SupplyWarning["code"][] {
  return supplyWarnings(params).map((warning) => warning.code);
}

describe("AMPACITY_A", () => {
  it("has a positive entry for every material × loaded count × method × cross-section", () => {
    for (const material of CONDUCTOR_MATERIALS) {
      for (const loaded of LOADED_CONDUCTOR_COUNTS) {
        for (const method of REFERENCE_METHODS) {
          for (const section of WLZ_CROSS_SECTIONS_MM2) {
            const value: unknown = AMPACITY_A[material][loaded][method][section];
            expect(typeof value, `${material} ${String(loaded)} ${method} ${String(section)}`).toBe("number");
            expect(value).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("maps every installation method to a tabulated reference method", () => {
    for (const installation of WLZ_INSTALLATIONS) {
      expect(REFERENCE_METHODS).toContain(REFERENCE_METHOD_BY_INSTALLATION[installation]);
    }
  });

  // Checked by the electrician against HD 60364-5-52:2011 Tablica B.52.2 (PVC, two loaded conductors).
  // Changing a pinned value means re-checking it against the standard, not updating the test.
  it.each([
    ["Cu", "B2", [23, 30, 38, 52, 69, 90, 111]],
    ["Cu", "C", [27, 36, 46, 63, 85, 112, 138]],
    ["Cu", "D1", [29, 37, 46, 60, 78, 99, 119]],
    ["Al", "B2", [17.5, 24, 30, 41, 54, 71, 86]],
    ["Al", "C", [21, 28, 36, 49, 66, 83, 103]],
    ["Al", "D1", [22, 29, 36, 47, 61, 77, 93]],
  ] as const)("pins the verified B.52.2 column %s %s", (material, method, expected) => {
    expect(WLZ_CROSS_SECTIONS_MM2.map((section) => AMPACITY_A[material][2][method][section])).toEqual(expected);
  });

  // Checked by the electrician against HD 60364-5-52:2011 Tablica B.52.4 (PVC, three loaded conductors).
  it.each([
    ["Cu", "B2", [20, 27, 34, 46, 62, 80, 99]],
    ["Cu", "C", [24, 32, 41, 57, 76, 96, 119]],
    ["Cu", "D1", [24, 30, 38, 50, 64, 82, 98]],
    ["Al", "B2", [15.5, 21, 27, 36, 48, 62, 77]],
    ["Al", "C", [18.5, 25, 32, 44, 59, 73, 90]],
    ["Al", "D1", [18.5, 24, 30, 39, 50, 64, 77]],
  ] as const)("pins the verified B.52.4 column %s %s", (material, method, expected) => {
    expect(WLZ_CROSS_SECTIONS_MM2.map((section) => AMPACITY_A[material][3][method][section])).toEqual(expected);
  });

  it("grows with the cross-section in every column", () => {
    for (const material of CONDUCTOR_MATERIALS) {
      for (const loaded of LOADED_CONDUCTOR_COUNTS) {
        for (const method of REFERENCE_METHODS) {
          const column = WLZ_CROSS_SECTIONS_MM2.map((section) => AMPACITY_A[material][loaded][method][section]);
          expect(column).toEqual([...column].sort((a, b) => a - b));
        }
      }
    }
  });
});

describe("supplyWarnings", () => {
  it("returns nothing for a compliant supply", () => {
    expect(supplyWarnings(COMPLIANT)).toEqual([]);
  });

  describe("wlz_ampacity_below_protection", () => {
    // Cu 2.5 mm² in a conduit (B2), three loaded conductors: 20 A in the table. 1 m keeps ΔU out of it.
    const base: SupplyParams = {
      ...COMPLIANT,
      wlz_cross_section_mm2: 2.5,
      wlz_length_m: 1,
      wlz_installation: "conduit_surface",
    };

    it("does not warn when the protection equals the ampacity", () => {
      expect(AMPACITY_A.Cu[3].B2[2.5]).toBe(20);
      expect(codes({ ...base, premeter_protection_a: 20 })).toEqual([]);
    });

    it("warns when the protection exceeds the ampacity", () => {
      expect(supplyWarnings({ ...base, premeter_protection_a: 25 })).toEqual([
        { code: "wlz_ampacity_below_protection", ampacityA: 20, protectionA: 25 },
      ]);
    });

    it("uses two loaded conductors for a single-phase WLZ", () => {
      // Cu 2.5 mm² B2 with two loaded conductors carries 23 A, so 20 A does not warn either way.
      expect(codes({ ...base, phase_count: 1, premeter_protection_a: 20 })).not.toContain(
        "wlz_ampacity_below_protection",
      );
      expect(codes({ ...base, phase_count: 1, premeter_protection_a: 25 })).toContain("wlz_ampacity_below_protection");
    });

    it("warns for 63 A on Cu 10 mm² in a conduit", () => {
      expect(codes({ ...COMPLIANT, premeter_protection_a: 63 })).toContain("wlz_ampacity_below_protection");
    });
  });

  describe("aluminium_below_minimum", () => {
    // 1 m and 16 A keep ampacity and ΔU out of these cases.
    const base: SupplyParams = { ...COMPLIANT, premeter_protection_a: 16, wlz_length_m: 1, wlz_material: "Al" };

    it("does not warn for Al 16 mm²", () => {
      expect(codes({ ...base, wlz_cross_section_mm2: 16 })).toEqual([]);
    });

    it("warns for Al 10 mm²", () => {
      expect(codes({ ...base, wlz_cross_section_mm2: 10 })).toEqual(["aluminium_below_minimum"]);
    });
  });

  describe("pen_below_minimum", () => {
    const base: SupplyParams = { ...COMPLIANT, premeter_protection_a: 16, wlz_length_m: 1, earthing_system: "TN-C" };

    it("does not warn for TN-C with Cu 10 mm²", () => {
      expect(codes({ ...base, wlz_cross_section_mm2: 10 })).toEqual([]);
    });

    it("warns for TN-C with Cu 6 mm²", () => {
      expect(supplyWarnings({ ...base, wlz_cross_section_mm2: 6 })).toEqual([
        { code: "pen_below_minimum", minimumMm2: 10 },
      ]);
    });

    it("warns for TN-C-S with Cu 6 mm², where the PEN splits in the switchboard", () => {
      expect(codes({ ...base, earthing_system: "TN-C-S", wlz_cross_section_mm2: 6 })).toEqual(["pen_below_minimum"]);
    });

    it("does not warn for TN-S with Cu 6 mm²", () => {
      expect(codes({ ...base, earthing_system: "TN-S", wlz_cross_section_mm2: 6 })).toEqual([]);
    });

    it("asks for 16 mm² when the conductor is aluminium", () => {
      expect(supplyWarnings({ ...base, wlz_material: "Al", wlz_cross_section_mm2: 10 })).toContainEqual({
        code: "pen_below_minimum",
        minimumMm2: 16,
      });
      expect(codes({ ...base, wlz_material: "Al", wlz_cross_section_mm2: 16 })).toEqual([]);
    });
  });

  describe("voltage_drop_high", () => {
    const reference: SupplyParams = { ...COMPLIANT, phase_count: 1 };

    it("is ≈ 0.58 % for 25 A, 15 m, Cu 10 mm² single-phase, and warns alone", () => {
      expect(voltageDropPercent(reference)).toBeCloseTo(0.58, 2);
      expect(supplyWarnings(reference)).toEqual([
        { code: "voltage_drop_high", percent: 0.59, limitPercent: VOLTAGE_DROP_LIMIT_PERCENT },
      ]);
    });

    it("warns just above the limit instead of rounding it away (13 m ≈ 0.5047 %)", () => {
      const boundary = { ...reference, wlz_length_m: 13 };
      expect(voltageDropPercent(boundary)).toBeCloseTo(0.5047, 4);
      expect(supplyWarnings(boundary)).toEqual([
        { code: "voltage_drop_high", percent: 0.51, limitPercent: VOLTAGE_DROP_LIMIT_PERCENT },
      ]);
    });

    it("is ≈ 0.29 % for the same WLZ three-phase, and does not warn", () => {
      expect(voltageDropPercent(COMPLIANT)).toBeCloseTo(0.29, 2);
      expect(codes(COMPLIANT)).not.toContain("voltage_drop_high");
    });

    it("uses the lower conductivity of aluminium", () => {
      const aluminium = { ...COMPLIANT, wlz_material: "Al" as const, wlz_cross_section_mm2: 16 as const };
      const copper = { ...aluminium, wlz_material: "Cu" as const };
      expect(voltageDropPercent(aluminium) / voltageDropPercent(copper)).toBeCloseTo(56 / 34, 6);
    });
  });

  it("lists several warnings in a stable order", () => {
    const params: SupplyParams = {
      premeter_protection_a: 63,
      earthing_system: "TN-C",
      phase_count: 1,
      wlz_length_m: 30,
      wlz_cross_section_mm2: 10,
      wlz_material: "Al",
      wlz_installation: "conduit_flush",
    };
    expect(codes(params)).toEqual([
      "wlz_ampacity_below_protection",
      "aluminium_below_minimum",
      "pen_below_minimum",
      "voltage_drop_high",
    ]);
  });
});

describe("supplyWarningMessage", () => {
  it("formats numbers the Polish way", () => {
    const message = supplyWarningMessage({ code: "voltage_drop_high", percent: 0.58, limitPercent: 0.5 });
    expect(message).toContain("0,58");
    expect(message).toContain("0,5");
  });

  it("names the ampacity and the protection", () => {
    const message = supplyWarningMessage({ code: "wlz_ampacity_below_protection", ampacityA: 17.5, protectionA: 20 });
    expect(message).toContain("17,5");
    expect(message).toContain("20");
  });

  it("has text for every code", () => {
    const warnings: SupplyWarning[] = [
      { code: "wlz_ampacity_below_protection", ampacityA: 20, protectionA: 25 },
      { code: "aluminium_below_minimum" },
      { code: "pen_below_minimum", minimumMm2: 10 },
      { code: "voltage_drop_high", percent: 0.58, limitPercent: 0.5 },
    ];
    for (const warning of warnings) {
      expect(supplyWarningMessage(warning).length).toBeGreaterThan(0);
    }
  });
});
