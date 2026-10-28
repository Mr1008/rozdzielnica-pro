# Cabinet 3D Preview Implementation Plan

## Overview

A third option of the project page's "Widok" switch, `?wiring=3d`, shows the placed layout in 3D. The
electrician can rotate, zoom and pan it with the mouse. The scene shows an open cabinet box, the DIN
rails, every placed device at its real depth, the PE/N bars, the comb busbars and every routed wire,
lifted into depth.

The view runs only in the browser and is display-only. It is a lazily loaded React island
(@react-three/fiber + drei `OrbitControls`) built from two pure, unit-tested modules. The router, both
2D drawings, the printout, the wire lengths and the quote stay exactly as they are. Source: parked
roadmap idea "Trójwymiarowy podgląd szafki", GitHub
[#14](https://github.com/Mr1008/rozdzielnica-pro/issues/14).

## Current State Analysis

- **Cabinet geometry** (`src/lib/cabinet-geometry.ts:96-105`) has integer mm and its origin at the
  interior top-left, with y growing down. The interior is `{widthMm, heightMm, depthMm}`.
  - Rails are `{xMm, yMm, lengthMm}`, with a fixed `RAIL_HEIGHT_MM = 35` (`:11`) and **no z**.
  - Built-in PE/N bars carry `zMm`, the distance from the back mounting plate, checked against
    `interior.depthMm` (`:177`).
  - Entries are 2D spans on the interior edges.
  - There is no wall thickness, door, frame or outer size.
- **Devices.** `project_devices` keeps `width_mm`, `height_mm` and `depth_mm` as `not null`
  (`supabase/migrations/20260929120000_circuits_and_device_matching.sql:146-148`), copied by the snapshot
  trigger. So depth is already in `matchView.snapshot` (`SnapshotRow`,
  `src/lib/device-matching-server.ts:35`). It is missing from `DrawnDevice`
  (`src/lib/cabinet-drawing.ts:149-164`), whose `rect` is front-view x/y/w/h in mm
  (`buildDrawnDevices`, `:229`; `deviceRect`, `src/lib/cabinet-layout.ts:186`). Catalog PE/N bars on a
  rail come out of `catalogBarAsCabinetBar` (`cabinet-layout.ts:139`) with `zMm: 0`.
- **Wiring** is routed only in the browser (`src/lib/wiring-island.ts`). It takes the serialisable
  `WiringData` and runs `routeWiring(data)` (`src/lib/cabinet-wiring.ts:2245`). The result is
  `{conductors, busbars}`:
  - each `Conductor.path` is an orthogonal 2D polyline ending at a device terminal, a cable entry or a
    bar terminal;
  - `packSegment` and `packLayer` (`bundle`/`overflow`) mark the side pack, and `tied` marks the
    bundled segments;
  - a crowded vertical run may already pass "behind the devices" (router header, `:95-106`);
  - lengths are measured on this 2D path. The `layout-wiring` rule says one router feeds every drawing
    variant, and a variant never changes a route or its length.
- **Page.** `src/pages/dashboard/projects/[id].astro:70-73` reads `?wiring=` through
  `wiringViewFromParam` (`src/lib/wiring-view.ts`), which returns `WiringVariant`
  (`cabinet-drawing.ts:321`, also used by the 2D drawing and the printout).
  - `buildLayoutDrawing` (`src/lib/layout-server.ts:137`) gives `drawing.devices` and `drawing.wiring`.
  - In the placed state, `src/components/projects/LayoutSection.astro:136-190` mounts `LayoutEditor`
    (`client:only="react"`, with a static `CabinetDrawing` fallback). Without editor data it mounts
    `WiringDrawing` (`client:idle`) instead.
  - `WiringViewSwitch.tsx` is two server links.
- **Tooling.**
  - No three.js, R3F or drei in `package.json`, and no dynamic `import()` in `src`.
  - React is 19.2.6. R3F 9.8.2 accepts react `>=19 <19.4` and three `>=0.156`; three is 0.186.1.
  - No CSP.
  - Vitest runs in `node` with no jsdom, so only pure modules are unit-testable.
  - Playwright is chromium-only and runs against build + preview (`tests/e2e/layout-manual-edit.spec.ts`
    reaches a placed layout).

## Desired End State

On a project whose layout is `placed`, "Widok: realistyczny / schematyczny / 3D" has a third link. It
leads to `?wiring=3d#layout`, and the section then renders a 3D canvas instead of the 2D editor.

- **The scene:**
  - an open cabinet (back plate plus four thin walls, no door) at the interior dimensions;
  - DIN rails;
  - devices as boxes with their snapshot depth, coloured from the drawing tokens;
  - built-in bars at their `zMm`, catalog bars on their rail;
  - comb busbars at terminal depth;
  - every routed conductor as a tube with its real diameter and IEC colour, following a 3D path whose
    front view is exactly its 2D route.
- **Controls.** Left drag rotates, the wheel zooms, and right drag pans. A Polish hint says so.
- **Without WebGL** the section shows a Polish Alert linking back to the realistic view.
- **Other views.** The default and schematic views, the printout, wire lengths and the quote are
  byte-for-byte unchanged. three.js is downloaded only when the 3D view is opened.

### Key Discoveries:

- Device depth needs no migration. It is on the snapshot row the page already holds
  (`device-matching-server.ts:35`).
- The front-view boxes come ready-made from `DrawnDevice.rect` (`cabinet-drawing.ts:149-164`). Don't
  recompute them.
- The lift has enough information without a search: path end types (`Endpoint`,
  `cabinet-wiring.ts:216`), `packSegment`, `packLayer` and `tied` (`:228-279`), plus device rects to
  detect "behind the devices" runs.
- `WiringVariant` feeds the 2D drawing and the printout, so `3d` must be its own type, not a third
  `WiringVariant`.
- The same router call the 3D island needs is already made by `buildWiringDrawing`
  (`wiring-island.ts:104`). Reuse `routeWiring(data)` the same way, with the same deferred-effect pattern
  as `useWiringDrawing` (`src/components/projects/WiringDrawing.tsx:15-51`).
- Both new `src/lib` files already match the `layout-wiring` area patterns (`src/lib/cabinet-*.ts`,
  `src/lib/wiring-*.ts`). New components fall under `src/components/projects/**`.

## What We're NOT Doing

- **Router, lengths and print.** No change to the router, `Conductor`, wire lengths, the wire-length
  table, the quote or the printout. The 3D path is a little longer than `routedMm`, and that gap is
  accepted and documented, not reconciled.
- **No 3D on the printout.** The printout stays 2D schematic.
- **No editing in 3D.** The 3D view shows the saved `placed` layout. Unsaved editor drafts are not
  shown, and switching views reloads the page.
- **Legend and warnings stay on the 2D views.** No legend, wire-length table or warnings in the 3D
  scene. The only text in the scene is each device's front label (Phase 4).
- **No new cabinet data.** No catalog or schema change for wall thickness, doors or outer dimensions.
  The new depth constants are display assumptions.
- **No 3D on the landing page.** The hero stays the static 2D `DraftingSheet`, so three.js never loads
  there.
- **No realism beyond the 2D realistic variant's rules.** 3D wires follow the same bend, sag, ferrule
  and tie rules as the realistic 2D drawing (Phase 4), and never invent their own. (Amended 2026-10-28:
  Jakub asked for elements modelled as realistically as possible. The earlier "no sag, bends or
  ferrules" exclusion is replaced by Phase 4.)
- **No touch support** (PRD non-goal, roadmap parked item #22).
- **No depth validation.** Nothing checks whether devices fit the cabinet's depth; the scene shows the
  data as it is.
- **No roadmap change.** No roadmap slice carries this Change ID.

## Implementation Approach

Pure first, rendering last.

- **Phase 1** turns geometry plus drawn devices plus snapshot depth into a renderer-agnostic box
  model.
- **Phase 2** lifts the router's output into 3D polylines and busbar boxes by fixed rules over data
  the router already records.
- **Phase 3** is the only phase that touches React, three.js or the page. The island converts mm boxes
  and polylines into meshes. It holds no geometry logic beyond the axis flip.
- **Phase 4** (added 2026-10-28) replaces the boxes and taut tubes with realistic models: DIN device
  profiles, rail profile, bars, comb busbar and wires with bends, sag, ferrules and ties. Each stays
  inside its pure-model box or on its lifted route.
- **Phase 5** adds the kitchen-sink state, the E2E smoke test, the area rule and the final gate.

**Coordinates.** Both pure modules work in cabinet mm: x right and y down (as in
`cabinet-geometry.ts`), with z measured from the back plate (0) toward the viewer. Only the island maps
them to three.js, with y up: `(x, -y, z)`.

## Critical Implementation Details

**Lazy loading.** three.js must reach the browser only on `?wiring=3d`. To make that so, the server
renders the 3D island only in that view, as `client:only="react"`. Nothing outside
`src/components/projects/Cabinet3D*.tsx` may import `three`, `@react-three/*`, or a module that imports
them. Pure modules must stay three-free. Verify it on the built preview's network panel (Phase 3,
manual).

**Colours.** The tokens in `src/styles/global.css` are `oklch()`. Resolve them at runtime with
`getComputedStyle` and convert them by painting one pixel on a 2D canvas and reading `getImageData`.
Don't rely on `THREE.Color` parsing `oklch`, and never inline a hex value.

## Phase 1: 3D scene model

### Overview

A pure module that builds the static part of the scene (cabinet, rails, devices, bars) as mm boxes. It
also defines the serialisable data the page hands the island.

### Changes Required:

#### 1. Scene model

**File**: `src/lib/cabinet-3d.ts` (new)

**Intent**: Turn cabinet geometry and the drawn devices plus their snapshot depth into boxes a renderer
can draw without any domain knowledge. It also hosts the named depth assumptions, so they live in one
place.

**Contract**:

- **Bundle-safe.** It imports only `cabinet-geometry`, `din-module` and types from `cabinet-drawing`,
  `cabinet-layout` and `wiring-island`. It never imports `layout-server` or anything that touches
  Supabase.
- **`Box3Mm`** is `{ x, y, z, w, h, d }` in cabinet mm, with `(x, y, z)` the top-left-back corner.
- **Exported constants**, each with a one-line comment saying it is a display assumption, not catalog
  data:
  - `WALL_THICKNESS_MM`, about 2;
  - `RAIL_STANDOFF_MM`, back plate to the rail's back, about 20;
  - `DIN_RAIL_DEPTH_MM` = 7.5 (TS35×7.5);
  - `TERMINAL_DEPTH_RATIO`, the share of a device's depth at which its terminals sit, about 0.5;
  - `BUILTIN_BAR_DEPTH_MM`, about 10.
- **Derived planes:**
  - `railFrontZ` = `RAIL_STANDOFF_MM + DIN_RAIL_DEPTH_MM`. A device's back sits on it.
  - `terminalZ(device)` = `railFrontZ + depthMm × TERMINAL_DEPTH_RATIO`.
  - Built-in bar terminal z = `bar.zMm + BUILTIN_BAR_DEPTH_MM / 2`.
  - Catalog bar: like a device.
- **`Scene3DDevice`** is `Pick<DrawnDevice, "id" | "role" | "railIndex" | "rect">` plus `depthMm`.
  - `toScene3DDevices(drawn, snapshot)` joins `DrawnDevice.id` to the snapshot row's `depth_mm`.
  - It throws on a drawn device with no snapshot row. That is a programming error, never a user state.
- **`Cabinet3DData`** = `{ geometry: CabinetGeometry; devices: Scene3DDevice[]; wiring: WiringData | null }`.
  This is the island's whole prop payload; no prices or other snapshot columns.
- **`buildCabinetScene(data)`** returns `CabinetScene`:
  - `interior` and `backPlate`;
  - `walls` (4 boxes outside the interior, open front);
  - `rails` (from `railRect`, at `RAIL_STANDOFF_MM`, depth `DIN_RAIL_DEPTH_MM`);
  - `devices` (each `{ id, role, box }`, the box from `rect` at `z = railFrontZ`, `d = depthMm`);
  - `bars`: built-in ones from `barRect` at `bar.zMm`, depth `BUILTIN_BAR_DEPTH_MM`. Catalog
    `pe_bar`/`n_bar` come through `devices` like any placed device.
  - It is deterministic and does no clamping: a device deeper than the cabinet is drawn as it is.

#### 2. Unit tests

**File**: `src/lib/cabinet-3d.test.ts` (new)

**Intent**: Pin the box model against a small fixture: one cabinet with two rails, one built-in PE bar
and a few devices of different depths. Reuse an existing layout fixture (e.g. the kitchen-sink or
landing fixture) if one already gives a `placed` layout.

**Contract**:

- A device box's x/y/w/h equals its `DrawnDevice.rect`.
- Its z equals `railFrontZ`, and its d equals the snapshot `depth_mm`.
- Rails sit at `RAIL_STANDOFF_MM`.
- A built-in bar sits at its `zMm`.
- The walls enclose the interior with an open front.
- `toScene3DDevices` throws on a missing snapshot row.
- The result is identical over two calls.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes, including the new `cabinet-3d.test.ts`
- `npm run lint` passes

#### Manual Verification:

- The depth constants and their "display assumption" comments read sensibly against a real modular
  enclosure (one look at the constants block)

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 2: 3D wire and busbar lift

### Overview

A pure module that takes `routeWiring`'s output plus the scene model and returns 3D polylines for every
conductor and boxes for every comb busbar. It never alters the 2D route.

### Changes Required:

#### 1. Lift

**File**: `src/lib/wiring-3d.ts` (new)

**Intent**: Give every routed segment a depth by fixed rules, so wires plug into terminals at the right
depth, run in channels in front of the rails, pass behind devices where the router already sends them
behind, and form round side packs. Display-only, like the router.

**Contract**:

- **Bundle-safe and three-free**, like `cabinet-3d.ts`.
- **`liftWiring(wiring: Wiring, scene: CabinetScene, data: Cabinet3DData)`** returns
  `{ conductors: Conductor3D[]; busbars: Busbar3D[] }`.
  - `Conductor3D` = `{ key, role, diameterMm, points: Point3Mm[] }`, plus a sheath stub for a circuit
    or WLZ cable.
  - `Busbar3D` = `{ key, phases, body: Box3Mm, teeth: Box3Mm[] }`.
- **Depth rules**, applied per segment of `Conductor.path`:
  - **End points.** A path end takes its endpoint's z: the device's `terminalZ`, the bar's terminal z,
    or, for an `entry`, the channel z (the cable comes through the wall at wiring depth).
  - **Channel z** = `railFrontZ` + the smallest terminal offset among placed devices
    (`min(depthMm) × TERMINAL_DEPTH_RATIO`), so no channel wire stands proud of the nearest terminal.
    A stub segment touching a terminal stays at that terminal's z up to its far end.
  - **Behind the devices.** A segment whose front-view extent overlaps a device body (excluding the
    devices at its own endpoints) runs at `RAIL_STANDOFF_MM / 2`, between the plate and the rail.
  - **Side packs and tied bundles.** A `tied` segment with layer `bundle` runs at channel z. A segment
    with layer `overflow` runs one bundle width further back, never below `WALL_THICKNESS_MM` off the
    plate. Members of one bundle (same `bundle` id and layer) are spread across the bundle width in z,
    centred on its z and ordered by conductor `key`, so tubes do not pass through each other.
  - **Changes of z** are inserted as pure-z steps at the shared corner between two segments.
- **Invariants** (the tests assert them):
  - Dropping z and merging collinear points gives back exactly `Conductor.path`.
  - Every routed conductor gives exactly one `Conductor3D`. An unrouted (empty-path) conductor gives
    none.
  - Every z lies within `[0, interior.depthMm]`, except devices deeper than the cabinet. Their terminal
    z is used as it is.
  - Same input gives the same output.
- **Busbars.** The body is `Busbar.rect` in x/y, centred in z on the group's terminal z, with depth
  `BUSBAR_DEPTH_MM` (a new display constant in this file). Each tooth is a small box from the body to
  its `BusbarTooth (x, y)`.
- **Sheath.** Reuse `SHEATH_STUB_MM` from `cabinet-drawing.ts`: the first `SHEATH_STUB_MM` of a cable
  from its entry is marked as sheathed, and the renderer draws it as a thicker tube.

#### 2. Unit tests

**File**: `src/lib/wiring-3d.test.ts` (new)

**Intent**: Assert the invariants above over the same fixture as Phase 1, routed through `routeWiring`.
Also cover a case with a side pack plus an overflow layer, and one with a busbar group. Reuse an
existing wiring test fixture that already produces `overflow` and a busbar, if one exists in
`cabinet-wiring.test.ts`.

**Contract**:

- Front-view projection equals `path` for every conductor.
- End z equals the terminal or bar z.
- Overflow z is less than bundle z.
- Bundle members have distinct z.
- A busbar's body z is centred on its group's terminal z.
- Conductor count equals the routed count.
- Output is deterministic.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes, including `wiring-3d.test.ts`; `cabinet-wiring.test.ts` and the drawing
  tests are unchanged and green
- `npm run lint` passes
- `git diff --stat` shows no change to `src/lib/cabinet-wiring.ts`, `src/lib/cabinet-drawing.ts` or
  `src/lib/wiring-island.ts`

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: 3D view on the project page

### Overview

Add `?wiring=3d`, build the R3F island and mount it in the layout section in place of the editor when
that view is chosen.

### Changes Required:

#### 1. Dependencies

**File**: `package.json`

**Intent**: Add the renderer.

**Contract**: `three`, `@react-three/fiber` (9.x, whose peer range covers React 19.2) and
`@react-three/drei` as dependencies, with `@types/three` as a dev dependency. Keep the existing
`overrides` block untouched.

#### 2. View switch

**File**: `src/lib/wiring-view.ts`, `src/lib/wiring-view.test.ts` (extend or create)

**Intent**: Make the switch three-way without widening `WiringVariant`.

**Contract**:

- New `DrawingView = WiringVariant | "3d"` and `DRAWING_VIEWS`.
- `drawingViewFromParam(value)` maps `"schematic"` → schematic, `"3d"` → 3d, anything else → realistic.
- `wiringViewHrefs` returns `Record<DrawingView, string>`, with `3d` → `?wiring=3d#<anchor>`.
- `wiringVariantOf(view)` maps `3d` → `"realistic"`, for the 2D fallback.
- `wiringViewFromParam` is either kept as a thin wrapper or replaced at its two call sites
  (`[id].astro`, `kitchen-sink.astro`). The printout keeps calling nothing.

**File**: `src/components/projects/WiringViewSwitch.tsx`

**Intent**: Render three links from `DRAWING_VIEWS`.

**Contract**: The props become `active: DrawingView` and `hrefs: Record<DrawingView, string>`.

#### 3. Strings

**File**: `src/lib/i18n/pl.ts`

**Intent**: Polish copy for the new view.

**Contract**:

- `layout.section.view.options["3d"]` = "3D".
- A new `layout.section.preview3d` group:
  - `canvasLabel`, the canvas `aria-label`;
  - `loading`, "Ładowanie podglądu 3D…";
  - `controlsHint`, "Przeciągnij, aby obrócić · kółko: przybliżenie · prawy przycisk: przesuwanie";
  - `unavailableTitle`;
  - `unavailableBody`;
  - `backTo2d`, the link label to the realistic view.

#### 4. Island

**File**: `src/components/projects/Cabinet3DPreview.tsx` (new, the island entry) and
`src/components/projects/Cabinet3DScene.tsx` (new, R3F scene)

**Intent**: Route in the browser, lift, and draw with orbit controls. If there is no WebGL, explain why
instead of failing silently.

**Contract**:

- **Props:** `{ data: Cabinet3DData; fallbackHref: string }`.
- **Before the Canvas,** `Cabinet3DPreview`:
  - checks for WebGL (a `webgl2`/`webgl` context on a scratch canvas);
  - computes `routeWiring(data.wiring)` and `liftWiring`, deferred to an effect exactly like
    `useWiringDrawing`, so the first render matches;
  - renders the scene inside an error boundary. A missing context, or a Canvas or context-creation
    error, renders `Cabinet3DUnavailable`: a shadcn `Alert` with `unavailableTitle` and
    `unavailableBody` and a link to `fallbackHref`.
- **`Cabinet3DScene`:**
  - R3F `<Canvas>` with an `aria-label`;
  - one mesh per box (cabinet, rails, devices, bars, busbars);
  - wires as tubes along `points` (radius `diameterMm / 2`, a thicker sheath tube where marked);
  - drei `OrbitControls`: left rotate, wheel zoom, right pan; damping on; target at the interior
    centre;
  - camera fitted to the interior box, initially from the front and slightly from above and the
    side;
  - soft ambient light plus one directional light;
  - the axis flip `(x, -y, z)` lives here only.
- **Colours** come from tokens read at runtime (see Critical Implementation Details):
  - wire colours use the same role→token mapping as the 2D drawing. Export it from
    `cabinet-drawing.ts` if it is not exported; never a second mapping.
  - devices, bars, rails and the cabinet use the existing `--drawing-*`, `--busbar-*` and `--wire-*`
    tokens.
  - If a needed colour has no token, add the token to `src/styles/global.css` first.
- **Tailwind:** only `cn()` and token classes on the wrapper.
- **Height:** a fixed aspect area of about the 2D drawing's `max-w-3xl` width.
- **Text:** `controlsHint` under the canvas.

#### 5. Page and section

**File**: `src/pages/dashboard/projects/[id].astro`, `src/components/projects/LayoutSection.astro`

**Intent**: Pick the view from the query and render the 3D island instead of the editor when it is
`3d`.

**Contract**:

- The page computes `drawingView` and keeps `wiringVariant = wiringVariantOf(drawingView)` for all 2D
  uses.
- Only when `drawingView === "3d"` and the layout is `placed`, it builds
  `cabinet3d: Cabinet3DData = { geometry, devices: toScene3DDevices(drawing.devices, matchView.snapshot), wiring: drawing.wiring }`.
- `LayoutSection` gets optional `view: DrawingView` and `cabinet3d` props. In the `placed` branch with
  `cabinet3d`, it renders the switch plus `<Cabinet3DPreview client:only="react">` (with
  `fallbackHref` = the realistic href) instead of `LayoutEditor` / `WiringDrawing`.
- The fallback slot is the static `CabinetDrawing` plus `preview3d.loading`.
- All other branches are unchanged. The print page passes neither prop.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes, including the `wiring-view` tests for `3d`
- `npm run lint` passes
- `npm run build` succeeds

#### Manual Verification:

- On a placed project, "Widok" shows three links, and "3D" renders the cabinet with devices, bars,
  busbars and coloured wires, all matching the 2D realistic view from the front
- Left drag rotates, the wheel zooms and right drag pans; looking from the side shows wire drops to
  the terminals, the packs along the walls and runs behind devices
- On the built preview, loading the default view requests no three.js chunk (network panel); the 3D
  view requests it
- With WebGL disabled (e.g. `--disable-webgl`), the 3D view shows the Polish Alert with a working link
  back to the realistic view
- Realistic and schematic views, the editor, the wire-length table and the printout look and behave
  as before

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Realistic element models

### Overview

Added 2026-10-28 at Jakub's request: "model elements as realistic as possible". This phase replaces the
boxes and taut tubes that Phase 3 drew with models that look like real switchboard hardware. Each
element kind already has its own component in `Cabinet3DScene.tsx` (commit 042fdb2), and this phase
swaps the geometry inside those components.

**The invariant that does not move:** every model stays inside its pure-model box (`Box3Mm` from
`cabinet-3d.ts`), and every wire stays on its lifted route (`wiring-3d.ts`). So the front view still
matches the 2D drawing, terminals stay at `terminalZ`, and routes and lengths are untouched.

### Changes Required:

#### 1. Model shapes (pure)

**File**: `src/lib/cabinet-3d-models.ts` (new) and `src/lib/cabinet-3d-models.test.ts` (new)

**Intent**: Describe each element's realistic shape as plain parts in mm (boxes, rounded boxes,
cylinders, extruded 2D profiles). The proportions are tested here, so the scene only turns parts into
meshes. The module is bundle-safe and three-free, like `cabinet-3d.ts`.

**Contract**:

- **`deviceModel(device, box)`** returns the parts of a modular DIN device, given `role` and `poles`
  (see 3 below):
  - a base body clipped to the rail, at full width and height;
  - the stepped front: the standard 45 mm front window raised toward the viewer to the full depth;
  - screw terminal openings with screw heads on the top and bottom faces. One per pole, at
    `terminalZ`, matching the x positions of `deviceTerminals` in `src/lib/cabinet-layout.ts`, so
    wires and busbar teeth land on a screw.
  - a toggle lever per handle on the front: one for an MCB or RCBO, a wider single handle for the FR,
    and a lever plus a "T" test button for the RCD and RCBO;
  - catalog `pe_bar`/`n_bar` get the bar model below, on a rail foot.
  - Proportions are named constants (front window 45 mm, lever size, screw diameter), each documented
    as a display assumption. A device smaller than the standard window scales the front window
    down. It never overflows its box.
- **`railModel(box)`** gives the TS35×7.5 top-hat cross-section as a 2D profile extruded along the
  rail, with mounting slots along its length.
- **`barModel(box, kind, terminalCount)`** gives a brass bar on two insulating supports, with one
  clamping screw per terminal at the positions the router uses (`barTerminalPoints`).
- **`busbarModel(busbar)`** gives the insulated comb strip plus one copper pin per tooth reaching its
  terminal screw.
- **`cabinetModel(scene)`** gives the enclosure walls with rounded outer edges and a front frame lip.
  The cutaway from commit 1f98df3 is kept.
- **Tests:**
  - every part of every model lies inside its input box (cabinet: inside the walls' bounds);
  - one terminal screw per pole, each at `terminalZ` and at its terminal's x;
  - the lever, the test-button presence and the handle width all follow the role;
  - one busbar pin per tooth;
  - the result is deterministic.

#### 2. Realistic wires (pure)

**File**: `src/lib/wiring-3d.ts` (extend) and `src/lib/wiring-3d.test.ts` (extend)

**Intent**: Give 3D wires the same realism rules as the 2D realistic variant. Reuse the pure helpers
from `cabinet-drawing.ts` and `wire-dimensions.ts` rather than restating any number.

**Contract**:

- **`smoothConductor3D(conductor3d, variant: "realistic")`** rounds every corner with
  `bendRadiusMm(diameterMm, "realistic")`. Feeds sag by `sagDepthMm` within `sagLimits`, as in 2D:
  only feeds sag, while circuit and WLZ runs stay taut (layout-wiring rule). The sag goes down in y,
  never in z.
- **Ferrules** come from `FERRULE[crossSection]` (`wire-dimensions.ts`) at each terminal or bar end:
  a short sleeve of the right length and colour token, plus the insulating collar.
- **Cable ties:** one tie ring wherever `buildCableTies` puts one, placed on the lifted path.
- **Sheath:** the sheathed stub from Phase 2, with `CABLE_OUTER_DIAMETER_MM` for its diameter.
- **Tests:**
  - the smoothed path stays within one bend radius of the lifted path;
  - ends are unchanged;
  - only feeds sag;
  - one ferrule per terminal end, with the sizes from `FERRULE`;
  - ties match `buildCableTies` in count.

#### 3. Scene data

**File**: `src/lib/cabinet-3d.ts`, `src/pages/dashboard/projects/[id].astro`

**Intent**: The models need the device's poles, its front label and its N terminal side, all of which
the page already has.

**Contract**:

- `Scene3DDevice` also picks `lines` and `nTerminalSide` from `DrawnDevice`, and `poles` from the
  snapshot row. `toScene3DDevices` fills them.
- The page passes nothing new beyond these fields. Still no prices.

#### 4. Scene components

**File**: `src/components/projects/Cabinet3DScene.tsx`

**Intent**: Render the parts. The per-kind components keep their props.

**Contract**:

- **Materials** (tokens only, read at runtime as before):
  - satin plastic housings in `--drawing-paper`, or a new `--device-housing` token if none fits;
  - a darker lever;
  - zinc-plated steel rail;
  - brass bars;
  - copper busbar pins in `--busbar-copper`, with the insulation in `--busbar-insulation`;
  - a slightly glossy wire insulation.
  - Any new colour becomes a token in `src/styles/global.css` first.
- **Front label:** each device's `lines` (e.g. "B16", "40A 30mA") is drawn on its front window as a
  `CanvasTexture`, in the page's font. No drei `Text` and no font download.
- **Lighting:** an environment-style hemisphere light, a key directional light with soft shadows on
  the back plate, and tone mapping. Keep the frame rate interactive on a worst-case kitchen-sink
  cabinet.
- **Performance:**
  - geometry is shared per (role, poles, size) and instanced where there are many repeats (screws,
    ties, ferrules);
  - materials are shared per colour;
  - everything is built in `useMemo`.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes, including `cabinet-3d-models.test.ts` and the extended `wiring-3d.test.ts`
- `npm run lint` passes
- `npm run build` succeeds
- `git diff` since 042fdb2 shows no change to `src/lib/cabinet-wiring.ts` or `src/lib/wiring-island.ts`

#### Manual Verification:

- Up close, MCB, RCD, RCBO and FR read as real modular devices: stepped profile, lever(s), test
  button on RCD/RCBO, screw terminals, printed rating label
- Wires land on terminal screws with ferrules, bend with rounded corners, feeds sag, packs are tied,
  and cables keep their sheath to the stripping point
- PE/N bars show brass, supports and screws; comb busbars show insulated strips with pins into the
  terminals
- From the front, the 3D view still matches the realistic 2D drawing; rotating stays smooth on the
  largest kitchen-sink layout
- The default view still loads no three.js chunk, and the WebGL-unavailable Alert still works

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human before proceeding to the next phase.

---

## Phase 5: Kitchen-sink, E2E smoke and docs

### Overview

Show the new UI states on the kitchen-sink page, add one browser smoke test, record the 3D-lift rule,
and run the final gate.

### Changes Required:

#### 1. Kitchen-sink

**File**: `src/pages/dev/kitchen-sink.astro` (plus `src/lib/kitchen-sink-circuits.ts` if a fixture
helper is needed) and `pl.ts` (`devTools.kitchenSink`)

**Intent**: The project rule says every new UI state goes to `/dev/kitchen-sink` first.

**Contract**:

- A figure with the 3D island over an existing `placed` kitchen-sink layout.
- A figure with `Cabinet3DUnavailable` rendered directly.
- Captions as `pl.ts` keys.
- The view switch there shows the three links.

#### 2. E2E smoke

**File**: `tests/e2e/cabinet-3d.spec.ts` (new); `playwright.config.ts` only if headless WebGL needs it

**Intent**: Catch a broken lazy import or island mount, which the unit tests cannot see.

**Contract**:

- Reach a placed layout the way `layout-manual-edit.spec.ts` does. Extract a shared helper if that
  flow is inline and would otherwise be copied.
- Open `?wiring=3d#layout` and `waitForIslands`.
- Assert that the labelled canvas is visible, that the unavailable Alert is absent, and that there are
  no console errors.
- If headless chromium creates no WebGL context, add SwiftShader launch args
  (`--use-angle=swiftshader`, `--enable-unsafe-swiftshader`) to the chromium project. Don't weaken the
  assertion.

#### 3. Area rule

**File**: `context/foundation/agent-rules/layout-wiring.md`

**Intent**: Record the one rule a future agent could break.

**Contract**: One bullet.

- The 3D preview (`?wiring=3d`) is display-only, client-only and drawn from a `placed` layout.
- `src/lib/wiring-3d.ts` lifts the router's output and never changes a route or a length. The 3D path
  being longer than `lengthMm` is accepted.
- Depth constants in `src/lib/cabinet-3d.ts` are display assumptions, not catalog data.
- three.js is imported only by `src/components/projects/Cabinet3D*.tsx`.
- The printout stays 2D.

No shim or `AGENTS.md` index change, because the existing patterns already cover the new files.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run test:unit` passes
- `npx astro check` passes (final gate, run once here)
- `npm run build` succeeds
- `npm run test:e2e -- cabinet-3d` passes against a local Supabase stack

#### Manual Verification:

- `/dev/kitchen-sink` shows the 3D figure and the unavailable state, with Polish captions

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- `cabinet-3d.test.ts`: box positions and depths, rails, built-in bars, walls, the missing-snapshot
  throw, determinism.
- `wiring-3d.test.ts`:
  - front-view projection equals the route;
  - terminal and bar end depths;
  - overflow behind bundle;
  - distinct depths inside a bundle;
  - busbar depth;
  - one-to-one conductor count;
  - determinism.
- `wiring-view.test.ts`: `3d` parsing, the three hrefs, `wiringVariantOf`.

### Integration Tests:

- `tests/e2e/cabinet-3d.spec.ts`: a placed project's 3D view mounts a canvas with no errors. No RLS
  integration change is needed, because there is no data change.

### Manual Testing Steps:

1. Open a placed project, then choose "Widok: 3D".
2. Compare the front view with the realistic 2D drawing.
3. Rotate to the side: check the terminal drops, the side packs (with an overflow layer when present)
   and the runs behind devices.
4. Zoom and pan.
5. On the built preview, confirm that the default view loads no three.js chunk.
6. Launch with WebGL disabled and check the Alert and the link back.
7. Confirm that the printout and the wire-length table are unchanged.

## Performance Considerations

- **Main-thread cost.** Routing already runs in the browser for the 2D views. The 3D view adds the
  lift, which is linear in path points, and one tube geometry per conductor. A worst-case cabinet has a
  few hundred conductors; build the tube geometries once in `useMemo` and reuse materials per colour.
- **Chunk size.** three.js plus R3F plus drei is a few hundred KB gzipped, in a chunk loaded only by
  the 3D island. That is far below Workers asset limits, and it never touches the Worker bundle.

## Migration Notes

None. There is no schema or data change, and the deploy is backward-compatible.

## References

- Parked roadmap idea: `context/foundation/roadmap.md` `## Parked`, "Trójwymiarowy podgląd szafki";
  GitHub [#14](https://github.com/Mr1008/rozdzielnica-pro/issues/14)
- Router and its rules: `src/lib/cabinet-wiring.ts:25-137`, `:216-279`
- Browser routing pattern: `src/lib/wiring-island.ts:104`,
  `src/components/projects/WiringDrawing.tsx:15-51`
- Placed-state rendering: `src/components/projects/LayoutSection.astro:136-190`
- View switch: `src/lib/wiring-view.ts`, `src/components/projects/WiringViewSwitch.tsx`
- Area rule: `context/foundation/agent-rules/layout-wiring.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: 3D scene model

#### Automated

- [x] 1.1 `npm run test:unit` passes, including the new `cabinet-3d.test.ts` — 091f2a8
- [x] 1.2 `npm run lint` passes — 091f2a8

#### Manual

- [x] 1.3 The depth constants and their "display assumption" comments read sensibly against a real modular enclosure

### Phase 2: 3D wire and busbar lift

#### Automated

- [x] 2.1 `npm run test:unit` passes, including `wiring-3d.test.ts`; router and drawing tests unchanged and green — f5e8cbd
- [x] 2.2 `npm run lint` passes — f5e8cbd
- [x] 2.3 No change to `cabinet-wiring.ts`, `cabinet-drawing.ts` or `wiring-island.ts` — f5e8cbd

### Phase 3: 3D view on the project page

#### Automated

- [x] 3.1 `npm run test:unit` passes, including the `wiring-view` tests for `3d` — 3b68e16
- [x] 3.2 `npm run lint` passes — 3b68e16
- [x] 3.3 `npm run build` succeeds — 3b68e16

#### Manual

- [x] 3.4 "Widok" shows three links and "3D" renders cabinet, devices, bars, busbars and coloured wires matching the 2D front view
- [x] 3.5 Rotate, zoom and pan work; side view shows terminal drops, packs and runs behind devices
- [x] 3.6 Default view loads no three.js chunk on the built preview; the 3D view does
- [x] 3.7 Without WebGL the 3D view shows the Polish Alert with a working link back
- [x] 3.8 Realistic and schematic views, the editor, wire lengths and the printout are unchanged

### Phase 4: Realistic element models

#### Automated

- [x] 4.1 `npm run test:unit` passes, including `cabinet-3d-models.test.ts` and the extended `wiring-3d.test.ts`
- [x] 4.2 `npm run lint` passes
- [x] 4.3 `npm run build` succeeds
- [x] 4.4 No change to `cabinet-wiring.ts` or `wiring-island.ts` since 042fdb2

#### Manual

- [ ] 4.5 MCB, RCD, RCBO and FR read as real modular devices up close
- [ ] 4.6 Wires land on screws with ferrules, rounded bends, feeds sag, packs tied, sheaths to the stripping point
- [ ] 4.7 PE/N bars and comb busbars look like real hardware
- [ ] 4.8 Front view still matches the realistic 2D drawing; rotation stays smooth on the largest layout
- [ ] 4.9 Default view still loads no three.js chunk; the WebGL-unavailable Alert still works

### Phase 5: Kitchen-sink, E2E smoke and docs

#### Automated

- [ ] 5.1 `npm run lint` passes
- [ ] 5.2 `npm run test:unit` passes
- [ ] 5.3 `npx astro check` passes (final gate)
- [ ] 5.4 `npm run build` succeeds
- [ ] 5.5 `npm run test:e2e -- cabinet-3d` passes against a local Supabase stack

#### Manual

- [ ] 5.6 `/dev/kitchen-sink` shows the 3D figure and the unavailable state with Polish captions
