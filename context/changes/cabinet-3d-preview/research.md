---
date: 2026-10-27T16:32:04+01:00
researcher: Claude (Opus 5.5) for Jakub Michałek
git_commit: 778c32d6aa01e7b745c402d648bbc3296e943704
branch: master
repository: Mr1008/rozdzielnica-pro
topic: "What exists, and what is missing, for an interactive 3D cabinet preview (issue #14)"
tags: [research, cabinet-geometry, cabinet-drawing, layout-server, react-island, three-js]
status: complete
last_updated: 2026-10-27
last_updated_by: Claude (Opus 5.5)
---

# Research: data and plumbing for an interactive 3D cabinet preview

**Date**: 2026-10-27T16:32:04+01:00
**Researcher**: Claude (Opus 5.5) for Jakub Michałek
**Git Commit**: 778c32d (local working tree; anchors are local `file:line`)
**Branch**: master
**Repository**: Mr1008/rozdzielnica-pro

## Research Question

GitHub [#14](https://github.com/Mr1008/rozdzielnica-pro/issues/14), parked in
`context/foundation/roadmap.md:315-321`: a 3D preview of the cabinet and its devices, with mouse
rotate/zoom/pan. The roadmap note claims "the data for 3D exists". The questions are:

1. Which 3D-relevant geometry exists (cabinet, devices, placements, bars, busbars, wires), and what is
   missing?
2. How does the current 2D drawing get from data to pixels, and where would a client-only 3D island plug
   in?
3. Which dependencies and platform constraints apply (bundle, SSR, CSP, Workers)?
4. Which prior decisions or non-functional requirements constrain it?

## Summary

- **The front-view X/Y of every placed device and the cabinet interior depth exist. A device's Z does
  not.**
  - The cabinet `interior` is `{widthMm, heightMm, depthMm}` (`src/lib/cabinet-geometry.ts:95`).
  - Only the built-in PE/N bars carry a depth position, `zMm` ("Distance from the back mounting plate",
    `cabinet-geometry.ts:88-89`).
  - Rails are `{xMm, yMm, lengthMm}` with a fixed 35 mm height, and have no z and no profile depth.
  - Placements hold only `rail_index` and `x_mm`
    (`supabase/migrations/20261006130000_project_device_placements.sql:44-54`).
- **Device depth is stored but not threaded through.**
  - `depth_mm` is NOT NULL > 0 on `devices` for every kind
    (`supabase/migrations/20260923130628_devices_catalog.sql:57-59`).
  - It is copied into the `project_devices` snapshot
    (`20260929120000_circuits_and_device_matching.sql:146-148`, default 0 overwritten by the trigger).
  - `LayoutDevice` picks `width_mm` and `height_mm` but not `depth_mm` (`src/lib/cabinet-layout.ts:75-87`),
    so neither `DrawnDevice` nor anything the page passes to islands carries depth.
- **Many catalog depths are invented.**
  - 134 source rows have `"depth_mm": null` (31 in `supabase/catalog/source/eaton.json`, 103 in
    `legrand.json`; counted with grep).
  - `catalog-seed.ts:27-29` fills them with per-series defaults, else a generic 85 × 70 mm.
  - A 3D view would render those estimates as if they were real.
- **The 2D pipeline already yields a reusable scene model in mm.**
  - `buildLayoutDrawing` (`src/lib/layout-server.ts:137-158`) returns `DrawnDevice[]` with front-view
    `rect`s (`src/lib/cabinet-drawing.ts:149-164`) plus `WiringData`.
  - `src/components/projects/LayoutSection.astro` mounts `LayoutEditor` (`client:only="react"`) or
    `WiringDrawing` (`client:idle`).
  - A 3D island fits beside them with the same props plus depth.
- **No platform blocker was found in the inspected files.**
  - No three.js or other 3D library is in `package.json`.
  - Client JS ships as static assets, not inside the Worker script (`wrangler.jsonc`).
  - A grep of `src/**` for `Content-Security-Policy` and `http-equiv` found nothing, and there is no
    `public/_headers`.
  - With `client:only`, three.js never runs during SSR.
- **Product constraints.**
  - No functional requirement asks for 3D (`roadmap.md:316-317`).
  - The printout stays 2D.
  - Mouse and keyboard only; touch is parked (`roadmap.md:301`).
  - UI text in Polish via `t` (`prd.md:100-101`).
  - No bundle, WebGL-fallback or accessibility requirement exists, so those are open decisions.

## Detailed Findings

### Cabinet geometry

- Units are integer mm. The origin is the interior's top-left corner and +y points down
  (`src/lib/cabinet-geometry.ts:5-9`). three.js is y-up, so a renderer must flip y.
- `geometryShapeSchema` (`cabinet-geometry.ts:93-99`) has these fields:
  - `version: 1`.
  - `interior {widthMm, heightMm, depthMm}`.
  - `rails[]` (≥ 1), each `{xMm, yMm, lengthMm}`, with `RAIL_HEIGHT_MM = 35` (line 12).
  - `entries[]` (≥ 1), each `{side, offsetMm, lengthMm}`: 2D strips on an edge, with no z.
  - `bars[]`, each `{kind, orientation, xMm, yMm, lengthMm, heightMm, zMm, terminalGroups}`.
- `zMm` is bounded by `interior.depthMm` (around `cabinet-geometry.ts:190`). It is used today only for
  the front-view occlusion check `barsBehindAnother` (line 159, `BAR_Z_CLEARANCE_MM = 10`).
- A bar has no thickness along z, and the source does not say whether `zMm` refers to its front or its
  back face.
- The geometry has no door, wall thickness, outer dimensions or explicit mounting plate. The z = 0 plane
  is implied by "back mounting plate".
- `projects.cabinet_geometry` is the snapshot a 3D view must read, never `cabinets.geometry`
  (data-guards rule).
  - It defaults to `'{}'` (`supabase/migrations/20260924150000_projects.sql:64`).
  - The layout code treats a missing geometry as possible, so a 3D view needs the same null branch.
- Sample cabinets (`supabase/seed.sql:99-116`) have depths of 90, 110 and 130 mm and bar `zMm` values
  of 20 and 40.
- Production Karwasz cabinets put bars at `BAR_Z_FRONT_MM = 20` or `BAR_Z_BACK_MM = 35`
  (`src/lib/karwasz-cabinets.ts:51-52`), with `BAR_HEIGHT_MM = 12`.

### Devices and placements

- Catalog dimensions (`20260923130628_devices_catalog.sql:57-59`):
  - `width_mm numeric(6,2)`, `height_mm numeric(6,1)` and `depth_mm numeric(6,1)`.
  - All three are NOT NULL > 0, with no per-kind exception (`src/lib/device-spec.ts:173-202`).
- The snapshot copies all three (`20260929120000_circuits_and_device_matching.sql:146-148`, trigger at
  lines 200-203). The copy is repeated in `20261006120000_device_n_terminal_side.sql:113-117` and
  `20261006140000_project_device_bars.sql:39-43`.
- In TypeScript, `database.types.ts` has `project_devices.Row.depth_mm: number`.
- How a device's front-view rect is computed:
  - `rectOnRail` (`src/lib/cabinet-layout.ts:173-180`) gives x = `rail.xMm + xMm` and centres the device
    vertically on the rail: y = `rail.yMm + 17.5 − height/2`.
  - w and h come from the snapshot.
- Placing a device in 3D needs an assumed z:
  - Back face at z = 0 or at a TH35 standoff, with an extent of `depth_mm`.
  - No rail standoff or profile depth (7.5 or 15 mm) is stored.
- Placements:
  - The `placed` view carries `placements: {projectDeviceId, railIndex, xMm}[]`
    (`src/lib/layout-server.ts:56-60`).
  - Only `placed` may be drawn (layout-wiring rule), and a 3D view inherits that gate.
- Catalog PE/N bars (roles `pe_bar` / `n_bar`) are placed on rails like devices. They are separate from
  the cabinet's built-in `geometry.bars`.
- Comb busbars:
  - Snapshot `busbar` rows sit on no rail (`isBusbarRole`).
  - Their drawn form is `Busbar` (`src/lib/cabinet-wiring.ts:187-200`): a front-view rect along a
    group's top or bottom edge, with no z.
  - `BUSBAR_TOOTH_DEPTH_MM = 3` (`cabinet-drawing.ts:735`) is a 2D tick length, not a z value.
- Wires:
  - Wires are routed in 2D (`Point{x,y}`, `cabinet-wiring.ts:228`).
  - `sagDepthMm` (`cabinet-drawing.ts:330`) is a droop along y, not along z.
  - `src/lib/wire-dimensions.ts` holds diameters and ferrule data with no z.
  - Wires in 3D would mean inventing a z route, or lifting the 2D route to a fixed plane in front of the
    devices.

### Rendering pipeline and the island mount point

- Server side, `src/pages/dashboard/projects/[id].astro` computes:
  - `computeMatchView` (line 139).
  - `computeLayoutView` (lines 141-144).
  - `buildLayoutDrawing` (line 147), which gives `placedDevices` and `placedWiring`.
  - It then renders `<LayoutSection …>` (line 524).
- `src/lib/cabinet-drawing.ts` is "pure front-view geometry" (line 39) in mm.
  - `CabinetDrawing.tsx:599` uses `viewBox="0 0 widthMm heightMm"`, so 1 SVG unit is 1 mm.
  - Reusable inputs for 3D:
    - `CabinetGeometry`.
    - `DrawnDevice[]` (`{id, role, railIndex, rect, lines, groupKey, groupLabel, nTerminalSide, bar}`).
    - `groupOutlines`.
    - `WiringData`.
- Heavy client-island pattern:
  - `src/lib/wiring-island.ts` is bundle-safe: it imports only pure modules, never `layout-server.ts`.
  - `toWiringData` (line 53) strips prices.
  - `useWiringDrawing` (`src/components/projects/WiringDrawing.tsx:15-47`) starts at null so hydration
    matches, computes after mount, and fires `WIRING_READY_EVENT`.
  - `LayoutEditor` is `client:only="react"` with a server-rendered `CabinetDrawing` fallback slot
    (`LayoutSection.astro:143-175`).
- View switch:
  - `src/lib/wiring-view.ts` maps `?wiring=schematic`, and anything else means realistic.
  - `WiringViewSwitch.tsx` is server-rendered links over `WIRING_VARIANTS` (`cabinet-drawing.ts:322`),
    and each option is a full reload.
  - `WiringVariant` drives wire style, bend radius and the legend. Adding `"3d"` to it would mix
    concerns, so a separate view-mode parameter or an in-island toggle is the cleaner fit.
- Kitchen sink:
  - `src/pages/dev/kitchen-sink.astro` renders `LayoutSection` per `layoutStates` entry (around lines
    677-715). AGENTS.md says every new UI state lands here first.
  - Not inspected: how `layoutStates` is built.
- i18n:
  - The switch keys live at `t.layout.section.view` in `src/lib/i18n/pl.ts` (around lines 1229-1234),
    `options` keyed by variant.
  - New keys belong under `t.layout.section`: loading, no-WebGL fallback, aria label.

### Dependencies and platform

- `package.json`: react 19.2, astro 7.3, `@astrojs/react` 6, `@astrojs/cloudflare` 14. No `three` and no
  `@react-three/*`.
- `astro.config.mjs` has no `manualChunks` and no bundle budget.
- `wrangler.jsonc` serves `./dist` as static assets, so client bundle size does not count against the
  Worker script.
- three.js must be imported only from a `client:only` island (ideally via `React.lazy`). An import from
  `.astro` frontmatter or from a `client:load`/`client:idle` island would pull it into SSR.
- No CSP or Permissions-Policy was found:
  - `src/middleware.ts` sets no response headers.
  - The `src/**` grep found no CSP and no `http-equiv`.
  - `public/` holds only icons and an og image.
- Not inspected: `src/pages/api/**` header code beyond that grep.

## Code References

- `src/lib/cabinet-geometry.ts:5-9,12,85-99,159,190`: units, axes, schema, bar `zMm`, occlusion check.
- `src/lib/cabinet-layout.ts:75-87`: `LayoutDevice` (no `depth_mm`). Lines 169-186: `rectOnRail` and
  `deviceRect`.
- `src/lib/cabinet-drawing.ts:149-164,229-259,322,735`: `DrawnDevice`, `buildDrawnDevices`, variants,
  busbar constants.
- `src/lib/layout-server.ts:56-60,137-158`: the `placed` view and `buildLayoutDrawing`.
- `src/lib/wiring-island.ts:28-38,53`: serialisable island data.
- `src/components/projects/LayoutSection.astro:137-186`: drawing branch and island mount.
- `src/components/projects/WiringDrawing.tsx:15-47`: post-mount compute hook.
- `src/lib/catalog-seed.ts:25-30`: invented height/depth defaults.
- `supabase/migrations/20260923130628_devices_catalog.sql:57-59`: catalog dimensions.
- `supabase/migrations/20260929120000_circuits_and_device_matching.sql:146-148,200-203`: snapshot
  dimensions and trigger copy.
- `supabase/migrations/20261006130000_project_device_placements.sql:44-54`: placement columns.

## Architecture Insights

- The likely shape is a read-only `client:only="react"` island fed from data the page already computes:
  - The geometry snapshot.
  - `DrawnDevice[]`, extended with `depthMm`, or a new pure `buildScene3D` helper with a unit test.
  - Optionally `WiringData`.
- A pure helper (mm boxes with x/y/z and w/h/d, y flipped) keeps three.js out of `src/lib` and makes
  the z assumptions testable.
- The `placed`-only gate, snapshot-only reads, Polish `t` keys and kitchen-sink-first all carry over
  unchanged from the 2D view.

## Historical Context (from prior changes)

- `context/archive/2026-09-23-admin-device-catalog/plan-brief.md:33` and `plan.md:99,106`: height and
  depth were added at 0.1 mm precision for every kind. Supported by the current schema.
- `context/archive/2026-09-23-admin-cabinet-catalog/plan-brief.md:30-34,49`: full mm geometry so the
  planner can "render the real cabinet". Rails have no depth, and rail depth and vertical rails are out
  of scope.
  - Supported by the current schema, which has no rail z.
  - The same change's `plan.md:62` mentions rail depth. That line is contradicted by the shipped schema.
- `context/archive/2026-10-06-cabinet-layout-proposal/plan.md:166`: the layout's bar overlap check is 2D
  and ignores `zMm`. Still true (`cabinet-layout.ts` around line 268, per the worker report; not
  re-read).
- `context/archive/2026-10-21-production-catalog-seed/research.md:54-56,129` and `plan.md:162-169`:
  rows without height or depth get placeholders. Supported (134 null-depth source rows today).
- `context/foundation/infrastructure.md:151-166`: client libraries must be priced against a concrete
  requirement, a precedent for setting a bundle budget for three.js.

## Related Research

- `context/archive/2026-10-21-production-catalog-seed/research.md`: catalog dimension gaps.
- `context/archive/2026-10-08-realistic-wiring-render/`: why wiring moved to a client island. Its
  folder was not searched in this pass.

## Open Questions

These are decisions for `/10x-plan` or the user:

1. **Device z model.** Back face on a fixed rail standoff (TH35 7.5 or 15 mm?) with extent `depth_mm`?
   Nothing in the data decides this.
2. **Estimated depths.** Render them as is, mark them visually, or ignore them? 134 source rows use
   defaults.
3. **Scope of the scene.** Enclosure box, rails and devices only, or also built-in PE/N bars (need a z
   thickness and a reference face for `zMm`), comb busbars and wires (no z anywhere)?
4. **Entry point.** A separate `?view=3d` parameter, an in-island toggle, or a separate tab. Not part of
   `WiringVariant`.
5. **Library and budget.** Plain `three` vs `@react-three/fiber` + `drei`, a lazy chunk, and an
   explicit bundle budget, since none exists. React 19 compatibility of the chosen versions still needs
   checking.
6. **No-WebGL fallback and accessibility.** The PRD is silent. Falling back to the 2D `CabinetDrawing`
   is the obvious default.
7. **Testing.** `test-plan.md` has no row for 3D. A unit test of the pure scene helper is the natural
   minimum, and whether to add an E2E smoke is open.
8. **Roadmap.** Taking #14 out of `## Parked` is a roadmap edit and must be mirrored with
   `scripts/roadmap-to-github.mjs --apply`.
