import { describe, expect, it } from "vitest";
import {
  BEND_RADIUS_DIAMETERS,
  BUSBAR_OVERHANG_MM,
  BUSBAR_TOOTH_DEPTH_MM,
  MAX_SAG_MM,
  MIN_SAG_SPAN_MM,
  PEN_DASH,
  REALISTIC_WIRE_STYLES,
  SHEATH_STUB_MM,
  TIE_BAND_MM,
  TIE_PITCH_MM,
  WIRE_BEND_MM,
  WIRE_STYLES,
  bendRadiusMm,
  buildCableTies,
  buildDrawnBusbars,
  buildDrawnCables,
  buildDrawnDevices,
  buildDrawnWires,
  clampRect,
  clipRect,
  deviceLabelLines,
  elementRect,
  ferruleStyle,
  entryRect,
  groupOutlines,
  issueElements,
  labelFontSizeMm,
  sagDepthMm,
  sagLimits,
  wirePathD,
  wireTitle,
  type DrawableDevice,
  type DrawnDevice,
} from "./cabinet-drawing";
import { RAIL_HEIGHT_MM, parseCabinetGeometry, type CabinetGeometry } from "./cabinet-geometry";
import { WIRE_CLEARANCE_MM, type Busbar, type Conductor } from "./cabinet-wiring";
import { WIRE_CROSS_SECTIONS_MM2, cableDiameterMm } from "./wire-dimensions";

const INTERIOR = { widthMm: 400, heightMm: 300, depthMm: 100 };

/**
 * The control points of a drawn path's quadratic curves that are no corner of its route — its sags. A
 * bend's control point is the corner it rounds (`wirePathD`); a sag's lies below the run's middle.
 */
function sagControls(d: string, path: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  return [...d.matchAll(/Q(-?[\d.]+) (-?[\d.]+) /g)]
    .map((match) => ({ x: Number(match[1]), y: Number(match[2]) }))
    .filter(
      (control) =>
        !path.some((corner) => Math.abs(corner.x - control.x) < 0.01 && Math.abs(corner.y - control.y) < 0.01),
    );
}

/** The bug report's repro: rail 3 ends at 350 + 35 = 385 mm, below the 300 mm interior. */
const REPRO: CabinetGeometry = {
  version: 1,
  interior: INTERIOR,
  rails: [
    { xMm: 0, yMm: 100, lengthMm: 400 },
    { xMm: 0, yMm: 225, lengthMm: 400 },
    { xMm: 0, yMm: 350, lengthMm: 400 },
  ],
  entries: [{ side: "top", offsetMm: 0, lengthMm: 400 }],
  bars: [
    {
      kind: "PE",
      orientation: "vertical",
      xMm: 380,
      yMm: 10,
      lengthMm: 80,
      heightMm: 15,
      zMm: 20,
      terminalGroups: [{ count: 8, minMm2: 1.5, maxMm2: 16 }],
    },
  ],
};

describe("clipRect", () => {
  it("keeps a rectangle that lies inside the interior", () => {
    expect(clipRect({ x: 10, y: 20, w: 30, h: 40 }, INTERIOR)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("cuts the part past the right and bottom edges", () => {
    expect(clipRect({ x: 0, y: 225, w: 450, h: RAIL_HEIGHT_MM + 100 }, INTERIOR)).toEqual({
      x: 0,
      y: 225,
      w: 400,
      h: 75,
    });
  });

  it("cuts the part before the left and top edges", () => {
    expect(clipRect({ x: -10, y: -5, w: 20, h: 10 }, INTERIOR)).toEqual({ x: 0, y: 0, w: 10, h: 5 });
  });

  it("returns null for a rectangle wholly outside or only touching an edge", () => {
    expect(clipRect({ x: 0, y: 350, w: 400, h: RAIL_HEIGHT_MM }, INTERIOR)).toBeNull();
    expect(clipRect({ x: 400, y: 0, w: 10, h: 10 }, INTERIOR)).toBeNull();
  });
});

describe("clampRect", () => {
  it("leaves a rectangle inside the interior as it is", () => {
    expect(clampRect({ x: 10, y: 20, w: 30, h: 40 }, INTERIOR)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
  });

  it("squashes a rectangle wholly below the interior onto the bottom edge", () => {
    expect(clampRect({ x: 0, y: 350, w: 400, h: RAIL_HEIGHT_MM }, INTERIOR)).toEqual({ x: 0, y: 300, w: 400, h: 0 });
  });

  it("squashes a rectangle wholly left of the interior onto the left edge", () => {
    expect(clampRect({ x: -50, y: 20, w: 30, h: 40 }, INTERIOR)).toEqual({ x: 0, y: 20, w: 0, h: 40 });
  });
});

describe("elementRect", () => {
  it("finds each kind of element by its index", () => {
    expect(elementRect(REPRO, { kind: "rail", index: 2 })).toEqual({ x: 0, y: 350, w: 400, h: RAIL_HEIGHT_MM });
    expect(elementRect(REPRO, { kind: "entry", index: 0 })).toEqual(entryRect(REPRO.entries[0], INTERIOR));
    expect(elementRect(REPRO, { kind: "bar", index: 0 })).toEqual({ x: 380, y: 10, w: 15, h: 80 });
  });

  it("returns null for an index the geometry does not have", () => {
    expect(elementRect(REPRO, { kind: "rail", index: 3 })).toBeNull();
    expect(elementRect(REPRO, { kind: "bar", index: 1 })).toBeNull();
  });
});

describe("entryRect", () => {
  it("lays each side's strip along its own edge, inside the interior", () => {
    const thickness = 9; // 3% of the shorter 300 mm side
    expect(entryRect({ side: "top", offsetMm: 10, lengthMm: 50 }, INTERIOR)).toEqual({
      x: 10,
      y: 0,
      w: 50,
      h: thickness,
    });
    expect(entryRect({ side: "bottom", offsetMm: 10, lengthMm: 50 }, INTERIOR)).toEqual({
      x: 10,
      y: 300 - thickness,
      w: 50,
      h: thickness,
    });
    expect(entryRect({ side: "left", offsetMm: 10, lengthMm: 50 }, INTERIOR)).toEqual({
      x: 0,
      y: 10,
      w: thickness,
      h: 50,
    });
    expect(entryRect({ side: "right", offsetMm: 10, lengthMm: 50 }, INTERIOR)).toEqual({
      x: 400 - thickness,
      y: 10,
      w: thickness,
      h: 50,
    });
  });
});

describe("issueElements", () => {
  it("lists the repro's out-of-bounds rail, once", () => {
    const parsed = parseCabinetGeometry(REPRO);
    expect(parsed.ok).toBe(false);
    expect(issueElements(parsed.ok ? [] : parsed.issues)).toEqual([{ kind: "rail", index: 2 }]);
  });

  it("dedupes elements with several issues and skips geometry-wide ones", () => {
    expect(
      issueElements([
        { code: "no_entries" },
        { code: "rails_overlap", element: { kind: "rail", index: 1 } },
        { code: "rail_overlaps_bar", element: { kind: "rail", index: 1 } },
        { code: "bar_outside_interior", element: { kind: "bar", index: 0 } },
      ]),
    ).toEqual([
      { kind: "rail", index: 1 },
      { kind: "bar", index: 0 },
    ]);
  });
});

describe("deviceLabelLines", () => {
  it("labels an MCB by its B rating", () => {
    expect(deviceLabelLines("mcb", 16, null)).toEqual(["B16"]);
  });

  it("labels an RCD with its rating and residual current", () => {
    expect(deviceLabelLines("rcd", 40, 30)).toEqual(["RCD", "40A", "30mA"]);
  });

  it("labels an RCBO with its B rating and residual current", () => {
    expect(deviceLabelLines("rcbo", 10, 30)).toEqual(["RCBO", "B10", "30mA"]);
  });

  it("labels the main switch and leaves out a missing rating", () => {
    expect(deviceLabelLines("main_switch", 40, null)).toEqual(["FR", "40A"]);
    expect(deviceLabelLines("main_switch", null, null)).toEqual(["FR"]);
  });
});

describe("labelFontSizeMm", () => {
  it("is capped for a roomy device", () => {
    expect(labelFontSizeMm({ x: 0, y: 0, w: 36, h: 85 }, ["B16"])).toBe(8);
  });

  it("shrinks until the longest line fits the width", () => {
    const size = labelFontSizeMm({ x: 0, y: 0, w: 18, h: 85 }, ["RCBO", "B10", "30mA"]);
    expect(size).toBeLessThan(8);
    expect(size * 0.6 * 4).toBeLessThanOrEqual(18);
  });
});

const GEOMETRY_WITH_RAILS: CabinetGeometry = {
  version: 1,
  interior: { widthMm: 400, heightMm: 400, depthMm: 100 },
  rails: [
    { xMm: 20, yMm: 80, lengthMm: 360 },
    { xMm: 20, yMm: 240, lengthMm: 360 },
  ],
  entries: [{ side: "top", offsetMm: 0, lengthMm: 400 }],
  bars: [],
};

function device(id: string, overrides: Partial<DrawableDevice> = {}): DrawableDevice {
  return {
    id,
    role: "mcb",
    rcd_group_id: null,
    width_mm: 18,
    height_mm: 85,
    rated_current_a: 16,
    residual_current_ma: null,
    n_terminal_side: null,
    ...overrides,
  };
}

describe("buildDrawnDevices", () => {
  const groups = [{ id: "g1", label: "RCD 1" }];

  it("places each device on its rail, centred on the rail, with its group", () => {
    const drawn = buildDrawnDevices(
      [device("a", { role: "rcd", rcd_group_id: "g1", width_mm: 36, rated_current_a: 40, residual_current_ma: 30 })],
      [{ projectDeviceId: "a", railIndex: 1, xMm: 18 }],
      GEOMETRY_WITH_RAILS,
      groups,
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0]).toMatchObject({
      id: "a",
      role: "rcd",
      railIndex: 1,
      groupKey: "g1",
      groupLabel: "RCD 1",
      lines: ["RCD", "40A", "30mA"],
    });
    // Rail 2: x 20 + 18, centre y 240 + RAIL_HEIGHT_MM / 2, device 85 mm tall.
    expect(drawn[0].rect).toEqual({ x: 38, y: 240 + RAIL_HEIGHT_MM / 2 - 42.5, w: 36, h: 85 });
  });

  it("gives the main switch and ungrouped devices no group", () => {
    const drawn = buildDrawnDevices(
      [device("m", { role: "main_switch", rcd_group_id: "g1" }), device("u")],
      [
        { projectDeviceId: "m", railIndex: 0, xMm: 0 },
        { projectDeviceId: "u", railIndex: 0, xMm: 36 },
      ],
      GEOMETRY_WITH_RAILS,
      groups,
    );
    expect(drawn.map((entry) => entry.groupKey)).toEqual([null, null]);
  });

  it("carries each device's own N terminal side, and none for a device without N", () => {
    const drawn = buildDrawnDevices(
      [
        device("l", { role: "rcd", rcd_group_id: "g1", n_terminal_side: "left" }),
        device("r", { role: "rcd", rcd_group_id: "g1", n_terminal_side: "right" }),
        device("n"),
      ],
      [
        { projectDeviceId: "l", railIndex: 0, xMm: 0 },
        { projectDeviceId: "r", railIndex: 0, xMm: 36 },
        { projectDeviceId: "n", railIndex: 0, xMm: 72 },
      ],
      GEOMETRY_WITH_RAILS,
      groups,
    );
    expect(drawn.map((entry) => [entry.id, entry.nTerminalSide])).toEqual([
      ["l", "left"],
      ["r", "right"],
      ["n", null],
    ]);
  });

  it("draws a catalog PE/N bar as a bar of its kind: no label lines, no group, no N mark", () => {
    const drawn = buildDrawnDevices(
      [
        device("pe", { role: "pe_bar", width_mm: 35, height_mm: 15, rated_current_a: null }),
        device("n", { role: "n_bar", width_mm: 35, height_mm: 15, rated_current_a: null }),
      ],
      [
        { projectDeviceId: "pe", railIndex: 0, xMm: 0 },
        { projectDeviceId: "n", railIndex: 0, xMm: 35 },
      ],
      GEOMETRY_WITH_RAILS,
      groups,
    );
    expect(drawn.map((entry) => [entry.role, entry.lines, entry.groupKey, entry.nTerminalSide])).toEqual([
      ["pe_bar", [], null, null],
      ["n_bar", [], null, null],
    ]);
    // Centred on its rail like any device: 15 mm tall around rail 1's centre line.
    expect(drawn[0].rect).toEqual({ x: 20, y: 80 + RAIL_HEIGHT_MM / 2 - 7.5, w: 35, h: 15 });
  });

  it("skips a placement whose device or rail does not exist", () => {
    const drawn = buildDrawnDevices(
      [device("a")],
      [
        { projectDeviceId: "ghost", railIndex: 0, xMm: 0 },
        { projectDeviceId: "a", railIndex: 9, xMm: 0 },
      ],
      GEOMETRY_WITH_RAILS,
      groups,
    );
    expect(drawn).toEqual([]);
  });
});

describe("groupOutlines", () => {
  it("wraps a group's devices on one rail in a padded box", () => {
    const drawn = buildDrawnDevices(
      [
        device("r", { role: "rcd", rcd_group_id: "g1", width_mm: 36 }),
        device("m", { rcd_group_id: "g1" }),
        device("u"),
      ],
      [
        { projectDeviceId: "r", railIndex: 0, xMm: 0 },
        { projectDeviceId: "m", railIndex: 0, xMm: 36 },
        { projectDeviceId: "u", railIndex: 0, xMm: 100 },
      ],
      GEOMETRY_WITH_RAILS,
      [{ id: "g1", label: "RCD 1" }],
    );
    const outlines = groupOutlines(drawn);
    expect(outlines).toHaveLength(1);
    expect(outlines[0].label).toBe("RCD 1");
    // Devices span x 20..74; padded by 2 mm on every side.
    expect(outlines[0].rect.x).toBe(18);
    expect(outlines[0].rect.w).toBe(54 + 4);
    expect(outlines[0].rect.h).toBe(85 + 4);
  });

  it("gives a group split over two rails one outline per rail", () => {
    const drawn = buildDrawnDevices(
      [device("a", { rcd_group_id: "g1" }), device("b", { rcd_group_id: "g1" })],
      [
        { projectDeviceId: "a", railIndex: 0, xMm: 0 },
        { projectDeviceId: "b", railIndex: 1, xMm: 0 },
      ],
      GEOMETRY_WITH_RAILS,
      [{ id: "g1", label: "RCD 1" }],
    );
    expect(groupOutlines(drawn)).toHaveLength(2);
  });
});

describe("sagDepthMm", () => {
  it("keeps short runs taut and derives longer runs' sag from the slack, capped", () => {
    expect(sagDepthMm(MIN_SAG_SPAN_MM - 1)).toBe(0);
    // L·√(3 · 0.3 · 0.1 / 8) = √0.01125 · L ≈ 0.1061 · L
    expect(sagDepthMm(50)).toBeCloseTo(50 * Math.sqrt(0.01125), 9);
    expect(sagDepthMm(100)).toBe(MAX_SAG_MM);
    expect(sagDepthMm(1000)).toBe(MAX_SAG_MM);
  });
});

describe("wirePathD", () => {
  it("draws a short straight run as a line", () => {
    expect(
      wirePathD([
        { x: 0, y: 0 },
        { x: 0, y: 20 },
      ]),
    ).toBe("M0 0 L0 20");
  });

  it("sags a long horizontal run below its line and bends each corner", () => {
    const d = wirePathD([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 100, y: 10 },
      { x: 100, y: 30 },
    ]);
    // Down 10 (bend 4 before the corner), a curved corner, the 92 mm run sagging 9.76 mm capped at
    // 8 mm (the quadratic control point sits twice as deep: 10 + 16), another corner.
    expect(d).toBe("M0 0 L0 6 Q0 10 4 10 Q50 26 96 10 Q100 10 100 14 L100 30");
  });

  it("is empty for no points", () => {
    expect(wirePathD([])).toBe("");
  });

  it("bends a realistic conductor around 3 diameters, at least the schematic radius", () => {
    expect(BEND_RADIUS_DIAMETERS).toBe(3);
    expect(bendRadiusMm(3.6, "realistic")).toBeCloseTo(10.8, 9);
    expect(bendRadiusMm(1, "realistic")).toBe(WIRE_BEND_MM);
    expect(bendRadiusMm(10.9, "schematic")).toBe(WIRE_BEND_MM);
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 100, y: 30 },
      { x: 100, y: 60 },
    ];
    // A 2.5 mm² core (3.6 mm): 10.8 mm bends, and no sag (the run is held).
    expect(wirePathD(route, [0, 0, 0], bendRadiusMm(3.6, "realistic"))).toBe(
      "M0 0 L0 19.2 Q0 30 10.8 30 L89.2 30 Q100 30 100 40.8 L100 60",
    );
    // A 16 mm² core (7.8 mm) would bend 23.4 mm, capped at half of each 30 mm vertical run.
    expect(wirePathD(route, [0, 0, 0], bendRadiusMm(7.8, "realistic"))).toBe(
      "M0 0 L0 15 Q0 30 15 30 L85 30 Q100 30 100 45 L100 60",
    );
  });

  it("never bends inside a straight end, so a ferrule keeps its full length", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 12 },
      { x: 100, y: 12 },
      { x: 100, y: 30 },
    ];
    // A 10 mm² core would bend 19.2 mm; its 12 mm ferrules leave no bend at the first corner (a 12 mm
    // run) and 6 mm at the last (an 18 mm run).
    expect(wirePathD(route, [0, 0, 0], bendRadiusMm(6.4, "realistic"), { startMm: 12, endMm: 12 })).toBe(
      "M0 0 L0 12 Q0 12 0 12 L94 12 Q100 12 100 18 L100 30",
    );
  });
});

describe("buildCableTies", () => {
  /**
   * A core whose inner vertical run lies at x from y 10 down to ottom (segment 2), between a short
   * lane run at the top and a far-apart row run at the bottom, as a pack core runs.
   */
  const core = (key: string, x: number, bottom: number, diameterMm = 3.6): Conductor => ({
    key,
    kind: "circuit",
    role: "L",
    circuitId: null,
    crossSectionMm2: 2.5,
    from: { type: "entry", entryIndex: 0, slot: 0 },
    to: { type: "terminal", deviceId: "d", side: "top", pole: "L" },
    path: [
      { x: 200, y: 0 },
      { x: 200, y: 10 },
      { x, y: 10 },
      { x, y: bottom },
      { x: 300, y: bottom },
      { x: 300, y: bottom + 10 },
    ],
    routedMm: 0,
    lengthMm: 0,
    diameterMm,
    squeezed: [],
    stubOverlaps: [],
    packSide: null,
    packSegment: null,
    packLayer: null,
    tied: [],
    overflow: false,
  });
  const step = 3.6 + WIRE_CLEARANCE_MM;

  it("ties a group of three neighbouring runs every TIE_PITCH_MM, centred on its extent, as wide as the group", () => {
    const ties = buildCableTies([core("a", 190, 130), core("b", 190 + step, 140), core("c", 190 + 2 * step, 150)]);
    // The vertical runs span y 10…150 (140 mm): two ties, 60 mm apart, centred at 50 and 110. The
    // bottom row runs lie 10 mm apart — not neighbours — and the top lane run is too short for a tie.
    expect(TIE_PITCH_MM).toBe(60);
    expect(ties.map((tie) => tie.rect.y + tie.rect.h / 2)).toEqual([50, 110]);
    for (const tie of ties) {
      expect(tie.rect.h).toBe(TIE_BAND_MM);
      expect(tie.rect.x).toBeCloseTo(190 - 1.8, 9);
      expect(tie.rect.w).toBeCloseTo(2 * step + 3.6, 9);
    }
  });

  it("ties cores that overlap in a round bundle, too", () => {
    expect(buildCableTies([core("a", 190, 130), core("b", 191, 140), core("c", 192, 150)])).toHaveLength(2);
  });

  it("needs at least three conductors", () => {
    expect(buildCableTies([core("a", 190, 130), core("b", 190 + step, 140)])).toEqual([]);
  });

  it("leaves runs apart that are farther than twice the clearance from each other", () => {
    const apart = 3.6 + 2 * WIRE_CLEARANCE_MM + 0.1;
    expect(buildCableTies([core("a", 190, 130), core("b", 190 + apart, 140), core("c", 190 + 2 * apart, 150)])).toEqual(
      [],
    );
  });

  it("never ties a run in the overflow layer, and holds the tied horizontal runs taut", () => {
    const spilled = (c: Conductor): Conductor => ({ ...c, tied: [{ segment: 2, bundle: 0, layer: "overflow" }] });
    expect(
      buildCableTies([spilled(core("a", 190, 130)), spilled(core("b", 191, 140)), spilled(core("c", 192, 150))]),
    ).toEqual([]);
    // Three 200 mm row runs on neighbouring tracks: tied, so the realistic drawing keeps them taut (no
    // sag control point at the run's middle, x 100); the schematic one still sags the lowest. Feeds —
    // the one kind the realistic drawing lets hang — so it is the tie that holds them.
    const rows = [0, 1, 2].map((i) => ({
      ...core(String(i), 0, 0),
      kind: "feed" as const,
      path: [
        { x: 0, y: 0 },
        { x: 0, y: 20 + i * step },
        { x: 200, y: 20 + i * step },
        { x: 200, y: 300 },
      ],
    }));
    expect(buildCableTies(rows)).toHaveLength(3);
    for (const wire of buildDrawnWires(rows, undefined, "realistic")) {
      const row = rows.find((candidate) => candidate.key === wire.key);
      expect(sagControls(wire.d, row?.path ?? [])).toEqual([]);
    }
    // Untied (too few to tie), the lowest of them hangs: the tie is what holds the three taut.
    const pair = rows.slice(1);
    expect(buildCableTies(pair)).toEqual([]);
    expect(
      buildDrawnWires(pair, undefined, "realistic").some(
        (wire) => sagControls(wire.d, pair.find((row) => row.key === wire.key)?.path ?? []).length > 0,
      ),
    ).toBe(true);
    expect(buildDrawnWires(rows, undefined, "schematic").some((wire) => wire.d.includes("Q100 "))).toBe(true);
  });
});

describe("buildDrawnWires", () => {
  const conductor = (key: string, role: Conductor["role"]): Conductor => ({
    key,
    kind: "circuit",
    role,
    circuitId: null,
    crossSectionMm2: 2.5,
    from: { type: "entry", entryIndex: 0, slot: 0 },
    to: { type: "entry", entryIndex: 0, slot: 0 },
    path: [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ],
    routedMm: 10,
    lengthMm: 11.5,
    diameterMm: 3.6,
    squeezed: [],
    stubOverlaps: [],
    packSide: null,
    packSegment: null,
    packLayer: null,
    tied: [],
    overflow: false,
  });

  it("paints protective conductors first, then the rest in routing order", () => {
    const wires = buildDrawnWires([
      conductor("a", "L"),
      conductor("b", "PE"),
      conductor("c", "N"),
      conductor("d", "PEN"),
    ]);
    expect(wires.map((wire) => wire.key)).toEqual(["b", "d", "a", "c"]);
    expect(wires[0]).toEqual({
      key: "b",
      role: "PE",
      kind: "circuit",
      crossSectionMm2: 2.5,
      diameterMm: 3.6,
      overflow: false,
      d: "M0 0 L0 10",
      frontD: "M0 0 L0 10",
      behindD: "",
      title: "",
      barEnds: [],
      terminalEnds: [],
    });
  });

  it("draws the same route in both variants, with the variant's bends", () => {
    const bent: Conductor = {
      ...conductor("a", "L"),
      path: [
        { x: 0, y: 0 },
        { x: 0, y: 30 },
        { x: 20, y: 30 },
      ],
    };
    // Schematic: today's 4 mm bend. Realistic: 3 × 3.6 mm, capped at half the 20 mm run.
    expect(buildDrawnWires([bent], undefined, "schematic")[0].d).toBe("M0 0 L0 26 Q0 30 4 30 L20 30");
    expect(buildDrawnWires([bent], undefined, "realistic")[0].d).toBe("M0 0 L0 20 Q0 30 10 30 L20 30");
  });

  it("splits the overflow layer's segments into behindD and the rest into frontD", () => {
    const spilled: Conductor = {
      ...conductor("a", "L"),
      path: [
        { x: 0, y: 0 },
        { x: 0, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 40 },
      ],
      tied: [{ segment: 1, bundle: 0, layer: "overflow" }],
      overflow: true,
    };
    const [wire] = buildDrawnWires([spilled], undefined, "realistic");
    expect(wire.overflow).toBe(true);
    // Bends of 3 × 3.6 = 10.8 mm, capped at 10 (half of each 20 mm run).
    expect(wire.d).toBe("M0 0 L0 10 Q0 20 10 20 L10 20 Q20 20 20 30 L20 40");
    expect(wire.frontD).toBe("M0 0 L0 10 Q0 20 10 20 M20 30 L20 40");
    expect(wire.behindD).toBe("M10 20 L10 20 Q20 20 20 30");
  });

  it("lists a ferrule end at every device or bar terminal, none at an entry", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 26 },
    ];
    const toDevice: Conductor = {
      ...conductor("a", "L"),
      path: route,
      to: { type: "terminal", deviceId: "mcb", side: "top", pole: "L" },
    };
    const [wire] = buildDrawnWires([toDevice]);
    expect(wire.terminalEnds).toEqual([{ point: { x: 30, y: 26 }, direction: { x: 0, y: -1 }, runMm: 6 }]);
    const barToDevice: Conductor = {
      ...toDevice,
      kind: "feed",
      from: { type: "bar", kind: "N", barIndex: 0, groupIndex: 0, terminalIndex: 0 },
    };
    expect(buildDrawnWires([barToDevice])[0].terminalEnds).toEqual([
      { point: { x: 0, y: 0 }, direction: { x: 0, y: 1 }, runMm: 20 },
      { point: { x: 30, y: 26 }, direction: { x: 0, y: -1 }, runMm: 6 },
    ]);
    expect(buildDrawnWires([conductor("e", "L")])[0].terminalEnds).toEqual([]);
  });
});

describe("sag of parallel runs", () => {
  const run = (key: string, y: number): Conductor => ({
    key,
    kind: "circuit",
    role: "L",
    circuitId: null,
    crossSectionMm2: 2.5,
    from: { type: "entry", entryIndex: 0, slot: 0 },
    to: { type: "entry", entryIndex: 0, slot: 0 },
    path: [
      { x: 0, y: 0 },
      { x: 0, y },
      { x: 100, y },
      { x: 100, y: 200 },
    ],
    routedMm: 300,
    lengthMm: 390,
    diameterMm: 3.6,
    squeezed: [],
    stubOverlaps: [],
    packSide: null,
    packSegment: null,
    packLayer: null,
    tied: [],
    overflow: false,
  });
  /** The depth a drawn path's long horizontal run sags to: half its quadratic control offset. */
  const sagOf = (d: string, y: number) => {
    const control = /Q50 ([\d.]+) /.exec(d);
    return control ? (Number(control[1]) - y) / 2 : 0;
  };

  /** Two 2.5 mm² cores (3.6 mm) on neighbouring tracks: the router's true-scale spacing. */
  const spacing = 3.6 + WIRE_CLEARANCE_MM;

  it("keeps a run above its neighbour one track below — they never touch or swap", () => {
    const upper = run("a", 10);
    const lower = run("b", 10 + spacing);
    const [a, b] = buildDrawnWires([upper, lower], undefined, "schematic");
    expect(sagOf(a.d, 10)).toBeLessThan(spacing);
    expect(sagOf(a.d, 10)).toBeGreaterThan(0);
    // Nothing beneath the lowest run of the bundle: it hangs as deep as its span allows.
    expect(sagOf(b.d, 10 + spacing)).toBe(MAX_SAG_MM);
  });

  it("lets a realistic run sag only within the gap between the two insulation bodies", () => {
    const limits = sagLimits([run("a", 10), run("b", 10 + spacing)], "realistic");
    expect(limits[0][1]).toBeCloseTo(WIRE_CLEARANCE_MM / 2, 9);
    // Bodies that overlap (a tied bundle) do not sag at all.
    expect(sagLimits([run("a", 10), run("b", 12)], "realistic")[0][1]).toBe(0);
  });

  it("keeps a realistic run taut where the router tied it into a bundle", () => {
    // A feed: the one kind the realistic drawing lets sag at all, so only the tie keeps it taut.
    const tied = {
      ...run("a", 10),
      kind: "feed" as const,
      tied: [{ segment: 1, bundle: 0, layer: "bundle" as const }],
    };
    expect(sagControls(buildDrawnWires([{ ...tied, tied: [] }], undefined, "realistic")[0].d, tied.path)).toHaveLength(
      1,
    );
    expect(sagControls(buildDrawnWires([tied], undefined, "realistic")[0].d, tied.path)).toEqual([]);
    expect(buildDrawnWires([tied], undefined, "schematic")[0].d).toMatch(/Q50 /);
  });

  it("draws realistic circuit and WLZ cores taut — straight runs and bends only — and lets only feeds hang", () => {
    // The same lone 100 mm run, nothing beneath it: the schematic drawing sags it whatever its kind.
    for (const kind of ["circuit", "wlz"] as const) {
      const core = { ...run("a", 10), kind };
      const realistic = buildDrawnWires([core], undefined, "realistic")[0].d;
      expect(realistic).toMatch(/Q/);
      expect(sagControls(realistic, core.path)).toEqual([]);
      expect(buildDrawnWires([core], undefined, "schematic")[0].d).toMatch(/Q50 /);
    }
    const feed = { ...run("f", 10), kind: "feed" as const };
    const [hanging] = buildDrawnWires([feed], undefined, "realistic");
    // Hung below the run, as deep as its span allows (the cap).
    expect(sagControls(hanging.d, feed.path).map((point) => point.y)).toEqual([10 + 2 * MAX_SAG_MM]);
    // A feed sags only within the gap to the run below it, the insulation bodies apart.
    const [upper] = buildDrawnWires(
      [feed, { ...run("b", 10 + spacing), kind: "feed" as const }],
      undefined,
      "realistic",
    );
    const [control] = sagControls(upper.d, feed.path);
    expect((control.y - 10) / 2).toBeCloseTo(WIRE_CLEARANCE_MM / 2, 2);
  });

  it("leaves a run with no neighbour below unlimited", () => {
    expect(sagLimits([run("a", 10)])).toEqual([[Infinity, Infinity, Infinity]]);
  });
});

describe("wireTitle", () => {
  const drawn = (id: string, lines: string[], role: DrawnDevice["role"], groupLabel: string | null): DrawnDevice => ({
    id,
    role,
    railIndex: 0,
    rect: { x: 0, y: 0, w: 35, h: 85 },
    lines,
    fontSizeMm: 6,
    groupKey: groupLabel === null ? null : "g1",
    groupLabel,
    nTerminalSide: null,
    bar: null,
  });
  const names = {
    circuits: new Map([["c1", "Gniazda kuchnia"]]),
    devices: [
      drawn("fr", ["FR", "40A"], "main_switch", null),
      drawn("rcd", ["RCD", "40A", "30mA"], "rcd", "Kuchnia"),
      drawn("mcb", ["B16"], "mcb", "Kuchnia"),
    ],
  };
  const conductor = (overrides: Partial<Conductor>): Conductor => ({
    key: "k",
    kind: "circuit",
    role: "L",
    circuitId: "c1",
    crossSectionMm2: 2.5,
    from: { type: "entry", entryIndex: 0, slot: 0 },
    to: { type: "terminal", deviceId: "mcb", side: "top", pole: "L" },
    path: [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
    ],
    routedMm: 10,
    lengthMm: 423,
    diameterMm: 3.6,
    squeezed: [],
    stubOverlaps: [],
    packSide: null,
    packSegment: null,
    packLayer: null,
    tied: [],
    overflow: false,
    ...overrides,
  });

  it("names a circuit cable by its circuit, conductor, cross-section and length in metres", () => {
    expect(wireTitle(conductor({}), names)).toBe("Obwód „Gniazda kuchnia” — L, 2,5 mm², 0,42 m");
  });

  it("names a feed by both ends, a grouped RCD with its group but a grouped MCB by its rating", () => {
    const feed = conductor({
      kind: "feed",
      role: "N",
      circuitId: null,
      crossSectionMm2: 16,
      from: { type: "terminal", deviceId: "fr", side: "top", pole: "N" },
      to: { type: "terminal", deviceId: "rcd", side: "top", pole: "N" },
      lengthMm: 205,
    });
    expect(wireTitle(feed, names)).toBe("Połączenie FR → RCD „Kuchnia” — N, 16 mm², 0,21 m");
    const toMcb = {
      ...feed,
      from: feed.to,
      to: { type: "terminal", deviceId: "mcb", side: "bottom", pole: "N" } as const,
    };
    expect(wireTitle(toMcb, names)).toBe("Połączenie RCD „Kuchnia” → B16 — N, 16 mm², 0,21 m");
  });

  it("names the WLZ and a bar end", () => {
    const wlz = conductor({
      kind: "wlz",
      role: "PEN",
      circuitId: null,
      crossSectionMm2: 16,
      to: { type: "bar", kind: "PE", barIndex: 0, groupIndex: 0, terminalIndex: 2 },
      lengthMm: 464,
    });
    expect(wireTitle(wlz, names)).toBe("WLZ — PEN, 16 mm², 0,46 m — szyna PE, zacisk 3");
    const split = {
      ...wlz,
      kind: "feed" as const,
      role: "N" as const,
      from: wlz.to,
      to: { type: "bar", kind: "N", barIndex: 1, groupIndex: 0, terminalIndex: 0 } as const,
    };
    expect(wireTitle(split, names)).toBe("Połączenie szyna PE, zacisk 3 → szyna N, zacisk 1 — N, 16 mm², 0,46 m");
  });

  it("leaves the tooltip empty when buildDrawnWires gets no names, and fills it when it does", () => {
    expect(buildDrawnWires([conductor({})])[0]?.title).toBe("");
    expect(buildDrawnWires([conductor({})], names)[0]?.title).toBe("Obwód „Gniazda kuchnia” — L, 2,5 mm², 0,42 m");
  });
});

// ---------------------------------------------------------------------------------------------
// Plan Phase 5c — PEN, bar terminals, cables at the entry
// ---------------------------------------------------------------------------------------------

describe("REALISTIC_WIRE_STYLES", () => {
  it("colours phases and N solid, PE yellow with green stripes, and PEN with green and blue stripes", () => {
    for (const role of ["L1", "L2", "L3", "N"] as const) expect(REALISTIC_WIRE_STYLES[role].stripes).toEqual([]);
    expect(REALISTIC_WIRE_STYLES.L1.body).toBe("stroke-wire-l1");
    expect(REALISTIC_WIRE_STYLES.N.body).toBe("stroke-wire-n");
    expect(REALISTIC_WIRE_STYLES.PE.body).toBe("stroke-wire-pe-stripe");
    expect(REALISTIC_WIRE_STYLES.PE.stripes.map((stripe) => stripe.stroke)).toEqual(["stroke-wire-pe"]);
    expect(REALISTIC_WIRE_STYLES.PEN.body).toBe("stroke-wire-pe-stripe");
    expect(REALISTIC_WIRE_STYLES.PEN.stripes.map((stripe) => stripe.stroke)).toEqual([
      "stroke-wire-pe",
      "stroke-wire-n",
    ]);
  });

  it("never lets the PEN's green and blue stripes overlap, and leaves yellow between them", () => {
    const [green, blue] = REALISTIC_WIRE_STYLES.PEN.stripes;
    const period = green.onDiameters + green.offDiameters;
    expect(blue.onDiameters + blue.offDiameters).toBe(period);
    expect(blue.startDiameters).toBeGreaterThan(green.startDiameters + green.onDiameters);
    expect(blue.startDiameters + blue.onDiameters).toBeLessThan(green.startDiameters + period);
  });

  it("has a ferrule for every cross-section and none for an untabulated one", () => {
    expect(ferruleStyle(1.5)).toEqual({ stroke: "stroke-ferrule-black", lengthMm: 8 });
    expect(ferruleStyle(16)).toEqual({ stroke: "stroke-ferrule-blue", lengthMm: 12 });
    expect(ferruleStyle(3)).toBeNull();
  });
});

describe("WIRE_STYLES — PEN is never drawn as PE", () => {
  it("draws PEN green-yellow with blue dashes over the stripe, and PE without them", () => {
    expect(WIRE_STYLES.PE).toMatchObject({ stroke: "stroke-wire-pe", stripe: true, penDash: false });
    expect(WIRE_STYLES.PEN).toMatchObject({ stroke: "stroke-wire-pe", stripe: true, penDash: true });
    // The dashes are what a greyscale print keeps apart; PEN is also the heavier line.
    expect(PEN_DASH).toMatch(/^\d+ \d+$/);
    expect(WIRE_STYLES.PEN.weight).toBeGreaterThan(WIRE_STYLES.PE.weight);
    for (const role of ["L", "L1", "L2", "L3", "N", "PE"] as const) expect(WIRE_STYLES[role].penDash).toBe(false);
  });

  it("takes every colour from a wire token, never a literal", () => {
    for (const style of Object.values(WIRE_STYLES)) {
      expect(style.stroke).toMatch(/^stroke-wire-/);
      expect(style.fill).toMatch(/^fill-wire-/);
    }
    for (const style of Object.values(REALISTIC_WIRE_STYLES)) {
      expect(style.body).toMatch(/^stroke-wire-/);
      expect(style.fill).toMatch(/^fill-wire-/);
      for (const stripe of style.stripes) expect(stripe.stroke).toMatch(/^stroke-wire-/);
    }
    for (const mm2 of WIRE_CROSS_SECTIONS_MM2) expect(ferruleStyle(mm2)?.stroke).toMatch(/^stroke-ferrule-/);
  });
});

describe("buildDrawnDevices — catalog bars", () => {
  it("gives a placed catalog bar its terminals, and every other device no bar", () => {
    const drawn = buildDrawnDevices(
      [
        device("pe", {
          role: "pe_bar",
          width_mm: 36,
          height_mm: 15,
          rated_current_a: null,
          terminal_groups: [{ count: 4, minMm2: 1.5, maxMm2: 16 }],
        }),
        device("m"),
      ],
      [
        { projectDeviceId: "pe", railIndex: 0, xMm: 0 },
        { projectDeviceId: "m", railIndex: 0, xMm: 36 },
      ],
      GEOMETRY_WITH_RAILS,
      [],
    );
    expect(drawn[0].bar).toMatchObject({ kind: "PE", terminalGroups: [{ count: 4, minMm2: 1.5, maxMm2: 16 }] });
    expect(drawn[1].bar).toBeNull();
  });
});

describe("bar terminals and cables in the drawn wires", () => {
  const base: Conductor = {
    key: "k",
    kind: "circuit",
    role: "PE",
    circuitId: "c1",
    crossSectionMm2: 2.5,
    from: { type: "entry", entryIndex: 0, slot: 0 },
    to: { type: "bar", kind: "PE", barIndex: 0, groupIndex: 0, terminalIndex: 2 },
    path: [
      { x: 50, y: 0 },
      { x: 50, y: 20 },
      { x: 10, y: 20 },
      { x: 10, y: 60 },
    ],
    routedMm: 100,
    lengthMm: 130,
    diameterMm: 3.6,
    squeezed: [],
    stubOverlaps: [],
    packSide: null,
    packSegment: null,
    packLayer: null,
    tied: [],
    overflow: false,
  };

  it("marks the end that lands on a bar terminal, and no other", () => {
    const [wire] = buildDrawnWires([base]);
    expect(wire.barEnds).toEqual([{ x: 10, y: 60 }]);
    const [toDevice] = buildDrawnWires([
      { ...base, role: "L", to: { type: "terminal", deviceId: "mcb", side: "top", pole: "L" } },
    ]);
    expect(toDevice.barEnds).toEqual([]);
  });

  it("names the bar terminal a cable core lands on", () => {
    const names = { circuits: new Map([["c1", "Gniazda kuchnia"]]), devices: [] };
    expect(wireTitle(base, names)).toBe("Obwód „Gniazda kuchnia” — PE, 2,5 mm², 0,13 m — szyna PE, zacisk 3");
  });

  it("draws one sheath per cable from its entry point, cut back before its first core turns off", () => {
    const cores: Conductor[] = [
      { ...base, key: "a", role: "L" },
      {
        ...base,
        key: "b",
        path: [
          { x: 50, y: 0 },
          { x: 50, y: 14 },
          { x: 90, y: 14 },
        ],
      },
      {
        ...base,
        key: "c",
        circuitId: "c2",
        path: [
          { x: 80, y: 0 },
          { x: 80, y: 30 },
          { x: 99, y: 30 },
        ],
      },
      {
        ...base,
        key: "f",
        kind: "feed",
        path: [
          { x: 5, y: 5 },
          { x: 5, y: 50 },
        ],
      },
    ];
    const cables = buildDrawnCables(cores);
    expect(cables.map((cable) => cable.key)).toEqual(["c:c1", "c:c2"]);
    // c1's two cores leave the entry at (50, 0) and turn off 14 and 20 mm down: the sheath stops one bend
    // (4 mm) before the first turn-off. c2's single core turns off 30 mm down: the sheath stops at
    // SHEATH_STUB_MM, short of the bend.
    expect(cables[0].d).toBe("M50 0 L50 10");
    expect(cables[1].d).toBe(`M80 0 L80 ${String(SHEATH_STUB_MM)}`);
    // The sheath at true scale: c1 is a two-core 2.5 mm² cable; c2's single core counts as two.
    expect(cables.map((cable) => cable.diameterMm)).toEqual([cableDiameterMm(2, 2.5), cableDiameterMm(2, 2.5)]);
  });

  it("ends the sheath SHEATH_STUB_MM past the entry, however far the cores run on together", () => {
    const core = (key: string, depth: number, x: number): Conductor => ({
      ...base,
      key,
      path: [
        { x: 50, y: 0 },
        { x: 50, y: depth },
        { x, y: depth },
      ],
    });
    // Three cores turning off at 300, 40 and 60 mm: the sheath is stripped 25 mm in, the cores run bare.
    expect(SHEATH_STUB_MM).toBe(25);
    const cables = buildDrawnCables([core("a", 300, 70), core("b", 40, 30), core("c", 60, 20)]);
    expect(cables.map((cable) => cable.d)).toEqual(["M50 0 L50 25"]);
    // A side entry's stub runs across: the sheath follows it, just as short.
    const fromLeft = buildDrawnCables([
      {
        ...base,
        path: [
          { x: 0, y: 100 },
          { x: 80, y: 100 },
          { x: 80, y: 200 },
        ],
      },
    ]);
    expect(fromLeft.map((cable) => cable.d)).toEqual(["M0 100 L25 100"]);
    // A stub too short for a bend's clearance still gets half of it.
    expect(buildDrawnCables([core("a", 6, 70)]).map((cable) => cable.d)).toEqual(["M50 0 L50 3"]);
  });
});

describe("buildDrawnBusbars", () => {
  const busbar: Busbar = {
    key: "busbar-g1",
    groupId: "g1",
    edge: "bottom",
    rect: { x: 100, y: 200, w: 70, h: 4 },
    phases: 3,
    pins: 8,
    piece: 0,
    teeth: [
      { x: 100, y: 200, pole: "L1", pin: 0, deviceId: "rcd" },
      { x: 135, y: 198, pole: "L2", pin: 2, deviceId: "mcb-1" },
      { x: 170, y: 200, pole: "L3", pin: 4, deviceId: "mcb-2" },
    ],
  };

  it("reaches the strip past its end teeth and keeps its height and edge", () => {
    const [drawn] = buildDrawnBusbars([busbar], "realistic");
    expect(drawn.body).toEqual({
      x: 100 - BUSBAR_OVERHANG_MM,
      y: 200,
      w: 70 + 2 * BUSBAR_OVERHANG_MM,
      h: 4,
    });
    expect(drawn).toMatchObject({ key: "busbar-g1", groupId: "g1", phases: 3, pins: 8, variant: "realistic" });
  });

  it("runs each tooth from the strip's device-facing edge into its terminal", () => {
    const [drawn] = buildDrawnBusbars([busbar], "realistic");
    // Bottom edge: the devices are above the strip, so the strip's top edge is where teeth start and
    // they end BUSBAR_TOOTH_DEPTH_MM above the terminal.
    expect(drawn.teeth.map((tooth) => [tooth.x, tooth.y1, tooth.y2, tooth.pole])).toEqual([
      [100, 200, 200 - BUSBAR_TOOTH_DEPTH_MM, "L1"],
      [135, 200, 198 - BUSBAR_TOOTH_DEPTH_MM, "L2"],
      [170, 200, 200 - BUSBAR_TOOTH_DEPTH_MM, "L3"],
    ]);
    const top = buildDrawnBusbars([{ ...busbar, edge: "top", rect: { x: 100, y: 90, w: 70, h: 4 } }], "schematic")[0];
    expect(top.teeth[0].y1).toBe(94);
    expect(top.teeth[0].y2).toBe(200 + BUSBAR_TOOTH_DEPTH_MM);
  });

  it("draws the same geometry in both variants — only the variant differs", () => {
    const [realistic] = buildDrawnBusbars([busbar], "realistic");
    const [schematic] = buildDrawnBusbars([busbar], "schematic");
    expect({ ...schematic, variant: "realistic" }).toEqual(realistic);
    expect(schematic.variant).toBe("schematic");
  });

  it("titles a busbar with its phases, its group and its pins", () => {
    const [named] = buildDrawnBusbars([busbar], "realistic", new Map([["g1", "Kuchnia"]]));
    expect(named.title).toBe("Listwa zasilająca 3F — grupa „Kuchnia”, 8 pinów");
    const [single] = buildDrawnBusbars([{ ...busbar, phases: 1, pins: 1 }], "realistic", new Map([["g1", "Kuchnia"]]));
    expect(single.title).toBe("Listwa zasilająca 1F — grupa „Kuchnia”, 1 pin");
    expect(buildDrawnBusbars([busbar], "realistic")[0].title).toBe("Listwa zasilająca 3F, 8 pinów");
  });

  it("draws nothing for no busbars", () => {
    expect(buildDrawnBusbars([], "schematic")).toEqual([]);
  });
});
