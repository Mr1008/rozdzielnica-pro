import { describe, expect, it } from "vitest";
import {
  BAR_Z_CLEARANCE_MM,
  GEOMETRY_ISSUE_CODES,
  RAIL_HEIGHT_MM,
  cabinetGeometrySchema,
  geometryIssueMessage,
  parseCabinetGeometry,
  type CabinetGeometry,
  type GeometryIssue,
  type GeometryIssueCode,
} from "./cabinet-geometry";

type Bar = CabinetGeometry["bars"][number];

/** 600 × 800 × 120 mm, one full-width rail, one top entry, no bars. */
function valid(): CabinetGeometry {
  return {
    version: 1,
    interior: { widthMm: 600, heightMm: 800, depthMm: 120 },
    rails: [{ xMm: 0, yMm: 100, lengthMm: 600 }],
    entries: [{ side: "top", offsetMm: 0, lengthMm: 200 }],
    bars: [],
  };
}

function bar(overrides: Partial<Bar> = {}): Bar {
  return {
    kind: "PE",
    orientation: "horizontal",
    xMm: 0,
    yMm: 400,
    lengthMm: 200,
    heightMm: 20,
    zMm: 0,
    terminalGroups: [{ count: 8, minMm2: 1.5, maxMm2: 16 }],
    ...overrides,
  };
}

function withGeometry(change: (g: CabinetGeometry) => void): CabinetGeometry {
  const g = valid();
  change(g);
  return g;
}

function issuesOf(input: unknown): GeometryIssue[] {
  const result = parseCabinetGeometry(input);
  return result.ok ? [] : result.issues;
}

function expectValid(input: unknown) {
  expect(issuesOf(input)).toEqual([]);
}

/** A `Record` over every code, so a new code without a failing fixture fails `astro check`. */
const FAILING: Record<GeometryIssueCode, { input: unknown; element?: GeometryIssue["element"] }[]> = {
  malformed: [
    { input: null },
    { input: "geometry" },
    { input: { ...valid(), version: 2 } },
    {
      input: withGeometry((g) => Object.assign(g.entries[0], { side: "front" })),
      element: { kind: "entry", index: 0 },
    },
    {
      input: withGeometry((g) => (g.bars = [bar({ kind: "L" as unknown as Bar["kind"] })])),
      element: { kind: "bar", index: 0 },
    },
  ],
  size_not_positive_integer: [
    { input: withGeometry((g) => (g.interior.widthMm = 0)) },
    { input: withGeometry((g) => (g.rails[0].lengthMm = 12.5)), element: { kind: "rail", index: 0 } },
    { input: withGeometry((g) => (g.entries[0].lengthMm = 0)), element: { kind: "entry", index: 0 } },
    { input: withGeometry((g) => (g.bars = [bar({ heightMm: -1 })])), element: { kind: "bar", index: 0 } },
  ],
  position_not_non_negative_integer: [
    { input: withGeometry((g) => (g.rails[0].xMm = -1)), element: { kind: "rail", index: 0 } },
    { input: withGeometry((g) => (g.entries[0].offsetMm = 1.5)), element: { kind: "entry", index: 0 } },
    {
      input: withGeometry((g) => (g.bars = [bar({ zMm: "10" as unknown as number })])),
      element: { kind: "bar", index: 0 },
    },
  ],
  no_rails: [{ input: withGeometry((g) => (g.rails = [])) }],
  no_entries: [{ input: withGeometry((g) => (g.entries = [])) }],
  rail_outside_interior: [
    { input: withGeometry((g) => (g.rails[0].xMm = 1)), element: { kind: "rail", index: 0 } },
    {
      input: withGeometry((g) => (g.rails[0].yMm = 800 - RAIL_HEIGHT_MM + 1)),
      element: { kind: "rail", index: 0 },
    },
  ],
  rails_overlap: [
    {
      input: withGeometry(
        (g) =>
          (g.rails = [
            { xMm: 0, yMm: 100, lengthMm: 300 },
            { xMm: 299, yMm: 100, lengthMm: 300 },
          ]),
      ),
      element: { kind: "rail", index: 1 },
    },
    {
      input: withGeometry((g) => g.rails.push({ xMm: 0, yMm: 100 + RAIL_HEIGHT_MM - 1, lengthMm: 600 })),
      element: { kind: "rail", index: 1 },
    },
  ],
  rail_overlaps_bar: [
    {
      input: withGeometry((g) => (g.bars = [bar({ yMm: 100 + RAIL_HEIGHT_MM - 1 })])),
      element: { kind: "rail", index: 0 },
    },
  ],
  bar_outside_interior: [
    { input: withGeometry((g) => (g.bars = [bar({ xMm: 401 })])), element: { kind: "bar", index: 0 } },
    {
      input: withGeometry((g) => (g.bars = [bar({ orientation: "vertical", xMm: 581, yMm: 200, lengthMm: 500 })])),
      element: { kind: "bar", index: 0 },
    },
  ],
  bar_depth_outside_interior: [
    { input: withGeometry((g) => (g.bars = [bar({ zMm: 121 })])), element: { kind: "bar", index: 0 } },
  ],
  bars_too_close: [
    {
      input: withGeometry((g) => (g.bars = [bar({ zMm: 0 }), bar({ kind: "N", zMm: BAR_Z_CLEARANCE_MM - 1 })])),
      element: { kind: "bar", index: 1 },
    },
  ],
  entry_exceeds_side: [
    { input: withGeometry((g) => (g.entries[0].offsetMm = 401)), element: { kind: "entry", index: 0 } },
    {
      input: withGeometry((g) => (g.entries[0] = { side: "left", offsetMm: 700, lengthMm: 101 })),
      element: { kind: "entry", index: 0 },
    },
  ],
  entries_overlap: [
    {
      input: withGeometry((g) => g.entries.push({ side: "top", offsetMm: 199, lengthMm: 100 })),
      element: { kind: "entry", index: 1 },
    },
  ],
  bar_no_terminal_groups: [
    { input: withGeometry((g) => (g.bars = [bar({ terminalGroups: [] })])), element: { kind: "bar", index: 0 } },
  ],
  terminal_count_invalid: [
    {
      input: withGeometry((g) => (g.bars = [bar({ terminalGroups: [{ count: 0, minMm2: 1.5, maxMm2: 16 }] })])),
      element: { kind: "bar", index: 0 },
    },
    {
      input: withGeometry((g) => (g.bars = [bar({ terminalGroups: [{ count: 1.5, minMm2: 1.5, maxMm2: 16 }] })])),
      element: { kind: "bar", index: 0 },
    },
  ],
  terminal_range_invalid: [
    {
      input: withGeometry((g) => (g.bars = [bar({ terminalGroups: [{ count: 4, minMm2: 10, maxMm2: 6 }] })])),
      element: { kind: "bar", index: 0 },
    },
    {
      input: withGeometry((g) => (g.bars = [bar({ terminalGroups: [{ count: 4, minMm2: 0, maxMm2: 6 }] })])),
      element: { kind: "bar", index: 0 },
    },
  ],
};

describe("parseCabinetGeometry — valid geometries and rule boundaries", () => {
  it("accepts the base fixture and returns it unchanged", () => {
    expect(parseCabinetGeometry(valid())).toEqual({ ok: true, geometry: valid() });
  });

  it("accepts a cabinet with no bars", () => {
    expectValid(valid());
  });

  it("accepts a split row: two rails at the same height with a gap between", () => {
    expectValid(
      withGeometry(
        (g) =>
          (g.rails = [
            { xMm: 0, yMm: 100, lengthMm: 250 },
            { xMm: 350, yMm: 100, lengthMm: 250 },
          ]),
      ),
    );
  });

  it("treats rails touching end to end or edge to edge as not overlapping", () => {
    expectValid(
      withGeometry(
        (g) =>
          (g.rails = [
            { xMm: 0, yMm: 100, lengthMm: 300 },
            { xMm: 300, yMm: 100, lengthMm: 300 },
            { xMm: 0, yMm: 100 + RAIL_HEIGHT_MM, lengthMm: 600 },
          ]),
      ),
    );
  });

  it("accepts a rail flush with the interior's right and bottom edges", () => {
    expectValid(withGeometry((g) => (g.rails = [{ xMm: 0, yMm: 800 - RAIL_HEIGHT_MM, lengthMm: 600 }])));
  });

  it("accepts a bar touching a rail's edge", () => {
    expectValid(withGeometry((g) => (g.bars = [bar({ yMm: 100 + RAIL_HEIGHT_MM })])));
  });

  it(`accepts bars overlapping in the front view exactly ${String(BAR_Z_CLEARANCE_MM)} mm apart in depth`, () => {
    expectValid(withGeometry((g) => (g.bars = [bar({ zMm: 0 }), bar({ kind: "N", zMm: BAR_Z_CLEARANCE_MM })])));
  });

  it("accepts bars at the same depth that only touch in the front view", () => {
    expectValid(withGeometry((g) => (g.bars = [bar({ xMm: 0 }), bar({ kind: "N", xMm: 200 })])));
  });

  it("accepts zMm at 0 and at exactly depthMm", () => {
    expectValid(withGeometry((g) => (g.bars = [bar({ zMm: 0 })])));
    expectValid(withGeometry((g) => (g.bars = [bar({ zMm: 120 })])));
  });

  it("measures a vertical bar with lengthMm running down and heightMm across", () => {
    const vertical = bar({ orientation: "vertical", xMm: 580, yMm: 200, lengthMm: 500, heightMm: 20 });
    expectValid(withGeometry((g) => (g.bars = [vertical])));
    expect(issuesOf(withGeometry((g) => (g.bars = [{ ...vertical, orientation: "horizontal" }])))).toContainEqual({
      code: "bar_outside_interior",
      element: { kind: "bar", index: 0 },
    });
  });

  it("accepts an entry that exactly fills its side, measured by width or height", () => {
    expectValid(withGeometry((g) => (g.entries = [{ side: "top", offsetMm: 400, lengthMm: 200 }])));
    expectValid(withGeometry((g) => (g.entries = [{ side: "right", offsetMm: 600, lengthMm: 200 }])));
  });

  it("accepts entries touching on one side, and overlapping spans on different sides", () => {
    expectValid(withGeometry((g) => g.entries.push({ side: "top", offsetMm: 200, lengthMm: 100 })));
    expectValid(withGeometry((g) => g.entries.push({ side: "bottom", offsetMm: 0, lengthMm: 200 })));
  });

  it("accepts a terminal group whose min equals max, in fractional mm²", () => {
    expectValid(withGeometry((g) => (g.bars = [bar({ terminalGroups: [{ count: 1, minMm2: 2.5, maxMm2: 2.5 }] })])));
  });
});

describe("parseCabinetGeometry — every issue code", () => {
  it.each(GEOMETRY_ISSUE_CODES)("rejects with %s", (code) => {
    for (const { input, element } of FAILING[code]) {
      expect(issuesOf(input)).toContainEqual(element ? { code, element } : { code });
    }
  });

  it("never throws, and returns only known codes", () => {
    const inputs: unknown[] = [
      undefined,
      [],
      42,
      {},
      { version: 1 },
      ...Object.values(FAILING)
        .flat()
        .map((f) => f.input),
    ];
    for (const input of inputs) {
      const issues = issuesOf(input);
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) expect(GEOMETRY_ISSUE_CODES).toContain(issue.code);
    }
  });

  it("reports each code once per element", () => {
    const issues = issuesOf(withGeometry((g) => (g.rails[0] = { xMm: -1, yMm: -1, lengthMm: 600 })));
    expect(issues).toEqual([{ code: "position_not_non_negative_integer", element: { kind: "rail", index: 0 } }]);
  });
});

describe("cabinetGeometrySchema", () => {
  it("accepts a valid geometry and rejects a cross-element rule on its own", () => {
    expect(cabinetGeometrySchema.safeParse(valid()).success).toBe(true);
    expect(cabinetGeometrySchema.safeParse(withGeometry((g) => (g.rails[0].xMm = 1))).success).toBe(false);
  });
});

describe("geometryIssueMessage", () => {
  it.each(GEOMETRY_ISSUE_CODES)("has a Polish message for %s", (code) => {
    for (const issue of [{ code }, { code, element: { kind: "bar", index: 0 } }] as GeometryIssue[]) {
      const message = geometryIssueMessage(issue);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain(code);
    }
  });

  it("numbers elements from 1", () => {
    expect(geometryIssueMessage({ code: "rail_outside_interior", element: { kind: "rail", index: 1 } })).toBe(
      "Szyna DIN 2 wychodzi poza wnętrze szafki",
    );
    expect(geometryIssueMessage({ code: "size_not_positive_integer", element: { kind: "entry", index: 0 } })).toContain(
      "Wprowadzenie 1",
    );
  });
});
