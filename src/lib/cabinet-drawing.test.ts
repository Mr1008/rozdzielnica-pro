import { describe, expect, it } from "vitest";
import { clampRect, clipRect, elementRect, entryRect, issueElements } from "./cabinet-drawing";
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
