/* eslint-disable react/no-unknown-property -- R3F elements take three.js props, not DOM attributes. */
import { useEffect, useMemo, type JSX } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import {
  BoxGeometry,
  BufferAttribute,
  Color,
  CurvePath,
  LineCurve3,
  MeshStandardMaterial,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from "three";
import { BAR_CLASSES, DEVICE_CLASSES } from "@/components/cabinets/CabinetDrawing";
import type { Box3Mm, CabinetScene } from "@/lib/cabinet-3d";
import { REALISTIC_WIRE_STYLES, type WireStripe } from "@/lib/cabinet-drawing";
import type { ConductorRole } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import type { Point3Mm, Wiring3D } from "@/lib/wiring-3d";

/**
 * The three.js side of the 3D preview (GitHub #14). It draws the boxes and polylines of `cabinet-3d.ts`
 * and `wiring-3d.ts` and holds no geometry logic beyond the axis flip: cabinet millimetres (x right,
 * y down, z from the back plate toward the viewer) become three.js units as `(x, -y, z)`, here only.
 *
 * Colours are the drawing's tokens, read at runtime and converted to sRGB through a one-pixel 2D canvas,
 * because the tokens are `oklch()` and three.js's CSS parser is not relied on for that. The token of a
 * role comes from the 2D drawing's own class maps (`DEVICE_CLASSES`, `BAR_CLASSES`,
 * `REALISTIC_WIRE_STYLES`), so there is no second mapping to drift.
 */

/** A token class (`fill-drawing-frame stroke-…`, `stroke-wire-l1`) → its custom property's name. */
function tokenOfClass(classes: string): string {
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

/** Steps along a tube per ring: about one conductor diameter, enough for stripes and tight corners. */
const MIN_TUBE_STEP_MM = 2;
const TUBE_RADIAL_SEGMENTS = 8;
/** Display assumption: a cable sheath's diameter as a multiple of its core's. */
const SHEATH_DIAMETER_RATIO = 1.8;

function toVector({ x, y, z }: Point3Mm): Vector3 {
  return new Vector3(x, -y, z);
}

/** The polyline as one tube; null when it has no length. */
function tube(points: readonly Point3Mm[], diameterMm: number): TubeGeometry | null {
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
function paintCore(geometry: TubeGeometry, role: ConductorRole, diameterMm: number, read: (token: string) => Color) {
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

function boxPosition(box: Box3Mm): [number, number, number] {
  return [box.x + box.w / 2, -(box.y + box.h / 2), box.z + box.d / 2];
}

function boxScale(box: Box3Mm): [number, number, number] {
  return [box.w, box.h, box.d];
}

interface Props {
  scene: CabinetScene;
  /** The lifted wires; null while they are routed, and the boxes are drawn alone. */
  wiring: Wiring3D | null;
}

export default function Cabinet3DScene({ scene, wiring }: Props): JSX.Element {
  const read = useMemo(() => makeTokenReader(), []);
  const unitBox = useMemo(() => new BoxGeometry(1, 1, 1), []);
  const materials = useMemo(() => {
    const material = (token: string, extra: { roughness?: number; metalness?: number } = {}) =>
      new MeshStandardMaterial({ color: read(token), roughness: 0.7, ...extra });
    return {
      plate: material("drawing-paper"),
      wall: material("drawing-rail-stroke"),
      rail: material("drawing-rail", { metalness: 0.3, roughness: 0.5 }),
      devices: Object.fromEntries(
        Object.entries(DEVICE_CLASSES).map(([role, classes]) => [role, material(tokenOfClass(classes.body))]),
      ) as Record<keyof typeof DEVICE_CLASSES, MeshStandardMaterial>,
      bars: {
        PE: material(tokenOfClass(BAR_CLASSES.PE.body), { metalness: 0.4 }),
        N: material(tokenOfClass(BAR_CLASSES.N.body), { metalness: 0.4 }),
      },
      busbarBody: material("busbar-insulation"),
      busbarTooth: material("busbar-copper", { metalness: 0.6, roughness: 0.4 }),
      core: new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
      sheath: material("wire-sheath"),
    };
  }, [read]);
  const edgeColor = read("drawing-frame");

  const tubes = useMemo(() => {
    if (wiring === null) return { cores: [], sheaths: [] };
    const cores: { key: string; geometry: BufferGeometry }[] = [];
    const sheaths: { key: string; geometry: BufferGeometry }[] = [];
    for (const conductor of wiring.conductors) {
      const core = tube(conductor.points, conductor.diameterMm);
      if (core) {
        paintCore(core, conductor.role, conductor.diameterMm, read);
        cores.push({ key: conductor.key, geometry: core });
      }
      const sheath = conductor.sheath && tube(conductor.sheath, conductor.diameterMm * SHEATH_DIAMETER_RATIO);
      if (sheath) sheaths.push({ key: conductor.key, geometry: sheath });
    }
    return { cores, sheaths };
  }, [wiring, read]);

  useEffect(
    () => () => {
      for (const { geometry } of [...tubes.cores, ...tubes.sheaths]) geometry.dispose();
    },
    [tubes],
  );
  useEffect(
    () => () => {
      unitBox.dispose();
      materials.plate.dispose();
      materials.wall.dispose();
      materials.rail.dispose();
      for (const material of Object.values(materials.devices)) material.dispose();
      materials.bars.PE.dispose();
      materials.bars.N.dispose();
      materials.busbarBody.dispose();
      materials.busbarTooth.dispose();
      materials.core.dispose();
      materials.sheath.dispose();
    },
    [unitBox, materials],
  );

  // Fit the camera to the interior: from the front, a little from above and the side.
  const { interior } = scene;
  const centre: [number, number, number] = [interior.w / 2, -interior.h / 2, interior.d / 2];
  const fov = 35;
  const distance = Math.max(interior.w, interior.h) / 2 / Math.tan(((fov / 2) * Math.PI) / 180) + interior.d;
  const camera = {
    fov,
    near: 1,
    far: distance * 10,
    position: [centre[0] + interior.w * 0.25, centre[1] + interior.h * 0.2, centre[2] + distance] as [
      number,
      number,
      number,
    ],
  };

  const box = (key: string, b: Box3Mm, material: MeshStandardMaterial, edges = false) => (
    <mesh key={key} geometry={unitBox} material={material} position={boxPosition(b)} scale={boxScale(b)}>
      {edges && <Edges color={edgeColor} />}
    </mesh>
  );

  return (
    <Canvas
      role="img"
      aria-label={t.layout.section.preview3d.canvasLabel}
      camera={camera}
      dpr={[1, 2]}
      frameloop="demand"
    >
      <ambientLight intensity={1.4} />
      <directionalLight
        intensity={2}
        position={[centre[0] + interior.w, centre[1] + interior.h, centre[2] + distance]}
      />
      {box("plate", scene.backPlate, materials.plate)}
      {scene.walls.map((wall, i) => box(`wall-${String(i)}`, wall, materials.wall))}
      {scene.rails.map((rail, i) => box(`rail-${String(i)}`, rail, materials.rail, true))}
      {scene.bars.map((bar, i) => box(`bar-${String(i)}`, bar.box, materials.bars[bar.kind], true))}
      {scene.devices.map((device) => box(device.id, device.box, materials.devices[device.role], true))}
      {wiring?.busbars.map((busbar) => (
        <group key={busbar.key}>
          {box("body", busbar.body, materials.busbarBody)}
          {busbar.teeth.map((tooth, i) => box(`tooth-${String(i)}`, tooth, materials.busbarTooth))}
        </group>
      ))}
      {tubes.cores.map(({ key, geometry }) => (
        <mesh key={key} geometry={geometry} material={materials.core} />
      ))}
      {tubes.sheaths.map(({ key, geometry }) => (
        <mesh key={`sheath-${key}`} geometry={geometry} material={materials.sheath} />
      ))}
      <OrbitControls makeDefault enableDamping target={centre} />
    </Canvas>
  );
}
