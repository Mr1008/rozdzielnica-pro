import { terminalZ, type Box3Mm, type CabinetScene, type Scene3DDevice } from "@/lib/cabinet-3d";
import { deviceTerminals, type Point } from "@/lib/cabinet-layout";
import type { Busbar3D, Point3Mm } from "@/lib/wiring-3d";

/**
 * The realistic element models of the 3D preview (GitHub #14): each element kind as plain parts in
 * cabinet millimetres (the frame of `cabinet-3d.ts`: x right, y down, z from the back plate toward the
 * viewer), so the scene only turns parts into meshes and needs no domain knowledge. Every part lies
 * inside the box it was built from — the front view therefore still matches the 2D drawing, terminals
 * stay at `terminalZ`, and nothing here moves a route or a length.
 *
 * Bundle-safe and three-free, like `cabinet-3d.ts`: no colours either, only semantic `ModelMaterial`
 * names the renderer maps to design tokens. Every proportion below is a display assumption of how
 * modular hardware looks, never catalog data.
 */

/** A part's semantic material; the renderer maps each name to a token-based material. */
export type ModelMaterial =
  | "housing"
  | "housingDark"
  | "lever"
  | "testButton"
  | "indicator"
  | "accessHole"
  | "accessScrew"
  | "screw"
  | "terminalOpening"
  | "rail"
  | "railSlot"
  | "brass"
  | "insulator"
  | "busbarInsulation"
  | "busbarCopper"
  | "plate"
  | "wall";

export type ModelAxis = "x" | "y" | "z";

/** A point of an extrusion profile, in the two axes across the extrusion axis (see `ModelPart`). */
export interface ProfilePoint {
  a: number;
  b: number;
}

/**
 * One primitive. `extrusion` sweeps a closed profile along `axis` from `startMm` for `lengthMm`; the
 * profile's `(a, b)` are absolute cabinet millimetres in the other two axes, in axis order — axis x:
 * (y, z), axis y: (x, z), axis z: (x, y). A `cylinder` is centred on `center`, its axis along `axis`.
 */
export type ModelPart =
  | { shape: "box"; box: Box3Mm; material: ModelMaterial }
  | { shape: "roundedBox"; box: Box3Mm; radiusMm: number; material: ModelMaterial }
  | {
      shape: "cylinder";
      center: Point3Mm;
      axis: ModelAxis;
      radiusMm: number;
      lengthMm: number;
      material: ModelMaterial;
    }
  | {
      shape: "extrusion";
      axis: ModelAxis;
      startMm: number;
      lengthMm: number;
      profile: ProfilePoint[];
      material: ModelMaterial;
    };

/** The axis-aligned bounds of a part. */
export function partBounds(part: ModelPart): Box3Mm {
  if (part.shape === "box" || part.shape === "roundedBox") return { ...part.box };
  if (part.shape === "cylinder") {
    const { x, y, z } = part.center;
    const half = part.lengthMm / 2;
    const r = part.radiusMm;
    const [hx, hy, hz] = [part.axis === "x" ? half : r, part.axis === "y" ? half : r, part.axis === "z" ? half : r];
    return { x: x - hx, y: y - hy, z: z - hz, w: 2 * hx, h: 2 * hy, d: 2 * hz };
  }
  const as = part.profile.map((p) => p.a);
  const bs = part.profile.map((p) => p.b);
  const [a0, a1, b0, b1] = [Math.min(...as), Math.max(...as), Math.min(...bs), Math.max(...bs)];
  if (part.axis === "x") return { x: part.startMm, y: a0, z: b0, w: part.lengthMm, h: a1 - a0, d: b1 - b0 };
  if (part.axis === "y") return { x: a0, y: part.startMm, z: b0, w: a1 - a0, h: part.lengthMm, d: b1 - b0 };
  return { x: a0, y: b0, z: part.startMm, w: a1 - a0, h: b1 - b0, d: part.lengthMm };
}

// ---------------------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------------------

/** Display assumption, not catalog data: the standard modular front window's height (the 45 mm cut-out). */
export const FRONT_WINDOW_MM = 45;

/** Display assumption, not catalog data: a window of a shorter device is at most this share of its height. */
export const FRONT_WINDOW_MAX_SHARE = 0.8;

/** Display assumption, not catalog data: the share of a device's depth the shoulders (outside the window) fill. */
export const SHOULDER_DEPTH_SHARE = 0.65;

/** Display assumption, not catalog data: how far a lever stands proud of the window face. */
export const LEVER_PROTRUSION_MM = 5;

/** Display assumption, not catalog data: a lever may protrude at most this share of the device's depth. */
export const LEVER_PROTRUSION_MAX_SHARE = 0.15;

/** Display assumption, not catalog data: an MCB / RCD / RCBO lever's width. */
export const LEVER_WIDTH_MM = 7;

/** Display assumption, not catalog data: a lever's height, capped at this share of the window. */
export const LEVER_HEIGHT_MM = 20;

/** Display assumption, not catalog data: the share of a device's width an FR handle spans. */
export const FR_HANDLE_WIDTH_SHARE = 0.8;

/** Display assumption, not catalog data: a lever's edge rounding. */
export const LEVER_RADIUS_MM = 1;

/** Display assumption, not catalog data: the dark slot a lever sits in, standing this far off the window. */
export const LEVER_SLOT_RAISE_MM = 0.4;

/** Display assumption, not catalog data: an RCD / RCBO test button's diameter (Eaton's round "T"). */
export const TEST_BUTTON_DIAMETER_MM = 8;

/** Display assumption, not catalog data: how far the test button stands off the window. */
export const TEST_BUTTON_PROTRUSION_MM = 1.5;

/** Display assumption, not catalog data: where, as a share of the width, the lever sits beside a test button. */
export const LEVER_WITH_BUTTON_SHARE = 0.65;

/** Display assumption, not catalog data: where, as a share of the width, the test button sits (left of the lever). */
export const TEST_BUTTON_SHARE = 0.3;

/** Display assumption, not catalog data: the lever's top, as a share of the window height (it sits high, as on Eaton). */
export const LEVER_TOP_SHARE = 0.1;

/**
 * Display assumption, not catalog data: the red contact-position window below the lever (width, height,
 * gap below the lever slot); an RCD / RCBO has a wider bar, this share of its width.
 */
export const INDICATOR_MM = { w: 3, h: 2, gap: 1.5, rcdWidthShare: 0.3 } as const;

/** Display assumption, not catalog data: the screwdriver holes on the shoulder fronts, as a share of the screw radius. */
export const ACCESS_HOLE_RADIUS_SHARE = 1.2;

/** Display assumption, not catalog data: how far the contact-position window stands off the window face. */
export const INDICATOR_PROTRUSION_MM = 0.3;

/** Display assumption, not catalog data: a terminal screw head's radius. */
export const SCREW_RADIUS_MM = 2.5;

/** Display assumption, not catalog data: a terminal screw head's length along its axis. */
export const SCREW_HEAD_MM = 1.5;

/** Display assumption, not catalog data: the dark opening around a terminal screw reaches this far in. */
export const TERMINAL_OPENING_DEPTH_MM = 4;

/** Display assumption, not catalog data: the opening's margin around the screw head. */
export const TERMINAL_OPENING_MARGIN_MM = 1;

/** Display assumption, not catalog data: the latch at a device's back that clips it onto the rail. */
export const RAIL_LATCH_MM = { widthShare: 0.5, height: 3, depth: 4 } as const;

/** Display assumption, not catalog data: the label's inset from the window edge. */
export const LABEL_INSET_MM = 1;

/** TS35×7.5: the web that lies against the plate, 27 mm wide. */
export const RAIL_WEB_WIDTH_MM = 27;

/** TS35×7.5: the overall width, across the brims. */
export const RAIL_OVERALL_WIDTH_MM = 35;

/** Display assumption, not catalog data: the rail's sheet thickness. */
export const RAIL_SHEET_MM = 1;

/** Display assumption, not catalog data: the pitch of the rail's mounting slots. */
export const RAIL_SLOT_PITCH_MM = 25;

/** Display assumption, not catalog data: a mounting slot's length along the rail. */
export const RAIL_SLOT_LENGTH_MM = 15;

/** Display assumption, not catalog data: a mounting slot's width across the web. */
export const RAIL_SLOT_WIDTH_MM = 5.2;

/** Display assumption, not catalog data: the dark slot stands this far off the web's front face. */
export const RAIL_SLOT_RAISE_MM = 0.2;

/** Display assumption, not catalog data: a PE/N bar's brass thickness in z. */
export const BAR_BRASS_THICKNESS_MM = 4;

/** Display assumption, not catalog data: the brass may fill at most this share of the bar's depth. */
export const BAR_BRASS_MAX_SHARE = 0.4;

/** Display assumption, not catalog data: an insulating support's length along the bar. */
export const BAR_SUPPORT_LENGTH_MM = 8;

/** Display assumption, not catalog data: a bar's supports are at most this share of its length each. */
export const BAR_SUPPORT_MAX_SHARE = 0.15;

/** Display assumption, not catalog data: the largest radius of a bar's clamping screw head. */
export const BAR_SCREW_RADIUS_MM = 2.5;

/** Display assumption, not catalog data: a bar screw head's length along z. */
export const BAR_SCREW_HEAD_MM = 1.5;

/** Display assumption, not catalog data: the foot that clips a catalog bar onto its rail. */
export const BAR_RAIL_FOOT_MM = 3;

/** Display assumption, not catalog data: the share of a comb busbar tooth's width its copper pin fills. */
export const BUSBAR_PIN_FILL = 0.6;

/** Display assumption, not catalog data: the comb strip's copper pin ends this far out of its insulation. */
export const BUSBAR_PIN_EXPOSED_MM = 2;

/** Display assumption, not catalog data: the radius rounding the enclosure walls' outer edges. */
export const CABINET_EDGE_RADIUS_MM = 0.8;

/** Display assumption, not catalog data: the front frame lip's depth along z. */
export const CABINET_LIP_DEPTH_MM = 4;

/** Display assumption, not catalog data: how far the front frame lip reaches into the opening. */
export const CABINET_LIP_INWARD_MM = 3;

const EPS = 1e-6;

function box(x: number, y: number, z: number, w: number, h: number, d: number, material: ModelMaterial): ModelPart {
  return { shape: "box", box: { x, y, z, w, h, d }, material };
}

// ---------------------------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------------------------

/** The label's placement: a rectangle on the front window's face. */
export interface DeviceLabel {
  rect: { x: number; y: number; w: number; h: number };
  /** The z of the window face the label lies on. */
  z: number;
  lines: string[];
}

export interface DeviceModel {
  parts: ModelPart[];
  /** Terminal screw head centres (top and bottom faces, left to right), for instancing. */
  screws: Point3Mm[];
  /** Null for a catalog bar, which carries no printed rating. */
  label: DeviceLabel | null;
}

/**
 * A modular DIN device: a base body clipped to the rail with shoulders at a lower depth, the stepped
 * front window raised toward the viewer, one lever (an FR has one wide handle), a test
 * button on an RCD / RCBO and one screw terminal per pole on the top and bottom faces. The screw
 * heads sit flush with the faces at `box.y` / `box.y + box.h`, at the x of `deviceTerminals` and at
 * `terminalZ` — exactly where a wire ends. A `terminalOpening` part is a dark flush decal around each
 * head: the renderer should draw it with a polygon offset. A catalog `pe_bar` / `n_bar` is the bar
 * model on a rail foot; `terminals` are its screws (`CabinetScene.devices[].terminals`).
 */
export function deviceModel(device: Scene3DDevice, boxMm: Box3Mm, terminals: readonly Point[] = []): DeviceModel {
  if (device.role === "pe_bar" || device.role === "n_bar") return catalogBarModel(device, boxMm, terminals);

  const { x, y, z, w, h, d } = boxMm;
  const parts: ModelPart[] = [];

  const protrusion = Math.min(LEVER_PROTRUSION_MM, d * LEVER_PROTRUSION_MAX_SHARE);
  const windowH = Math.min(FRONT_WINDOW_MM, h * FRONT_WINDOW_MAX_SHARE);
  const windowY = y + (h - windowH) / 2;
  const windowFrontZ = z + d - protrusion;

  const points = deviceTerminals(
    { id: device.id, poles: device.poles, n_terminal_side: device.nTerminalSide },
    { x, y, w, h },
  );
  const slot = points.top.length === 0 ? w : w / points.top.length;
  const radius = Math.max(0, Math.min(SCREW_RADIUS_MM, slot / 2 - TERMINAL_OPENING_MARGIN_MM, d * 0.25));
  const tz = terminalZ(device);
  // The shoulders must contain the screws: the terminal's offset plus the head's radius.
  const shoulderD = Math.min(d, Math.max(d * SHOULDER_DEPTH_SHARE, tz - z + radius + EPS));

  parts.push(box(x, y, z, w, h, shoulderD, "housing"));
  parts.push(box(x, windowY, z, w, windowH, Math.max(shoulderD, windowFrontZ - z), "housing"));
  parts.push(
    box(
      x + w * ((1 - RAIL_LATCH_MM.widthShare) / 2),
      y + h - RAIL_LATCH_MM.height,
      z,
      w * RAIL_LATCH_MM.widthShare,
      Math.min(RAIL_LATCH_MM.height, h),
      Math.min(RAIL_LATCH_MM.depth, d),
      "housingDark",
    ),
  );

  const front = frontParts(device, { x, w, z: windowFrontZ, y: windowY, h: windowH, protrusion });
  parts.push(...front.parts);

  const screws: Point3Mm[] = [];
  if (radius > 0) {
    const headMm = Math.min(SCREW_HEAD_MM, TERMINAL_OPENING_DEPTH_MM / 2);
    const openingMm = Math.min(TERMINAL_OPENING_DEPTH_MM, h / 4);
    const half = Math.min(radius + TERMINAL_OPENING_MARGIN_MM, slot / 2, d * 0.5);
    for (const [edge, terminalsAtEdge] of [
      ["top", points.top],
      ["bottom", points.bottom],
    ] as const) {
      const sign = edge === "top" ? 1 : -1;
      const faceY = edge === "top" ? y : y + h;
      for (const terminal of terminalsAtEdge) {
        const openingY = edge === "top" ? faceY : faceY - openingMm;
        parts.push(box(terminal.x - half, openingY, tz - half, 2 * half, openingMm, 2 * half, "terminalOpening"));
        const center = { x: terminal.x, y: faceY + (sign * Math.min(headMm, openingMm)) / 2, z: tz };
        screws.push(center);
        parts.push({
          shape: "cylinder",
          center,
          axis: "y",
          radiusMm: radius,
          lengthMm: Math.min(headMm, openingMm),
          material: "screw",
        });
      }
    }
  }

  // Screwdriver holes on the shoulder fronts above and below the window, one per terminal, with the
  // screw's head showing inside, as on Eaton's range. Flush decals on the shoulder face.
  const shoulderH = (h - windowH) / 2;
  const holeR = Math.min(radius * ACCESS_HOLE_RADIUS_SHARE, slot / 2 - TERMINAL_OPENING_MARGIN_MM, shoulderH / 2 - 0.5);
  if (holeR > 0) {
    const faceZ = z + shoulderD;
    for (const [terminalsAtEdge, cy] of [
      [points.top, y + shoulderH / 2],
      [points.bottom, y + h - shoulderH / 2],
    ] as const) {
      for (const terminal of terminalsAtEdge) {
        parts.push(
          {
            shape: "cylinder",
            center: { x: terminal.x, y: cy, z: faceZ - 0.1 },
            axis: "z",
            radiusMm: holeR,
            lengthMm: 0.2,
            material: "accessHole",
          },
          {
            shape: "cylinder",
            center: { x: terminal.x, y: cy, z: faceZ - 0.05 },
            axis: "z",
            radiusMm: holeR * 0.6,
            lengthMm: 0.1,
            material: "accessScrew",
          },
        );
      }
    }
  }

  // The printed rating sits on the window below the lever slot and the indicator, never under the lever.
  const inset = Math.min(LABEL_INSET_MM, w * 0.05, windowH * 0.05);
  const labelTop = front.slotBottomY + inset;
  return {
    parts,
    screws,
    label: {
      rect: { x: x + inset, y: labelTop, w: w - 2 * inset, h: Math.max(0, windowY + windowH - inset - labelTop) },
      z: windowFrontZ,
      lines: [...device.lines],
    },
  };
}

/**
 * The lever high on the window in its slot, the red contact-position window below it and, on an RCD /
 * RCBO, the round test button left of the lever, on the window face (its front is at `z`), modelled
 * on Eaton's xPole range. Also returns the y below which the label goes.
 */
function frontParts(
  device: Pick<Scene3DDevice, "role">,
  face: { x: number; w: number; z: number; y: number; h: number; protrusion: number },
): { parts: ModelPart[]; slotBottomY: number } {
  const { x, w, z, y, h, protrusion } = face;
  const parts: ModelPart[] = [];
  const hasButton = device.role === "rcd" || device.role === "rcbo";
  const isSwitch = device.role === "main_switch";

  const leverW = isSwitch ? Math.max(LEVER_WIDTH_MM, w * FR_HANDLE_WIDTH_SHARE) : Math.min(LEVER_WIDTH_MM, w * 0.4);
  const leverH = Math.min(LEVER_HEIGHT_MM, h * (isSwitch ? 0.6 : 0.5));
  const centreX = x + w * (hasButton ? LEVER_WITH_BUTTON_SHARE : 0.5);
  const leverX = Math.min(Math.max(centreX - leverW / 2, x), x + w - leverW);
  const leverY = y + Math.max(1.5, h * LEVER_TOP_SHARE);
  const raise = Math.min(LEVER_SLOT_RAISE_MM, protrusion);
  const margin = Math.max(0, Math.min(1, leverX - x, x + w - (leverX + leverW)));

  parts.push(box(leverX - margin, leverY - 1.5, z, leverW + 2 * margin, leverH + 3, raise, "housingDark"), {
    shape: "roundedBox",
    box: { x: leverX, y: leverY, z, w: leverW, h: leverH, d: protrusion },
    radiusMm: Math.min(LEVER_RADIUS_MM, leverW / 2, protrusion / 2),
    material: "lever",
  });
  const slotBottomY = Math.min(leverY + leverH + 1.5, y + h);
  const indicatorW = hasButton ? w * INDICATOR_MM.rcdWidthShare : Math.min(INDICATOR_MM.w, leverW);
  const indicatorY = slotBottomY + INDICATOR_MM.gap;
  const indicatorH = Math.min(INDICATOR_MM.h, Math.max(0, y + h - indicatorY));
  if (indicatorH > 0) {
    parts.push(
      box(
        Math.min(Math.max(leverX + (leverW - indicatorW) / 2, x), x + w - indicatorW),
        indicatorY,
        z,
        indicatorW,
        indicatorH,
        Math.min(INDICATOR_PROTRUSION_MM, protrusion),
        "indicator",
      ),
    );
  }
  if (hasButton) {
    const radius = Math.min(TEST_BUTTON_DIAMETER_MM / 2, w * 0.15);
    const buttonX = Math.min(Math.max(x + w * TEST_BUTTON_SHARE, x + radius), x + w - radius);
    parts.push({
      shape: "cylinder",
      center: { x: buttonX, y: leverY + leverH / 2, z: z + Math.min(TEST_BUTTON_PROTRUSION_MM, protrusion) / 2 },
      axis: "z",
      radiusMm: radius,
      lengthMm: Math.min(TEST_BUTTON_PROTRUSION_MM, protrusion),
      material: "testButton",
    });
  }
  return { parts, slotBottomY: indicatorH > 0 ? indicatorY + indicatorH : slotBottomY };
}

function catalogBarModel(device: Scene3DDevice, boxMm: Box3Mm, terminals: readonly Point[]): DeviceModel {
  const footD = Math.min(BAR_RAIL_FOOT_MM, boxMm.d * 0.2);
  const foot = box(boxMm.x, boxMm.y, boxMm.z, boxMm.w, boxMm.h, footD, "housingDark");
  const bar = barModel(
    { ...boxMm, z: boxMm.z + footD, d: boxMm.d - footD },
    device.role === "pe_bar" ? "PE" : "N",
    terminals,
    terminalZ(device),
  );
  return { parts: [foot, ...bar.parts], screws: bar.screws, label: null };
}

// ---------------------------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------------------------

/**
 * The TS35×7.5 top-hat: its 27 mm web lies against the plate at the box's back, the sides rise to the
 * box's front and the brims reach out to 35 mm there, in ~1 mm sheet — a closed profile extruded along
 * the rail's x — plus dark mounting slots in the web at a fixed pitch.
 */
export function railModel(boxMm: Box3Mm): ModelPart[] {
  const cy = boxMm.y + boxMm.h / 2;
  const web = RAIL_WEB_WIDTH_MM / 2;
  const brim = RAIL_OVERALL_WIDTH_MM / 2;
  const t = RAIL_SHEET_MM;
  const depth = boxMm.d;
  const z = boxMm.z;
  const profile: ProfilePoint[] = [
    [-web, 0],
    [web, 0],
    [web, depth - t],
    [brim, depth - t],
    [brim, depth],
    [web - t, depth],
    [web - t, t],
    [-(web - t), t],
    [-(web - t), depth],
    [-brim, depth],
    [-brim, depth - t],
    [-web, depth - t],
  ].map(([a, b]) => ({ a: cy + a, b: z + b }));

  const parts: ModelPart[] = [
    { shape: "extrusion", axis: "x", startMm: boxMm.x, lengthMm: boxMm.w, profile, material: "rail" },
  ];
  const raise = Math.min(RAIL_SLOT_RAISE_MM, depth - t);
  for (let i = 0; (i + 1) * RAIL_SLOT_PITCH_MM <= boxMm.w; i++) {
    const centre = boxMm.x + RAIL_SLOT_PITCH_MM * (i + 0.5);
    parts.push(
      box(
        centre - RAIL_SLOT_LENGTH_MM / 2,
        cy - RAIL_SLOT_WIDTH_MM / 2,
        z + t,
        RAIL_SLOT_LENGTH_MM,
        RAIL_SLOT_WIDTH_MM,
        raise,
        "railSlot",
      ),
    );
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// PE / N bar
// ---------------------------------------------------------------------------------------------

export interface BarModel {
  parts: ModelPart[];
  /** Clamping screw head centres, one per terminal. */
  screws: Point3Mm[];
}

/**
 * A brass bar on two insulating supports at its ends (behind the brass), with one clamping screw per
 * terminal at exactly the terminal's (x, y), head on the front, axis z. `terminals` must be the
 * router's `barTerminalPoints`. The brass is centred on `centreZ` (default: the box's middle, which
 * is `builtinBarTerminalZ` for a built-in bar and `terminalZ` for a catalog one), where the wires land.
 */
export function barModel(
  boxMm: Box3Mm,
  _kind: "PE" | "N",
  terminals: readonly Point[],
  centreZ: number = boxMm.z + boxMm.d / 2,
): BarModel {
  const { x, y, w, h, z, d } = boxMm;
  const horizontal = w >= h;
  const long = horizontal ? w : h;
  const thickness = Math.min(BAR_BRASS_THICKNESS_MM, d * BAR_BRASS_MAX_SHARE);
  const brassBack = Math.max(z, centreZ - thickness / 2);
  const brassFront = brassBack + thickness;
  const parts: ModelPart[] = [];

  const supportMm = Math.min(BAR_SUPPORT_LENGTH_MM, long * BAR_SUPPORT_MAX_SHARE);
  if (brassBack - z > EPS) {
    for (const offset of [0, long - supportMm]) {
      parts.push(
        horizontal
          ? box(x + offset, y, z, supportMm, h, brassBack - z, "insulator")
          : box(x, y + offset, z, w, supportMm, brassBack - z, "insulator"),
      );
    }
  }
  parts.push(box(x, y, brassBack, w, h, thickness, "brass"));

  const sorted = [...terminals].sort((a, b) => (horizontal ? a.x - b.x : a.y - b.y));
  const spacing = sorted.slice(1).map((p, i) => (horizontal ? p.x - sorted[i].x : p.y - sorted[i].y));
  const radius = Math.min(
    BAR_SCREW_RADIUS_MM,
    (horizontal ? h : w) * 0.4,
    ...spacing.map((gap) => gap * 0.4),
    Math.max(0, z + d - brassFront) > EPS ? Infinity : 0,
  );
  const headMm = Math.min(BAR_SCREW_HEAD_MM, z + d - brassFront);
  const screws: Point3Mm[] = [];
  if (radius > 0 && headMm > EPS) {
    for (const terminal of terminals) {
      const center = { x: terminal.x, y: terminal.y, z: brassFront + headMm / 2 };
      screws.push(center);
      parts.push({ shape: "cylinder", center, axis: "z", radiusMm: radius, lengthMm: headMm, material: "screw" });
    }
  }
  return { parts, screws };
}

// ---------------------------------------------------------------------------------------------
// Comb busbar
// ---------------------------------------------------------------------------------------------

/**
 * The insulated comb strip: the body in insulation, a tooth sleeve in insulation per tooth with one
 * copper pin inside each tooth box, reaching the tooth's terminal end (the end farthest from the body)
 * and standing `BUSBAR_PIN_EXPOSED_MM` out of its sleeve there.
 */
export function busbarModel(busbar: Busbar3D): ModelPart[] {
  const { body, teeth } = busbar;
  const parts: ModelPart[] = [{ shape: "box", box: { ...body }, material: "busbarInsulation" }];
  for (const tooth of teeth) {
    const toBottom = tooth.y + tooth.h / 2 > body.y + body.h / 2;
    const exposed = Math.min(BUSBAR_PIN_EXPOSED_MM, tooth.h);
    parts.push({
      shape: "box",
      box: { ...tooth, y: toBottom ? tooth.y : tooth.y + exposed, h: tooth.h - exposed },
      material: "busbarInsulation",
    });
    const pinW = tooth.w * BUSBAR_PIN_FILL;
    const pinD = tooth.d * BUSBAR_PIN_FILL;
    parts.push({
      shape: "box",
      box: {
        x: tooth.x + (tooth.w - pinW) / 2,
        y: tooth.y,
        z: tooth.z + (tooth.d - pinD) / 2,
        w: pinW,
        h: tooth.h,
        d: pinD,
      },
      material: "busbarCopper",
    });
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Enclosure
// ---------------------------------------------------------------------------------------------

/**
 * The enclosure, one part list per element in the order of `[backPlate, ...walls]` (plate, left,
 * right, top, bottom), so the renderer's cutaway can hide whole elements. Each is a rounded box; a
 * wall also carries a front frame lip that reaches into the opening. Everything lies inside the
 * bounds of the plate and walls together.
 */
export function cabinetModel(scene: CabinetScene): ModelPart[][] {
  const rounded = (b: Box3Mm, material: ModelMaterial): ModelPart => ({
    shape: "roundedBox",
    box: { ...b },
    radiusMm: Math.min(CABINET_EDGE_RADIUS_MM, Math.min(b.w, b.h, b.d) / 2),
    material,
  });
  const lipD = Math.min(CABINET_LIP_DEPTH_MM, scene.interior.d);
  const lipIn = CABINET_LIP_INWARD_MM;
  const walls = scene.walls.map((wall, index): ModelPart[] => {
    const front = wall.z + wall.d - lipD;
    // left, right (reach in along x), top, bottom (reach in along y)
    const lip: Box3Mm =
      index === 0
        ? { ...wall, z: front, d: lipD, w: wall.w + lipIn }
        : index === 1
          ? { ...wall, z: front, d: lipD, x: wall.x - lipIn, w: wall.w + lipIn }
          : index === 2
            ? { ...wall, z: front, d: lipD, h: wall.h + lipIn }
            : { ...wall, z: front, d: lipD, y: wall.y - lipIn, h: wall.h + lipIn };
    return [rounded(wall, "wall"), { shape: "box", box: lip, material: "wall" }];
  });
  return [[rounded(scene.backPlate, "plate")], ...walls];
}
