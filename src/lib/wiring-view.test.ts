import { describe, expect, it } from "vitest";
import { WIRING_VIEW_PARAM, wiringViewFromParam, wiringViewHrefs } from "./wiring-view";

describe("wiringViewFromParam", () => {
  it("reads `schematic` as the schematic view", () => {
    expect(wiringViewFromParam("schematic")).toBe("schematic");
  });

  it("reads an absent or any other value as the realistic view", () => {
    for (const value of [null, "", "realistic", "Schematic", "schematic ", "1"]) {
      expect(wiringViewFromParam(value)).toBe("realistic");
    }
  });
});

describe("wiringViewHrefs", () => {
  it("links both views to the same page and section, the parameter only on the schematic one", () => {
    expect(wiringViewHrefs("/dashboard/projects/abc", "layout")).toEqual({
      realistic: "/dashboard/projects/abc#layout",
      schematic: "/dashboard/projects/abc?wiring=schematic#layout",
    });
  });

  it("round-trips through the parameter", () => {
    for (const [variant, href] of Object.entries(wiringViewHrefs("/p", "a"))) {
      const url = new URL(href, "http://localhost");
      expect(wiringViewFromParam(url.searchParams.get(WIRING_VIEW_PARAM))).toBe(variant);
      expect(url.hash).toBe("#a");
    }
  });
});
