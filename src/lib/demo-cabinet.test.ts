import { describe, expect, it } from "vitest";
import { parseCabinetGeometry } from "./cabinet-geometry";
import { DEMO_CABINET_GEOMETRY, HERO_CABINET_GEOMETRY } from "./demo-cabinet";

describe.each([
  ["DEMO_CABINET_GEOMETRY", DEMO_CABINET_GEOMETRY],
  ["HERO_CABINET_GEOMETRY", HERO_CABINET_GEOMETRY],
])("%s", (_name, DEMO_CABINET_GEOMETRY) => {
  it("passes parseCabinetGeometry unchanged", () => {
    expect(parseCabinetGeometry(DEMO_CABINET_GEOMETRY)).toEqual({ ok: true, geometry: DEMO_CABINET_GEOMETRY });
  });

  it("shows every element kind the drawing renders", () => {
    expect(DEMO_CABINET_GEOMETRY.rails.length).toBeGreaterThan(0);
    expect(DEMO_CABINET_GEOMETRY.entries.length).toBeGreaterThan(0);
    expect(DEMO_CABINET_GEOMETRY.bars.map((bar) => bar.kind).sort()).toEqual(["N", "PE"]);
  });
});
