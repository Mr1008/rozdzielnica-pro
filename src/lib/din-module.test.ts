import { describe, expect, it } from "vitest";
import { DIN_MODULE_MM, mmFromModules, modulesFromMm } from "./din-module";

describe("mmFromModules", () => {
  it("converts module counts to millimetres", () => {
    expect(DIN_MODULE_MM).toBe(17.5);
    expect(mmFromModules(1)).toBe(17.5);
    expect(mmFromModules(3)).toBe(52.5);
    expect(mmFromModules(1.5)).toBe(26.25);
  });
});

describe("modulesFromMm", () => {
  it("converts millimetres to modules in 0.5 steps", () => {
    expect(modulesFromMm(17.5)).toBe(1);
    expect(modulesFromMm(52.5)).toBe(3);
    expect(modulesFromMm(26.25)).toBe(1.5);
    expect(modulesFromMm(8.75)).toBe(0.5);
    expect(modulesFromMm(70)).toBe(4);
  });

  it("returns null for a width that is not a multiple of 8.75 mm", () => {
    expect(modulesFromMm(18)).toBeNull();
    expect(modulesFromMm(36)).toBeNull();
    expect(modulesFromMm(17.4)).toBeNull();
  });

  it("returns null for a non-positive or non-finite width", () => {
    expect(modulesFromMm(0)).toBeNull();
    expect(modulesFromMm(-17.5)).toBeNull();
    expect(modulesFromMm(Number.NaN)).toBeNull();
  });

  it("round-trips every half-module step", () => {
    for (let modules = 0.5; modules <= 24; modules += 0.5) {
      expect(modulesFromMm(mmFromModules(modules))).toBe(modules);
    }
  });
});
