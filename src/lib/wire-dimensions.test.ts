import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CIRCUIT_CROSS_SECTIONS_MM2 } from "@/lib/circuit-params";
import { WLZ_CROSS_SECTIONS_MM2 } from "@/lib/supply-params";
import {
  CABLE_CORE_COUNTS,
  CABLE_OUTER_DIAMETER_MM,
  CONDUCTOR_OUTER_DIAMETER_MM,
  FERRULE,
  FERRULE_COLOUR_TOKENS,
  WIRE_CROSS_SECTIONS_MM2,
  cableDiameterMm,
  conductorDiameterMm,
} from "@/lib/wire-dimensions";

const css = readFileSync(new URL("../styles/global.css", import.meta.url), "utf8");

describe("wire dimensions", () => {
  it("cover every circuit and WLZ cross-section", () => {
    const union = [...new Set([...CIRCUIT_CROSS_SECTIONS_MM2, ...WLZ_CROSS_SECTIONS_MM2])].sort((a, b) => a - b);
    expect([...WIRE_CROSS_SECTIONS_MM2]).toEqual(union);
  });

  it("has every conductor, cable and ferrule combination", () => {
    for (const section of WIRE_CROSS_SECTIONS_MM2) {
      expect(conductorDiameterMm(section)).toBeGreaterThan(0);
      expect(FERRULE[section].lengthMm).toBeGreaterThan(0);
      for (const cores of CABLE_CORE_COUNTS) {
        expect(cableDiameterMm(cores, section)).toBeGreaterThan(0);
      }
    }
    expect(Object.keys(CONDUCTOR_OUTER_DIAMETER_MM)).toHaveLength(WIRE_CROSS_SECTIONS_MM2.length);
    expect(Object.keys(CABLE_OUTER_DIAMETER_MM)).toHaveLength(CABLE_CORE_COUNTS.length);
  });

  it("grows strictly with cross-section", () => {
    const strictlyIncreasing = (values: number[]) => values.every((v, i) => i === 0 || v > values[i - 1]);
    expect(strictlyIncreasing(WIRE_CROSS_SECTIONS_MM2.map((s) => conductorDiameterMm(s)))).toBe(true);
    for (const cores of CABLE_CORE_COUNTS) {
      expect(strictlyIncreasing(WIRE_CROSS_SECTIONS_MM2.map((s) => cableDiameterMm(cores, s)))).toBe(true);
    }
  });

  it("grows with the core count", () => {
    for (const section of WIRE_CROSS_SECTIONS_MM2) {
      const diameters = CABLE_CORE_COUNTS.map((cores) => cableDiameterMm(cores, section));
      expect(diameters.every((d, i) => i === 0 || d > diameters[i - 1])).toBe(true);
    }
  });

  it("makes each sheath wider than one core of its cross-section", () => {
    for (const section of WIRE_CROSS_SECTIONS_MM2) {
      for (const cores of CABLE_CORE_COUNTS) {
        expect(cableDiameterMm(cores, section)).toBeGreaterThan(conductorDiameterMm(section));
      }
    }
  });

  it("uses only ferrule colours that exist as tokens in global.css", () => {
    for (const section of WIRE_CROSS_SECTIONS_MM2) {
      expect(FERRULE_COLOUR_TOKENS).toContain(FERRULE[section].colourToken);
    }
    for (const token of [...FERRULE_COLOUR_TOKENS, "wire-tie", "wire-sheath", "wire-sheen"]) {
      expect(css).toContain(`--${token}:`);
      expect(css).toContain(`--color-${token}: var(--${token});`);
    }
  });
});
