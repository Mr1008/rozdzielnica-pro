/* eslint-disable react/no-unknown-property -- R3F elements take three.js props, not DOM attributes. */
import { createContext, use, useEffect, useMemo, useRef, type JSX } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
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
  type Mesh,
} from "three";
import { BAR_CLASSES, DEVICE_CLASSES } from "@/components/cabinets/CabinetDrawing";
import type { Box3Mm, CabinetScene } from "@/lib/cabinet-3d";
import { REALISTIC_WIRE_STYLES, type DrawnRole, type WireStripe } from "@/lib/cabinet-drawing";
import type { ConductorRole } from "@/lib/cabinet-wiring";
import { t } from "@/lib/i18n";
import type { Busbar3D, Conductor3D, Point3Mm, Wiring3D } from "@/lib/wiring-3d";

/**
 * The three.js side of the 3D preview (GitHub #14). It draws the boxes and polylines of `cabinet-3d.ts`
 * and `wiring-3d.ts` and holds no geometry logic beyond the axis flip: cabinet millimetres (x right,
 * y down, z from the back plate toward the viewer) become three.js units as `(x, -y, z)`, here only.
 *
 * Colours are the drawing's tokens, read at runtime and converted to sRGB through a one-pixel 2D canvas,
 * because the tokens are `oklch()` and three.js's CSS parser is not relied on for that. The token of a
 * role comes from the 2D drawing's own class maps (`DEVICE_CLASSES`, `BAR_CLASSES`,
 * `REALISTIC_WIRE_STYLES`), so there is no second mapping to drift.
 *
 * One component per element kind — `Cabinet`, `Rail`, `Device`, `BuiltinBar`, `Busbar`, `Wire` — each
 * taking only its pure-model box or points, so a detailed model can replace a kind's box without
 * touching the scene. They share the colours, materials and the unit box through `SceneKit`.
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

type BarKind = CabinetScene["bars"][number]["kind"];

/** What every element component shares: token colours, one material per colour, one unit box. */
interface SceneKit {
  read: (token: string) => Color;
  unitBox: BoxGeometry;
  materials: {
    plate: MeshStandardMaterial;
    wall: MeshStandardMaterial;
    rail: MeshStandardMaterial;
    devices: Record<DrawnRole, MeshStandardMaterial>;
    bars: Record<BarKind, MeshStandardMaterial>;
    busbarBody: MeshStandardMaterial;
    busbarTooth: MeshStandardMaterial;
    core: MeshStandardMaterial;
    sheath: MeshStandardMaterial;
  };
  edgeColor: Color;
}

const SceneKitContext = createContext<SceneKit | null>(null);

function useSceneKit(): SceneKit {
  const kit = use(SceneKitContext);
  if (kit === null) throw new Error("a 3D element rendered outside Cabinet3DScene");
  return kit;
}

/** Builds the shared kit once and disposes of it with the scene. */
function useBuildSceneKit(): SceneKit {
  const kit = useMemo<SceneKit>(() => {
    const read = makeTokenReader();
    const material = (token: string, extra: { roughness?: number; metalness?: number } = {}) =>
      new MeshStandardMaterial({ color: read(token), roughness: 0.7, ...extra });
    return {
      read,
      unitBox: new BoxGeometry(1, 1, 1),
      materials: {
        plate: material("drawing-paper"),
        wall: material("drawing-rail-stroke"),
        rail: material("drawing-rail", { metalness: 0.3, roughness: 0.5 }),
        devices: Object.fromEntries(
          Object.entries(DEVICE_CLASSES).map(([role, classes]) => [role, material(tokenOfClass(classes.body))]),
        ) as Record<DrawnRole, MeshStandardMaterial>,
        bars: {
          PE: material(tokenOfClass(BAR_CLASSES.PE.body), { metalness: 0.4 }),
          N: material(tokenOfClass(BAR_CLASSES.N.body), { metalness: 0.4 }),
        },
        busbarBody: material("busbar-insulation"),
        busbarTooth: material("busbar-copper", { metalness: 0.6, roughness: 0.4 }),
        core: new MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
        sheath: material("wire-sheath"),
      },
      edgeColor: read("drawing-frame"),
    };
  }, []);
  useEffect(
    () => () => {
      kit.unitBox.dispose();
      const { devices, bars, ...single } = kit.materials;
      for (const material of [...Object.values(single), ...Object.values(devices), ...Object.values(bars)]) {
        material.dispose();
      }
    },
    [kit],
  );
  return kit;
}

interface BoxMeshProps {
  box: Box3Mm;
  material: MeshStandardMaterial;
  /** Outline it in the frame colour, like the 2D drawing's stroke. */
  edges?: boolean;
}

/** A box-shaped stand-in: the unit box scaled to `box`. */
function BoxMesh({ box, material, edges = false }: BoxMeshProps): JSX.Element {
  const { unitBox, edgeColor } = useSceneKit();
  return (
    <mesh geometry={unitBox} material={material} position={boxPosition(box)} scale={boxScale(box)}>
      {edges && <Edges color={edgeColor} />}
    </mesh>
  );
}

/**
 * The back plate and the four walls, as a cutaway: each frame, a wall (or the plate) the camera is
 * outside of is hidden, so from any angle the interior stays in view. `walls` is left, right, top,
 * bottom (`buildCabinetScene`).
 */
function Cabinet({ interior, backPlate, walls }: Pick<CabinetScene, "interior" | "backPlate" | "walls">): JSX.Element {
  const { unitBox, materials } = useSceneKit();
  const refs = useRef<(Mesh | null)[]>([]);
  useFrame(({ camera }) => {
    const { x, y, z } = camera.position;
    const outside = [z < 0, x < 0, x > interior.w, y > 0, y < -interior.h];
    outside.forEach((hidden, i) => {
      const mesh = refs.current[i];
      if (mesh) mesh.visible = !hidden;
    });
  });
  return (
    <>
      {[backPlate, ...walls].map((b, i) => (
        <mesh
          key={i === 0 ? "plate" : `wall-${String(i)}`}
          ref={(mesh) => {
            refs.current[i] = mesh;
          }}
          geometry={unitBox}
          material={i === 0 ? materials.plate : materials.wall}
          position={boxPosition(b)}
          scale={boxScale(b)}
        />
      ))}
    </>
  );
}

/** A DIN rail. */
function Rail({ box }: { box: Box3Mm }): JSX.Element {
  return <BoxMesh box={box} material={useSceneKit().materials.rail} edges />;
}

/** A placed device, catalog PE/N bars included; its look follows its role. */
function Device({ role, box }: { role: DrawnRole; box: Box3Mm }): JSX.Element {
  return <BoxMesh box={box} material={useSceneKit().materials.devices[role]} edges />;
}

/** One of the cabinet's built-in PE/N bars. */
function BuiltinBar({ kind, box }: { kind: BarKind; box: Box3Mm }): JSX.Element {
  return <BoxMesh box={box} material={useSceneKit().materials.bars[kind]} edges />;
}

/** A comb busbar: its insulated body and a copper tooth per terminal. */
function Busbar({ body, teeth }: Pick<Busbar3D, "body" | "teeth">): JSX.Element {
  const { materials } = useSceneKit();
  return (
    <group>
      <BoxMesh box={body} material={materials.busbarBody} />
      {teeth.map((tooth, i) => (
        <BoxMesh key={i} box={tooth} material={materials.busbarTooth} />
      ))}
    </group>
  );
}

/** A conductor: its core as a tube in its insulation colours, plus a thicker sheath stub for a cable. */
function Wire({
  role,
  diameterMm,
  points,
  sheath,
}: Pick<Conductor3D, "role" | "diameterMm" | "points" | "sheath">): JSX.Element {
  const { read, materials } = useSceneKit();
  const geometries = useMemo(() => {
    const core = tube(points, diameterMm);
    if (core) paintCore(core, role, diameterMm, read);
    return { core, sheath: sheath && tube(sheath, diameterMm * SHEATH_DIAMETER_RATIO) };
  }, [points, sheath, role, diameterMm, read]);
  useEffect(
    () => () => {
      geometries.core?.dispose();
      geometries.sheath?.dispose();
    },
    [geometries],
  );
  return (
    <>
      {geometries.core && <mesh geometry={geometries.core} material={materials.core} />}
      {geometries.sheath && <mesh geometry={geometries.sheath} material={materials.sheath} />}
    </>
  );
}

interface Props {
  scene: CabinetScene;
  /** The lifted wires; null while they are routed, and the boxes are drawn alone. */
  wiring: Wiring3D | null;
}

export default function Cabinet3DScene({ scene, wiring }: Props): JSX.Element {
  const kit = useBuildSceneKit();

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

  return (
    <Canvas
      role="img"
      aria-label={t.layout.section.preview3d.canvasLabel}
      camera={camera}
      dpr={[1, 2]}
      frameloop="demand"
    >
      <SceneKitContext value={kit}>
        <ambientLight intensity={1.4} />
        <directionalLight
          intensity={2}
          position={[centre[0] + interior.w, centre[1] + interior.h, centre[2] + distance]}
        />
        <Cabinet interior={scene.interior} backPlate={scene.backPlate} walls={scene.walls} />
        {scene.rails.map((rail, i) => (
          <Rail key={`rail-${String(i)}`} box={rail} />
        ))}
        {scene.bars.map((bar, i) => (
          <BuiltinBar key={`bar-${String(i)}`} kind={bar.kind} box={bar.box} />
        ))}
        {scene.devices.map((device) => (
          <Device key={device.id} role={device.role} box={device.box} />
        ))}
        {wiring?.busbars.map((busbar) => (
          <Busbar key={busbar.key} body={busbar.body} teeth={busbar.teeth} />
        ))}
        {wiring?.conductors.map((conductor) => (
          <Wire
            key={conductor.key}
            role={conductor.role}
            diameterMm={conductor.diameterMm}
            points={conductor.points}
            sheath={conductor.sheath}
          />
        ))}
        <OrbitControls makeDefault enableDamping target={centre} />
      </SceneKitContext>
    </Canvas>
  );
}
