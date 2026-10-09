import { describe, expect, it } from "vitest";
import {
  WIRE_BEND_MM,
  buildCableTies,
  buildDrawnCables,
  buildDrawnWires,
  sagLimits,
  wirePathD,
} from "@/lib/cabinet-drawing";
import { wireLengthsBySection, wiringWarnings } from "@/lib/cabinet-wiring";
import { computeMatchView } from "@/lib/device-matching-server";
import { buildLayoutDrawing, computeLayoutView, computeWiring } from "@/lib/layout-server";
import { realisticFixture, worstCaseFixture, type RenderFixture } from "@/lib/wiring-bench-fixtures";
import { buildWiringDrawing } from "@/lib/wiring-island";

/** The page's server path up to the drawing, for one bench fixture. */
function render(fixture: RenderFixture) {
  const matchView = computeMatchView(fixture.context);
  const layoutView = computeLayoutView(matchView, fixture.context, fixture.placements);
  return { matchView, layoutView, drawing: buildLayoutDrawing(layoutView, matchView, fixture.context) };
}

describe.each([
  ["realistic", realisticFixture],
  ["worst case", worstCaseFixture],
])("the wiring island on the %s fixture", (_name, fixture) => {
  const built = fixture();
  const { matchView, layoutView, drawing } = render(built);

  it("hands the island a placed layout's router input", () => {
    expect(layoutView?.state).toBe("placed");
    expect(drawing.wiring).not.toBeNull();
    expect(drawing.devices.length).toBeGreaterThan(0);
  });

  it("survives serialisation, as island props must", () => {
    expect(JSON.parse(JSON.stringify(drawing.wiring))).toEqual(drawing.wiring);
  });

  it("draws exactly what the server path drew before the island", () => {
    const conductors = computeWiring(layoutView, matchView, built.context);
    const names = { circuits: new Map(built.context.circuits.map((c) => [c.id, c.name])), devices: drawing.devices };
    const wiring = drawing.wiring;
    if (wiring === null) throw new Error("expected wiring data");
    const island = buildWiringDrawing(JSON.parse(JSON.stringify(wiring)) as typeof wiring, drawing.devices);
    expect(conductors.length).toBeGreaterThan(0);
    expect(island.wires).toEqual(buildDrawnWires(conductors, names));
    expect(island.cables).toEqual(buildDrawnCables(conductors));
    expect(island.ties).toEqual(buildCableTies(conductors));
    expect(island.ties.length).toBeGreaterThan(0);
    expect(island.lengths).toEqual(wireLengthsBySection(conductors));
    expect(island.warnings).toEqual(wiringWarnings(conductors));
  });

  it("draws the schematic variant's wires, and no ties, when asked to", () => {
    const conductors = computeWiring(layoutView, matchView, built.context);
    const names = { circuits: new Map(built.context.circuits.map((c) => [c.id, c.name])), devices: drawing.devices };
    const wiring = drawing.wiring;
    if (wiring === null) throw new Error("expected wiring data");
    const island = buildWiringDrawing(wiring, drawing.devices, "schematic");
    expect(island.wires).toEqual(buildDrawnWires(conductors, names, "schematic"));
    expect(island.ties).toEqual([]);
  });

  it("keeps the schematic variant as it was: every run sagging per sagLimits, every corner a 4 mm bend", () => {
    const conductors = computeWiring(layoutView, matchView, built.context);
    const limits = sagLimits(conductors, "schematic");
    const byKey = new Map(conductors.map((conductor, index) => [conductor.key, { conductor, index }]));
    for (const wire of buildDrawnWires(conductors, undefined, "schematic")) {
      const found = byKey.get(wire.key);
      if (found === undefined) throw new Error("unknown wire");
      expect(wire.d).toBe(wirePathD(found.conductor.path, limits[found.index], WIRE_BEND_MM));
    }
  });

  it("draws every realistic circuit and WLZ core taut — straight runs and bends — with sag left to the feeds", () => {
    const conductors = computeWiring(layoutView, matchView, built.context);
    const byKey = new Map(conductors.map((conductor) => [conductor.key, conductor]));
    const wires = buildDrawnWires(conductors, undefined, "realistic");
    expect(wires.some((wire) => wire.kind !== "feed")).toBe(true);
    for (const wire of wires) {
      if (wire.kind === "feed") continue;
      const path = byKey.get(wire.key)?.path ?? [];
      // Every quadratic curve is a bend whose control point is a corner of the route — never a sag.
      const controls = [...wire.d.matchAll(/Q(-?[\d.]+) (-?[\d.]+) /g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
      for (const control of controls) {
        expect(
          path.some((corner) => Math.abs(corner.x - control.x) < 0.01 && Math.abs(corner.y - control.y) < 0.01),
        ).toBe(true);
      }
    }
  });

  it("keeps prices and other snapshot columns off the wire", () => {
    const keys = new Set(drawing.wiring?.devices.flatMap((device) => Object.keys(device)));
    expect(keys.has("price_grosze")).toBe(false);
    expect(keys.has("name")).toBe(false);
  });
});

describe("the wiring island outside a placed layout", () => {
  it("gets no router input and draws no devices", () => {
    const built = realisticFixture();
    const matchView = computeMatchView(built.context);
    const layoutView = computeLayoutView(matchView, built.context, []);
    expect(layoutView?.state).toBe("missing");
    const drawing = buildLayoutDrawing(layoutView, matchView, built.context);
    expect(drawing).toEqual({ devices: [], wiring: null });
  });
});
