/* eslint-disable react/no-unknown-property -- R3F elements take three.js props, not DOM attributes. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import {
  InstancedMesh,
  Matrix4,
  Object3D,
  Quaternion,
  Vector3,
  type DirectionalLight,
  type Group,
  type TubeGeometry,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  boxGeometry,
  mergeParts,
  paintCore,
  SceneKitProvider,
  toVector,
  tube,
  useBuildSceneKit,
  useSceneKit,
} from "@/components/projects/Cabinet3DKit";
import type { Box3Mm, CabinetScene, Scene3DDevice } from "@/lib/cabinet-3d";
import { barModel, busbarModel, cabinetModel, deviceModel, railModel, type ModelPart } from "@/lib/cabinet-3d-models";
import type { Point } from "@/lib/cabinet-layout";
import { builtinBarTerminalZ } from "@/lib/cabinet-3d";
import { t } from "@/lib/i18n";
import type { Busbar3D, RealisticWire, Tie3D } from "@/lib/wiring-3d";

/**
 * The three.js side of the 3D preview (GitHub #14). It turns the plain parts of `cabinet-3d-models.ts`
 * and the lifted, smoothed routes of `wiring-3d.ts` into meshes and holds no geometry logic beyond the
 * axis flip: cabinet millimetres (x right, y down, z from the back plate toward the viewer) become
 * three.js units as `(x, -y, z)`, here and in `Cabinet3DKit.tsx` only. Nothing is drawn outside a
 * pure-model box or off a lifted route, except a device's printed label, which lies on its window face.
 *
 * One component per element kind — `Cabinet`, `Rail`, `Device`, `BuiltinBar`, `Busbar`, `Wire`, plus the
 * instanced `Ferrules` and `Ties` — each taking only its pure-model input. Parts are merged into one
 * geometry per material per element; materials, textures and the unit cylinder come from the shared kit.
 */

/** Display assumption: a cable tie's strap thickness. */
const TIE_THICKNESS_MM = 0.5;
/** Display assumption: how far the label plane stands off the window face, against z-fighting. */
const LABEL_LIFT_MM = 0.05;

/** The lifted busbars and the realistic wiring, as the island hands them to the scene. */
export interface Wiring3DView {
  busbars: Busbar3D[];
  wires: RealisticWire[];
  ties: Tie3D[];
}

/** An element's parts as merged meshes, one per material; disposed with the element. */
function Parts({
  parts,
  cast = true,
  receive = true,
}: {
  parts: readonly ModelPart[];
  cast?: boolean;
  receive?: boolean;
}): JSX.Element {
  const kit = useSceneKit();
  const merged = useMemo(() => mergeParts(parts), [parts]);
  useEffect(
    () => () => {
      for (const { geometry } of merged) geometry.dispose();
    },
    [merged],
  );
  return (
    <>
      {merged.map(({ material, geometry }) => (
        <mesh
          key={material}
          geometry={geometry}
          material={kit.materialOf(material)}
          castShadow={cast}
          receiveShadow={receive}
        />
      ))}
    </>
  );
}

/**
 * The back plate and the four walls, as a cutaway: each frame, a wall (or the plate) the camera is
 * outside of is hidden, so from any angle the interior stays in view. The model's elements are plate,
 * left, right, top, bottom (`cabinetModel`).
 */
function Cabinet({ scene }: { scene: CabinetScene }): JSX.Element {
  const { interior } = scene;
  const elements = useMemo(() => cabinetModel(scene), [scene]);
  const refs = useRef<(Group | null)[]>([]);
  useFrame(({ camera }) => {
    const { x, y, z } = camera.position;
    const outside = [z < 0, x < 0, x > interior.w, y > 0, y < -interior.h];
    outside.forEach((hidden, i) => {
      const group = refs.current[i];
      if (group) group.visible = !hidden;
    });
  });
  return (
    <>
      {elements.map((parts, i) => (
        <group
          key={i === 0 ? "plate" : `wall-${String(i)}`}
          ref={(group) => {
            refs.current[i] = group;
          }}
        >
          <Parts parts={parts} cast={false} receive={i === 0} />
        </group>
      ))}
    </>
  );
}

/** A DIN rail: its top-hat profile and mounting slots. */
function Rail({ box }: { box: Box3Mm }): JSX.Element {
  const parts = useMemo(() => railModel(box), [box]);
  return <Parts parts={parts} />;
}

/**
 * A placed device, catalog PE/N bars included: its modular model and printed rating. `terminals` are a
 * catalog bar's clamping screws; the housing takes its role's colour, as in the 2D drawing.
 */
function Device({
  device,
  box,
  terminals,
}: {
  device: Scene3DDevice;
  box: Box3Mm;
  terminals: readonly Point[];
}): JSX.Element {
  const kit = useSceneKit();
  const model = useMemo(() => deviceModel(device, box, terminals), [device, box, terminals]);
  const { label } = model;
  return (
    <group>
      <Parts parts={model.parts} />
      {label && label.lines.length > 0 && (
        <mesh
          position={[label.rect.x + label.rect.w / 2, -(label.rect.y + label.rect.h / 2), label.z + LABEL_LIFT_MM]}
          material={kit.label(label.lines, label.rect)}
        >
          <planeGeometry args={[label.rect.w, label.rect.h]} />
        </mesh>
      )}
    </group>
  );
}

/** One of the cabinet's built-in PE/N bars: brass on two supports, with a clamping screw per terminal. */
function BuiltinBar({
  kind,
  box,
  terminals,
  zMm,
}: {
  kind: "PE" | "N";
  box: Box3Mm;
  terminals: readonly Point[];
  zMm: number;
}): JSX.Element {
  const model = useMemo(
    () => barModel(box, kind, terminals, builtinBarTerminalZ({ zMm })),
    [box, kind, terminals, zMm],
  );
  return <Parts parts={model.parts} />;
}

/** A comb busbar: its insulated strip and a copper pin per tooth. */
function Busbar({ busbar }: { busbar: Busbar3D }): JSX.Element {
  const parts = useMemo(() => busbarModel(busbar), [busbar]);
  return <Parts parts={parts} />;
}

/** A conductor: its core as a tube along the smoothed route in its insulation colours, plus a cable's sheath. */
function Wire({ wire }: { wire: RealisticWire }): JSX.Element {
  const { read, core, sheath } = useSceneKit();
  const geometries = useMemo(() => {
    const coreGeometry: TubeGeometry | null = tube(wire.smooth, wire.diameterMm);
    if (coreGeometry) paintCore(coreGeometry, wire.role, wire.diameterMm, read);
    return {
      core: coreGeometry,
      sheath: wire.sheath && tube(wire.sheath.points, wire.sheath.diameterMm),
    };
  }, [wire, read]);
  useEffect(
    () => () => {
      geometries.core?.dispose();
      geometries.sheath?.dispose();
    },
    [geometries],
  );
  return (
    <>
      {geometries.core && <mesh geometry={geometries.core} material={core} castShadow />}
      {geometries.sheath && <mesh geometry={geometries.sheath} material={sheath} castShadow />}
    </>
  );
}

/** Every ferrule, one instanced mesh per colour: sleeve and wider collar are two instances of a unit cylinder. */
function Ferrules({ wires }: { wires: readonly RealisticWire[] }): JSX.Element {
  const kit = useSceneKit();
  const meshes = useMemo(() => {
    const up = new Vector3(0, 1, 0);
    const byToken = new Map<string, Matrix4[]>();
    const add = (token: string, start: Vector3, direction: Vector3, lengthMm: number, diameterMm: number) => {
      const matrix = new Matrix4().compose(
        start.clone().addScaledVector(direction, lengthMm / 2),
        new Quaternion().setFromUnitVectors(up, direction),
        new Vector3(diameterMm / 2, lengthMm, diameterMm / 2),
      );
      byToken.set(token, [...(byToken.get(token) ?? []), matrix]);
    };
    for (const wire of wires) {
      for (const f of wire.ferrules) {
        const direction = new Vector3(f.direction.x, -f.direction.y, f.direction.z).normalize();
        const start = toVector(f.at).addScaledVector(direction, f.offsetMm);
        add(f.colourToken, start, direction, f.lengthMm, f.diameterMm);
        const collarStart = start.clone().addScaledVector(direction, f.lengthMm - f.collar.lengthMm);
        add(f.colourToken, collarStart, direction, f.collar.lengthMm, f.collar.diameterMm);
      }
    }
    return [...byToken].map(([token, matrices]) => {
      const mesh = new InstancedMesh(kit.unitCylinder, kit.ferrule(token), matrices.length);
      matrices.forEach((matrix, i) => {
        mesh.setMatrixAt(i, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      return { token, mesh };
    });
  }, [wires, kit]);
  useEffect(
    () => () => {
      for (const { mesh } of meshes) mesh.dispose();
    },
    [meshes],
  );
  return (
    <>
      {meshes.map(({ token, mesh }) => (
        <primitive key={token} object={mesh} />
      ))}
    </>
  );
}

/** Every cable tie: a thin rectangular strap around its runs' cross-section, merged into one mesh. */
function Ties({ ties }: { ties: readonly Tie3D[] }): JSX.Element | null {
  const kit = useSceneKit();
  const geometry = useMemo(() => {
    const pieces: Box3Mm[] = [];
    for (const tie of ties) {
      const { centre, bandMm: band, widthMm, depthMm } = tie;
      const k = Math.min(TIE_THICKNESS_MM, widthMm / 4, depthMm / 4);
      // The ring's two sides across the runs (along `across`) and its two sides in z.
      if (tie.axis === "y") {
        const [x0, y0, z0] = [centre.x - widthMm / 2, centre.y - band / 2, centre.z - depthMm / 2];
        pieces.push(
          { x: x0, y: y0, z: z0, w: k, h: band, d: depthMm },
          { x: x0 + widthMm - k, y: y0, z: z0, w: k, h: band, d: depthMm },
          { x: x0 + k, y: y0, z: z0, w: widthMm - 2 * k, h: band, d: k },
          { x: x0 + k, y: y0, z: z0 + depthMm - k, w: widthMm - 2 * k, h: band, d: k },
        );
      } else {
        const [x0, y0, z0] = [centre.x - band / 2, centre.y - widthMm / 2, centre.z - depthMm / 2];
        pieces.push(
          { x: x0, y: y0, z: z0, w: band, h: k, d: depthMm },
          { x: x0, y: y0 + widthMm - k, z: z0, w: band, h: k, d: depthMm },
          { x: x0, y: y0 + k, z: z0, w: band, h: widthMm - 2 * k, d: k },
          { x: x0, y: y0 + k, z: z0 + depthMm - k, w: band, h: widthMm - 2 * k, d: k },
        );
      }
    }
    if (pieces.length === 0) return null;
    const boxes = pieces.map(boxGeometry);
    const merged = mergeGeometries(boxes);
    for (const box of boxes) box.dispose();
    return merged;
  }, [ties]);
  useEffect(
    () => () => {
      geometry?.dispose();
    },
    [geometry],
  );
  return geometry && <mesh geometry={geometry} material={kit.tie} castShadow />;
}

/** The key light: its shadow camera fitted to the interior, static, so the shadow map is built once. */
function KeyLight({ interior, offset }: { interior: Box3Mm; offset: [number, number, number] }): JSX.Element {
  const light = useRef<DirectionalLight>(null);
  const target = useMemo(() => new Object3D(), []);
  const centre: [number, number, number] = [interior.w / 2, -interior.h / 2, interior.d / 2];
  useLayoutEffect(() => {
    const shadow = light.current?.shadow;
    if (!shadow) return;
    const half = Math.hypot(interior.w, interior.h) / 2 + 10;
    Object.assign(shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: half * 6 });
    shadow.camera.updateProjectionMatrix();
  }, [interior]);
  return (
    <>
      <primitive object={target} position={centre} />
      <directionalLight
        ref={light}
        target={target}
        intensity={2.2}
        position={[centre[0] + offset[0], centre[1] + offset[1], centre[2] + offset[2]]}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.4}
        shadow-radius={3}
      />
    </>
  );
}

/** The lights never move, so the shadow map is rendered when something is added, not every frame. */
function ShadowRefresh({ wiring }: { wiring: Wiring3DView | null }): null {
  const get = useThree((state) => state.get);
  useEffect(() => {
    const { gl, invalidate } = get();
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [get, wiring]);
  return null;
}

interface Props {
  scene: CabinetScene;
  /** The placed devices, in the order of `scene.devices`: the models need their poles and label lines. */
  devices: readonly Scene3DDevice[];
  /** The lifted busbars and realistic wires; null while they are routed, and the elements are drawn alone. */
  wiring: Wiring3DView | null;
}

export default function Cabinet3DScene({ scene, devices, wiring }: Props): JSX.Element {
  const kit = useBuildSceneKit();
  // A context lost after mount (GPU reset, too many contexts) would leave a blank canvas; rethrown during
  // render, it reaches `SceneErrorBoundary`, which shows `Cabinet3DUnavailable`.
  const [contextLost, setContextLost] = useState(false);
  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);

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

  if (contextLost) throw new Error("Cabinet3D: WebGL context lost");
  return (
    <Canvas
      role="img"
      aria-label={t.layout.section.preview3d.canvasLabel}
      camera={camera}
      dpr={[1, 2]}
      frameloop="demand"
      shadows="percentage"
      onCreated={({ gl }) => {
        gl.shadowMap.autoUpdate = false;
        gl.domElement.addEventListener("webglcontextlost", () => {
          setContextLost(true);
        });
      }}
    >
      <SceneKitProvider value={kit}>
        <hemisphereLight args={[kit.sky, kit.ground, 1.3]} />
        <KeyLight interior={interior} offset={[-interior.w * 0.6, interior.h * 0.7, distance * 0.8]} />
        <ShadowRefresh wiring={wiring} />
        <Cabinet scene={scene} />
        {scene.rails.map((rail, i) => (
          <Rail key={`rail-${String(i)}`} box={rail} />
        ))}
        {scene.bars.map((bar, i) => (
          <BuiltinBar
            key={`bar-${String(i)}`}
            kind={bar.kind}
            box={bar.box}
            terminals={bar.terminals}
            zMm={bar.box.z}
          />
        ))}
        {scene.devices.map((placed) => {
          const device = deviceById.get(placed.id);
          return device && <Device key={placed.id} device={device} box={placed.box} terminals={placed.terminals} />;
        })}
        {wiring?.busbars.map((busbar) => (
          <Busbar key={busbar.key} busbar={busbar} />
        ))}
        {wiring?.wires.map((wire) => (
          <Wire key={wire.key} wire={wire} />
        ))}
        {wiring && <Ferrules wires={wiring.wires} />}
        {wiring && <Ties ties={wiring.ties} />}
        <OrbitControls makeDefault enableDamping target={centre} />
      </SceneKitProvider>
    </Canvas>
  );
}
