# Layout, wiring and comb busbars

- **Layout placements are a snapshot, read only through `computeLayoutView`**
  (`src/lib/layout-server.ts`). Draw a layout (and its wires) only when its state is `placed`; an
  outdated or missing one is never drawn. `project_device_placements` is written only by the
  `save_project_circuits` / `save_project_layout` RPCs
  (`supabase/migrations/20261006130000_project_device_placements.sql`) — never from TypeScript — and a
  cabinet change clears it. Placements have no UPDATE grant on purpose: every save replaces the whole
  set.
  **Manual edits (S-06):** the editor island (`src/components/projects/LayoutEditor.tsx`, model in
  `src/lib/layout-editing.ts`) saves through `POST /api/projects/[id]/placements`, which requires a
  `current` match, runs `validateLayout` (refusal: `layout_invalid`) and only then calls
  `save_project_layout` with `p_edited_manually: true`
  (`supabase/migrations/20261008120000_manual_layout_edits.sql`). The `edited_manually` flag lives on
  the placement rows, so it dies with them — a circuit save or re-match re-creates the rows, a supply
  change deletes the snapshot — and a cabinet change clears it. The flag is a convention, not
  enforced by the database: the owner's own token can set it through either RPC or a direct INSERT,
  so never let it decide more than the badge and whether a carry-over is attempted (which still runs
  `validateLayout`). A manual layout survives a circuit save or re-match only through
  `carryOverPlacements`, reached via `chooseSelectionLayout` in `layout-server.ts`: it applies only
  when the whole set still applies (devices matched by role, `rcd_group_id`, `circuit_id`) and passes
  `validateLayout`; otherwise a fresh proposal is stored and the redirect carries `layout_reset=1`.
- **Catalog PE/N bars:** a cabinet without built-in bars gets `pe_bar` / `n_bar` selections from the
  catalog, snapshotted with `project_devices.terminal_groups`
  (`supabase/migrations/20261006140000_project_device_bars.sql`) and placed on a DIN rail; the
  drawing and wiring read the snapshot, never the live catalog.
- **Wiring (S-11) is display-only, routed and drawn in the browser.** The wiring router exceeded the
  Worker CPU budget on Cloudflare, so the page hands a `placed` layout's router input to a client
  island (`src/lib/wiring-island.ts`, `src/components/projects/WiringDrawing.tsx`; the editor uses the
  same hook). Moving it back to the server must be measured on Cloudflare with `scripts/wiring-bench`
  (`README.md` there), never decided by local timings; the bench Worker's name must never be
  `rozdzielnica-pro`. Conductor diameters and ferrule colours come only from `src/lib/wire-dimensions.ts`
  (transcribed, user-verified data — never inline a size). One router (`routeConductors`) feeds both
  drawing variants, `realistic` and `schematic`: a variant changes how a route is drawn, never the route
  or its length. Overflow (`conductors_do_not_fit`) is an informational warning and never blocks a
  layout, a save or a quote. In `src/lib/cabinet-drawing.ts` a cable's sheath ends `SHEATH_STUB_MM` past
  its entry, and realistic circuit/WLZ runs are taut — only feeds sag. The project page's "Widok" switch
  is `?wiring=schematic` (`src/lib/wiring-view.ts`); the printout stays schematic regardless.
- **Comb busbar segments are snapshot rows that sit on no rail.** A `busbar` row (`isBusbarRole` in
  `src/lib/cabinet-layout.ts`) carries the group's `rcd_group_id` and a `busbar_piece` number, is never
  placed, and must be excluded from every coverage, membership and contiguity check — filter it with
  `isBusbarRole`, never count it as a device on a rail. **`busbar_piece` is guarded twice, and the two
  guards must change together:** the `project_devices_busbar_piece_valid` CHECK in
  `supabase/migrations/20261009120200_project_device_busbars.sql` (set exactly for `busbar` rows) and
  `Selection.busbarPiece` with its snapshot mapping in `src/lib/device-matching-server.ts`. Segments are cut
  by `src/lib/busbar-cutting.ts` (never a busbar rated below the group RCD); **a busbar miss is never a
  catalog gap** — only an informational note (`busbar_missing`, `busbar_group_too_wide`), and the group
  keeps its wire jumpers. The N-outward RCD orientation of a busbar group is a rule in the
  `src/lib/cabinet-layout.ts` header, not a score. `routeWiring` (`src/lib/cabinet-wiring.ts`) replaces the
  phase jumpers of a busbar group with the drawn busbar; N jumpers stay. The matcher gets busbars only
  when `MatchInput.maxRailMm` is given (`maxRailMm` in `device-matching-server.ts`).
- **The 3D preview (`?wiring=3d`, GitHub #14) is display-only, client-only and drawn from a `placed`
  layout.** `src/lib/wiring-3d.ts` lifts the router's output into depth and never changes a route or a
  length — a 3D path longer than `lengthMm` is accepted. Its realistic wires reuse the 2D realistic rules
  (`bendRadiusMm`, `realisticSagLimits` / `sagLimits`, `FERRULE`, `buildCableTies` from
  `cabinet-drawing.ts` / `wire-dimensions.ts`); never fork a 3D-only bend, sag, ferrule or tie rule. The
  depth constants in `src/lib/cabinet-3d.ts` and the shape constants in `src/lib/cabinet-3d-models.ts` are
  display assumptions, not catalog data, and every model part stays inside its pure-model box (asserted
  in `cabinet-3d-models.test.ts`), so the front view keeps matching the 2D drawing. three.js is imported
  only by `src/components/projects/Cabinet3D*.tsx`; the printout stays 2D.
