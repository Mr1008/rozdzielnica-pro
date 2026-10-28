import { describe, expect, it } from "vitest";
import {
  buildCabinetScene,
  builtinBarTerminalZ,
  RAIL_FRONT_Z_MM,
  RAIL_STANDOFF_MM,
  TERMINAL_DEPTH_RATIO,
  terminalZ,
  toScene3DDevices,
  WALL_THICKNESS_MM,
  type Cabinet3DData,
} from "./cabinet-3d";
import type { Point } from "./cabinet-layout";
import { routeWiring, type Conductor, type Endpoint, type Wiring } from "./cabinet-wiring";
import { computeMatchView } from "./device-matching-server";
import { buildLayoutDrawing, computeLayoutView } from "./layout-server";
import { busbarFixture, realisticFixture, worstCaseFixture, type RenderFixture } from "./wiring-bench-fixtures";
import { BUSBAR_DEPTH_MM, liftWiring, realisticWiring, smoothConductor3D, type Point3Mm } from "./wiring-3d";
import { bendRadiusMm, buildCableTies, buildDrawnCables, MAX_SAG_MM } from "./cabinet-drawing";
import { FERRULE } from "./wire-dimensions";

/** The fixtures give every device 70 mm; vary it so each end depth is tied to its own device. */
const DEPTH_BY_ROLE: Record<string, number> = { main_switch: 66, rcd: 76, mcb: 70 };

/** The 3D data the project page builds for a render fixture, and the router's output for it. */
function lifted(fixture: RenderFixture, edit: (data: Cabinet3DData) => Cabinet3DData = (d) => d) {
  const matchView = computeMatchView(fixture.context);
  const view = computeLayoutView(matchView, fixture.context, fixture.placements);
  const drawing = buildLayoutDrawing(view, matchView, fixture.context);
  if (fixture.context.geometry === null || drawing.wiring === null) throw new Error("fixture must be placed");
  const snapshot = matchView.snapshot.map((row) => ({
    id: row.id,
    depth_mm: DEPTH_BY_ROLE[row.role] ?? row.depth_mm,
    poles: row.poles,
  }));
  const data = edit({
    geometry: fixture.context.geometry,
    devices: toScene3DDevices(drawing.devices, snapshot),
    wiring: drawing.wiring,
  });
  if (data.wiring === null) throw new Error("fixture must be wired");
  const wiring = routeWiring(data.wiring);
  const scene = buildCabinetScene(data);
  return { data, wiring, scene, result: liftWiring(wiring, scene, data) };
}

/** Drops z, repeated points and collinear middle points: the front view of a lifted wire. */
function frontView(points: readonly Point3Mm[]): Point[] {
  const flat: Point[] = [];
  for (const { x, y } of points) {
    const prev = flat.at(-1);
    if (prev?.x === x && prev.y === y) continue;
    const before = flat.at(-2);
    if (
      prev !== undefined &&
      before !== undefined &&
      (before.x === prev.x) === (prev.x === x) &&
      (before.y === prev.y) === (prev.y === y)
    ) {
      flat[flat.length - 1] = { x, y };
      continue;
    }
    flat.push({ x, y });
  }
  return flat;
}

const routed = (wiring: Wiring) => wiring.conductors.filter((c) => c.path.length >= 2);

/** An end's expected z, from the same data the lift reads. */
function endZ(endpoint: Endpoint, data: Cabinet3DData): number | null {
  if (endpoint.type === "terminal") {
    const device = data.devices.find((d) => d.id === endpoint.deviceId);
    return device === undefined ? null : terminalZ(device);
  }
  if (endpoint.type === "bar" && endpoint.barIndex < data.geometry.bars.length) {
    return builtinBarTerminalZ(data.geometry.bars[endpoint.barIndex]);
  }
  return null;
}

const FIXTURES = [
  ["realistic project, seed (b)", realisticFixture()],
  ["comb busbars, seed (b)", busbarFixture()],
  ["worst case, seed (c)", worstCaseFixture()],
] as const;

describe.each(FIXTURES)("liftWiring — %s", (_name, fixture) => {
  const { data, wiring, scene, result } = lifted(fixture);
  const byKey = new Map(result.conductors.map((c) => [c.key, c]));

  it("gives exactly one 3D conductor per routed conductor, in order", () => {
    expect(result.conductors.map((c) => c.key)).toEqual(routed(wiring).map((c) => c.key));
  });

  it("keeps every front view exactly the 2D route", () => {
    for (const conductor of routed(wiring)) {
      expect(frontView(byKey.get(conductor.key)?.points ?? []), conductor.key).toEqual(conductor.path);
    }
  });

  it("changes depth only in pure-z steps", () => {
    for (const { key, points } of result.conductors) {
      for (const [i, q] of points.slice(1).entries()) {
        const p = points[i];
        const moved = [p.x !== q.x, p.y !== q.y, p.z !== q.z].filter(Boolean).length;
        expect(moved, key).toBe(1);
      }
    }
  });

  it("plugs every terminal and bar end in at its depth", () => {
    let checked = 0;
    for (const conductor of routed(wiring)) {
      const points = byKey.get(conductor.key)?.points ?? [];
      for (const [endpoint, point] of [
        [conductor.from, points[0]],
        [conductor.to, points.at(-1)],
      ] as const) {
        const z = endZ(endpoint, data);
        if (z === null) continue;
        expect(point?.z, conductor.key).toBeCloseTo(z, 9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("keeps a terminal or bar end's stub at that end's depth", () => {
    for (const conductor of routed(wiring)) {
      const points = byKey.get(conductor.key)?.points ?? [];
      const last = conductor.path.length - 2;
      for (const [segment, endpoint] of [
        [0, conductor.from],
        [last, conductor.to],
      ] as const) {
        const z = endZ(endpoint, data);
        if (z !== null) expect(segmentZ(conductor, points, segment), conductor.key).toBeCloseTo(z, 9);
      }
    }
  });

  it("runs a segment crossing another device's body behind the devices", () => {
    for (const conductor of routed(wiring)) {
      const points = byKey.get(conductor.key)?.points ?? [];
      const own = new Set([endDevice(conductor.from, data), endDevice(conductor.to, data)]);
      for (const segment of conductor.path.keys()) {
        if (segment > conductor.path.length - 2 || isEndStub(conductor, segment)) continue;
        const [a, b] = [conductor.path[segment], conductor.path[segment + 1]];
        const crosses = scene.devices.some((d) => !own.has(d.id) && crossesBox(a, b, d.box));
        const z = segmentZ(conductor, points, segment);
        if (crosses) expect(z, `${conductor.key}#${String(segment)}`).toBe(RAIL_STANDOFF_MM / 2);
        else expect(z, `${conductor.key}#${String(segment)}`).toBeGreaterThan(RAIL_FRONT_Z_MM);
      }
    }
  });

  it("brings cables in at channel z", () => {
    const channelZ = RAIL_FRONT_Z_MM + Math.min(...data.devices.map((d) => d.depthMm)) * TERMINAL_DEPTH_RATIO;
    const entering = routed(wiring).filter((c) => c.from.type === "entry");
    expect(entering.length).toBeGreaterThan(0);
    for (const conductor of entering) expect(byKey.get(conductor.key)?.points[0].z).toBeCloseTo(channelZ, 9);
  });

  it("keeps every depth inside the cabinet", () => {
    for (const { key, points } of result.conductors) {
      for (const { z } of points) {
        expect(z, key).toBeGreaterThanOrEqual(0);
        expect(z, key).toBeLessThanOrEqual(scene.interior.d);
      }
    }
  });

  it("spreads the members of a tied bundle to distinct depths", () => {
    const layers = new Map<string, Map<string, number>>();
    for (const conductor of routed(wiring)) {
      const points = byKey.get(conductor.key)?.points ?? [];
      for (const tie of conductor.tied) {
        // An end stub keeps its terminal's depth, and a run behind the devices leaves the bundle.
        if (isEndStub(conductor, tie.segment)) continue;
        const z = segmentZ(conductor, points, tie.segment);
        if (z === RAIL_STANDOFF_MM / 2) continue;
        const layer = layers.get(`${String(tie.bundle)}:${tie.layer}`) ?? new Map<string, number>();
        layer.set(conductor.key, z);
        layers.set(`${String(tie.bundle)}:${tie.layer}`, layer);
      }
    }
    expect(layers.size).toBeGreaterThan(0);
    for (const layer of layers.values()) {
      const depths = [...layer.values()];
      expect(new Set(depths).size).toBe(depths.length);
    }
  });

  it("is deterministic", () => {
    expect(lifted(fixture).result).toEqual(result);
  });

  it("sheathes only a cable's start, along its entry stub", () => {
    const sheathed = result.conductors.filter((c) => c.sheath !== null);
    expect(sheathed.length).toBeGreaterThan(0);
    for (const conductor of routed(wiring)) {
      const sheath = byKey.get(conductor.key)?.sheath ?? null;
      if (conductor.kind === "feed" || conductor.from.type !== "entry") {
        expect(sheath, conductor.key).toBeNull();
        continue;
      }
      if (sheath === null) continue;
      const [a, b] = conductor.path;
      expect(sheath[0]).toEqual(byKey.get(conductor.key)?.points[0]);
      for (const p of sheath) expect(onSegment(p, a, b), conductor.key).toBe(true);
    }
  });
});

/** The device an end lies in: a terminal's, or a catalog bar's (placed after the built-in bars). */
function endDevice(endpoint: Endpoint, data: Cabinet3DData): string | null {
  if (endpoint.type === "terminal") return endpoint.deviceId;
  if (endpoint.type !== "bar" || data.wiring === null) return null;
  const catalogBars = data.wiring.placements
    .map((p) => p.projectDeviceId)
    .filter((id) => data.devices.some((d) => d.id === id && (d.role === "pe_bar" || d.role === "n_bar")));
  return catalogBars[endpoint.barIndex - data.geometry.bars.length] ?? null;
}

function crossesBox(a: Point, b: Point, box: { x: number; y: number; w: number; h: number }): boolean {
  const eps = 1e-6;
  return (
    Math.max(a.x, b.x) > box.x + eps &&
    Math.min(a.x, b.x) < box.x + box.w - eps &&
    Math.max(a.y, b.y) > box.y + eps &&
    Math.min(a.y, b.y) < box.y + box.h - eps
  );
}

/** The first segment leaving a terminal or bar end, or the last one reaching it. */
function isEndStub(conductor: Conductor, segment: number): boolean {
  const pinned = (endpoint: Endpoint) => endpoint.type !== "entry";
  return (segment === 0 && pinned(conductor.from)) || (segment === conductor.path.length - 2 && pinned(conductor.to));
}

/** The z of a path segment: the lifted point pair whose front view runs along it. */
function segmentZ(conductor: Conductor, points: readonly Point3Mm[], segment: number): number {
  const [a, b] = [conductor.path[segment], conductor.path[segment + 1]];
  for (const [i, q] of points.slice(1).entries()) {
    const p = points[i];
    if (p.z === q.z && onSegment(p, a, b) && onSegment(q, a, b) && (p.x !== q.x || p.y !== q.y)) return p.z;
  }
  throw new Error(`${conductor.key} has no lifted run for segment ${String(segment)}`);
}

function onSegment(p: { x: number; y: number }, a: Point, b: Point): boolean {
  const within = (v: number, u: number, w: number) => v >= Math.min(u, w) - 1e-9 && v <= Math.max(u, w) + 1e-9;
  return (a.x === b.x ? p.x === a.x : p.y === a.y) && within(p.x, a.x, b.x) && within(p.y, a.y, b.y);
}

describe("liftWiring — a side pack with an overflow layer", () => {
  // Every circuit of the worst-case project as a 16 mm² cable from the left: far more than its pack holds.
  const { wiring, result } = lifted(worstCaseFixture(), (data) =>
    data.wiring === null
      ? data
      : {
          ...data,
          wiring: {
            ...data.wiring,
            circuits: data.wiring.circuits.map((c) => ({ ...c, cross_section_mm2: 16, entry_side: "left" })),
          },
        },
  );
  const byKey = new Map(result.conductors.map((c) => [c.key, c]));
  /** The pack runs' depths per bundle and layer, end stubs left out (they keep their terminal's depth). */
  const packs = new Map<number, { bundle: number[]; overflow: number[] }>();
  for (const c of routed(wiring)) {
    const tie = c.tied.find((t) => t.segment === c.packSegment);
    if (tie === undefined || isEndStub(c, tie.segment)) continue;
    const pack = packs.get(tie.bundle) ?? { bundle: [], overflow: [] };
    pack[tie.layer].push(segmentZ(c, byKey.get(c.key)?.points ?? [], tie.segment));
    packs.set(tie.bundle, pack);
  }
  const mean = (values: readonly number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

  it("centres the overflow layer behind its bundle, off the plate", () => {
    const spilled = [...packs.values()].filter((pack) => pack.overflow.length > 0);
    expect(spilled.length).toBeGreaterThan(0);
    for (const pack of spilled) {
      expect(pack.bundle.length).toBeGreaterThan(0);
      expect(mean(pack.overflow)).toBeLessThan(mean(pack.bundle));
      expect(Math.min(...pack.overflow)).toBeGreaterThanOrEqual(WALL_THICKNESS_MM);
    }
  });
});

describe("liftWiring — runs behind the devices", () => {
  it("occur in the realistic project, where the router spreads a crowded passage behind the devices", () => {
    const { result } = lifted(realisticFixture());
    expect(result.conductors.some((c) => c.points.some((p) => p.z === RAIL_STANDOFF_MM / 2))).toBe(true);
  });
});

describe("liftWiring — comb busbars", () => {
  const { data, wiring, result } = lifted(busbarFixture());

  it("lifts every busbar, its body centred on its group's terminal depth", () => {
    expect(wiring.busbars.length).toBeGreaterThan(0);
    expect(result.busbars.map((b) => b.key)).toEqual(wiring.busbars.map((b) => b.key));
    for (const [i, busbar] of wiring.busbars.entries()) {
      const lift = result.busbars[i];
      const groupZ = Math.min(
        ...busbar.teeth.map((tooth) =>
          terminalZ(data.devices.find((d) => d.id === tooth.deviceId) ?? { depthMm: NaN }),
        ),
      );
      expect(lift.body).toMatchObject({ ...busbar.rect, d: BUSBAR_DEPTH_MM });
      expect(lift.body.z + lift.body.d / 2).toBeCloseTo(groupZ, 9);
      expect(lift.teeth).toHaveLength(busbar.teeth.length);
      for (const [j, tooth] of busbar.teeth.entries()) {
        const box = lift.teeth[j];
        expect(box.x + box.w / 2).toBeCloseTo(tooth.x, 9);
        expect([box.y, box.y + box.h]).toContain(tooth.y);
        expect(box.z).toBe(lift.body.z);
      }
    }
  });
});

describe("liftWiring — an unrouted conductor", () => {
  it("gives no 3D conductor", () => {
    const { wiring, scene, data } = lifted(realisticFixture());
    const [first, ...rest] = wiring.conductors;
    const result = liftWiring({ ...wiring, conductors: [{ ...first, path: [] }, ...rest] }, scene, data);
    expect(result.conductors.map((c) => c.key)).toEqual(rest.filter((c) => c.path.length >= 2).map((c) => c.key));
  });
});

/** Distance from `p` to the segment `a`-`b` in 3D. */
function distanceToSegment(p: Point3Mm, a: Point3Mm, b: Point3Mm): number {
  const [dx, dy, dz] = [b.x - a.x, b.y - a.y, b.z - a.z];
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const along = lengthSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / lengthSq;
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy), p.z - (a.z + t * dz));
}

/** The lifted segment nearest to `p`, with its distance. */
function nearest(p: Point3Mm, points: readonly Point3Mm[]): { index: number; distance: number } {
  let best = { index: 0, distance: Infinity };
  for (let i = 1; i < points.length; i++) {
    const distance = distanceToSegment(p, points[i - 1], points[i]);
    if (distance < best.distance) best = { index: i - 1, distance };
  }
  return best;
}

describe.each(FIXTURES)("realisticWiring — %s", (_name, fixture) => {
  const { wiring, result } = lifted(fixture);
  const dressed = realisticWiring(wiring, result);
  const lift = new Map(result.conductors.map((c) => [c.key, c]));
  const conductors = new Map(wiring.conductors.map((c) => [c.key, c]));
  const EPS = 1e-6;

  it("gives one wire per lifted conductor, ends unchanged", () => {
    expect(dressed.wires.map((w) => w.key)).toEqual(result.conductors.map((c) => c.key));
    for (const wire of dressed.wires) {
      const points = lift.get(wire.key)?.points ?? [];
      expect(wire.smooth[0], wire.key).toEqual(points[0]);
      expect(wire.smooth.at(-1), wire.key).toEqual(points.at(-1));
    }
  });

  it("keeps the smoothed path within one bend radius of the lifted path, plus the sag for feeds", () => {
    for (const wire of dressed.wires) {
      const points = lift.get(wire.key)?.points ?? [];
      const bend = bendRadiusMm(wire.diameterMm, "realistic");
      const feed = conductors.get(wire.key)?.kind === "feed";
      const zs = points.map((p) => p.z);
      for (const p of wire.smooth) {
        expect(nearest(p, points).distance, wire.key).toBeLessThanOrEqual(bend + (feed ? MAX_SAG_MM : 0) + EPS);
        // Sag is only ever in y: depth stays within the lifted route's range.
        expect(p.z, wire.key).toBeGreaterThanOrEqual(Math.min(...zs) - EPS);
        expect(p.z, wire.key).toBeLessThanOrEqual(Math.max(...zs) + EPS);
      }
    }
  });

  it("sags only feeds, downward in y, and leaves circuit and WLZ runs taut", () => {
    for (const wire of dressed.wires) {
      const points = lift.get(wire.key)?.points ?? [];
      const feed = conductors.get(wire.key)?.kind === "feed";
      const bend = bendRadiusMm(wire.diameterMm, "realistic");
      for (const p of wire.smooth) {
        const { index } = nearest(p, points);
        const [a, b] = [points[index], points[index + 1]];
        if (a.y !== b.y || a.x === b.x) continue;
        const inside = p.x > Math.min(a.x, b.x) + bend + EPS && p.x < Math.max(a.x, b.x) - bend - EPS;
        if (!inside || Math.abs(p.z - a.z) > EPS) continue;
        if (feed) {
          expect(p.y - a.y, wire.key).toBeGreaterThanOrEqual(-EPS);
          expect(p.y - a.y, wire.key).toBeLessThanOrEqual(MAX_SAG_MM + EPS);
        } else {
          expect(p.y, wire.key).toBeCloseTo(a.y, 9);
        }
      }
    }
  });

  it("puts one ferrule on every terminal or bar end, never on an entry end", () => {
    let ferrules = 0;
    for (const wire of dressed.wires) {
      const conductor = conductors.get(wire.key);
      const points = lift.get(wire.key)?.points ?? [];
      if (conductor === undefined) throw new Error(wire.key);
      const ends = [
        ...(conductor.from.type === "entry" ? [] : [points[0]]),
        ...(conductor.to.type === "entry" ? [] : [points.at(-1)]),
      ];
      expect(
        wire.ferrules.map((f) => f.at),
        wire.key,
      ).toEqual(ends);
      const table = FERRULE[conductor.crossSectionMm2 as keyof typeof FERRULE];
      for (const f of wire.ferrules) {
        expect(f.lengthMm).toBe(table.lengthMm);
        expect(f.colourToken).toBe(table.colourToken);
        expect(f.diameterMm).toBeGreaterThan(wire.diameterMm);
        expect(f.collar.diameterMm).toBeGreaterThan(f.diameterMm);
        expect(Math.hypot(f.direction.x, f.direction.y, f.direction.z)).toBeCloseTo(1, 9);
        expect(f.offsetMm).toBeLessThanOrEqual(0);
      }
      ferrules += wire.ferrules.length;
    }
    expect(ferrules).toBeGreaterThan(0);
  });

  it("places one tie per 2D cable tie, inside the cabinet", () => {
    const ties = buildCableTies(wiring.conductors);
    expect(dressed.ties.map((t) => t.key)).toEqual(ties.map((t) => t.key));
    for (const tie of dressed.ties) {
      expect(tie.depthMm).toBeGreaterThan(0);
      expect(tie.centre.z).toBeGreaterThan(0);
    }
  });

  it("draws every sheath at its 2D cable's diameter", () => {
    const cables = new Map(buildDrawnCables(wiring.conductors).map((c) => [c.key, c.diameterMm]));
    let sheathed = 0;
    for (const wire of dressed.wires) {
      const conductor = conductors.get(wire.key);
      if (conductor === undefined) throw new Error(wire.key);
      if (wire.sheath === null) continue;
      sheathed++;
      const key = conductor.kind === "wlz" ? "wlz" : `c:${conductor.circuitId ?? conductor.key}`;
      expect(wire.sheath.diameterMm, wire.key).toBe(cables.get(key));
      expect(wire.sheath.points).toEqual(lift.get(wire.key)?.sheath);
    }
    expect(sheathed).toBe(result.conductors.filter((c) => c.sheath !== null).length);
  });

  it("is deterministic", () => {
    expect(realisticWiring(wiring, lifted(fixture).result)).toEqual(dressed);
  });
});

describe("realisticWiring — feeds hang loose", () => {
  it("sags a feed with a long free horizontal run in the realistic project", () => {
    const { wiring, result } = lifted(realisticFixture());
    const dressed = realisticWiring(wiring, result);
    const sagging = dressed.wires.filter((wire) => {
      const points = result.conductors.find((c) => c.key === wire.key)?.points ?? [];
      return (
        wiring.conductors.find((c) => c.key === wire.key)?.kind === "feed" &&
        wire.smooth.some((p) => {
          const { index } = nearest(p, points);
          return points[index].y === points[index + 1].y && p.y - points[index].y > 0.5;
        })
      );
    });
    expect(sagging.length).toBeGreaterThan(0);
  });
});

describe("realisticWiring — a side pack with an overflow layer", () => {
  it("ties and dresses the overflowing bundle without throwing", () => {
    const { wiring, result } = lifted(worstCaseFixture(), (data) =>
      data.wiring === null
        ? data
        : {
            ...data,
            wiring: {
              ...data.wiring,
              circuits: data.wiring.circuits.map((c) => ({ ...c, cross_section_mm2: 16, entry_side: "left" })),
            },
          },
    );
    const dressed = realisticWiring(wiring, result);
    expect(dressed.ties.length).toBe(buildCableTies(wiring.conductors).length);
    expect(dressed.ties.length).toBeGreaterThan(0);
  });
});

describe("smoothConductor3D", () => {
  it("returns a copy of a conductor with no corners", () => {
    const { result } = lifted(realisticFixture());
    const [first] = result.conductors;
    const straight = { ...first, points: [first.points[0], first.points[1]] };
    expect(smoothConductor3D(straight, "realistic")).toEqual(straight.points);
  });
});
