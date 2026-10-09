# Realistic Wiring Render Implementation Plan

## Overview

Roadmap S-11 (issue #32): an extension beyond the PRD, requested by the user on 2026-10-07, which
serves FR-012 indirectly through a readable layout visualisation. The cabinet wiring drawing should look like a real,
carefully wired switchboard, at the "uber pro" level of
`context/foundation/references/wiring/rozdzielnica-z-opaskami.webp`:

- conductors at their true outer diameter;
- circuit cores and the WLZ gathered into packs in channels along the cabinet's side walls, tied with
  cable ties, branching off horizontally to their terminals;
- ferrules (tulejki) on every terminal end;
- bends sized to the conductor;
- cable sheaths.

The schematic drawing stays available as a variant over the same routes. It is the fallback for
greyscale print (S-09 decides) and for an on-screen "Widok: schematyczny" switch.

This is **not** presentation-only, as the roadmap's original risk note assumed. The user decided
(2026-10-08) on true-scale spacing and side packs, and both change the routes and so the wire lengths.
The CPU budget is measured on real Cloudflare before and after the router rewrite, with a client-island
fallback.

**Sequencing:** the plan is written now, but implementation starts only after S-09
(`printable-quote-export`) ships. S-11 keeps its S-09 prerequisite.

## Current State Analysis

### Routing (`src/lib/cabinet-wiring.ts`, 1590 lines)

**Pipeline.** `routeConductors` (`:1278-1546`) runs these steps in order:

1. Locate the devices and build a `Router` (`:1291`) with row bands, obstacles, `topLane`/`bottomLane`
   and two gutter lines.
2. `spreadCables` (`:1167`) gives each cable its own point along its entry.
3. Decide the supply edge per device (`:1337-1360`).
4. Build the conductor list (`:1362-1482`).
5. `assignBarTerminals` (`:1221`) puts one conductor on each terminal.
6. `router.route` (`:432`) gives every conductor a raw orthogonal route.
7. `nudgeTracks` (`:1089`) separates parallel segments.
8. Lengths are the route length × `WIRE_SLACK_RATIO` (0.3), at `:1543`.

**Vertical runs.** `joinHorizontalLanes` (`:394`) picks one x for each vertical run: a gap between
blocks, a block end ± `CLEARANCE_MM`, or a gutter line.

**Gutters.** The gutters (`gutterLeft/Right`, `:279-280`, `GUTTER_MM = 10` at `:184`) are a single
candidate x each. They reserve no width and have no bundle semantics. There are no side packs today.

**Track pitch.** The pitch is one constant, `WIRE_TRACK_PITCH_MM = 3` (`:532`). It is read by
`BEHIND_DEVICES_MM` (`:546`), `VERTICAL_REACH_MM` (`:553`), `avoidPins` (`:670`), `spread` (`:767`),
`place` (`:790`) and the bundle merge test in `nudgeAxis` (`:1064`).

**Slots.** The slot model is a uniform grid. `assignSlots` (`:834`) does interval partitioning, and
`Bundle.lo/hi = start + (slots − 1) × pitch` (`:903`). A per-conductor pitch is therefore a rewrite of
the nudging stage (`~:524-1081`), not a constant swap.

**When there is no room.** Nothing is reported. `spread` (`:765-769`) compresses the pitch, down to 0.
`avoidPins` (`:718`) accepts an overlap. `joinHorizontalLanes` (`:410`) falls back through devices.

**Data shape.** `Conductor` (`:154-169`) already carries `crossSectionMm2`, `kind`
(`circuit | wlz | feed`), `role`, `circuitId`, `from`/`to` endpoints and an orthogonal `path`. End
positions are `path[0]` and `path[last]`, and an end segment is always a vertical stub.

### Drawing (`src/lib/cabinet-drawing.ts`, `src/components/cabinets/CabinetDrawing.tsx`)

**Path geometry.** `wirePathD` (`:323-355`) draws bends as `Q` curves with radius `WIRE_BEND_MM = 4`,
plus a sag on horizontal runs of at least 30 mm. `sagLimits` (`:435-458`) caps the sag against the
run below it.

**Wires and cables.** `buildDrawnWires` (`:465-482`) emits `DrawnWire`:
`{key, role, kind, d, title, barEnds}`. It carries no cross-section field. `buildDrawnCables`
(`:501-522`) draws a sheath stub from the entry to where the cores split.

**Stroke widths.**

- They are fixed screen pixels with `vectorEffect="non-scaling-stroke"`.
- They depend on the conductor kind, not its cross-section: `WIRE_WIDTH_PX = {circuit 1.5, wlz 2.5,
feed 2.25}` (`CabinetDrawing.tsx:128`).
- The per-role weights come from `WIRE_STYLES` (`cabinet-drawing.ts:366-377`): PE 1.6, PEN 2.2.
- The patterns keep greyscale legible: N is dashed, PE has a stripe, PEN has a stripe and blue dashes.

**SVG coordinates.** One SVG unit is one millimetre and there are no transforms, so true-scale strokes
are simply mm-valued strokes without `non-scaling-stroke`.

**Layers and hover.** All wires sit in one layer above the devices, and cables in a layer above the
wires (`:512-551`). Hover is CSS-only (`:519`), backed by an invisible 10 px hover path.

**Wire ends.** Only bar ends get a filled terminal (`:168-181`). Device-terminal ends have no end marker.

**Legend.** `src/components/projects/LayoutLegend.tsx:55-104` hard-codes its own swatch widths.

**Print.** There is no `@media print` anywhere. Greyscale legibility comes from luminance and patterns
alone (`src/styles/global.css:77`).

### Call sites

- **Server render.** `computeWiring` (`src/lib/layout-server.ts:102`) is the only caller of
  `routeConductors`. It routes only in layout state `placed`.
- **Project page.** `src/pages/dashboard/projects/[id].astro:149-165` calls `computeWiring` →
  `buildDrawnWires` / `buildDrawnCables` → `wireLengthsBySection`.
- **Layout section.** `src/components/projects/LayoutSection.astro:141-166` draws the static drawing
  and the `client:only` `LayoutEditor`. The editor hides wires while it is dirty.
- **Kitchen sink.** `src/lib/kitchen-sink-circuits.ts:526` and `src/pages/dev/kitchen-sink.astro`.
- **Landing hero.** `src/components/brand/DraftingSheet.astro:18` uses `landingLayoutFixture()`, shown
  on the landing page.

### CPU

- The Worker allows 10 ms of CPU per request.
- The S-05 "render path CPU budget" test (`src/lib/layout-server.test.ts:484`) measured the worst case
  (60 circuits, 20 RCD groups, 81 devices, ~284 conductors on seed cabinet (c)). After per-conductor
  tracks the median was 7.9–10.2 ms, already at the limit.
- That figure was measured in Node on this machine, not in workerd on Cloudflare. The user notes this
  machine is slow, so the real headroom is unknown.
- The documented fallback is to route wires in a client island
  (`context/archive/2026-10-06-cabinet-layout-proposal/plan.md:935-947`).

### Side room in the seed cabinets (`supabase/seed.sql`)

- **(a)** 10 mm on each side of the single rail.
- **(b)** 40 mm on each side, but vertical PE/N bars take up part of it, leaving about 15 mm of free
  strip per side.
- **(c)** About 30 mm on each side, and a 60 mm central gap between the split bottom rails.

At true scale, a 30 mm strip holds about 6–8 conductors of 2.5–4 mm², so overflow is the normal case
for big projects.

## Desired End State

**Project page, realistic view (the default).**

- Conductors have their true outer diameter: a 1.5 mm² core is visibly thinner than a 2.5 mm² one, and
  the WLZ is clearly the thickest.
- Each circuit's cores and the WLZ leave the cable sheath, run in a tied pack along the nearer side
  wall, and branch horizontally to their terminal.
- Every device and bar terminal end carries a ferrule coloured by cross-section.
- Bends follow the conductor's diameter.
- Hover highlight and tooltips work as today.

**Overflow.** Where a pack or channel cannot hold the conductors at true scale, the extra conductors run
in a second layer behind the rail ends. An informational Polish warning under the drawing says so. A
layout or quote is never blocked.

**Schematic view.** "Widok: schematyczny" on the project page shows the same routes as thin
schematic lines with today's greyscale patterns.

**Wire lengths.** The lengths table reflects the new routes, still with 30 % slack, and both variants
read the same lengths.

**Other screens.** The landing hero, `/dev/kitchen-sink` and the layout editor's saved-state drawing
show the realistic view. The kitchen sink also shows the schematic view, the overflow warning and the
view switch.

**CPU.** The worst-case render fits the Worker CPU budget, measured on Cloudflare. If it does not,
wires are routed and drawn in a client island instead.

**Data.** The diameter and ferrule table has been checked by the user against its cited sources.

### Key Discoveries:

- A per-conductor pitch needs cumulative slot offsets. Where non-overlapping members share a slot, the
  slot is as wide as its largest member. This rewrites `place`, `spread`, the anchor grid, `avoidPins`
  and the bundle merge test (`cabinet-wiring.ts:524-1081`), so plan it as a rewrite of the nudging
  stage.
- `routeConductors` already isolates topology from geometry. Entry spreading, the supply edge, the
  conductor list and bar terminal assignment can all stay. Side packs change only how vertical runs are
  placed (`joinHorizontalLanes` `:394`, `joinVerticalLanes` `:415`), the track ranges (`trackRange`
  `:450`) and the nudging stage.
- Roughly 70–75 % of `cabinet-wiring.test.ts` asserts invariants (endpoints, roles, orthogonality,
  slack, determinism, bar terminals) and survives. The pitch-based tests need rework:
  `trackClashes` `:496-528`, pitch ≥ 2.5 `:604`, the progressive-split and closing-up tests
  `:835-916`, and "passes behind a device only along its length" `:568`.
- `cabinet-drawing.test.ts` pins exact strings: the `wirePathD` string `:374`, the `Q50` sag regex
  `:411-448` and the `buildDrawnWires` `toEqual` `:407`. Extend these intentionally; never loosen them
  to "anything".
- A Worker's `performance.now()` / `Date.now()` do not advance during pure computation (a Spectre
  mitigation). CPU time can only be read from the platform (Workers Logs / `wrangler tail`), not timed
  inside the code.
- `wrangler.jsonc` has `preview_urls: false` and `observability.enabled: true`. The production Worker
  `rozdzielnica-pro` must not be renamed or reused for a benchmark (AGENTS.md tripwire).

## What We're NOT Doing

- No changes to the layout heuristic, `validateLayout`, layout states or the `does_not_fit` failure.
  Wiring stays display-only and never blocks a layout, a save or a quote.
- No database change. Wiring is computed on render and never stored.
- No change to `WIRE_SLACK_RATIO` (0.3).
- No second router for the schematic view: one router, two drawing variants.
- No print styles. The realistic/schematic choice for print belongs to S-09.
- No per-manufacturer diameters. One transcribed typical value per cross-section, with ~±10 % spread
  accepted.
- No bend-radius, fill-factor or standards checks on the packs. Overflow is informational only.
- No 3D, no animation and no client-side drag of wires.
- Short device-to-device feeds (FR→RCD, RCD→MCB bridges) do not join the packs.
- No changes to device matching, the quote or the wire-lengths formula.

## Implementation Approach

The routing work is bracketed by measurement on real Cloudflare:

1. Measure today's router (Phase 1).
2. Add the dimension data (Phase 2).
3. Rewrite the nudging stage for true-scale spacing (Phase 3).
4. Add side packs and overflow (Phase 4).
5. Re-measure and decide server vs client (Phase 5).
6. Build the realistic and schematic drawing variants on top of the final routes (Phase 6). Its
   heavier SVG is measured once more on the chosen runtime.
7. Wire the variant switch, the warning, the landing page, the kitchen sink and the docs (Phase 7).

The geometry contract stays the same: `Conductor.path` is the measured route, and every drawing effect
(ties, ferrules, bends, shading) is derived from it without changing it.

## Critical Implementation Details

**Performance constraints.**

- The CPU budget decision rule is fixed now: a worst-case median of **≤ 8 ms** CPU and a **max ≤ 10 ms**
  on Cloudflare (workerd, warm, ≥ 30 requests) keeps rendering on the server; anything over that moves
  wiring to the client island.
- The rule applies to the full render path the page runs: match view, layout view, routing,
  `buildDrawnWires` / `buildDrawnCables` and the drawing's server render.
- The local Node test in `layout-server.test.ts` stays as a regression guard, but it is not the decision
  instrument.

**Debug & observability.**

- CPU is read per invocation from the platform: `npx wrangler tail <bench-worker> --format json`, or a
  Workers Logs query. In-Worker timers do not advance during computation.
- If neither exposes CPU time in this account, stop and ask the user to install the Cloudflare MCP
  server (offered 2026-10-08) rather than falling back to local numbers.
- Deploying and deleting the bench Worker are outward-facing actions on the user's Cloudflare account.
  Confirm each one with the user in chat when you reach it.

**Ordering.** Never let the realistic drawing's widths feed back into routing. Diameters reach the
router only through `wire-dimensions.ts` (Phase 2), so both drawing variants draw identical routes.

---

## Phase 1: Cloudflare CPU bench and baseline

### Overview

Build a throwaway benchmark Worker that runs the real render path on fixed fixtures, deploy it under its
own name, and record today's CPU baseline on Cloudflare. This gives Phase 5 a like-for-like comparison.

### Changes Required:

#### 1. Shared bench fixtures

**File**: `src/lib/wiring-bench-fixtures.ts` (new), `src/lib/layout-server.test.ts`

**Intent**: Move the worst-case project builder (60 circuits, 20 groups, seed cabinet (c)) and a
realistic project (12 circuits, 4 groups) out of `layout-server.test.ts` into one importable module.
The local test and the bench then measure the same input.

**Contract**:

- `worstCaseFixture()` and `realisticFixture()` each return everything the render path needs: a
  `MatchContext` with its snapshot, and placements in state `placed`.
- The module must not import from `layout-server.ts` loaders, so it stays bundle-safe.
- `layout-server.test.ts` imports it, and its existing assertions stay unchanged.

#### 2. Bench Worker

**File**: `scripts/wiring-bench/worker.ts`, `scripts/wiring-bench/wrangler.jsonc` (new)

**Intent**: A minimal Worker whose `fetch` runs the project page's full render path for one fixture,
chosen by a query parameter (`?fixture=worst|realistic`), and returns a small text body.

**Contract**:

- The render path is `computeMatchView` → `computeLayoutView` → `computeWiring` → `buildDrawnWires` /
  `buildDrawnCables` → `wireLengthsBySection` → React `renderToString(<CabinetDrawing …/>)`.
- The Worker name is `rozdzielnica-pro-wiring-bench`. Never `rozdzielnica-pro`.
- It has no bindings and no secrets, and `observability.enabled` is true.
- It is deployed only with `npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc`.
- `npm run lint` must cover or explicitly ignore the folder consistently with `scripts/`.

#### 3. Measurement procedure and baseline

**File**: `scripts/wiring-bench/README.md` (new), `context/changes/realistic-wiring-render/change.md`

**Intent**: Document the repeatable procedure, then record today's numbers.

**Contract**: The procedure is:

1. Deploy the bench (after user confirmation).
2. Start `wrangler tail --format json`.
3. Send 5 warm-up requests, then 30 requests per fixture.
4. Take the median and max CPU per fixture from the per-invocation CPU field.

The baseline (median/max for worst and realistic) is appended to `change.md` under `## Measurements`,
with the date and the wrangler version. If the tail exposes no CPU field, use a Workers Logs query. If
that is unavailable too, stop and ask for the Cloudflare MCP server.

### Success Criteria:

#### Automated Verification:

- Unit tests pass with the extracted fixtures: `npm run test:unit`
- Lint and type checks pass: `npm run lint && npx astro check`
- Bench Worker builds/deploys under its own name: `npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc --dry-run`

#### Manual Verification:

- User confirmed the bench deploy, and `rozdzielnica-pro` (production) is untouched: same version id in `npx wrangler deployments list` before and after
- Baseline CPU median/max for worst and realistic fixtures, read from Cloudflare, recorded in `change.md`

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 2: Wire dimensions data

### Overview

Add the transcribed data that true scale depends on:

- conductor outer diameters;
- cable sheath diameters;
- ferrule colour and length per cross-section.

Each table comes with completeness tests and a cited source, and the user verifies it the same way as
`AMPACITY_A`.

### Changes Required:

#### 1. Dimension tables

**File**: `src/lib/wire-dimensions.ts` (new) + `src/lib/wire-dimensions.test.ts`

**Intent**: Provide the single source of physical sizes for the router and the drawing.

**Contract**:

- `CONDUCTOR_OUTER_DIAMETER_MM: Record<mm², number>`: a single insulated core, typical H07V-K,
  covering every value in `CIRCUIT_CROSS_SECTIONS_MM2` ∪ `WLZ_CROSS_SECTIONS_MM2` (1.5 … 35).
- `CABLE_OUTER_DIAMETER_MM[cores][mm²]`: a sheathed cable, typical YDY/YKY. Cores are 2–5, covering
  every core count the router produces for circuits and the WLZ.
- `FERRULE[mm²]`: `{ colourToken, lengthMm }`, following the DIN 46228-4 colour code.
- Helpers: `conductorDiameterMm(mm²)` and `cableDiameterMm(cores, mm²)`.
- A header comment cites the transcription source (datasheet / standard and edition) and carries
  "TRANSCRIBED DATA — verify", exactly like `supply-warnings.ts`.
- Tests:
  - every combination is present;
  - diameters are strictly increasing in cross-section;
  - each sheath is wider than one core of its section;
  - every ferrule colour token exists in `global.css`.

#### 2. Tokens

**File**: `src/styles/global.css`

**Intent**: New colours are tokens, never literals (UI rule).

**Contract**:

- `--ferrule-*` per DIN 46228-4 colour used.
- `--wire-tie` (natural nylon), `--wire-sheath` (cable jacket) and `--wire-sheen` (insulation
  highlight).
- Each is mapped under `@theme inline` as `--color-…`.

### Success Criteria:

#### Automated Verification:

- Completeness and monotonicity tests pass: `npm run test:unit -- wire-dimensions`
- Lint and type checks pass: `npm run lint && npx astro check`

#### Manual Verification:

- User verified every diameter and ferrule entry against the cited sources (recorded in the file header with the date, like `AMPACITY_A`)

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 3: Router — true-scale spacing

### Overview

Replace the uniform 3 mm track grid with per-conductor spacing. Two neighbouring tracks sit
`rA + rB + WIRE_CLEARANCE_MM` apart centre to centre, where r is a conductor's half outer diameter.
Route topology is unchanged. Lengths shift only by the changed offsets.

### Changes Required:

#### 1. Nudging stage

**File**: `src/lib/cabinet-wiring.ts`

**Intent**: Rewrite slot layout so tracks are spaced by the diameters of the conductors in them.
Compression is recorded instead of hidden.

**Contract**:

- `WIRE_TRACK_PITCH_MM` is removed and replaced by `WIRE_CLEARANCE_MM` (visual gap between insulation,
  0.5 mm, a named constant with its rationale). Diameters come from `conductorDiameterMm`.
- A slot is as wide as its widest member. Bundle extents, `place`, `spread`, the anchor grid,
  `avoidPins` and the bundle-merge "near" test all use cumulative widths.
- `BEHIND_DEVICES_MM` and `VERTICAL_REACH_MM` become their own constants (keeping today's 30 mm reach),
  no longer pitch multiples.
- `Conductor` gains `diameterMm: number`, set from `crossSectionMm2`.
- When a range is too narrow, `spread` still compresses. It must not be silent: it marks the affected
  segments in a new `Conductor.squeezed: number[]` (segment indices). Phase 4 turns this into the
  overflow signal.
- Determinism and orthogonality are kept, and so is "segments touching an endpoint never move".

#### 2. Tests

**File**: `src/lib/cabinet-wiring.test.ts`, `src/lib/cabinet-drawing.ts` (comment at `:431`)

**Intent**: Re-base the pitch invariants on true scale and keep every topology test.

**Contract**:

- `trackClashes` becomes "two parallel overlapping segments closer than `rA + rB` (bodies overlap)
  unless a segment is listed in `squeezed`".
- The pitch ≥ 2.5 test becomes a spacing test with a 1.5 mm² vs 16 mm² pair.
- The progressive-split and closing-up tests (`:835-916`) are rewritten for per-conductor widths.
- The drawing comment about pitch vs stroke px is updated.

### Success Criteria:

#### Automated Verification:

- Router tests pass, including new spacing tests (unsqueezed neighbours never overlap at true scale; a mixed 1.5/16 mm² pair is spaced by both radii): `npm run test:unit -- cabinet-wiring`
- Slack invariant still holds (lengthMm = 1.3 × route length) and routing is deterministic: `npm run test:unit -- cabinet-wiring`
- Full unit suite, lint, types: `npm run test:unit && npm run lint && npx astro check`

#### Manual Verification:

- `/dev/kitchen-sink` layout states still draw every conductor end-to-end with no wire crossing through a device, with visibly wider spacing next to the WLZ

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 4: Router — side packs and overflow

### Overview

Route every circuit cable core (L, N, PE, including to the bars) and every WLZ core through a pack in a
side strip:

1. entry stub;
2. along the top or bottom lane to the pack;
3. vertical in the pack;
4. horizontal in the destination row's channel;
5. terminal stub.

Feeds keep today's local routing. A pack that does not fit continues in a second layer behind the rail
ends and is flagged as overflow. An informational warning reports it.

### Changes Required:

#### 1. Pack strips

**File**: `src/lib/cabinet-wiring.ts` (`Router` constructor, `trackRange`)

**Intent**: Compute a left and a right pack strip, and give packs their own track range.

**Contract**:

- A strip's x-range runs from the interior wall, or the inner edge of a vertical bar on that side, plus
  `CLEARANCE_MM`, to the outermost rail end minus `CLEARANCE_MM`.
- A strip narrower than one conductor counts as absent.
- The overflow layer for a strip is the band behind the rail ends, up to `BEHIND_DEVICES_MM`.
- The `GUTTER_MM` line logic is replaced by the strips.

#### 2. Pack routing

**File**: `src/lib/cabinet-wiring.ts` (`joinHorizontalLanes`, `joinVerticalLanes`, conductor build `:1362-1482`)

**Intent**: Send circuit and WLZ cores through a pack; feeds stay local.

**Contract**:

- **Pack side, per conductor.**
  - A left or right entry uses that side's pack.
  - A top or bottom entry uses the side whose strip is nearer to the destination terminal's x. A tie
    goes to the side nearer the entry slot, and a remaining tie goes to the left.
  - With no usable strip on either side, the conductor falls back to today's routing and is flagged
    as overflow.
- **Order in a pack.** The conductor that leaves the pack first sits innermost, nearest the rails, so
  branches never cross the conductors that continue. Ordering is deterministic.
- **Spacing.** Pack tracks use the Phase 3 true-scale spacing. Conductors that do not fit in the strip
  go to the overflow layer.
- `Conductor` gains `packSide: "left" | "right" | null` and `overflow: boolean`. `overflow` is true when
  any segment is in the overflow layer or `squeezed` anywhere.
- **Sheath.** A circuit cable's sheath ends where the cable reaches its pack, and the cores split there.
  This replaces the progressive split for packed cables.

#### 3. Overflow warning

**File**: `src/lib/cabinet-wiring.ts`, `src/lib/i18n/pl.ts`

**Intent**: Surface overflow as information, never as a block.

**Contract**:

- `wiringWarnings(conductors): WiringWarning[]` returns
  `{ code: "conductors_do_not_fit", count }` when any conductor has `overflow`.
- `wiringWarningMessage(warning)` is exhaustive over the code, like `supplyWarningMessage`.
- The Polish text is in `t.layout.section.wiringOverflow(count)`, using `plural()`. It says how many
  conductors did not fit at true scale in the side channels and are drawn behind the DIN rail ends, and
  that this is a drawing simplification, not a blocker.

#### 4. Tests

**File**: `src/lib/cabinet-wiring.test.ts`

**Intent**: Pin the pack rules as invariants.

**Contract**:

- Every circuit and WLZ core has a vertical run inside its pack strip, unless it is overflow.
- Feeds never enter a strip.
- The pack side rule holds, including ties.
- Innermost-exits-first: no two cores in one pack cross.
- The worst-case fixture yields an overflow warning and the realistic fixture on seed (c) yields none.
- Endpoints, roles, bar-terminal uniqueness and slack invariants are unchanged.

### Success Criteria:

#### Automated Verification:

- Pack, side-rule, no-crossing and overflow tests pass: `npm run test:unit -- cabinet-wiring`
- Worst-case fixture produces `conductors_do_not_fit`; realistic fixture on seed (c) produces none: `npm run test:unit -- cabinet-wiring`
- Full unit suite, lint, types: `npm run test:unit && npm run lint && npx astro check`

#### Manual Verification:

- On `/dev/kitchen-sink` (schematic strokes still), wires visibly run in side packs and branch to their rows; the lengths table changed plausibly (longer circuit cores, unchanged feeds)

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 5: Cloudflare re-measure and runtime decision

### Overview

Re-run the Phase 1 procedure on the new router. Apply the decision rule (worst-case median ≤ 8 ms and
max ≤ 10 ms keeps the server). If the server path is over budget, move routing and the wire layer to a
client island.

### Changes Required:

#### 1. Measurement and decision record

**File**: `context/changes/realistic-wiring-render/change.md`

**Intent**: Record the new numbers next to the baseline, and the decision.

**Contract**: The `## Measurements` section gets a "router v2" row per fixture and a one-line decision:
`server` or `client island`.

#### 2. Client island (only if over budget)

**File**: `src/components/projects/WiringLayer.tsx` (new), `src/components/projects/LayoutSection.astro`, `src/pages/dashboard/projects/[id].astro`

**Intent**: Follow the documented fallback.

- The server still decides the layout state and validates placements (never moved to the client).
- An island hydrated `client:idle` receives the validated inputs, runs `routeConductors` +
  `buildDrawnWires` / `buildDrawnCables` + `wireLengthsBySection` in the browser, and renders the wire
  layer, the lengths table and the overflow warning.

**Contract**:

- The island imports only bundle-safe modules (`cabinet-wiring.ts`, `cabinet-drawing.ts`,
  `wire-dimensions.ts`), never `layout-server.ts`.
- The server render keeps the devices and the cabinet, and shows a Polish "Wczytywanie przewodów…"
  placeholder where the wires go.
- Landing and kitchen sink keep server-rendering their fixed fixtures if those measure within budget.
  Otherwise they use the same island.
- The decision is noted for S-09, because print must wait for the rendered SVG.

### Success Criteria:

#### Automated Verification:

- Unit suite, lint, types, build: `npm run test:unit && npm run lint && npx astro check && npm run build`

#### Manual Verification:

- Router v2 CPU median/max for both fixtures, read from Cloudflare, recorded with the decision in `change.md`
- If the island was built: on the project page, wires appear after hydration, hover and lengths work, and devices render without JS

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 6: Drawing — realistic and schematic variants

### Overview

Add the realistic variant: true-scale bodies, insulation shading, ferrules, cable ties, sheaths and
bends sized to the diameter. Keep the schematic variant as today's look over the new routes. Both read
the same `Conductor[]`.

### Changes Required:

#### 1. Drawn-wire model

**File**: `src/lib/cabinet-drawing.ts`

**Intent**: Carry what the realistic variant needs, still derived purely from conductors.

**Contract**:

- `DrawnWire` gains `crossSectionMm2`, `diameterMm`, `overflow` and
  `terminalEnds: { point, direction }[]` (device and bar ends, for ferrules).
- `buildDrawnWires(conductors, names?, variant)` builds `d` with the variant's bend radius.
  - Realistic: `max(WIRE_BEND_MM, BEND_RADIUS_DIAMETERS × diameter)`, with `BEND_RADIUS_DIAMETERS = 3`
    as a named constant, still capped at half of each adjacent run.
  - Schematic: as today.
- Sag applies only to runs that are not tied, and `sagLimits` uses diameters.
- `buildCableTies(conductors): DrawnTie[]`:
  - Groups parallel overlapping segments whose neighbours sit within `2 × WIRE_CLEARANCE_MM` of each
    other.
  - For groups of ≥ 3 conductors, a tie every `TIE_PITCH_MM = 60` along the shared extent, as wide as
    the group.
  - Ties cover pack runs and dense channel runs alike.
- `buildDrawnCables` draws the sheath with `cableDiameterMm(cores, mm²)` in the realistic variant.
- `WIRE_STYLES` gains realistic styles:
  - L1 brown, L2 black and L3 grey solid.
  - N solid blue.
  - PE yellow body with green dashes along it.
  - PEN as PE plus blue sleeves at both ends.
  - All are token classes; the existing "no literal colours" test covers them.
- The schematic styles stay as they are.

#### 2. Component

**File**: `src/components/cabinets/CabinetDrawing.tsx`

**Intent**: Render either variant.

**Contract**:

- New prop `wiring?: "realistic" | "schematic"`, defaulting to `"realistic"`.
- Realistic:
  - Strokes are in millimetres (no `non-scaling-stroke`): an outline path at diameter + 0.3 mm in
    `drawing-frame`, a body at the diameter, and a `wire-sheen` highlight at ~0.25 × diameter.
  - Ferrules are drawn at each `terminalEnd` (length and colour from `FERRULE`).
  - Ties sit above the wires.
  - Overflow segments are drawn beneath the device layer.
- Schematic: today's render path, unchanged.
- The invisible hover path and the CSS hover highlight work in both variants.

#### 3. Legend

**File**: `src/components/projects/LayoutLegend.tsx`, `src/lib/i18n/pl.ts`

**Intent**: Give each variant a legend that matches its look; the hard-coded swatches must follow the
variant.

**Contract**: `LayoutLegend` gets a `wiring` prop. New Polish keys cover the realistic legend:
thickness by cross-section, ferrule colours by cross-section, cable tie, side pack and overflow layer.

#### 4. Tests

**File**: `src/lib/cabinet-drawing.test.ts`

**Intent**: Extend the pinned expectations deliberately.

**Contract**:

- The `buildDrawnWires` `toEqual` is updated with the new fields.
- New exact-string `wirePathD` cases for the realistic bend radius.
- `buildCableTies` cases: pitch, group-size threshold, width.
- Ferrule ends: one per device or bar end, none at entries.
- Realistic style tokens are checked by the existing literal-colour test.

### Success Criteria:

#### Automated Verification:

- Drawing tests pass, including ties, ferrule ends and realistic bend strings: `npm run test:unit -- cabinet-drawing`
- Full unit suite, lint, types, build: `npm run test:unit && npm run lint && npx astro check && npm run build`

#### Manual Verification:

- Bench re-run on Cloudflare with the realistic drawing stays within the Phase 5 rule on the chosen runtime (recorded in `change.md`)
- Realistic view on `/dev/kitchen-sink` (medium, large, TN-C, no-bars states) resembles `rozdzielnica-z-opaskami.webp`: tied side packs, WLZ clearly thickest, ferrules at terminals; hover highlight and tooltips still work
- Schematic variant looks as before over the new routes, and PE / N / PEN stay distinguishable in a greyscale screenshot

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 7: View switch, warning, landing, kitchen sink, docs

### Overview

Expose the variants on the project page, surface the overflow warning, update the landing hero and the
kitchen sink, and record the new rules in docs and the roadmap.

### Changes Required:

#### 1. View switch

**File**: `src/pages/dashboard/projects/[id].astro`, `src/components/projects/LayoutSection.astro`, `src/components/projects/LayoutEditor.tsx`, `src/lib/i18n/pl.ts`

**Intent**: Add a "Widok: realistyczny / schematyczny" switch in the "Układ w szafce" section, so the
server renders only the chosen variant.

**Contract**:

- The query parameter is `?wiring=schematic`; absent or any other value means realistic.
- The switch is two links preserving the section anchor, built from an existing `src/components/ui`
  control, with the active state marked.
- The variant flows to both the static drawing and the editor's saved-state drawing.
- Polish labels come from `pl.ts`.
- Redirects after saves do not need to preserve the parameter.

#### 2. Overflow warning UI

**File**: `src/components/projects/LayoutSection.astro` (or the island, if Phase 5 chose it)

**Intent**: Show `wiringWarningMessage` as a warning alert under the drawing, next to the lengths note.
It never hides the drawing or the lengths.

**Contract**: The warning is shown in state `placed` only, in both variants.

#### 3. Landing and kitchen sink

**File**: `src/components/brand/DraftingSheet.astro`, `src/lib/kitchen-sink-circuits.ts`, `src/pages/dev/kitchen-sink.astro`, `src/lib/i18n/pl.ts`

**Intent**: The landing hero shows the realistic view. Every new UI state lands on `/dev/kitchen-sink`
(UI rule).

**Contract**: The kitchen sink gains these states, with Polish captions under
`t.devTools.kitchenSink.layoutStates`:

- realistic medium and large;
- schematic medium;
- the overflow warning, from the worst-case fixture;
- the view switch in both positions.

#### 4. Docs and roadmap

**File**: `AGENTS.md`, `README.md`, `context/foundation/roadmap.md`

**Intent**: Record the new contracts.

**Contract**:

- **AGENTS.md tripwires:**
  - wire sizes come only from `wire-dimensions.ts` (transcribed, user-verified data);
  - one router feeds both drawing variants;
  - wiring is display-only and overflow never blocks;
  - the CPU budget is decided on Cloudflare via `scripts/wiring-bench`, never by local timings;
  - the bench Worker name must never be `rozdzielnica-pro`.
- **README:** the project-route description mentions the view switch.
- **Roadmap:** S-11 status and body follow the lifecycle, mirrored with
  `node scripts/roadmap-to-github.mjs --apply` (Mr1008 account, via a cheap-model subagent).
- **Bench teardown:** after user confirmation, the bench Worker is deleted
  (`npx wrangler delete -c scripts/wiring-bench/wrangler.jsonc`). The scripts stay for future
  measurements.

### Success Criteria:

#### Automated Verification:

- CI-equivalent passes: `npm run lint && npx astro check && npm run test:unit && npm run build`
- Roadmap mirror planned without errors: `node scripts/roadmap-to-github.mjs`

#### Manual Verification:

- Project page: the switch toggles realistic ↔ schematic, the active state is visible, and the overflow warning shows on a crowded project and not on a small one
- Landing hero shows the realistic drawing and stays legible at its small size
- Kitchen sink shows every new state with Polish captions
- User confirmed bench Worker deletion, and production `rozdzielnica-pro` is untouched

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Testing Strategy

### Unit Tests:

- **`wire-dimensions`:** completeness over every circuit and WLZ cross-section and every core count;
  monotonic diameters; sheath wider than a core; every ferrule token exists.
- **`cabinet-wiring`:**
  - true-scale spacing (mixed pairs);
  - `squeezed` marking;
  - pack strips (absent strip, vertical bar in the strip);
  - the pack side rule and its ties;
  - innermost-exits-first with no crossings;
  - feeds never packed;
  - overflow flag and warning on the worst case, none on the realistic fixture;
  - unchanged endpoints, bar terminals, slack and determinism.
- **`cabinet-drawing`:** realistic bend strings, ties (threshold, pitch, width), ferrule ends, the
  extended `DrawnWire`, realistic token styles.
- **`layout-server`:** the local CPU test stays as a regression guard on the shared fixtures.

### Integration Tests:

- None new: no database change. The bench Worker on Cloudflare is the runtime check for CPU.

### Manual Testing Steps:

1. Bench baseline (Phase 1) and the router v2 / realistic re-measures (Phases 5–6) on Cloudflare,
   recorded in `change.md`.
2. Kitchen sink: realistic and schematic states on seed (b) and (c), TN-C and no-bars; compare against
   the two reference photos.
3. Project page: toggle the view; hover a wire in each variant; check the lengths table and the
   overflow warning on a 60-circuit project.
4. Greyscale screenshot of the schematic variant: PE, N and PEN stay distinguishable.
5. Landing hero at its rendered size.

## Performance Considerations

- The realistic variant roughly triples the wire paths: outline, body, sheen, plus ferrules and ties.
  Phase 6 re-measures it.
- If even the island is slow on the worst case in the browser, simplify the realistic layers (drop the
  sheen path first) before anything else.
- Tie generation runs over segments once, O(segments log segments). Do not compare every pair of
  conductors.

## Migration Notes

- No data migration. Stored layouts are unaffected.
- Only drawn wires and the lengths table change, on the next render.
- Projects whose saved quote predates this change show different wire lengths; wires are not part of
  the quote amounts.

## References

- Roadmap S-11: `context/foundation/roadmap.md` (issue #32); reference photos in `context/foundation/references/wiring/`
- Router: `src/lib/cabinet-wiring.ts:154-169, 394-450, 524-1081, 1278-1546`
- Drawing: `src/lib/cabinet-drawing.ts:281-522`, `src/components/cabinets/CabinetDrawing.tsx:95-190, 512-551`
- Prior decisions (slack, sag, PEN look, CPU budget, client fallback): `context/archive/2026-10-06-cabinet-layout-proposal/plan.md:629-657, 767-818, 935-947`, `change.md:46-74`
- Transcribed-data pattern: `src/lib/supply-warnings.ts` (`AMPACITY_A`)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cloudflare CPU bench and baseline

#### Automated

- [x] 1.1 Unit tests pass with the extracted fixtures: `npm run test:unit` — ab0825e
- [x] 1.2 Lint and type checks pass: `npm run lint && npx astro check` — ab0825e
- [x] 1.3 Bench Worker builds/deploys under its own name: `npx wrangler deploy -c scripts/wiring-bench/wrangler.jsonc --dry-run` — ab0825e

#### Manual

- [x] 1.4 User confirmed the bench deploy, and `rozdzielnica-pro` (production) is untouched: same version id in `npx wrangler deployments list` before and after — ab0825e
- [x] 1.5 Baseline CPU median/max for worst and realistic fixtures, read from Cloudflare, recorded in `change.md` — ab0825e

### Phase 2: Wire dimensions data

#### Automated

- [x] 2.1 Completeness and monotonicity tests pass: `npm run test:unit -- wire-dimensions` — e6dc2b0
- [x] 2.2 Lint and type checks pass: `npm run lint && npx astro check` — e6dc2b0

#### Manual

- [x] 2.3 User verified every diameter and ferrule entry against the cited sources (recorded in the file header with the date, like `AMPACITY_A`) — e6dc2b0

### Phase 3: Router — true-scale spacing

#### Automated

- [x] 3.1 Router tests pass, including new spacing tests (unsqueezed neighbours never overlap at true scale; a mixed 1.5/16 mm² pair is spaced by both radii): `npm run test:unit -- cabinet-wiring`
- [x] 3.2 Slack invariant still holds (lengthMm = 1.3 × route length) and routing is deterministic: `npm run test:unit -- cabinet-wiring`
- [x] 3.3 Full unit suite, lint, types: `npm run test:unit && npm run lint && npx astro check`

#### Manual

- [x] 3.4 `/dev/kitchen-sink` layout states still draw every conductor end-to-end with no wire crossing through a device, with visibly wider spacing next to the WLZ

### Phase 4: Router — side packs and overflow

#### Automated

- [ ] 4.1 Pack, side-rule, no-crossing and overflow tests pass: `npm run test:unit -- cabinet-wiring`
- [ ] 4.2 Worst-case fixture produces `conductors_do_not_fit`; realistic fixture on seed (c) produces none: `npm run test:unit -- cabinet-wiring`
- [ ] 4.3 Full unit suite, lint, types: `npm run test:unit && npm run lint && npx astro check`

#### Manual

- [ ] 4.4 On `/dev/kitchen-sink` (schematic strokes still), wires visibly run in side packs and branch to their rows; the lengths table changed plausibly (longer circuit cores, unchanged feeds)

### Phase 5: Cloudflare re-measure and runtime decision

#### Automated

- [ ] 5.1 Unit suite, lint, types, build: `npm run test:unit && npm run lint && npx astro check && npm run build`

#### Manual

- [ ] 5.2 Router v2 CPU median/max for both fixtures, read from Cloudflare, recorded with the decision in `change.md`
- [ ] 5.3 If the island was built: on the project page, wires appear after hydration, hover and lengths work, and devices render without JS

### Phase 6: Drawing — realistic and schematic variants

#### Automated

- [ ] 6.1 Drawing tests pass, including ties, ferrule ends and realistic bend strings: `npm run test:unit -- cabinet-drawing`
- [ ] 6.2 Full unit suite, lint, types, build: `npm run test:unit && npm run lint && npx astro check && npm run build`

#### Manual

- [ ] 6.3 Bench re-run on Cloudflare with the realistic drawing stays within the Phase 5 rule on the chosen runtime (recorded in `change.md`)
- [ ] 6.4 Realistic view on `/dev/kitchen-sink` (medium, large, TN-C, no-bars states) resembles `rozdzielnica-z-opaskami.webp`: tied side packs, WLZ clearly thickest, ferrules at terminals; hover highlight and tooltips still work
- [ ] 6.5 Schematic variant looks as before over the new routes, and PE / N / PEN stay distinguishable in a greyscale screenshot

### Phase 7: View switch, warning, landing, kitchen sink, docs

#### Automated

- [ ] 7.1 CI-equivalent passes: `npm run lint && npx astro check && npm run test:unit && npm run build`
- [ ] 7.2 Roadmap mirror planned without errors: `node scripts/roadmap-to-github.mjs`

#### Manual

- [ ] 7.3 Project page: the switch toggles realistic ↔ schematic, the active state is visible, and the overflow warning shows on a crowded project and not on a small one
- [ ] 7.4 Landing hero shows the realistic drawing and stays legible at its small size
- [ ] 7.5 Kitchen sink shows every new state with Polish captions
- [ ] 7.6 User confirmed bench Worker deletion, and production `rozdzielnica-pro` is untouched
