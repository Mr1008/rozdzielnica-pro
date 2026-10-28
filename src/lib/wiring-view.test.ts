import { describe, expect, it } from "vitest";
import {
  DRAWING_VIEWS,
  WIRING_VIEW_PARAM,
  drawingViewFromParam,
  wiringVariantOf,
  wiringViewHrefs,
} from "./wiring-view";
import { WIRING_VARIANTS } from "./cabinet-drawing";

describe("drawingViewFromParam", () => {
  it("reads `schematic` and `3d` as their views", () => {
    expect(drawingViewFromParam("schematic")).toBe("schematic");
    expect(drawingViewFromParam("3d")).toBe("3d");
  });

  it("reads an absent or any other value as the realistic view", () => {
    for (const value of [null, "", "realistic", "Schematic", "schematic ", "3D", "3d ", "1"]) {
      expect(drawingViewFromParam(value)).toBe("realistic");
    }
  });
});

describe("wiringVariantOf", () => {
  it("never makes `3d` a 2D wiring variant: the drawing and the printout must not see it", () => {
    expect(WIRING_VARIANTS).not.toContain("3d");
  });

  it("draws the 3D view's 2D fallback realistic and keeps the 2D views as they are", () => {
    expect(wiringVariantOf("3d")).toBe("realistic");
    expect(wiringVariantOf("realistic")).toBe("realistic");
    expect(wiringVariantOf("schematic")).toBe("schematic");
  });
});

describe("wiringViewHrefs", () => {
  it("links every view to the same page and section, the parameter only on the non-default ones", () => {
    expect(wiringViewHrefs("/dashboard/projects/abc", "layout")).toEqual({
      realistic: "/dashboard/projects/abc#layout",
      schematic: "/dashboard/projects/abc?wiring=schematic#layout",
      "3d": "/dashboard/projects/abc?wiring=3d#layout",
    });
  });

  it("has one link per view, in the switch's order", () => {
    expect(Object.keys(wiringViewHrefs("/p", "a"))).toEqual([...DRAWING_VIEWS]);
  });

  it("round-trips through the parameter", () => {
    for (const [view, href] of Object.entries(wiringViewHrefs("/p", "a"))) {
      const url = new URL(href, "http://localhost");
      expect(drawingViewFromParam(url.searchParams.get(WIRING_VIEW_PARAM))).toBe(view);
      expect(url.hash).toBe("#a");
    }
  });
});
