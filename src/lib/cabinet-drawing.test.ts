import { describe, expect, it } from "vitest";
import {
  buildDrawnDevices,
  clampRect,
  clipRect,
  deviceLabelLines,
  elementRect,
  entryRect,
  groupOutlines,
  issueElements,
  labelFontSizeMm,
  type DrawableDevice,
} from "./cabinet-drawing";
import { RAIL_HEIGHT_MM, parseCabinetGeometry, type CabinetGeometry } from "./cabinet-geometry";

const INTERIOR = { widthMm: 400, heightMm: 300, depthMm: 100 };

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
