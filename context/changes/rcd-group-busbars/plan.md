# RCD Group Comb Busbars Implementation Plan

## Overview

GitHub issue #17 (roadmap `## Parked`, idea from 2026-10-06 at S-05): comb busbars („listwy
zasilające / szyny grzebieniowe”), 1F and 3F, that connect an RCD's output to the inputs of the MCBs
in its group, instead of the wire jumpers drawn and counted today. This is how groups are mounted in
practice, so the drawing and the printout should look like a real switchboard. The jumpers a busbar
replaces should drop out of the wire lengths, and the busbar should be priced in the material.

The busbar becomes a new catalog device kind that the admin maintains. The matcher selects busbars
per RCD group, cutting offcuts from one bought piece for further groups with a greedy first-fit
decreasing pass. The pieces are snapshotted, the segments get no DIN-rail placement, and the router
replaces the phase jumpers with a drawn busbar. This widens the PRD's closed device-type list, so the
PRD, `AGENTS.md` and the roadmap change with it.

## Current State Analysis

### Matching and snapshot

- **Selection order.** `matchDevices` (`src/lib/device-matching.ts:320-487`) emits the main switch,
  then per group `[rcd, mcb…]` (or an RCBO, or an RCD+MCB fallback with note `rcbo_fallback`), then the
  ungrouped MCBs, then the catalog PE/N bars (`:465-483`). The array index becomes `position`.
- **Catalog bar precedent.** Catalog bars are filtered for correctness before price (`cheapest`,
  `:181-190`), and a miss is a gap.
- **Staleness.** `computeMatchView` (`src/lib/device-matching-server.ts:228-243`) re-runs the matcher
  on every render and compares element by element (`sameSelection`, `device-matching.ts:496-510`,
  notes included). Any matcher change therefore turns saved projects `stale`, which is the safe
  direction. `snapshotSelections` (`device-matching-server.ts:189-202`) drops rows whose role or note it
  does not know.
- **Role and notes guards.** `project_devices.role` is text plus `project_devices_role_valid`
  (`supabase/migrations/20261006140000_project_device_bars.sql:19-21`). `notes_valid` allows
  `rcbo_fallback` and `no_rcd` (`20260929120000_circuits_and_device_matching.sql:166-171`). The list
  `SELECTION_NOTES` is duplicated in `device-matching-server.ts:174`.
- **Placements.** `save_project_circuits` (latest version in
  `20261008120000_manual_layout_edits.sql:46-185`) inserts placements joined by position, and
  **already skips** elements without `rail_index`/`x_mm` (`:177-178`). An unplaced row is therefore
  storable as is.
- **Unparseable catalog rows.** `parseCatalog` (`device-matching-server.ts:82-91`) drops rows it
  cannot parse. A deployed old Worker meeting a `comb_busbar` catalog row ignores it.

### Device kind

- `public.device_kind` has never been altered (`20260923130628_devices_catalog.sql:21`).
  `devices_parameters_match_kind` was last restated in
  `20261006120000_device_n_terminal_side.sql:33-94`. It ends in `else false`, so a new kind needs its
  own branch.
- The TypeScript mirror is in `src/lib/device-spec.ts`: `DEVICE_KINDS :22`, `POLES_BY_KIND :58-65`,
  `PARAMETERS_BY_KIND :82-89`, the zod union `:201-250`, `KIND_LABEL_KEYS :410-417` and
  `_DeviceKindInSync :52`.
- Hard-coded bar checks: `device-draft.ts:48-50` (`isBarKind`) and
  `src/pages/admin/devices/index.astro:52`. The device editor gates poles and terminal groups on them
  (`src/components/devices/DeviceEditor.tsx:371,469`).
- `device-summary.ts:17-50` has an exhaustive switch.
- Tests that pin the kind list: the seed test `"contains all six kinds"` and `VALID_PARAMETERS` in
  `tests/integration/rls-devices.test.ts:39,317,387-390`, and the `VALID` record in
  `src/lib/device-spec.test.ts:42-75,89,95-99`.

### Layout

- Every snapshot row is expected to be placed: `validateLayout` raises `device_not_placed`
  (`src/lib/cabinet-layout.ts`, around `:934`). There is no "accessory" concept.
- `buildBlocks` puts the RCD/RCBO first in a group block (`blockOrder`).

### Wiring

- **RCD → MCB jumpers.** `routeConductors` (`src/lib/cabinet-wiring.ts:2115`) emits one `feed`
  conductor per MCB supply-edge terminal, from the RCD's out-edge terminal of the same pole
  (`:2304-2319`), at the WLZ cross-section.
- **Phase fallback.** `sourceTerminal` (`:1947-1953`) falls back L → L1, so every 1P MCB in a 3F
  group is fed from L1 today.
- **Edges.** The group's out edge is `supplyEdges` (`:2174-2197`): the RCD's out edge equals the MCBs'
  supply edge.
- **Header comment.** `:50-51` already says "Comb busbars would later replace the jumpers".
- **Island input.** It is a whitelist (`toWiringData`, `src/lib/wiring-island.ts:58-92`). The wire
  lengths aggregate feeds under the WLZ cross-section (`wireLengthsBySection`, `:2467`).

### Quote

- `deviceCount = snapshot.length` and `devicesGrosze = Σ price` (`src/lib/quote.ts:123-125`).
- `materialLines` groups the rows by `(device_id, price)` and must sum to `devicesGrosze`
  (`src/lib/quote-print.ts:66-123`).

## Desired End State

- The admin adds "Listwa zasilająca (grzebieniowa)" devices: 1F or 3F, a rated current, and a length
  in TE (= pin count), at a price per piece.
- For each RCD group with a separate RCD and at least 2 MCBs, the electrician sees a busbar in the
  match result.
  - The busbar is the cheapest compliant one: phases match the group, In ≥ the group RCD's In, and its
    length ≥ the group's width in TE.
  - The busbar is cut from the leftover of another group's piece whenever that leftover fits.
  - A group with a single MCB gets a busbar only from a leftover.
  - A group with no compliant busbar keeps its wire jumpers and shows an informational note. A group
    wider than every rail does the same.
- In the layout of a busbar group, the RCD stands at the group end that puts its N terminal on the
  outside. A manual edit may still move the RCD.
- The drawing shows the busbar along the RCD and MCB terminals, with a tooth at every phase terminal it
  feeds. On a 3F busbar, the 1P MCBs take the phase of their pin. This applies to the realistic and the
  schematic variants, the printout and the editor's saved view.
  - The phase jumpers it replaces are gone from the drawing and from „Długości przewodów”.
  - N jumpers to MCBs that carry N remain.
- The quote prices each bought piece once. Each segment counts as a device in labour.
- Saved projects read "Nieaktualny" until "Dobierz ponownie".

Verify with `npm run lint && npx astro check && npm run test:unit && npm run build`,
`npm run test:integration` against a local stack, and a browser walk through
admin → project → match → layout → quote → print.

### Key Discoveries:

- `save_project_circuits` skips elements without `rail_index` — unplaced snapshot rows need no new placement mechanism (`20261008120000_manual_layout_edits.sql:177-178`).
- Staleness is a full re-match compared element by element — appending busbar selections at the **end** of the list keeps every earlier index (and existing test expectations) stable (`device-matching.ts:496-510`).
- 3F phase naming is relative to the RCD feeding the busbar, so an offcut's phase rotation does not matter — no "cut at a multiple of 3 pins" rule is needed.
- The old Worker drops unparseable catalog rows (`device-matching-server.ts:82-91`) and unknown snapshot roles (`:189-202`), so the migrations stay backward-compatible for the deploy window.

## What We're NOT Doing

- No busbars with N (L+N, 3F+N variants). N to MCBs that carry N stays a wire jumper.
- No busbar for main switch → RCD connections, for RCBOs, or for ungrouped MCBs.
- No busbar for a group wider than every rail (split across rails). That group keeps its jumpers.
- No exact cutting optimiser — greedy FFD only (PRD `## Non-Goals`: no combinatorial optimisation).
- No pricing per pin and no reuse of offcuts across projects. A piece is bought whole, and its unused
  remainder is waste.
- No busbar dragging in the layout editor. A busbar follows its group and is not a placement.
- No new guard requiring the busbar width to be a whole number of TE. The pin count is
  `floor(width_mm / DIN_MODULE_MM)`.
- No migration that rewrites existing snapshots. Projects go stale and are re-matched by the
  electrician.

## Implementation Approach

Five phases, in dependency order:

1. **The kind.** Usable by the admin, inert in the matcher.
2. **Matching, snapshot and quote.** Busbar segments exist in projects.
3. **Layout.** RCD orientation, and the segments excluded from placement.
4. **Wiring and drawing.** The busbar replaces the phase jumpers.
5. **Close-out.** Kitchen sink, landing page and docs.

The new behaviour lives in a new pure module, `src/lib/busbar-cutting.ts`. It is called from
`matchDevices`, so the matcher, the staleness check and `saveCircuitsArgs` keep one source of truth.

## Critical Implementation Details

- **Enum value in its own migration.** Postgres refuses a new enum value inside the transaction that
  added it. `alter type public.device_kind add value if not exists 'comb_busbar'` therefore goes in its
  own migration file, before the file that restates the CHECK and seeds or uses the value. Every
  statement must be re-runnable, and each migration must stay backward-compatible with the deployed
  code (`AGENTS.md`, Environment).
- **Busbar rows carry `rcd_group_id`.** Every group-membership check would count them unless it
  excludes `role = 'busbar'`: `buildBlocks`, `validateLayout` (coverage and `group_not_contiguous`),
  `groupContiguous`, `layout-editor-data`, `layout-editing` and `deviceCount` labels. This is the main
  trap of the change.
- **Selection positions.** Busbar selections are appended after the catalog PE/N bars, never inserted
  next to their group. Layout arrays aligned by selection index (`selectionLayoutDevices`,
  `saveCircuitsArgs`) then simply carry `null` placements for them.

## Phase 1: Busbar device kind in the catalog

### Overview

The admin can create, edit, archive and restore comb busbars. Both guards (CHECK and
`parseDeviceSpec`) accept exactly the same rows. The seed carries four busbars. The PRD, `AGENTS.md` and
the roadmap reflect the widened device list. The matcher ignores the kind for now.

### Changes Required:

#### 1. Enum value

**File**: `supabase/migrations/20261009120000_comb_busbar_kind.sql` (new)

**Intent**: Add the kind in a migration of its own, because the value cannot be used in the same
transaction.

**Contract**: `alter type public.device_kind add value if not exists 'comb_busbar';` and nothing else.
The header comment explains the split.

#### 2. Kind CHECK

**File**: `supabase/migrations/20261009120100_comb_busbar_parameters.sql` (new)

**Intent**: Restate `devices_parameters_match_kind` with a `comb_busbar` branch, the same way
`20261006120000_device_n_terminal_side.sql` restated it.

**Contract**: The new branch requires `poles in ('1P','3P')` (1P = 1F busbar, 3P = 3F busbar) and
`rated_current_a`. It requires null for `residual_current_ma`, `rcd_type`, `breaking_capacity_ka`,
`terminal_groups` and `n_terminal_side`. The trailing N-side conjunct still holds, because neither pole
set carries N. The statements are `drop constraint if exists` followed by `add`.

#### 3. TypeScript guard

**File**: `src/lib/device-spec.ts`

**Intent**: Mirror the CHECK exactly.

**Contract**:

- `DEVICE_KINDS` gains `"comb_busbar"`, placed after `mcb_b` so it sits next to the protection devices
  in display order.
- `POLES_BY_KIND.comb_busbar = ["1P", "3P"]`.
- `PARAMETERS_BY_KIND.comb_busbar = ["poles", "rated_current_a"]`.
- The zod union gets a new branch.
- `KIND_LABEL_KEYS` gets a new entry.
- Export `isCombBusbarKind` and `busbarPins(widthMm) = floor(widthMm / DIN_MODULE_MM + 1e-9)`.
- Update the header comment ("closed MVP set").

#### 4. Admin editor, list and summaries

**Files**:

- `src/lib/device-draft.ts`
- `src/lib/device-form.ts`
- `src/lib/device-summary.ts`
- `src/components/devices/DeviceEditor.tsx`
- `src/pages/admin/devices/index.astro`
- `src/pages/admin/devices/[id].astro`

**Intent**: The editor shows phases (as "1F / 3F", not "1P / 3P"), the rated current and the width in
TE for a busbar, with a hint that the width is the busbar's length in pins. The catalog list summarises
a busbar as e.g. "3F, 63 A, 12 pinów".

**Contract**:

- `isBarKind` stays limited to the PE/N bars.
- The pole selector is labelled with phases for `comb_busbar` (new i18n keys).
- `deviceParameterSummary` gets a `comb_busbar` case.
- New i18n keys:
  - `devices.kinds.combBusbar` ("Listwa zasilająca (grzebieniowa)");
  - `devices.summary.busbar`;
  - editor hints for phases and pins;
  - `devices.busbarPhases` (1F/3F labels).

#### 5. Seed and types

**Files**: `supabase/seed.sql`, `src/lib/database.types.ts` (regenerated via `npm run db:types`)

**Intent**: Four busbar rows for local and CI use: 1F 12 pins, 1F 54 pins, 3F 12 pins and 3F 54 pins.
All are 63 A, with sample prices.

**Contract**: Widths are 210 mm and 945 mm. Every seed row passes `parseDeviceSpec`.

#### 6. Tests

**Files**:

- `src/lib/device-spec.test.ts`
- `src/lib/device-form.test.ts`
- `src/lib/device-draft.test.ts`
- `src/lib/device-summary.test.ts`
- `tests/integration/rls-devices.test.ts`
- the `Record<DeviceKind, …>` fixtures in `src/lib/wiring-bench-fixtures.ts` and
  `src/lib/kitchen-sink-circuits.ts`

**Intent**: Cover the new kind in both guards and keep the exhaustive records compiling.

**Contract**:

- `VALID_PARAMETERS` and `VALID` get a busbar entry.
- The seed test counts seven kinds.
- Pole cases: `2P` and `4P` are rejected for a busbar in both guards.

#### 7. Product docs and roadmap

**Files**:

- `context/foundation/prd.md`
- `AGENTS.md`
- `context/foundation/roadmap.md`

**Intent**: Record the decision to widen the closed list, with today's date.

**Contract**:

- **PRD `## Non-Goals`.** The bullet gains "listwy zasilające (grzebieniowe) 1F/3F do zasilania grup
  RCD". A dated line goes under "Rozstrzygnięte przy walidacji". The existing 2026-09-16 entry is not
  rewritten.
- **`AGENTS.md`.** The "MVP device types are closed" line lists the busbar.
- **Roadmap.**
  - Add slice **S-12 `rcd-group-busbars`** (issue #17): Prerequisites S-11, Status `in-progress` from
    this phase on.
  - Add a row to `## At a glance` and to the Backlog Handoff.
  - Remove the entry from `## Parked`.
  - Mirror to GitHub with `node scripts/roadmap-to-github.mjs --apply` under the `Mr1008` account,
    dispatched to a cheap-model subagent in the same turn.

### Success Criteria:

#### Automated Verification:

- Migrations apply on a clean local stack: `npx supabase db reset`
- Types regenerate and `_DeviceKindInSync` holds: `npm run db:types && npx astro check`
- Unit tests pass: `npm run test:unit`
- RLS/catalog integration tests pass, including a busbar row and the seven-kind seed: `npm run test:integration`
- Lint and build pass: `npm run lint && npm run build`

#### Manual Verification:

- In `/admin/devices` the admin creates, edits, archives and restores a 3F busbar; the form shows phases, current and width in TE only, and the list shows the busbar summary
- A busbar with 2P poles or a residual current is refused with a Polish message on the field
- Roadmap S-12 appears on the GitHub board and #17 is no longer `odłożone`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Busbar selection, cutting and quote

### Overview

The matcher selects busbar segments per group with a greedy first-fit decreasing cut. The selections
are snapshotted as unplaced `busbar` rows with a piece number. The match result lists them. The quote
prices each piece once and counts each segment in labour.

### Changes Required:

#### 1. Cutting module

**File**: `src/lib/busbar-cutting.ts` (new) + `busbar-cutting.test.ts` + `busbar-cutting.property.test.ts`

**Intent**: A pure, deterministic cut plan from the groups' busbar demands and the catalog.

**Contract**:

- **Input.** For every RCD group with a matched separate RCD, a demand
  `{ groupId, mcbCount, phases: 1 | 3, minRatedA: <the group RCD's rated_current_a>, pins: ceil(groupWidthMm / DIN_MODULE_MM) }`.
  - `groupWidthMm` is the summed catalog width of the group's RCD and MCBs.
  - The phases are 3 when the group RCD is 4P, otherwise 1.
- **Exclusions.** A group with `groupWidthMm > maxRailMm` is excluded with reason `group_too_wide`.
- **Pass 1.** Demands with `mcbCount ≥ 2`, sorted by pins descending; ties go to the stored group order.
  1. Take the first open piece, in piece-number order, with the same phases, the piece's
     `rated_current_a ≥ minRatedA` and remaining pins ≥ the demand's pins.
  2. Otherwise buy the cheapest compliant catalog busbar. Compliant means the same phases,
     In ≥ minRatedA and `busbarPins(width) ≥ pins`, filtered before price, with the matcher's
     `cheapest` tie-break.
  3. Nothing compliant gives reason `busbar_missing`.
- **Pass 2.** Demands with `mcbCount === 1` (including the RCBO fallback), in the same order, try open
  pieces only. A miss adds no reason.
- **Output.** Segments `{ groupId, deviceId, piece }` (piece is 0-based within the project) and
  per-group reasons.
- **Guardrail.** A segment never comes from a busbar below the group RCD's In, whether bought or an
  offcut. The property test asserts this.

#### 2. Matcher integration

**File**: `src/lib/device-matching.ts`

**Intent**: Call the cutter after all other selections, and append one `busbar` selection per segment
after the catalog bars. Attach the reasons as notes on the group's RCD selection.

**Contract**:

- `SelectionRole` gains `"busbar"`, with the role label key.
- `Selection` gains `busbarPiece: number | null`, which `sameSelection` compares.
- `SelectionNote` gains `busbar_missing` and `busbar_group_too_wide`.
- `MatchInput` gains `maxRailMm: number | null`. Null means no geometry: no busbars and no notes.
- A busbar miss is **never** a `CatalogGap`; the result stays `matched`.
- Busbar selections carry `rcdGroupId` and `circuitId: null`.

#### 3. Server side

**File**: `src/lib/device-matching-server.ts`

**Intent**: Pass `maxRailMm` from the cabinet snapshot geometry. Read `busbar_piece` in
`snapshotSelections`. Send it in `saveCircuitsArgs`, and send a busbar element with no
`rail_index`/`x_mm`.

**Contract**:

- `SELECTION_NOTES` mirrors the new notes.
- The `busbar` role is in `SELECTION_ROLES`.

#### 4. Snapshot migration

**File**: `supabase/migrations/20261009120200_project_device_busbars.sql` (new)

**Intent**: Store busbar segments.

**Contract**:

- `project_devices_role_valid` gains `'busbar'`.
- New column `busbar_piece smallint null`, with CHECK `(busbar_piece is not null) = (role = 'busbar')`
  and `busbar_piece >= 0`.
- `notes_valid` gains `busbar_missing` and `busbar_group_too_wide`.
- `create or replace` of `save_project_circuits` inserts `busbar_piece` from `e.value ->> 'busbar_piece'`.
  An old caller sends none, which is valid for non-busbar rows.
- Grants are repeated.
- The snapshot trigger needs no change, because the busbar's catalog columns are already copied.

#### 5. Quote and printout

**Files**: `src/lib/quote.ts`, `src/lib/quote-print.ts`

**Intent**: Price a piece once and count every segment in labour.

**Contract**:

- `devicesGrosze` sums one price per distinct `(device_id, busbar_piece)` for busbar rows, and the full
  price for every other row.
- `deviceCount` stays the row count, so each segment counts once.
- In the print `materialLines`, the busbar line's quantity = the number of distinct pieces of that
  device.
- The sum invariant with `devicesGrosze` still throws on mismatch.
- The labels change:
  - `quote.devices` becomes "Aparaty (w tym szyny z katalogu i odcinki listew)";
  - the formula wording follows;
  - print item details name the pin count.
- Update the `AGENTS.md` quote tripwire: every snapshot row counts as a device, and a busbar piece is
  priced once.

#### 6. Match result UI

**Files**: `src/components/projects/MatchResult.astro`, `src/lib/i18n/pl.ts`

**Intent**: List each busbar segment with its group ("Grupa „Kuchnia”"), piece ("sztuka 1, odcinek 8
TE") and the catalog price shown once per piece. Show the two notes on the RCD row as informational
text, never as a gap.

**Contract**:

- New keys `matching.roles.busbar`, `matching.notes.busbarMissing`, `matching.notes.busbarGroupTooWide`
  and `circuitSection.busbarSegment(...)`.
- The aside's device count wording stays `plural` correct.

#### 7. Tests and fixtures

**Files**:

- `src/lib/device-matching.test.ts`
- `src/lib/device-matching.property.test.ts`
- `src/lib/device-matching-server.test.ts`
- `src/lib/quote.test.ts`
- `src/lib/quote-print.test.ts`
- `src/lib/kitchen-sink-circuits.ts`
- `tests/integration/rls-circuits.test.ts`

**Intent**: Pin the selection rules, the offcut reuse and the quote dedup.

**Contract**:

- Existing expectations stay unchanged when the catalog has no busbar. The catalog fixtures without a
  busbar row are the regression guard.
- New cases:
  - two 1F groups sharing one 54-pin piece;
  - a 1-MCB group served only from an offcut;
  - a 3F group never takes a 1F piece;
  - an under-rated busbar is never chosen, even when it is cheaper;
  - a too-wide group gets the note;
  - `busbar_missing`.
- The property test's reference model gains the busbar rule.
- The integration test covers inserting a busbar row with `busbar_piece` and rejecting
  `busbar_piece` on a non-busbar row.

### Success Criteria:

#### Automated Verification:

- Migration applies: `npx supabase db reset && npm run db:types`
- Unit and property tests pass: `npm run test:unit`
- Integration tests pass: `npm run test:integration`
- Type check, lint and build pass: `npx astro check && npm run lint && npm run build`

#### Manual Verification:

- A project with two 1F RCD groups shows busbar segments cut from one piece; the quote shows one piece in material and both segments counted in the labour formula
- A project saved before this phase reads "Nieaktualny" and becomes current after "Dobierz ponownie"
- With all busbars archived, the groups show the informational "brak listwy" note and matching is not blocked

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Layout with unplaced segments and RCD orientation

### Overview

The layout proposal, validation, editor and carry-over ignore busbar rows as placement subjects. In a
busbar group, the RCD sits at the end that puts its N terminal on the outside.

### Changes Required:

#### 1. Layout core

**File**: `src/lib/cabinet-layout.ts`

**Intent**: Exclude `role = 'busbar'` from blocks, from coverage (`device_not_placed`), from group
membership and from contiguity. Place the RCD for N-outward orientation in groups that have a busbar
segment.

**Contract**:

- Export `isBusbarRole`.
- In `blockOrder`, for a group whose devices include a busbar row, the RCD goes last when its
  `n_terminal_side` is `right`, and first otherwise. The MCBs keep snapshot order. Groups without a
  busbar are unchanged.
- Document this in the header under Rule 1 as an explicit rule (user decision 2026-10-09), not as a
  score.
- `validateLayout` does not require the orientation. A manual layout with the RCD at the other end stays
  valid; the drawing shows it.

#### 2. Server and editor plumbing

**Files**:

- `src/lib/layout-server.ts`
- `src/lib/layout-editor-data.ts`
- `src/lib/layout-editing.ts`
- `src/components/projects/LayoutEditor.tsx`
- `src/pages/api/projects/[id]/placements.ts`

**Intent**: Selection layouts carry `null` placements for busbar selections. The editor model never
lists busbar rows as draggable. The placements endpoint does not demand a placement for them.

**Contract**:

- `carryOverPlacements` matches devices ignoring busbar rows.
- If `save_project_layout` requires every device to be placed, its migration replacement accepts
  unplaced busbar rows. Check its body first; extend `20261009120200` only if it refuses them.

#### 3. Tests

**Files**:

- `src/lib/cabinet-layout.test.ts`
- `src/lib/cabinet-layout.property.test.ts`
- `src/lib/layout-server.test.ts`
- `src/lib/layout-editing.test.ts`

**Intent**: Pin the behaviour of busbar groups in the layout.

**Contract**:

- A busbar group with an RCD with its N on the right is proposed as `[MCB…, RCD]`.
- Busbar rows never yield `device_not_placed` or `group_not_contiguous`.
- The property test (all proposals validate) holds with busbars in the input.

### Success Criteria:

#### Automated Verification:

- Unit and property tests pass: `npm run test:unit`
- Integration tests pass: `npm run test:integration`
- Type check, lint and build pass: `npx astro check && npm run lint && npm run build`

#### Manual Verification:

- "Zaproponuj układ" for a project with busbar groups places each RCD with its N terminal at the outer end of its group
- Manual edit (move a group, move the RCD to the other end) saves without `layout_invalid`, and a re-match carries the manual layout over

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Busbar in the wiring and the drawing

### Overview

For each group with a busbar segment, the router emits a busbar instead of the RCD → MCB phase jumpers.
Each terminal on it takes the phase of its pin. The drawing renders it in both variants, on the
printout and in the editor's saved view, with a legend entry.

### Changes Required:

#### 1. Router

**File**: `src/lib/cabinet-wiring.ts`

**Intent**: Replace the phase `feed` conductors of busbar groups with a busbar geometry.

**Contract**:

- `WiringDevice` admits busbar rows. They are not located and have no terminals.
- For a group with a busbar row, skip the phase feeds at `:2304-2319`. N feeds to MCBs that carry N
  stay.
- Emit `Busbar { key, groupId, edge, rect, phases: 1 | 3, teeth: { x, y, pole }[] }` in the routing
  result.
  - The strip lies along the group's out/supply edge (`supplyEdges`).
  - It spans from the first to the last phase terminal of the RCD and the MCBs on that edge.
  - A tooth sits at every phase terminal.
- **Pins.**
  - Pins are numbered from the RCD's end at `DIN_MODULE_MM` pitch.
  - A 1F busbar maps every pin to `L`.
  - A 3F busbar takes its phases from the RCD's L1/L2/L3 terminals on their pins and repeats them
    every 3 pins.
  - A 1P MCB therefore takes the phase of its pin, and its circuit's L core keeps the pole it gets.
- **Circuit cores.** The phase of a circuit's L core in the wire title follows the busbar pin (L1 / L2
  / L3).
- **Header.** `:22-113` documents the busbar and drops the "would later replace" note.
- The router treats the busbar strip as drawn on top. No obstacle is added.

#### 2. Island and server hand-off

**Files**: `src/lib/wiring-island.ts`, `src/lib/layout-server.ts`

**Intent**: Carry busbar rows (role, `rcd_group_id`, `busbar_piece`) through `toWiringData`, and return
`busbars` in `WiringDrawing` next to `wires`, `cables` and `ties`.

**Contract**: `WiringDrawing.busbars: DrawnBusbar[]`. Routing output still never feeds back into the
layout or the quote.

#### 3. Drawing

**Files**:

- `src/lib/cabinet-drawing.ts`
- `src/components/cabinets/CabinetDrawing.tsx`
- `src/components/projects/LayoutLegend.tsx`
- `src/components/projects/WiringDrawing.tsx`
- `src/lib/i18n/pl.ts`
- `src/styles/global.css` (new tokens only if needed)

**Intent**:

- **Realistic.** A copper/insulated strip with teeth, in tokens only (`AGENTS.md` UI rules).
- **Schematic.** A heavy line with tick teeth that stays legible in greyscale.
- **Layering.** Painted after the devices and before the wires, hidden with the wires while the editor
  is dirty.
- **Title.** A hover title such as „Listwa zasilająca 3F — grupa „Kuchnia”, 8 pinów”.
- **Legend.** An entry in both variants.

**Contract**:

- `buildDrawnBusbars(busbars, variant)` is pure and tested.
- The print page draws the busbar in the schematic variant, like the wires.

#### 4. Wire lengths

**Files**: `src/lib/cabinet-wiring.ts` (`wireLengthsBySection`), `src/components/projects/WireLengthsTable.tsx`

**Intent**: Replaced jumpers no longer contribute.

**Contract**: No new row kind. The busbar is material, not wire.

#### 5. Tests

**Files**:

- `src/lib/cabinet-wiring.test.ts`
- `src/lib/cabinet-drawing.test.ts`
- `src/lib/wiring-island.test.ts`
- `src/lib/wiring-bench-fixtures.ts`

**Intent**: Pin the busbar output, and keep the jumper behaviour pinned for groups without a busbar.

**Contract**:

- The "RCD → MCB jumpers on one side" tests (`:1236-1300`) stay for busbar-less fixtures.
- New cases:
  - a busbar group has zero phase feeds RCD → MCB and N feeds only to N-carrying MCBs;
  - the teeth sit on the phase terminals;
  - a 3F busbar spreads 1P MCBs over L1/L2/L3 by pin;
  - the 16 mm² `kinds` row shrinks accordingly.
- Bench fixtures gain a busbar variant.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Type check, lint and build pass: `npx astro check && npm run lint && npm run build`
- Smoke passes against the preview: `npm run build && npm run preview` + `npm run smoke`

#### Manual Verification:

- Project page, realistic and schematic views: busbars drawn along each busbar group, no phase jumpers there, N jumpers only where MCBs carry N; hover titles correct
- A 3F group shows 1P MCBs on L1, L2, L3 in turn
- The printout shows the busbars in the schematic drawing and the busbar pieces in the material table; a greyscale print preview stays legible
- The editor hides busbars while dirty and shows them after save
- Wiring renders without noticeable delay on the largest seed cabinet (no regression against S-11)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Kitchen sink, landing, docs

### Overview

Every new UI state is on `/dev/kitchen-sink`. The landing preview shows busbars. The docs and
tripwires describe the busbar.

### Changes Required:

#### 1. Kitchen sink

**Files**: `src/pages/dev/kitchen-sink.astro`, `src/lib/kitchen-sink-circuits.ts`, `src/lib/i18n/pl.ts`

**Intent**: Add the following states, each computed by the real functions:

- the busbar in the device catalog table;
- the match result with busbar segments, including a shared piece;
- the "brak listwy" note;
- the layout with busbars in the realistic and schematic views, including a 3F group;
- the quote and print with busbar pieces.

**Contract**: New `devTools.kitchenSink` captions.

#### 2. Landing preview

**Files**: `src/components/landing/*` (`Landing.astro` / `DraftingSheet`)

**Intent**: The hero drawing shows a group fed by a busbar.

**Contract**: It uses the same drawing components and no hand-drawn busbar.

#### 3. Docs

**Files**: `AGENTS.md`, `README.md`

**Intent**:

- `AGENTS.md` gets a busbar tripwire: segments are unplaced `busbar` rows; `busbar_piece` is guarded
  twice (CHECK plus `Selection`); busbar rows carry `rcd_group_id` and must be excluded from group
  checks; a miss is never a gap; the N-outward rule lives in the `cabinet-layout.ts` header.
- The `AGENTS.md` product-code summary mentions busbars.
- The README project page row mentions busbars.

**Contract**: Prose only.

### Success Criteria:

#### Automated Verification:

- Full CI reproduction passes: `npm run lint && npx astro check && npm run test:unit && npm run build`
- Integration tests pass: `npm run test:integration`

#### Manual Verification:

- `/dev/kitchen-sink` shows every new state correctly, including in greyscale print preview
- The landing page shows the busbar in the hero drawing
- End-to-end walk: admin adds busbars → electrician re-matches a project → proposes layout → sees busbars → prints a quote with busbar pieces

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- **`busbar-cutting`.** First-fit decreasing order, offcut reuse, the 1-MCB offcut-only rule, the
  phase match, the In ≥ RCD In guard (property: never under-rated), the too-wide exclusion and
  determinism.
- **Matcher.** Busbar selections are appended at the end; notes never become gaps; staleness flips when
  the busbar choice changes.
- **Quote.** A piece is priced once and a segment is counted once; the print lines sum to
  `devicesGrosze`.
- **Layout.** Busbar rows are excluded from all group and coverage checks; the N-outward orientation
  holds.
- **Wiring.** No phase jumpers in busbar groups; teeth on the phase terminals; 3F pin phases.

### Integration Tests:

- `rls-devices`: the busbar kind CHECK in both directions, and the seed has seven kinds.
- `rls-circuits`: the `busbar` role, the `busbar_piece` CHECK and the new notes.

### Manual Testing Steps:

1. As admin, add a 1F 12-pin and a 3F 54-pin busbar (or use the seed).
2. As electrician, re-match an existing project. It reads "Nieaktualny" first, then current with
   busbar segments.
3. Propose the layout and check the RCD orientation and the drawn busbars in both views.
4. Archive every busbar, re-match, and check the notes and the restored jumpers.
5. Print the quote and check the busbar pieces in the material, the segments in labour and the drawing.

## Performance Considerations

The cut is O(groups × pieces), with at most 20 groups. The busbar removes jumper conductors from the
router, so routing gets cheaper, not dearer. The client-side wiring island is unchanged.

## Migration Notes

Three new migrations:

1. `20261009120000_comb_busbar_kind.sql`, the enum value alone.
2. `20261009120100_comb_busbar_parameters.sql`, the kind CHECK.
3. `20261009120200_project_device_busbars.sql`, the role, `busbar_piece`, notes and
   `save_project_circuits`.

All three are re-runnable and backward-compatible with the deployed Worker during the deploy window:

- the old Worker drops `comb_busbar` catalog rows as unparseable;
- it reads busbar snapshot rows as an unknown role, so the project shows `stale`;
- it sends no `busbar_piece`, which is valid for its own rows.

Existing snapshots are not rewritten. Projects re-match on the electrician's "Dobierz ponownie". The
production catalog has no busbars until the admin adds them, and until then every group keeps its
jumpers and shows the informational note.

## References

- Issue: https://github.com/Mr1008/rozdzielnica-pro/issues/17
- Precedent (catalog PE/N bars): `supabase/migrations/20261006140000_project_device_bars.sql`, `src/lib/device-matching.ts:465-483`
- Feed generation: `src/lib/cabinet-wiring.ts:2304-2319`, edge choice `:2174-2197`, phase fallback `:1947-1953`
- Placement skip in RPC: `supabase/migrations/20261008120000_manual_layout_edits.sql:177-178`
- Staleness comparator: `src/lib/device-matching.ts:496-510`
- Quote counts: `src/lib/quote.ts:118-154`, `src/lib/quote-print.ts:66-123`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Busbar device kind in the catalog

#### Automated

- [x] 1.1 Migrations apply on a clean local stack: `npx supabase db reset` — e9c656a
- [x] 1.2 Types regenerate and `_DeviceKindInSync` holds: `npm run db:types && npx astro check` — e9c656a
- [x] 1.3 Unit tests pass: `npm run test:unit` — e9c656a
- [x] 1.4 RLS/catalog integration tests pass, including a busbar row and the seven-kind seed: `npm run test:integration` — e9c656a
- [x] 1.5 Lint and build pass: `npm run lint && npm run build` — e9c656a

#### Manual

- [x] 1.6 In `/admin/devices` the admin creates, edits, archives and restores a 3F busbar; the form shows phases, current and width in TE only, and the list shows the busbar summary — e9c656a
- [x] 1.7 A busbar with 2P poles or a residual current is refused with a Polish message on the field — e9c656a
- [x] 1.8 Roadmap S-12 appears on the GitHub board and #17 is no longer `odłożone` — e9c656a

### Phase 2: Busbar selection, cutting and quote

#### Automated

- [x] 2.1 Migration applies: `npx supabase db reset && npm run db:types`
- [x] 2.2 Unit and property tests pass: `npm run test:unit`
- [x] 2.3 Integration tests pass: `npm run test:integration`
- [x] 2.4 Type check, lint and build pass: `npx astro check && npm run lint && npm run build`

#### Manual

- [x] 2.5 A project with two 1F RCD groups shows busbar segments cut from one piece; the quote shows one piece in material and both segments counted in the labour formula
- [x] 2.6 A project saved before this phase reads "Nieaktualny" and becomes current after "Dobierz ponownie"
- [x] 2.7 With all busbars archived, the groups show the informational "brak listwy" note and matching is not blocked

### Phase 3: Layout with unplaced segments and RCD orientation

#### Automated

- [ ] 3.1 Unit and property tests pass: `npm run test:unit`
- [ ] 3.2 Integration tests pass: `npm run test:integration`
- [ ] 3.3 Type check, lint and build pass: `npx astro check && npm run lint && npm run build`

#### Manual

- [ ] 3.4 "Zaproponuj układ" for a project with busbar groups places each RCD with its N terminal at the outer end of its group
- [ ] 3.5 Manual edit (move a group, move the RCD to the other end) saves without `layout_invalid`, and a re-match carries the manual layout over

### Phase 4: Busbar in the wiring and the drawing

#### Automated

- [ ] 4.1 Unit tests pass: `npm run test:unit`
- [ ] 4.2 Type check, lint and build pass: `npx astro check && npm run lint && npm run build`
- [ ] 4.3 Smoke passes against the preview: `npm run build && npm run preview` + `npm run smoke`

#### Manual

- [ ] 4.4 Project page, realistic and schematic views: busbars drawn along each busbar group, no phase jumpers there, N jumpers only where MCBs carry N; hover titles correct
- [ ] 4.5 A 3F group shows 1P MCBs on L1, L2, L3 in turn
- [ ] 4.6 The printout shows the busbars in the schematic drawing and the busbar pieces in the material table; a greyscale print preview stays legible
- [ ] 4.7 The editor hides busbars while dirty and shows them after save
- [ ] 4.8 Wiring renders without noticeable delay on the largest seed cabinet (no regression against S-11)

### Phase 5: Kitchen sink, landing, docs

#### Automated

- [ ] 5.1 Full CI reproduction passes: `npm run lint && npx astro check && npm run test:unit && npm run build`
- [ ] 5.2 Integration tests pass: `npm run test:integration`

#### Manual

- [ ] 5.3 `/dev/kitchen-sink` shows every new state correctly, including in greyscale print preview
- [ ] 5.4 The landing page shows the busbar in the hero drawing
- [ ] 5.5 End-to-end walk: admin adds busbars → electrician re-matches a project → proposes layout → sees busbars → prints a quote with busbar pieces
