import { describe, expect, it } from "vitest";
import {
  BUILTIN_BAR_DEPTH_MM,
  DIN_RAIL_DEPTH_MM,
  RAIL_FRONT_Z_MM,
  RAIL_STANDOFF_MM,
  TERMINAL_DEPTH_RATIO,
  WALL_THICKNESS_MM,
  buildCabinetScene,
  builtinBarTerminalZ,
  terminalZ,
  toScene3DDevices,
  type Box3Mm,
  type Cabinet3DData,
} from "./cabinet-3d";
import { buildDrawnDevices, type DrawableDevice } from "./cabinet-drawing";
import { barRect, RAIL_HEIGHT_MM } from "./cabinet-geometry";
import { barTerminalPoints, catalogBarAsCabinetBar } from "./cabinet-layout";
import type { WiringData } from "./wiring-island";
import type { PoleConfig } from "./device-spec";
import { SEED_B } from "./cabinet-layout.fixtures";

/** PRZ-M3: three rails, a vertical built-in PE bar (left) and N bar (right), both at `zMm` 20. */
const GEOMETRY = SEED_B;

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

const DEVICES = [
  device("main", { role: "main_switch", width_mm: 54, rated_current_a: 40 }),
  device("rcd", { role: "rcd", rcd_group_id: "g1", width_mm: 36, rated_current_a: 40, residual_current_ma: 30 }),
  device("mcb", { rcd_group_id: "g1" }),
];
const DEPTH_MM: Record<string, number> = { main: 70, rcd: 74.5, mcb: 69 };
const POLES: Record<string, PoleConfig> = { main: "3P", rcd: "2P", mcb: "1P" };
const SNAPSHOT = DEVICES.map((entry) => ({ id: entry.id, depth_mm: DEPTH_MM[entry.id], poles: POLES[entry.id] }));

const DRAWN = buildDrawnDevices(
  DEVICES,
  [
    { projectDeviceId: "main", railIndex: 0, xMm: 0 },
    { projectDeviceId: "rcd", railIndex: 1, xMm: 0 },
    { projectDeviceId: "mcb", railIndex: 1, xMm: 36 },
  ],
  GEOMETRY,
  [{ id: "g1", label: "RCD 1" }],
);

function data(): Cabinet3DData {
  return { geometry: GEOMETRY, devices: toScene3DDevices(DRAWN, SNAPSHOT), wiring: null };
}

/** Strict, so boxes that only touch along a face do not intersect. */
function intersects(a: Box3Mm, b: Box3Mm): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h && a.z < b.z + b.d && b.z < a.z + a.d;
}

describe("toScene3DDevices", () => {
  it("keeps the drawn rectangle, lines and N side and adds the snapshot depth and poles", () => {
    expect(toScene3DDevices(DRAWN, SNAPSHOT)).toEqual(
      DRAWN.map((drawn) => ({
        id: drawn.id,
        role: drawn.role,
        railIndex: drawn.railIndex,
        rect: drawn.rect,
        lines: drawn.lines,
        nTerminalSide: drawn.nTerminalSide,
        depthMm: DEPTH_MM[drawn.id],
        poles: POLES[drawn.id],
      })),
    );
  });

  it("throws on a drawn device with no snapshot row", () => {
    expect(() => toScene3DDevices(DRAWN, SNAPSHOT.slice(1))).toThrow(/main/);
  });
});

describe("buildCabinetScene", () => {
  const scene = buildCabinetScene(data());

  it("puts every device's back on the rail's front face, with its front view and snapshot depth", () => {
    expect(RAIL_FRONT_Z_MM).toBe(RAIL_STANDOFF_MM + DIN_RAIL_DEPTH_MM);
    expect(scene.devices).toHaveLength(DRAWN.length);
    scene.devices.forEach((entry, index) => {
      const { rect } = DRAWN[index];
      expect(entry).toEqual({
        id: DRAWN[index].id,
        role: DRAWN[index].role,
        box: { x: rect.x, y: rect.y, w: rect.w, h: rect.h, z: RAIL_FRONT_Z_MM, d: DEPTH_MM[entry.id] },
        terminals: [],
      });
    });
  });

  it("sets each rail at the standoff, TS35 tall and 7.5 mm deep", () => {
    expect(scene.rails).toEqual(
      GEOMETRY.rails.map((rail) => ({
        x: rail.xMm,
        y: rail.yMm,
        w: rail.lengthMm,
        h: RAIL_HEIGHT_MM,
        z: RAIL_STANDOFF_MM,
        d: DIN_RAIL_DEPTH_MM,
      })),
    );
  });

  it("sets each built-in bar at its own zMm, a vertical one turned on its side", () => {
    const terminals = GEOMETRY.bars.map((bar) =>
      barTerminalPoints(bar, GEOMETRY.interior).map((terminal) => terminal.point),
    );
    expect(terminals[0]).toHaveLength(14);
    expect(scene.bars).toEqual([
      { kind: "PE", box: { x: 10, y: 50, w: 15, h: 400, z: 20, d: BUILTIN_BAR_DEPTH_MM }, terminals: terminals[0] },
      { kind: "N", box: { x: 375, y: 50, w: 15, h: 400, z: 20, d: BUILTIN_BAR_DEPTH_MM }, terminals: terminals[1] },
    ]);
    expect(builtinBarTerminalZ(GEOMETRY.bars[0])).toBe(20 + BUILTIN_BAR_DEPTH_MM / 2);
  });

  it("puts a device's terminals at its depth ratio in front of the rail", () => {
    expect(terminalZ({ depthMm: 70 })).toBe(RAIL_FRONT_Z_MM + 70 * TERMINAL_DEPTH_RATIO);
  });

  it("encloses the interior with a back plate and four walls, open at the front", () => {
    const { widthMm, heightMm, depthMm } = GEOMETRY.interior;
    expect(scene.interior).toEqual({ x: 0, y: 0, z: 0, w: widthMm, h: heightMm, d: depthMm });
    expect(scene.backPlate).toEqual({
      x: -WALL_THICKNESS_MM,
      y: -WALL_THICKNESS_MM,
      z: -WALL_THICKNESS_MM,
      w: widthMm + 2 * WALL_THICKNESS_MM,
      h: heightMm + 2 * WALL_THICKNESS_MM,
      d: WALL_THICKNESS_MM,
    });
    expect(scene.walls).toHaveLength(4);
    for (const wall of [scene.backPlate, ...scene.walls]) {
      expect(intersects(wall, scene.interior)).toBe(false);
      // Nothing closes the front: no part of the body stands in front of the interior.
      expect(wall.z + wall.d).toBeLessThanOrEqual(depthMm);
    }
    // Each side of the interior touches a wall: left, right, top, bottom.
    const [left, right, top, bottom] = scene.walls;
    expect(left.x + left.w).toBe(0);
    expect(right.x).toBe(widthMm);
    expect(top.y + top.h).toBe(0);
    expect(bottom.y).toBe(heightMm);
    for (const wall of scene.walls) {
      expect(wall.z).toBe(0);
      expect(wall.d).toBe(depthMm);
    }
  });

  it("gives a catalog bar the router's terminal points, and none without wiring data", () => {
    const groups = [{ count: 3, minMm2: 1.5, maxMm2: 16 }];
    const drawn = { ...DRAWN[2], id: "bar", role: "pe_bar" as const };
    const withBar = (wiring: WiringData | null) =>
      buildCabinetScene({
        geometry: GEOMETRY,
        devices: [{ ...drawn, depthMm: 40, poles: null }],
        wiring,
      }).devices[0].terminals;
    const wiring = { devices: [{ id: "bar", role: "pe_bar", terminal_groups: groups }] } as unknown as WiringData;
    const bar = catalogBarAsCabinetBar({ role: "pe_bar", terminal_groups: groups }, drawn.rect);
    if (bar === null) throw new Error("expected a bar");
    expect(barRect(bar)).toEqual(drawn.rect);
    expect(withBar(wiring)).toEqual(barTerminalPoints(bar, GEOMETRY.interior).map((terminal) => terminal.point));
    expect(withBar(wiring)).toHaveLength(3);
    expect(withBar(null)).toEqual([]);
  });

  it("does not clamp a device deeper than the cabinet", () => {
    const deep = buildCabinetScene({
      ...data(),
      devices: toScene3DDevices(
        DRAWN,
        SNAPSHOT.map((row) => ({ ...row, depth_mm: 200 })),
      ),
    });
    expect(deep.devices.every((entry) => entry.box.d === 200)).toBe(true);
  });

  it("gives the same scene for the same data", () => {
    expect(buildCabinetScene(data())).toEqual(buildCabinetScene(data()));
  });
});
