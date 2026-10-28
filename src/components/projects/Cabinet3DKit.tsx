import { createContext, use, useEffect, useMemo } from "react";
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CurvePath,
  CylinderGeometry,
  ExtrudeGeometry,
  LineCurve3,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Shape,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DEVICE_CLASSES } from "@/components/cabinets/CabinetDrawing";
import type { Box3Mm } from "@/lib/cabinet-3d";
import type { ModelMaterial, ModelPart } from "@/lib/cabinet-3d-models";
import { REALISTIC_WIRE_STYLES, type DrawnRole, type WireStripe } from "@/lib/cabinet-drawing";
import type { ConductorRole } from "@/lib/cabinet-wiring";
import type { Point3Mm } from "@/lib/wiring-3d";

/**
 * What the 3D preview's element components share (GitHub #14): token colours, one material per
 * (material name, colour), the part-to-geometry converter and the label textures. cabinet millimetres
 * (x right, y down, z toward the viewer) become three.js units as `(x, -y, z)` here and in
 * `Cabinet3DScene.tsx` only — every converter below builds its geometry already flipped, so it never
 * needs a second mapping afterwards.
 *
 * Colours are the drawing's tokens, read at runtime and converted to sRGB through a one-pixel 2D canvas,
 * because the tokens are `oklch()` and three.js's CSS parser is not relied on for that. The token of a
 * role comes from the 2D drawing's own class maps (`DEVICE_CLASSES`, `BAR_CLASSES`,
 * `REALISTIC_WIRE_STYLES`), so there is no second mapping to drift.
 */

/** A token class (`fill-drawing-frame stroke-…`, `stroke-wire-l1`) → its custom property's name. */
export function tokenOfClass(classes: string): string {
  const first = classes.split(" ")[0] ?? "";
  return first.replace(/^(fill|stroke)-/, "");
}

/** Reads `--<token>` from the document and converts it to a linear three.js colour. */
function makeTokenReader(): (token: string) => Color {
  const style = getComputedStyle(document.documentElement);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map<string, Color>();
  return (token) => {
    const cached = cache.get(token);
    if (cached) return cached;
    const color = new Color();
    if (ctx) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = style.getPropertyValue(`--${token}`).trim();
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      color.setRGB(r / 255, g / 255, b / 255, SRGBColorSpace);
    }
    cache.set(token, color);
    return color;
  };
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** Display assumption: facets around a cylinder (screw heads, test buttons, ferrules). */
const CYLINDER_SEGMENTS = 14;
/** Display assumption: curve steps of a rounded box's bevel. */
const BEVEL_SEGMENTS = 2;
/** Steps along a tube per ring: about one conductor diameter, enough for stripes and tight corners. */
const MIN_TUBE_STEP_MM = 2;
const TUBE_RADIAL_SEGMENTS = 10;

export function toVector({ x, y, z }: Point3Mm): Vector3 {
  return new Vector3(x, -y, z);
}

/** A box in cabinet mm as a flipped, non-indexed geometry. */
export function boxGeometry(b: Box3Mm): BufferGeometry {
  const geometry = new BoxGeometry(b.w, b.h, b.d).toNonIndexed();
  geometry.translate(b.x + b.w / 2, -(b.y + b.h / 2), b.z + b.d / 2);
  return geometry;
}

function roundedBoxGeometry(b: Box3Mm, radiusMm: number): BufferGeometry {
  const r = Math.min(radiusMm, Math.min(b.w, b.h, b.d) * 0.4);
  if (r <= 0) return boxGeometry(b);
  // A plain rectangle inset by `r`, extruded with a bevel of `r`: the bevel brings every edge back out.
  const w = b.w - 2 * r;
  const h = b.h - 2 * r;
  const shape = new Shape()
    .moveTo(-w / 2, -h / 2)
    .lineTo(w / 2, -h / 2)
    .lineTo(w / 2, h / 2)
    .lineTo(-w / 2, h / 2)
    .closePath();
  const geometry = new ExtrudeGeometry(shape, {
    depth: b.d - 2 * r,
    bevelEnabled: true,
    bevelThickness: r,
    bevelSize: r,
    bevelOffset: 0,
    bevelSegments: BEVEL_SEGMENTS,
    curveSegments: 1,
  });
  geometry.translate(b.x + b.w / 2, -(b.y + b.h / 2), b.z + r);
  return geometry;
}

function cylinderGeometry(part: Extract<ModelPart, { shape: "cylinder" }>): BufferGeometry {
  const geometry = new CylinderGeometry(part.radiusMm, part.radiusMm, part.lengthMm, CYLINDER_SEGMENTS).toNonIndexed();
  if (part.axis === "z") geometry.rotateX(Math.PI / 2);
  else if (part.axis === "x") geometry.rotateZ(Math.PI / 2);
  geometry.translate(part.center.x, -part.center.y, part.center.z);
  return geometry;
}

/**
 * The profile's local axes (u, v, w = extrusion) map to three.js axes by a cyclic permutation (a proper
 * rotation, so normals stay outward even though y is flipped): axis x → (y, z, x); axis y → (z, x, y);
 * axis z → (x, y, z), with the profile's second coordinate read as the first local axis for axis y.
 */
function extrusionGeometry(part: Extract<ModelPart, { shape: "extrusion" }>): BufferGeometry {
  const { axis, profile, startMm, lengthMm } = part;
  // Local (u, v) of each profile point and the three.js position of the local origin.
  const local = profile.map(({ a, b }) => {
    if (axis === "x") return { u: -a, v: b }; // a is cabinet y
    if (axis === "y") return { u: b, v: a }; // a is x, b is z: (z, x)
    return { u: a, v: -b }; // axis z: a is x, b is cabinet y
  });
  const shape = new Shape(local.map(({ u, v }) => new Vector2(u, v)));
  const geometry = new ExtrudeGeometry(shape, { depth: lengthMm, bevelEnabled: false, curveSegments: 1 });
  const ex = new Vector3(1, 0, 0);
  const ey = new Vector3(0, 1, 0);
  const ez = new Vector3(0, 0, 1);
  if (axis === "x") {
    geometry.applyMatrix4(new Matrix4().makeBasis(ey, ez, ex));
    geometry.translate(startMm, 0, 0);
  } else if (axis === "y") {
    geometry.applyMatrix4(new Matrix4().makeBasis(ez, ex, ey));
    geometry.translate(0, -(startMm + lengthMm), 0);
  } else {
    geometry.translate(0, 0, startMm);
  }
  return geometry;
}

/** Any model part as a flipped geometry; always non-indexed, so parts of every shape merge. */
function partGeometry(part: ModelPart): BufferGeometry {
  let geometry: BufferGeometry;
  if (part.shape === "box") geometry = boxGeometry(part.box);
  else if (part.shape === "roundedBox") geometry = roundedBoxGeometry(part.box, part.radiusMm);
  else if (part.shape === "cylinder") geometry = cylinderGeometry(part);
  else geometry = extrusionGeometry(part);
  const plain = geometry.index ? geometry.toNonIndexed() : geometry;
  // Merging needs the same attributes everywhere; the textures' uv is unused, the normals are used.
  for (const name of Object.keys(plain.attributes)) {
    if (name !== "position" && name !== "normal") plain.deleteAttribute(name);
  }
  return plain;
}

/** The parts merged into one geometry per material name: a handful of draw calls per element. */
export function mergeParts(parts: readonly ModelPart[]): { material: ModelMaterial; geometry: BufferGeometry }[] {
  const byMaterial = new Map<ModelMaterial, BufferGeometry[]>();
  for (const part of parts) {
    const list = byMaterial.get(part.material) ?? [];
    list.push(partGeometry(part));
    byMaterial.set(part.material, list);
  }
  const merged: { material: ModelMaterial; geometry: BufferGeometry }[] = [];
  for (const [material, geometries] of byMaterial) {
    const geometry = mergeGeometries(geometries);
    for (const g of geometries) g.dispose();
    merged.push({ material, geometry });
  }
  return merged;
}

/** The polyline as one tube; null when it has no length. */
export function tube(points: readonly Point3Mm[], diameterMm: number): TubeGeometry | null {
  const path = new CurvePath<Vector3>();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a.x === b.x && a.y === b.y && a.z === b.z) continue;
    path.add(new LineCurve3(toVector(a), toVector(b)));
  }
  if (path.curves.length === 0) return null;
  const length = path.getLength();
  const segments = Math.max(1, Math.ceil(length / Math.max(diameterMm, MIN_TUBE_STEP_MM)));
  return new TubeGeometry(path, segments, diameterMm / 2, TUBE_RADIAL_SEGMENTS, false);
}

/** The colour at `diameters` along a core: its body, or the last stripe that covers that spot. */
function stripeAt(diameters: number, body: Color, stripes: readonly { stripe: WireStripe; color: Color }[]): Color {
  let color = body;
  for (const { stripe, color: stripeColor } of stripes) {
    const period = stripe.onDiameters + stripe.offDiameters;
    const k = (((diameters - stripe.startDiameters) % period) + period) % period;
    if (k < stripe.onDiameters) color = stripeColor;
  }
  return color;
}

/** Paints a core's tube ring by ring with its insulation colour and stripes, as the realistic drawing does. */
export function paintCore(
  geometry: TubeGeometry,
  role: ConductorRole,
  diameterMm: number,
  read: (token: string) => Color,
) {
  const style = REALISTIC_WIRE_STYLES[role];
  const body = read(tokenOfClass(style.body));
  const stripes = style.stripes.map((stripe) => ({ stripe, color: read(tokenOfClass(stripe.stroke)) }));
  const { tubularSegments, radialSegments, path } = geometry.parameters;
  const length = path.getLength();
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i <= tubularSegments; i++) {
    const color = stripeAt(((i / tubularSegments) * length) / diameterMm, body, stripes);
    for (let j = 0; j <= radialSegments; j++) {
      const k = (i * (radialSegments + 1) + j) * 3;
      colors[k] = color.r;
      colors[k + 1] = color.g;
      colors[k + 2] = color.b;
    }
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

/** Display assumption: label texture resolution. */
const LABEL_PX_PER_MM = 10;
/** The share of the window's height, from its bottom, the text may use (the lever sits above it). */
const LABEL_BAND_SHARE = 0.27;
/** Display assumption: the largest label glyph height and the line spacing, in em. */
const LABEL_MAX_FONT_MM = 3.5;
const LABEL_LINE_EM = 1.15;

export interface LabelRect {
  w: number;
  h: number;
}

// ---------------------------------------------------------------------------------------------
// Kit
// ---------------------------------------------------------------------------------------------

type PhysicalOrStandard = MeshStandardMaterial | MeshPhysicalMaterial;

export interface SceneKit {
  read: (token: string) => Color;
  /** A unit-radius, unit-height, y-axis cylinder: ferrules instance it. */
  unitCylinder: CylinderGeometry;
  /** The material of a model part; a `housing` part takes its device role's colour. */
  materialOf: (name: ModelMaterial, role?: DrawnRole) => PhysicalOrStandard;
  core: MeshPhysicalMaterial;
  sheath: MeshStandardMaterial;
  tie: MeshStandardMaterial;
  ferrule: (token: string) => MeshStandardMaterial;
  /** The text of a device's label on a transparent plane texture, shared by equal labels. */
  label: (lines: readonly string[], rect: LabelRect, role: DrawnRole) => MeshBasicMaterial;
  /** Sky and ground colours of the hemisphere light. */
  sky: Color;
  ground: Color;
}

const SceneKitContext = createContext<SceneKit | null>(null);
export const SceneKitProvider = SceneKitContext;

export function useSceneKit(): SceneKit {
  const kit = use(SceneKitContext);
  if (kit === null) throw new Error("a 3D element rendered outside Cabinet3DScene");
  return kit;
}

interface Built {
  kit: SceneKit;
  dispose: () => void;
}

function buildKit(): Built {
  const read = makeTokenReader();
  const owned: { dispose: () => void }[] = [];
  const own = <T extends { dispose: () => void }>(item: T): T => {
    owned.push(item);
    return item;
  };
  const standard = (
    token: string,
    extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {},
  ): MeshStandardMaterial => own(new MeshStandardMaterial({ color: read(token), roughness: 0.6, ...extra }));
  // Coplanar decals (terminal openings, screw heads, slots) are pulled toward the camera instead of z-fighting.
  const decal = (factor: number) => ({ polygonOffset: true, polygonOffsetFactor: factor, polygonOffsetUnits: factor });

  const housing = Object.fromEntries(
    (Object.keys(DEVICE_CLASSES) as DrawnRole[]).map((role) => [
      role,
      standard(tokenOfClass(DEVICE_CLASSES[role].body), { roughness: 0.45 }),
    ]),
  ) as Record<DrawnRole, MeshStandardMaterial>;
  const named: Record<Exclude<ModelMaterial, "housing">, PhysicalOrStandard> = {
    housingDark: standard("device-dark", { roughness: 0.5 }),
    lever: standard("device-lever", { roughness: 0.35 }),
    testButton: standard("device-test-button", { roughness: 0.4 }),
    screw: standard("device-screw", { metalness: 0.8, roughness: 0.35, ...decal(-2) }),
    terminalOpening: standard("device-dark", { roughness: 0.8, ...decal(-1) }),
    rail: standard("drawing-rail", { metalness: 0.7, roughness: 0.4 }),
    railSlot: standard("device-dark", { roughness: 0.8, ...decal(-1) }),
    brass: standard("bar-brass", { metalness: 0.85, roughness: 0.3 }),
    insulator: standard("busbar-insulation", { roughness: 0.5 }),
    busbarInsulation: standard("busbar-insulation", { roughness: 0.45 }),
    busbarCopper: standard("busbar-copper", { metalness: 0.9, roughness: 0.3 }),
    plate: standard("drawing-paper", { roughness: 0.8 }),
    wall: standard("drawing-rail-stroke", { roughness: 0.6 }),
  };
  const ferrules = new Map<string, MeshStandardMaterial>();
  const labels = new Map<string, MeshBasicMaterial>();
  const fontFamily = getComputedStyle(document.body).fontFamily;

  const kit: SceneKit = {
    read,
    unitCylinder: own(new CylinderGeometry(1, 1, 1, CYLINDER_SEGMENTS)),
    materialOf: (name, role) => (name === "housing" ? housing[role ?? "mcb"] : named[name]),
    core: own(
      new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, clearcoat: 0.5, clearcoatRoughness: 0.3 }),
    ),
    sheath: standard("wire-sheath", { roughness: 0.5 }),
    tie: standard("wire-tie", { roughness: 0.7 }),
    ferrule: (token) => {
      const cached = ferrules.get(token);
      if (cached) return cached;
      const material = standard(token, { metalness: 0.2, roughness: 0.4 });
      ferrules.set(token, material);
      return material;
    },
    label: (lines, rect, role) => {
      const key = `${role}|${rect.w.toFixed(2)}|${rect.h.toFixed(2)}|${lines.join("\n")}`;
      const cached = labels.get(key);
      if (cached) return cached;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(rect.w * LABEL_PX_PER_MM));
      canvas.height = Math.max(1, Math.round(rect.h * LABEL_PX_PER_MM));
      const ctx = canvas.getContext("2d");
      if (ctx && lines.length > 0) {
        const bandPx = canvas.height * LABEL_BAND_SHARE;
        const fontPx = Math.min(LABEL_MAX_FONT_MM * LABEL_PX_PER_MM, bandPx / (lines.length * LABEL_LINE_EM));
        ctx.font = `600 ${String(fontPx)}px ${fontFamily}`;
        const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), 1);
        const fitPx = Math.min(fontPx, (fontPx * canvas.width * 0.92) / widest);
        ctx.font = `600 ${String(fitPx)}px ${fontFamily}`;
        ctx.fillStyle = read(tokenOfClass(DEVICE_CLASSES[role].label)).getStyle(SRGBColorSpace);
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const top = canvas.height - bandPx;
        lines.forEach((line, i) => {
          ctx.fillText(line, canvas.width / 2, top + i * fitPx * LABEL_LINE_EM, canvas.width * 0.96);
        });
      }
      const texture = own(new CanvasTexture(canvas));
      texture.colorSpace = SRGBColorSpace;
      texture.anisotropy = 4;
      const material = own(
        new MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        }),
      );
      labels.set(key, material);
      return material;
    },
    sky: read("drawing-paper"),
    ground: read("drawing-rail-stroke"),
  };
  return {
    kit,
    dispose: () => {
      for (const item of owned) item.dispose();
    },
  };
}

/** Builds the shared kit once and disposes of it with the scene. */
export function useBuildSceneKit(): SceneKit {
  const built = useMemo(() => buildKit(), []);
  useEffect(() => built.dispose, [built]);
  return built.kit;
}
