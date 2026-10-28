import { describe, expect, it } from "vitest";
import {
  BUSBAR_PIN_FILL,
  FRONT_WINDOW_MM,
  LEVER_PROTRUSION_MM,
  RAIL_SLOT_PITCH_MM,
  SCREW_RADIUS_MM,
  barModel,
  busbarModel,
  cabinetModel,
  deviceModel,
  partBounds,
  railModel,
  type ModelMaterial,
  type ModelPart,
} from "./cabinet-3d-models";
import {
  DIN_RAIL_DEPTH_MM,
  RAIL_FRONT_Z_MM,
  RAIL_STANDOFF_MM,
  buildCabinetScene,
  terminalZ,
  type Box3Mm,
  type Scene3DDevice,
} from "./cabinet-3d";
import { SEED_B } from "./cabinet-layout.fixtures";
import { deviceTerminals } from "./cabinet-layout";
import type { PoleConfig } from "./device-spec";
import type { Busbar3D } from "./wiring-3d";

const EPS = 1e-6;

function inside(inner: Box3Mm, outer: Box3Mm): boolean {
  return (
    inner.x >= outer.x - EPS &&
    inner.y >= outer.y - EPS &&
    inner.z >= outer.z - EPS &&
    inner.x + inner.w <= outer.x + outer.w + EPS &&
    inner.y + inner.h <= outer.y + outer.h + EPS &&
    inner.z + inner.d <= outer.z + outer.d + EPS
  );
}

function expectInside(parts: readonly ModelPart[], outer: Box3Mm) {
  for (const part of parts) {
    expect(inside(partBounds(part), outer), JSON.stringify(part)).toBe(true);
  }
}

function ofMaterial(parts: readonly ModelPart[], material: ModelMaterial): ModelPart[] {
  return parts.filter((part) => part.material === material);
}

function scene3DDevice(overrides: Partial<Scene3DDevice> = {}): Scene3DDevice {
  return {
    id: "d",
    role: "mcb",
    railIndex: 0,
    rect: { x: 40, y: 60, w: 18, h: 85 },
    lines: ["B16"],
    nTerminalSide: null,
    depthMm: 69,
    poles: "1P",
    ...overrides,
  };
}

function boxOf(device: Scene3DDevice): Box3Mm {
  return { ...device.rect, z: RAIL_FRONT_Z_MM, d: device.depthMm };
}

describe("deviceModel", () => {
  const cases: { poles: PoleConfig; side: "left" | "right" | null; width: number }[] = [
    { poles: "1P", side: null, width: 18 },
    { poles: "1P+N", side: "left", width: 18 },
    { poles: "1P+N", side: "right", width: 18 },
    { poles: "2P", side: "left", width: 36 },
    { poles: "2P", side: "right", width: 36 },
    { poles: "3P", side: null, width: 54 },
    { poles: "3P+N", side: "left", width: 72 },
    { poles: "3P+N", side: "right", width: 72 },
  ];

  it.each(cases)("puts one screw per pole at its terminal ($poles, N $side)", ({ poles, side, width }) => {
    const device = scene3DDevice({ role: "rcd", poles, nTerminalSide: side, rect: { x: 40, y: 60, w: width, h: 85 } });
    const box = boxOf(device);
    const model = deviceModel(device, box);
    const terminals = deviceTerminals({ id: device.id, poles, n_terminal_side: side }, device.rect);
    const heads = ofMaterial(model.parts, "screw");

    expect(model.screws).toHaveLength(terminals.top.length * 2);
    expect(heads).toHaveLength(terminals.top.length * 2);
    const expected = [...terminals.top, ...terminals.bottom];
    expected.forEach((terminal, index) => {
      expect(model.screws[index].x).toBeCloseTo(terminal.x, 9);
      expect(model.screws[index].z).toBe(terminalZ(device));
      // The head's outer face is flush with the top / bottom face, where the wire ends.
      const bounds = partBounds(heads[index]);
      const outer = terminal.y === device.rect.y ? bounds.y : bounds.y + bounds.h;
      expect(outer).toBeCloseTo(terminal.y, 9);
      expect(heads[index].shape === "cylinder" && heads[index].axis).toBe("y");
    });
    expect(ofMaterial(model.parts, "terminalOpening")).toHaveLength(expected.length);
    expectInside(model.parts, box);
  });

  it("keeps the shoulders deep enough to contain the screws", () => {
    const device = scene3DDevice();
    const box = boxOf(device);
    const shoulder = partBounds(deviceModel(device, box).parts[0]);
    expect(shoulder.z + shoulder.d).toBeGreaterThanOrEqual(terminalZ(device) + SCREW_RADIUS_MM);
    expect(shoulder.z + shoulder.d).toBeLessThan(box.z + box.d);
  });

  it("raises the standard 45 mm window to the lever's protrusion below the front", () => {
    const device = scene3DDevice();
    const box = boxOf(device);
    const window = partBounds(deviceModel(device, box).parts[1]);
    expect(window.h).toBe(FRONT_WINDOW_MM);
    expect(window.y + window.h / 2).toBeCloseTo(box.y + box.h / 2, 9);
    expect(window.z + window.d).toBeCloseTo(box.z + box.d - LEVER_PROTRUSION_MM, 9);
  });

  it("follows the role: levers, test button and handle width", () => {
    const parts = (role: Scene3DDevice["role"], width: number) => {
      const device = scene3DDevice({
        role,
        poles: role === "main_switch" ? "3P" : "2P",
        nTerminalSide: role === "main_switch" ? null : "left",
        rect: { x: 0, y: 0, w: width, h: 85 },
      });
      return deviceModel(device, boxOf(device)).parts;
    };
    const handleWidth = (list: ModelPart[]) => partBounds(ofMaterial(list, "lever")[0]).w;
    const mcb = parts("mcb", 18);
    const rcbo = parts("rcbo", 18);
    const rcd = parts("rcd", 36);
    const fr = parts("main_switch", 54);

    for (const list of [mcb, rcbo, rcd, fr]) expect(ofMaterial(list, "lever")).toHaveLength(1);
    expect(ofMaterial(mcb, "testButton")).toHaveLength(0);
    expect(ofMaterial(fr, "testButton")).toHaveLength(0);
    expect(ofMaterial(rcbo, "testButton")).toHaveLength(1);
    expect(ofMaterial(rcd, "testButton")).toHaveLength(1);
    expect(handleWidth(fr)).toBeGreaterThan(handleWidth(mcb) * 2);
  });

  it("scales the window down for a device shorter than 45 mm and never overflows the box", () => {
    for (const role of ["mcb", "rcd", "rcbo", "main_switch"] as const) {
      const device = scene3DDevice({
        role,
        poles: "2P",
        nTerminalSide: "right",
        rect: { x: 10, y: 10, w: 18, h: 30 },
        depthMm: 40,
      });
      const box = boxOf(device);
      const model = deviceModel(device, box);
      expect(partBounds(model.parts[1]).h).toBeLessThan(FRONT_WINDOW_MM);
      expectInside(model.parts, box);
      if (model.label === null) throw new Error("expected a label");
      expect(inside({ ...model.label.rect, z: model.label.z, d: 0 }, box)).toBe(true);
    }
  });

  it("puts the label on the window face and carries the lines", () => {
    const device = scene3DDevice({ lines: ["B16", "1P"] });
    const box = boxOf(device);
    const { label } = deviceModel(device, box);
    expect(label?.lines).toEqual(["B16", "1P"]);
    expect(label?.z).toBeCloseTo(box.z + box.d - LEVER_PROTRUSION_MM, 9);
  });

  it("models a catalog bar on a rail foot, screws at the terminal points", () => {
    const device = scene3DDevice({ role: "pe_bar", poles: null, rect: { x: 40, y: 60, w: 120, h: 20 }, depthMm: 40 });
    const box = boxOf(device);
    const terminals = [10, 40, 70, 100].map((dx) => ({ x: 40 + dx, y: 70 }));
    const model = deviceModel(device, box, terminals);
    expect(model.label).toBeNull();
    expect(ofMaterial(model.parts, "housingDark")).toHaveLength(1);
    expect(model.screws.map((p) => [p.x, p.y])).toEqual(terminals.map((p) => [p.x, p.y]));
    expectInside(model.parts, box);
  });
});

describe("barModel", () => {
  it("puts one screw per terminal at its (x, y), head toward the viewer, inside the box", () => {
    const box: Box3Mm = { x: 10, y: 50, z: 20, w: 15, h: 400, d: 10 };
    const terminals = [0, 1, 2, 3].map((i) => ({ x: 17.5, y: 70 + i * 90 }));
    const model = barModel(box, "PE", terminals);
    const heads = ofMaterial(model.parts, "screw");
    expect(heads).toHaveLength(terminals.length);
    heads.forEach((head, index) => {
      expect(head.shape === "cylinder" && head.axis).toBe("z");
      const bounds = partBounds(head);
      expect(bounds.x + bounds.w / 2).toBeCloseTo(terminals[index].x, 9);
      expect(bounds.y + bounds.h / 2).toBeCloseTo(terminals[index].y, 9);
    });
    const brass = partBounds(ofMaterial(model.parts, "brass")[0]);
    const front = Math.max(...heads.map((head) => partBounds(head).z + partBounds(head).d));
    expect(front).toBeGreaterThan(brass.z + brass.d);
    expect(ofMaterial(model.parts, "insulator")).toHaveLength(2);
    expectInside(model.parts, box);
  });

  it("copes with a bar of no terminals", () => {
    const model = barModel({ x: 0, y: 0, z: 0, w: 100, h: 15, d: 10 }, "N", []);
    expect(model.screws).toEqual([]);
    expect(ofMaterial(model.parts, "brass")).toHaveLength(1);
  });
});

describe("railModel", () => {
  const box: Box3Mm = { x: 40, y: 80, z: RAIL_STANDOFF_MM, w: 320, h: 35, d: DIN_RAIL_DEPTH_MM };

  it("is a top-hat profile and mounting slots inside the rail's box", () => {
    const parts = railModel(box);
    const profile = ofMaterial(parts, "rail");
    expect(profile).toHaveLength(1);
    expect(profile[0].shape).toBe("extrusion");
    expect(partBounds(profile[0])).toEqual({ x: 40, y: 80, z: RAIL_STANDOFF_MM, w: 320, h: 35, d: DIN_RAIL_DEPTH_MM });
    expect(ofMaterial(parts, "railSlot")).toHaveLength(Math.floor(320 / RAIL_SLOT_PITCH_MM));
    expectInside(parts, box);
  });

  it("keeps a short rail inside its box too", () => {
    const short = { ...box, w: 30 };
    expectInside(railModel(short), short);
  });
});

describe("busbarModel", () => {
  const busbar: Busbar3D = {
    key: "g1",
    phases: 3,
    body: { x: 40, y: 100, z: 40, w: 72, h: 6, d: 6 },
    teeth: [0, 1, 2, 3].map((i) => ({ x: 46 + i * 18 - 1.5, y: 106, z: 40, w: 3, h: 20, d: 6 })),
  };

  it("has one copper pin per tooth, inside its tooth box and reaching its far end", () => {
    const parts = busbarModel(busbar);
    const pins = ofMaterial(parts, "busbarCopper");
    expect(pins).toHaveLength(busbar.teeth.length);
    pins.forEach((pin, index) => {
      const tooth = busbar.teeth[index];
      const bounds = partBounds(pin);
      expect(inside(bounds, tooth)).toBe(true);
      expect(bounds.y + bounds.h).toBeCloseTo(tooth.y + tooth.h, 9);
      expect(bounds.w).toBeCloseTo(tooth.w * BUSBAR_PIN_FILL, 9);
    });
    expect(parts[0]).toEqual({ shape: "box", box: busbar.body, material: "busbarInsulation" });
  });

  it("reaches a tooth that points up too", () => {
    const up: Busbar3D = {
      ...busbar,
      body: { ...busbar.body, y: 200 },
      teeth: busbar.teeth.map((tooth) => ({ ...tooth, y: 170, h: 30 })),
    };
    for (const [index, pin] of ofMaterial(busbarModel(up), "busbarCopper").entries()) {
      expect(partBounds(pin).y).toBeCloseTo(up.teeth[index].y, 9);
    }
  });
});

describe("cabinetModel", () => {
  const scene = buildCabinetScene({ geometry: SEED_B, devices: [], wiring: null });
  const model = cabinetModel(scene);

  it("gives one part list per element, in the order plate, left, right, top, bottom", () => {
    expect(model).toHaveLength(5);
    expect(model[0].map((part) => part.material)).toEqual(["plate"]);
    for (const wall of model.slice(1)) expect(wall.every((part) => part.material === "wall")).toBe(true);
    expect(model[0][0].shape).toBe("roundedBox");
    expect(partBounds(model[0][0])).toEqual(scene.backPlate);
    scene.walls.forEach((wall, index) => {
      expect(partBounds(model[index + 1][0])).toEqual(wall);
    });
  });

  it("stays inside the bounds of the plate and walls", () => {
    const all = [scene.backPlate, ...scene.walls];
    const x0 = Math.min(...all.map((b) => b.x));
    const y0 = Math.min(...all.map((b) => b.y));
    const z0 = Math.min(...all.map((b) => b.z));
    const bounds: Box3Mm = {
      x: x0,
      y: y0,
      z: z0,
      w: Math.max(...all.map((b) => b.x + b.w)) - x0,
      h: Math.max(...all.map((b) => b.y + b.h)) - y0,
      d: Math.max(...all.map((b) => b.z + b.d)) - z0,
    };
    expectInside(model.flat(), bounds);
  });

  it("adds a front lip to each wall, flush with the wall's front", () => {
    for (const [index, wall] of scene.walls.entries()) {
      const lip = partBounds(model[index + 1][1]);
      expect(lip.z + lip.d).toBeCloseTo(wall.z + wall.d, 9);
    }
  });
});

describe("determinism", () => {
  it("gives the same model for the same input", () => {
    const device = scene3DDevice({ role: "rcbo", poles: "1P+N", nTerminalSide: "right" });
    expect(deviceModel(device, boxOf(device))).toEqual(deviceModel(device, boxOf(device)));
    const rail: Box3Mm = { x: 0, y: 0, z: 20, w: 100, h: 35, d: 7.5 };
    expect(railModel(rail)).toEqual(railModel(rail));
    const scene = buildCabinetScene({ geometry: SEED_B, devices: [], wiring: null });
    expect(cabinetModel(scene)).toEqual(cabinetModel(scene));
  });
});
