# Cabinet Layout Proposal Implementation Plan

## Overview

Roadmap S-05, the product's north star (FR-008, US-01, PRD `## Business Logic`). The system places
the devices S-04 already matched onto the DIN rails of the project's cabinet snapshot, using the
three PRD rules with an explicit precedence, stores the result, and draws it on the project page —
with wires carrying a standard 15% slack and a realistic sag, plus a list of conductor lengths. The
device catalog gains the side of each device's N terminal (GitHub #15), which the layout and the
wiring both use.

This plan closes PRD Open Question #2: **rule 1 > rule 2 > rule 3, strictly** (user decision,
2026-10-06).

## Current State Analysis

- S-04 matches one device per role (`main_switch`, `rcd`, `rcbo`, `mcb`) and stores them as an
  immutable snapshot in `project_devices` — insert/select/delete grants only, no UPDATE
  (`supabase/migrations/20260929120000_circuits_and_device_matching.sql:125-179, 274-277`). The
  snapshot carries `width_mm numeric(6,2)`, `height_mm`, `depth_mm`, `poles`, `kind` and price, but
  no placement column of any kind.
- `save_project_circuits` (current body: `supabase/migrations/20260930120000_rcd_group_margin.sql:24-139`)
  upserts groups and circuits, deletes **all** `project_devices` rows and re-inserts the matched set
  with `position = ordinality - 1` (`:120-137`). Called through `saveCircuitsArgs`
  (`src/lib/device-matching-server.ts:237-258`) from `src/pages/api/projects/[id]/circuits.ts:60`
  and `src/pages/api/projects/[id]/rematch.ts:39`.
- `projects_clear_device_snapshot` deletes the snapshot on a supply change only; a cabinet change
  re-snapshots `projects.cabinet_geometry` (`projects_snapshot_cabinet`,
  `supabase/migrations/20260924150000_projects.sql:152-183`) and leaves `project_devices` alone. The
  S-03 plan left "what a cabinet change does to an existing layout" to S-05.
- `computeMatchView` (`src/lib/device-matching-server.ts:208-226`) yields
  `current | stale | cleared | gaps | blocked`; S-08/S-09 may only use the snapshot when `current`.
  `MatchContext` already carries the parsed `geometry` snapshot (`:43-50`).
- Geometry (`src/lib/cabinet-geometry.ts`): integer mm, origin top-left, y down; rails are
  horizontal, 35 mm tall (`RAIL_HEIGHT_MM`), `yMm` is the rail's top edge; a row may hold several
  rails; entries are `{side, offsetMm, lengthMm}`; PE/N bars have `orientation`, rect, `zMm` and
  terminal groups; a cabinet may have zero bars.
- Circuits carry `entry_side` per circuit, not per group (`src/lib/circuit-params.ts`).
- `CabinetDrawing` (`src/components/cabinets/CabinetDrawing.tsx`) is hook-free, SSR-rendered,
  1 SVG unit = 1 mm, content clipped in a nested `<svg>` (`:111`); props are only `geometry`,
  `highlight`, `invalid`, `className`. `DraftingSheet.astro:72-99` already overlays a second SVG with
  the same viewBox — a precedent for layering on the drawing.
- The project page (`src/pages/dashboard/projects/[id].astro`) has sections `details`, `cabinet`,
  `supply`, `circuits`, `delete` (nav array `:165-171`); the only cabinet drawing is the aside
  thumbnail (`:428-434`). `MatchResult.astro` renders the device table.
- Device kinds/poles rules live twice: `devices_parameters_match_kind` CHECK
  (`supabase/migrations/20260923130628_devices_catalog.sql:80-81`) and `parseDeviceSpec`
  (`src/lib/device-spec.ts`). No pole order or N position is recorded (roadmap `## Parked`, #15).
- Seed cabinets (`supabase/seed.sql:86-117`) differ on purpose: (a) PRZ-S1 250×200, one 230 mm rail,
  top entry, **no bars**; (b) PRZ-M3 400×500, three 320 mm rails, top + bottom entries, vertical PE
  (left) and N (right) bars; (c) PRZ-L4 600×800, five rails (last row split 240 + 240 with a 40 mm
  gap), bottom + left entries, horizontal PE and N bars stacked at different `zMm`. Seeded devices
  are 85 mm tall; widths 17.5–70 mm.
- `src/lib/circuit-warnings.ts` already warns `bars_missing`, `bar_terminals_insufficient`,
  `entry_side_not_in_cabinet`.
- Wire colour tokens `--wire-pe/n/l1/l2/l3` exist in `src/styles/global.css` (S-10).
- Infrastructure risk register (`context/foundation/infrastructure.md:150-155`): server-side scoring
  could hit the Worker's 10 ms CPU limit.
- Test plan risk #4 (`context/foundation/test-plan.md:43, 59`): the proof is unit tests on layout
  invariants, never an SVG snapshot.

## Desired End State

After a successful match, the project page shows a new "Układ w szafce" section: the cabinet drawn
large with every matched device on its rail, grouped by RCD, the wires (circuit cables in, WLZ to the
main switch, feeds between devices) drawn with sag, and a table of conductor lengths per
cross-section including 15% slack. The aside thumbnail shows the devices too.

The section has exactly one state, derived on every render and only when the match is `current`:

| Layout state   | When                                                                   | Shown                                                      |
| -------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------- |
| `placed`       | stored placements cover the snapshot exactly and pass `validateLayout` | drawing + wires + lengths                                  |
| `missing`      | no placements stored, and a proposal fits                              | info + "Zaproponuj układ" button                           |
| `does_not_fit` | the devices cannot be placed on this cabinet's rails                   | error with required vs available modules (TE) — no drawing |
| `outdated`     | placements stored but incomplete or failing validation                 | warning "Układ nieaktualny" + "Zaproponuj układ ponownie"  |
| (none)         | match state is not `current`                                           | note pointing to the match result above; no device drawing |

The admin device editor has an "N terminal side" field (lewa/prawa) for devices whose poles carry N.
The landing hero's drafting sheet shows a demo layout with wires. PRD Open Question #2 is recorded
as resolved; roadmap S-05 no longer carries its blocker note.

Verify with: lint, `astro check`, `test:unit`, `test:integration`, build, and a browser walkthrough
of all three seed cabinets plus each layout state.

### Key Discoveries:

- `project_devices` rows are replaced on every circuit save (`20260930120000_rcd_group_margin.sql:120-137`),
  so placements keyed to `project_devices.id` disappear with them by `on delete cascade` — exactly
  the "new match → new proposal" semantics wanted, as long as the same RPC call re-inserts them.
- The RPC inserts devices with `with ordinality`; placements can be passed in the same JSON items and
  inserted from the same rows (`returning id` joined on position), keeping one transaction.
- A stored snapshot is not proof of validity (AGENTS.md tripwire on `project_devices`); the same
  applies to placements — render-time validation is mandatory.
- Devices (85 mm) are taller than a rail (35 mm); a device centred on its rail extends 25 mm above
  and below. Seed rail pitches (120 mm in (b), 150 mm in (c)) leave room, but nothing checks it today.
- `demo-cabinet.ts:9` comment says "18 mm" modules; `DIN_MODULE_MM` is 17.5 — fix the comment when
  touching the demo.

## What We're NOT Doing

- Manual layout editing (S-06) — no drag, no UPDATE grant on placements, no persistence of edits
  across re-matches.
- A global optimiser or solver (PRD `## Non-Goals`); the heuristic is greedy and deterministic.
- Selecting PE/N bars or comb busbars from the catalog; feeds are drawn as wire jumpers.
- Phase balancing: single-phase circuits are drawn on L1 colour; no L1/L2/L3 allocation.
- Cable lengths in the quote (S-08 has no cable item; the length table is informational).
- A WLZ entry-side field: the WLZ is assumed to enter through the cabinet's first entry
  (`geometry.entries[0]`), stated in the UI note.
- A reserve-percentage capacity rule; only the per-rail 1-module gap.
- Vertical rails, multi-cabinet projects, 3D (parked).
- Changing device matching: the N-terminal side never affects which device is picked.
- Server-side PDF or print styles (S-09).

## Implementation Approach

Bottom-up, each phase green on its own:

0. Pipeline ordering first (migrate → deploy), so no later phase depends on winning a race.
1. Catalog data first (N side), because the snapshot, the layout's rule 3 and the wiring read it.
2. The placement logic as pure functions with invariant tests — the north-star risk is tested
   before anything is stored or drawn.
3. Storage and write path, atomically with the match.
4. Drawing and page states.
5. Wires and lengths, as a pure routing module over a valid layout.
6. Landing, docs, roadmap/PRD closure.

The layout and wiring run server-side on render (SSR), like the matcher. They are O(devices × rails)
greedy passes over ≤ 60 circuits; Phase 3 measures the worst case against the Worker CPU budget.

### Precedence and placement rules (the decision record S-06 and reviewers rely on)

- **Blocks.** The main switch is its own block. Each non-empty RCD group is one block: its RCD (or
  RCBO, or the RCD of an RCBO fallback) first, then its MCBs in circuit order, all contiguous.
  Ungrouped MCBs form one block. Block order of devices inside a block follows the snapshot order.
- **Rule 1 (hard).** A block occupies one rail, contiguous. It continues onto the next rail in the
  same rail order **only** when it is wider than every rail; otherwise it is never split.
- **Rule 2 (orders blocks).** A group's side is the entry side most of its circuits use; a tie goes
  to the side of the earliest circuit in group order; a side the cabinet has no entry on is skipped
  in favour of the next-most-common side; with no usable side the block is treated as `top`. Rails
  are ranked per side: `top` → rails by ascending `yMm`; `bottom` → descending `yMm`; `left`/`right`
  → by vertical distance from the rail centre to the midpoint of that side's entries. Within a rail,
  `left` blocks fill from the rail start, `right` blocks from the rail end.
- **Rule 3 (tie-break only).** For `top`/`bottom` blocks the fill direction within a rail, and any
  tie between equally ranked rails, goes to the end/rail with the smaller score: **N term** — the
  distance from the block's line-side N terminal to the nearest N-bar terminal group, measured on
  the conductors Phase 5 actually routes (an RCD group: its RCD's line-side N; an RCBO block: the
  RCBO's N; the ungrouped block: each N-carrying MCB's N, plus each 1P circuit's N, which also goes
  to the N bar) — plus **PE term** — the block's centre to the PE bar. The PE term is a declared
  proxy, not a routed conductor (circuit PE runs entry → PE bar and touches no device): it is kept
  because PRD `## Business Logic` rule 3 names both bars, and it keeps groups from drifting away
  from where their PE conductors land. Terminal x positions come from one shared helper
  (`deviceTerminals(device, rect)` in `src/lib/cabinet-layout.ts`, from poles + `n_terminal_side`),
  which Phase 5's wiring reuses. With no bars (or both ends/rails scoring equally), fill from the
  rail start and take the earlier rail. (Plan review F3, 2026-10-06.)
- **Placement order.** Main switch first, on the rail ranked first for the side of `entries[0]`, at
  the end of that rail nearest the entry; then group blocks in stored group order; then the ungrouped
  block, ranked by its own majority side.
- **Fit.** A block goes on the first rail in its ranking with enough contiguous free length (packed
  widths). If no rail fits it (and it is not wider than every rail), the layout is `does_not_fit`.
  A device also must fit vertically: centred on its rail, its rect must stay inside the interior and
  must not overlap a bar or a device on another rail; a rail failing that for a device is not a
  candidate. "Another rail" means any rail other than the device's own — the check is plain rect
  overlap, so two rails in the same row (seed (c)'s split row) conflict only where their device rects
  actually overlap in x. The bar check is 2D (front view) and ignores `zMm`.
- **Gaps.** After assignment, on each rail whose free length is ≥ 1 TE (17.5 mm) × (blocks on the
  rail − 1), one 1-TE gap goes between adjacent blocks; a rail without room for all its gaps stays
  packed. Gaps never cause `does_not_fit`. Each block keeps its anchor end — blocks filled from the
  rail start (and the main switch, if it sits there) stay flush with the start, blocks filled from
  the rail end stay flush with the end — and every gap opens toward the rail's free middle: start-side
  blocks shift toward the end, end-side blocks toward the start. The free middle shrinks; no block
  changes its order.
- **Shortfall.** `does_not_fit` reports total required modules and total rail modules (TE, via
  `src/lib/din-module.ts`) and the first block that did not fit.

## Phase 0: One pipeline — migrate, then deploy

### Overview

Today `db-migrate.yml` (GitHub Actions) and Cloudflare Workers Builds fire on the same push with no
ordering. Phase 1 adds a parameter the new parser requires: if the Worker wins the race, `select("*")`
rows lack `n_terminal_side`, `parseDeviceSpec` reports `required`, and `activeCatalog` silently drops
every N-carrying device (all RCD/RCBO, FR 2P/4P) — the matcher shows catalog gaps and a circuit save
in that window stores an empty snapshot. Fix it systemically: deploy from Actions, after the
migration. User decision 2026-10-06 (plan review F1).

### Changes Required:

#### 1. Workflow

**File**: `.github/workflows/db-migrate.yml` (rename to `deploy.yml` if the name no longer fits)

**Intent**: One workflow on push to `master`: `migrate` (unchanged) → `deploy` (`needs: migrate`)
running `npm ci && npm run build && npx wrangler deploy`.

**Contract**:

- Secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit scope) and `CLOUDFLARE_ACCOUNT_ID` in GitHub;
  `SUPABASE_DB_PASSWORD` stays in GitHub only — the reason the workflow comment gives for not
  migrating from Workers Builds still holds.
- `deploy` waits for the `ci` job too (a `workflow_run` on CI, or the CI steps inlined before
  deploy) — a red CI no longer ships.
- The Worker name stays `rozdzielnica-pro` (AGENTS.md tripwire); runtime secrets stay Workers Secrets.
- Rewrite the header comment: ordering is now guaranteed; what remains is the deploy-length window
  where the **old** code runs on the **new** schema, so migrations must stay compatible with the
  deployed code (backward-compatible), not forward-compatible with code that isn't live yet.

#### 2. Cloudflare dashboard (manual, one-time)

**Intent**: Turn off the Workers Builds auto-deploy on `master` so only Actions deploys; keep the
connection or remove it — never both deploying.

#### 3. Docs

**Files**: `AGENTS.md` (Environment/CI paragraph, Tripwires), `README.md` (`## Deployment`, `## CI`),
`context/foundation/infrastructure.md`, `context/changes/deployment/deployment-plan.md`

**Intent**: Replace "races the Cloudflare deploy" with the ordered pipeline and the new
backward-compatibility rule; document the two secrets and the dashboard step.

### Success Criteria:

#### Automated Verification:

- Workflow file is valid YAML and lint passes: `npm run lint`
- A push to `master` shows `migrate` then `deploy` in order, both green: `gh run list --workflow db-migrate.yml`

#### Manual Verification:

- Workers Builds no longer deploys on push (Cloudflare dashboard → Deployments shows only the Actions deploy)
- Live app still works after the Actions deploy: `npx wrangler deployments list` shows the new version and sign-in works

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to the next phase.

---

## Phase 1: N-terminal side in the catalog

### Overview

Record on which side (left or right, viewed from the front) a device's N pole sits, guarded twice
like every other device parameter, and copy it into the project snapshot.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261006120000_device_n_terminal_side.sql`

**Intent**: Add the enum and column, extend the per-kind CHECK, backfill existing rows, and carry the
value into `project_devices` through the snapshot trigger.

**Contract**:

- New enum `public.n_terminal_side` (`left`, `right`); column `devices.n_terminal_side` nullable.
- `devices_parameters_match_kind` is dropped and recreated: `n_terminal_side` is NOT NULL exactly
  when `poles` ∈ {`1P+N`, `2P`, `3P+N`, `4P`} (any kind), and NULL for `1P`, `3P` and for bars.
- Backfill: existing N-carrying rows get `left` before the CHECK is re-added. With Phase 0 the
  migration always lands before the new Worker, so the new parser never meets a row without the
  column. What remains: for the deploy's length the **old** editor cannot create an N-carrying
  device (the CHECK wants a side it doesn't send). Accepted — admin-only, a deploy-length window;
  ship migration and editor in the same push and say so in the commit.
- `project_devices.n_terminal_side` snapshot column; `project_devices_snapshot_device` copies it
  (add it to both the trigger's `select` list and its `into new.*` list).
- Existing snapshots are **not** backfilled (user decision 2026-10-06, plan review F2): production
  has no projects, and the local stack is reset. Before the Phase 1 push, check production through
  the Supabase MCP (`select count(*) from public.project_devices`); if any rows exist, run
  `truncate public.project_devices` — the affected projects then read "not matched" (`cleared`)
  until the electrician re-matches. Contract from then on: the layout and wiring never see NULL
  `n_terminal_side` on N-carrying poles; `LayoutDevice` may still type it nullable and throw on
  that case as a bug, not a state.
- Keep `devices_kind_immutable` untouched.

#### 2. Spec and parser

**File**: `src/lib/device-spec.ts` (+ `device-spec.test.ts`)

**Intent**: Mirror the CHECK: a new `N_TERMINAL_SIDES` list with a `database.types` sync assertion,
`n_terminal_side` in `DEVICE_PARAMETERS`, required/forbidden by poles rather than by kind.

**Contract**: `parseDeviceSpec` reports `required` when an N-carrying pole set lacks it and
`foreign_parameter` when 1P/3P/bars carry it; `deviceSpecSchema` per kind accepts `left | right | null`
refined by poles. New issue codes only if an existing one cannot express it.

#### 3. Admin form, draft, editor, summary, i18n

**Files**: `src/lib/device-form.ts`, `src/lib/device-draft.ts`, `src/components/devices/DeviceEditor.tsx`,
`src/lib/device-summary.ts`, `src/lib/i18n/pl.ts` (+ tests beside each)

**Intent**: A "Strona zacisku N" toggle (Lewa / Prawa) shown when the chosen poles carry N; the
catalog summary appends it (e.g. "N z lewej").

**Contract**: form field `n_terminal_side`; Polish labels under `t.devices`. New UI state first on
`/dev/kitchen-sink` (AGENTS.md UI rule).

#### 4. Seed, types, matcher fixtures

**Files**: `supabase/seed.sql`, `src/lib/database.types.ts` (`npm run db:types`),
`src/lib/kitchen-sink-circuits.ts` (device rows and `SnapshotRow` fixtures), and every other place
that builds a device row or a snapshot row: `src/lib/device-matching.test.ts`,
`src/lib/device-matching.property.test.ts`, `src/lib/device-matching-server.test.ts`,
`src/lib/device-draft.test.ts`, `src/lib/device-form.test.ts`, `src/lib/device-summary.test.ts`,
`tests/integration/rls-circuits.test.ts` (inserts devices and calls `save_project_circuits` with its
own payload); the admin device routes `src/pages/admin/devices/[id].astro`,
`src/pages/api/admin/devices/index.ts`, `src/pages/api/admin/devices/[id]/index.ts` must carry the
new field through form → `parseDeviceSpec` → insert/update

**Intent**: Seed sets the side deliberately (mix of left and right across manufacturers so the
drawing shows both); fixtures gain the field so `activeCatalog` keeps parsing them.

**Contract**: `activeCatalog` must not start dropping fixture rows — the matcher's property and
oracle tests stay green unchanged in behaviour.

#### 5. RLS/integration

**File**: `tests/integration/rls-devices.test.ts`

**Intent**: Assert the CHECK: N-carrying device without a side is refused; a 1P device with a side
is refused; snapshot copies the side.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh local stack: `npx supabase db reset`
- Types regenerated and committed: `npm run db:types` shows no further diff
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Integration tests pass: `npm run test:integration`
- Build passes: `npm run build`

#### Manual Verification:

- Admin can set and change the N side on a 2P RCD; the field is absent for a 1P MCB and for bars
- Catalog list shows the N side in the parameter summary
- Kitchen sink shows the new editor field states

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to the next phase.

---

## Phase 2: Placement logic (pure)

### Overview

`proposeLayout` and `validateLayout` as pure, deterministic functions implementing the precedence
record above, with invariant tests.

### Changes Required:

#### 1. Layout module

**File**: `src/lib/cabinet-layout.ts`

**Intent**: Turn a matched snapshot plus groups, circuits and the cabinet geometry into placements,
or a typed failure; and check any placement set against the same invariants.

**Contract**:

- `LayoutDevice` = snapshot fields the layout needs (`id`, `role`, `rcd_group_id`, `circuit_id`,
  `kind`, `width_mm`, `height_mm`, `poles`, `n_terminal_side`, `position`).
- `Placement` = `{ projectDeviceId, railIndex, xMm }` — `xMm` from the rail's start, 2 decimals.
- `proposeLayout(input): { ok: true; placements: Placement[] } | { ok: false; reason: LayoutFailure }`;
  `LayoutFailure` = `{ code: "does_not_fit"; requiredModules; availableModules; blockLabel }` (closed
  union, Polish messages via `layoutFailureMessage`).
- `validateLayout(devices, placements, geometry, groups): LayoutIssue[]` — issues: device not
  placed / placed twice / unknown device; outside its rail; overlapping another device on the rail;
  vertical collision with interior edge, bar or adjacent-rail device; a group's devices not
  contiguous (except the allowed wider-than-every-rail continuation); an RCBO-role device not alone
  in its group block.
- `deviceRect(placement, device, geometry)` exported for the drawing and wiring.
- `deviceTerminals(device, rect)` — line-side (top) and load-side (bottom) terminal x positions per
  pole, N placed by `n_terminal_side`; used by rule 3 here and by `cabinet-wiring.ts` in Phase 5.
- Constants named with sources: `GROUP_GAP_MM = DIN_MODULE_MM` (user decision 2026-10-06).

#### 2. Tests

**Files**: `src/lib/cabinet-layout.test.ts`, `src/lib/cabinet-layout.property.test.ts`

**Intent**: Oracles from the precedence record, not from the code (test-plan §2 #4).

**Contract**:

- Table tests per rule on the three seed geometries: top-entry groups on top rails in (b); bottom
  in (b)/(c); left-entry groups at rail starts in (c); majority side and tie by circuit order;
  FR on the rail nearest `entries[0]`; ungrouped block last; rule 3 decides direction in (c) and
  nothing in (a) (no bars); gap present only where the rail has room; a group wider than every rail
  continues onto the next rail on a multi-rail fixture; the same group on (a) (one rail) is
  `does_not_fit` with correct TE counts.
- Vertical-fit fixtures (hand-built — no seed rail ever rejects an 85 mm device, so the seed tables
  cannot reach this branch): a horizontal bar inside a rail's device band; a top rail closer than
  25 mm to the interior top edge; two rails at a pitch under 85 mm. Each makes that rail a
  non-candidate (the block moves to the next-ranked rail, or `does_not_fit` when none is left).
- Property test (fast-check, as in `device-matching.property.test.ts`): for random matched sets on
  each seed geometry, every `ok` proposal passes `validateLayout` with zero issues, and a proposal
  is deterministic (same input → same output).
- Validator negative cases: each issue code produced by a hand-built bad placement.

### Success Criteria:

#### Automated Verification:

- Unit and property tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to the next phase.

---

## Phase 3: Storage and write path

### Overview

Persist placements atomically with the match, clear them on a cabinet change, add a layout-only
re-propose action, and derive the page's layout state.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261006130000_project_device_placements.sql`

**Intent**: A placements table owned through the project, cleared on cabinet change, written by the
extended RPC.

**Contract**:

- `public.project_device_placements(project_device_id uuid pk references project_devices(id) on delete cascade,
project_id uuid not null (composite FK with project_devices, cascade), rail_index smallint >= 0,
x_mm numeric(7,2) >= 0, created_at)`.
- `project_devices` gains `project_devices_project_id_id_key unique (project_id, id)` — the target of
  the placements' composite FK `(project_id, project_device_id) references project_devices (project_id, id)
on delete cascade`, the same pattern as `rcd_groups_project_id_id_key` / `circuits_project_id_id_key`
  (today `project_devices` has only its PK).
- RLS on; policies `select_own`, `insert_own`, `delete_own` mirroring `project_devices` (owner via
  `projects`, insert/delete also `user_role = 'elektryk'`). Grants: select, insert, delete only —
  UPDATE is S-06's decision.
- `projects_clear_layout_on_cabinet_change` AFTER UPDATE trigger: when `cabinet_id` changes, delete
  the project's placements.
- `save_project_circuits` replaced (same name, `create or replace`) to accept optional
  `rail_index`/`x_mm` in each `p_device_ids` item and insert placements for the rows it just
  inserted; items without them insert no placement. Forward-compatible: old callers keep working.
  Shape: a writable CTE `with ins as (insert into project_devices … returning id, position)` and
  `insert into project_device_placements select … from ins join jsonb_array_elements(v_devices) with
ordinality e on ins.position = e.ordinality - 1` — never rely on RETURNING order. The function is
  `security invoker`, so the new table's insert policy and grant must admit the owner.
- New RPC `save_project_layout(p_project_id uuid, p_placements jsonb)` (security invoker): deletes
  the project's placements and inserts the given ones, refusing (P0002 `device_unavailable`-style
  machine message) any `project_device_id` not in the project.

#### 2. Server module

**File**: `src/lib/layout-server.ts` (+ test)

**Intent**: Load placements, compute the layout state, and shape RPC args — the layout counterpart of
`device-matching-server.ts`.

**Contract**:

- `LayoutViewState = "placed" | "missing" | "does_not_fit" | "outdated"`;
  `computeLayoutView(matchView, context, placements): LayoutView | null` — `null` unless
  `matchView.state === "current"`; `placed` only when placements cover the snapshot exactly and
  `validateLayout` returns no issues; `missing`/`does_not_fit` decided by running `proposeLayout`.
- `saveCircuitsArgs` gains an optional layout so each matched item carries `rail_index`/`x_mm`.
- `loadMatchContext` (or a sibling loader) also reads placements.

#### 3. Endpoints

**Files**: `src/pages/api/projects/[id]/circuits.ts`, `rematch.ts`, new `layout.ts`

**Intent**: After a `matched` result, run `proposeLayout` and pass placements to the RPC (a
`does_not_fit` result still stores the devices, with no placements); `layout.ts` re-proposes from
the stored snapshot via `save_project_layout`, refusing unless the match is `current`.

**Contract**: FormData + redirect with `?saved=layout#layout` / `?error=` codes, mapped in
`src/lib/project-errors.ts` with Polish text in `t.projectErrors`.

#### 4. Tests

**Files**: `tests/integration/rls-layout.test.ts`, `src/lib/layout-server.test.ts`; update
`tests/integration/rls-circuits.test.ts` (its direct RPC payload, with and without placement fields)
and `src/lib/device-matching-server.test.ts` (`saveCircuitsArgs` with a layout)

**Intent**: Another electrician cannot read/insert/delete placements; admin sees none; a cabinet
change clears placements; a circuit save replaces them; `save_project_layout` refuses a foreign
device id. Unit: every `LayoutViewState` from fixtures.

#### 5. CPU budget check

**Intent**: Measure `proposeLayout` + `validateLayout` on a 60-circuit, 20-group fixture in a unit
benchmark-style test (assert a generous wall-clock bound locally, log the number) and record the
result in the change notes against the 10 ms Worker budget.

### Success Criteria:

#### Automated Verification:

- Migration applies: `npx supabase db reset`
- Types regenerated: `npm run db:types`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Integration tests pass: `npm run test:integration`
- Build passes: `npm run build`

#### Manual Verification:

- Saving circuits on a seed (b) project stores placements (visible in Studio) in the same save
- Changing the project's cabinet clears placements and the page reports `missing`
- Worst-case layout timing recorded in `change.md` notes and within budget

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to the next phase.

---

## Phase 4: Drawing the layout

### Overview

Draw devices on the cabinet and add the "Układ w szafce" section with one message/action per state.

### Changes Required:

#### 1. Drawing layer

**Files**: `src/components/cabinets/CabinetDrawing.tsx`, `src/lib/cabinet-drawing.ts` (+ test)

**Intent**: An optional `devices` prop (precomputed device rects with label, role, group key, N
side) drawn inside the clipped SVG between bars and frame; group membership shown by a shared outline
or tint token; labels like "B16", "RCD 40A 30mA" from `device-summary`.

**Contract**: Stays hook-free and SSR-renderable; every colour a token (no palette classes, no hex);
new tokens added to `src/styles/global.css` if needed. Existing call sites unchanged.

#### 2. Project page section

**Files**: `src/pages/dashboard/projects/[id].astro`, new `src/components/projects/LayoutSection.astro`,
`src/lib/i18n/pl.ts`

**Intent**: New section `layout` ("Układ w szafce") after `circuits` in the nav; renders the state
table from Desired End State; the aside thumbnail passes devices when `placed`; a matching aside
badge row like the match one.

**Contract**: Polish strings under `t.layout`; the TE shortfall uses `plural()`; the WLZ-entry
assumption is a visible hint.

#### 3. Kitchen sink

**File**: `src/pages/dev/kitchen-sink.astro`, `src/lib/kitchen-sink-circuits.ts`

**Intent**: Every layout state (placed on (b)-like and (c)-like geometry, missing, does_not_fit,
outdated, not-current) rendered from real `computeLayoutView`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Build passes: `npm run build`

#### Manual Verification:

- On each seed cabinet (a), (b), (c) a matched project shows a layout that visibly follows rules 1–3
- Every layout state renders correctly on the project page and in the kitchen sink (screenshots)
- Drawing stays legible in greyscale (browser print preview)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to the next phase.

---

## Phase 5: Wires, slack and lengths

### Overview

Route the conductors over a valid layout, draw them with sag, and list lengths per cross-section.

### Changes Required:

#### 1. Wiring module

**File**: `src/lib/cabinet-wiring.ts` (+ tests)

**Intent**: Pure routing from geometry + placements + snapshot + circuits + supply to a list of
conductors, each with endpoints, an orthogonal path, routed length, slack and cross-section.

**Contract**:

- Conductors: **circuit cables in** — per circuit L (L1–L3 for three-phase) from its entry to its
  MCB/RCBO load-side (bottom) terminal, N and PE as below; **WLZ** — from `entries[0]` to the main
  switch line-side (top) terminals, its PE (or PEN) to the PE bar; **feeds** — main switch load side
  to each RCD/RCBO/ungrouped MCB line side, and each RCD's load side to its MCBs.
- N routing (domain rule, derived): a circuit in an RCD group takes N from that RCD's outgoing N
  terminal — never from the shared N bar, which would bypass the RCD and trip it; an RCBO/1P+N MCB
  circuit takes N from the device's own N terminal; an ungrouped 1P circuit's N goes to the N bar;
  the main switch's load-side N feeds the N bar, and the N bar feeds each RCD's line-side N.
- TN-C: no N conductors; each circuit's and the WLZ's PEN goes to the PE bar.
- Terminal x positions come from `deviceTerminals` (Phase 2); path runs vertically to
  the space above/below the rail, horizontally along it, then to the target (entry midpoint or the
  nearest terminal group on the bar). No bars → PE/N-bar conductors are omitted (the existing
  `bars_missing` warning already explains why).
- `WIRE_SLACK_RATIO = 0.15` — user decision 2026-10-06 (electrician's standard reserve), applied as
  `length = routed × (1 + WIRE_SLACK_RATIO)`; no minimum.
- Cross-sections: circuit conductors use the circuit's `cross_section_mm2`; WLZ uses
  `wlz_cross_section_mm2`; feeds use the WLZ cross-section (conservative: a feed may carry up to the
  main switch current).
- `wireLengthsBySection(conductors)` → total mm per cross-section and colour class.

#### 1a. CPU budget, second measurement

**Intent**: Repeat the Phase 3 timing over the full render path — `computeMatchView` +
`computeLayoutView` + routing — on the 60-circuit, 20-group fixture, and record it next to the
Phase 3 number. If it exceeds the budget, apply the fallback in `## Performance Considerations`.

#### 2. Drawing

**Files**: `src/components/cabinets/CabinetDrawing.tsx` (or a sibling `CabinetWires` layer),
`src/lib/cabinet-drawing.ts`

**Intent**: Render conductors as paths with sag: long horizontal runs become curves whose depth is
derived from the slack; colours from `--wire-*` tokens; a dash/pattern per conductor role so print in
greyscale stays readable.

#### 3. Lengths table

**File**: `src/components/projects/LayoutSection.astro`, `src/lib/i18n/pl.ts`

**Intent**: Under the drawing, a table: cross-section, conductor role (L/N/PE/PEN, feeds), total
length in metres with `formatNumber`, with a note that 15% slack is included and the routing is an
estimate.

#### 4. Kitchen sink

**Intent**: Wired layout on two geometries, TN-C variant, and a no-bars cabinet.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (routing invariants: every circuit has L/N/PE or PEN, N of grouped circuits ends
  at its RCD, lengths include exactly 15%): `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- Wires look like a real wired board on seed (b) and (c); greyscale print preview stays legible
- Length table totals plausible against a hand-measured route on one circuit
- Full render path (match + layout state + wiring) timed on the 60-circuit, 20-group fixture, recorded in `change.md` notes and within the 10 ms Worker CPU budget

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation before proceeding to the next phase.

---

## Phase 6: Landing, docs and closure

### Overview

Show the feature on the landing and record the decisions where future agents read them.

### Changes Required:

#### 1. Landing hero

**Files**: `src/components/brand/DraftingSheet.astro`, `src/lib/demo-cabinet.ts`, `src/components/Landing.astro`,
`src/lib/i18n/pl.ts`

**Intent**: The drafting sheet renders a demo layout (fixed demo devices + `proposeLayout`) with
wires, replacing or complementing the animated traces; copy updated; fix the "18 mm" comment.

#### 2. Docs

**Files**: `AGENTS.md`, `README.md`, `context/foundation/prd.md`, `context/foundation/roadmap.md`

**Intent**: AGENTS.md tripwires: N-side is guarded twice (CHECK + `parseDeviceSpec`, by poles);
placements are a snapshot read only through `computeLayoutView`; placements are written only by
`save_project_circuits` / `save_project_layout`; the precedence record lives in
`src/lib/cabinet-layout.ts`. PRD Open Question #2 moved to "Rozstrzygnięte" (1 > 2 > 3,
2026-10-06). Roadmap: S-05 unknowns/blocker note and Backlog Handoff updated, #15 removed from
`## Parked`; mirror with `node scripts/roadmap-to-github.mjs --apply` (Mr1008). README routes table.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Build passes: `npm run build`
- Roadmap sync applied: `node scripts/roadmap-to-github.mjs --apply`

#### Manual Verification:

- Landing hero shows the wired demo layout and reads well
- Smoke flow still passes against the dev server: `npm run smoke`

---

## Testing Strategy

### Unit Tests:

- `cabinet-layout`: per-rule tables on seed geometries; boundaries (block exactly filling a rail,
  gap exactly fitting, tie on majority side, both bars equidistant, no usable entry side); property
  test "every proposal validates" + determinism.
- `layout-server`: each `LayoutViewState`, and `null` for every non-`current` match state.
- `cabinet-wiring`: conductor set per circuit kind, N-through-RCD rule, TN-C PEN, no-bars omission,
  slack arithmetic.
- `device-spec`: N side required/forbidden by poles.

### Integration Tests:

- RLS on `project_device_placements`; cabinet-change clearing; replacement on circuit save;
  `save_project_layout` refusal; devices CHECK for N side.

### Manual Testing Steps:

1. Seed (b): circuits with top-entry and bottom-entry groups → top groups on upper rails, bottom on
   the lowest; FR on the top rail near the top entry.
2. Seed (c): a left-entry group sits at a rail start; bars decide direction for bottom groups.
3. Seed (a): 14+ modules of devices → `does_not_fit` with correct TE numbers.
4. Change cabinet → `missing` → "Zaproponuj układ" → `placed`.
5. Edit a catalog device used by the project → match `stale` → layout section shows the not-current
   note.

## Performance Considerations

Greedy placement and routing are linear-ish in devices × rails; measured in Phase 3 (layout) and
again in Phase 5 (full render path) against the Worker's 10 ms CPU budget (CPU time, not wall time).
Fallbacks, in order, if a measurement exceeds it:

1. Layout: compute proposals in the write path only (they are already stored) and keep render to
   `validateLayout`.
2. Wiring: move `cabinet-wiring.ts` routing and the wire layer to a client island (`client:idle`) fed
   the validated placements — it is display-only and decides nothing. The cost is a JS bundle, a
   hydration step and no wires without JS; S-09's print must then wait for the rendered SVG.

Never move to the client: `matchDevices` / `computeMatchView` (the guardrail), `validateLayout` and
the layout-state verdict, or `proposeLayout` in the write path — S-08/S-09 trust these on the server.
(Plan review F8, 2026-10-06.)

## Migration Notes

Phase 0 orders the pipeline (migrate → deploy), so new code never runs on the old schema. The
placements migration is compatible with the old code (the RPC's new item fields are optional). The
N-side migration is not: for the deploy's length the old editor cannot insert N-carrying devices —
accepted, shipped in one push with the editor. Existing cloud devices backfill to `left`;
the admin should review them. Existing projects get no placements until their next save/re-match or
"Zaproponuj układ".

## References

- Roadmap S-05: `context/foundation/roadmap.md`; PRD `## Business Logic`, Open Question #2
- S-04 archive: `context/archive/2026-09-29-circuit-input-and-device-matching/`
- Matcher and view: `src/lib/device-matching.ts`, `src/lib/device-matching-server.ts:208-258`
- RPC: `supabase/migrations/20260930120000_rcd_group_margin.sql:24-139`
- Drawing: `src/components/cabinets/CabinetDrawing.tsx`, `src/components/brand/DraftingSheet.astro:72-99`
- Seed cabinets: `supabase/seed.sql:86-165`
- Test plan risk #4: `context/foundation/test-plan.md:43, 59`
- GitHub #6, #15

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 0: One pipeline — migrate, then deploy

#### Automated

- [x] 0.1 Workflow file is valid YAML and lint passes: `npm run lint` — 53d96eb
- [x] 0.2 A push to `master` shows `migrate` then `deploy` in order, both green: `gh run list --workflow db-migrate.yml` — 53d96eb

#### Manual

- [x] 0.3 Workers Builds no longer deploys on push (Cloudflare dashboard → Deployments shows only the Actions deploy) — 53d96eb
- [x] 0.4 Live app still works after the Actions deploy: `npx wrangler deployments list` shows the new version and sign-in works — 53d96eb

### Phase 1: N-terminal side in the catalog

#### Automated

- [x] 1.1 Migration applies on a fresh local stack: `npx supabase db reset` — 95fe3e5
- [x] 1.2 Types regenerated and committed: `npm run db:types` shows no further diff — 95fe3e5
- [x] 1.3 Lint passes: `npm run lint` — 95fe3e5
- [x] 1.4 Type check passes: `npx astro check` — 95fe3e5
- [x] 1.5 Unit tests pass: `npm run test:unit` — 95fe3e5
- [x] 1.6 Integration tests pass: `npm run test:integration` — 95fe3e5
- [x] 1.7 Build passes: `npm run build` — 95fe3e5

#### Manual

- [x] 1.8 Admin can set and change the N side on a 2P RCD; the field is absent for a 1P MCB and for bars — 95fe3e5
- [x] 1.9 Catalog list shows the N side in the parameter summary — 95fe3e5
- [x] 1.10 Kitchen sink shows the new editor field states — 95fe3e5

### Phase 2: Placement logic (pure)

#### Automated

- [x] 2.1 Unit and property tests pass: `npm run test:unit` — e1b507f
- [x] 2.2 Lint passes: `npm run lint` — e1b507f
- [x] 2.3 Type check passes: `npx astro check` — e1b507f

### Phase 3: Storage and write path

#### Automated

- [x] 3.1 Migration applies: `npx supabase db reset` — 940e065
- [x] 3.2 Types regenerated: `npm run db:types` — 940e065
- [x] 3.3 Lint passes: `npm run lint` — 940e065
- [x] 3.4 Type check passes: `npx astro check` — 940e065
- [x] 3.5 Unit tests pass: `npm run test:unit` — 940e065
- [x] 3.6 Integration tests pass: `npm run test:integration` — 940e065
- [x] 3.7 Build passes: `npm run build` — 940e065

#### Manual

- [x] 3.8 Saving circuits on a seed (b) project stores placements (visible in Studio) in the same save — 940e065
- [x] 3.9 Changing the project's cabinet clears placements and the page reports `missing` — 940e065
- [x] 3.10 Worst-case layout timing recorded in `change.md` notes and within budget — 940e065

### Phase 4: Drawing the layout

#### Automated

- [x] 4.1 Lint passes: `npm run lint`
- [x] 4.2 Type check passes: `npx astro check`
- [x] 4.3 Unit tests pass: `npm run test:unit`
- [x] 4.4 Build passes: `npm run build`

#### Manual

- [x] 4.5 On each seed cabinet (a), (b), (c) a matched project shows a layout that visibly follows rules 1–3
- [x] 4.6 Every layout state renders correctly on the project page and in the kitchen sink (screenshots)
- [x] 4.7 Drawing stays legible in greyscale (browser print preview)

### Phase 5: Wires, slack and lengths

#### Automated

- [ ] 5.1 Unit tests pass (routing invariants: every circuit has L/N/PE or PEN, N of grouped circuits ends at its RCD, lengths include exactly 15%): `npm run test:unit`
- [ ] 5.2 Lint passes: `npm run lint`
- [ ] 5.3 Type check passes: `npx astro check`
- [ ] 5.4 Build passes: `npm run build`

#### Manual

- [ ] 5.5 Wires look like a real wired board on seed (b) and (c); greyscale print preview stays legible
- [ ] 5.6 Length table totals plausible against a hand-measured route on one circuit
- [ ] 5.7 Full render path (match + layout state + wiring) timed on the 60-circuit, 20-group fixture, recorded in `change.md` notes and within the 10 ms Worker CPU budget

### Phase 6: Landing, docs and closure

#### Automated

- [ ] 6.1 Lint passes: `npm run lint`
- [ ] 6.2 Type check passes: `npx astro check`
- [ ] 6.3 Unit tests pass: `npm run test:unit`
- [ ] 6.4 Build passes: `npm run build`
- [ ] 6.5 Roadmap sync applied: `node scripts/roadmap-to-github.mjs --apply`

#### Manual

- [ ] 6.6 Landing hero shows the wired demo layout and reads well
- [ ] 6.7 Smoke flow still passes against the dev server: `npm run smoke`
