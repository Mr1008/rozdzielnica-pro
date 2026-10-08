# Manual Layout Editing Implementation Plan

## Overview

Roadmap S-06 (issue #7), PRD FR-009 and the US-01 acceptance criterion "Zaproponowany układ jest
edytowalny przed wygenerowaniem wyceny". The electrician corrects the proposed cabinet layout (S-05)
directly in the "Układ w szafce" section. They move whole blocks or single devices with the mouse or
keyboard, and drops snap to 0.5 TE steps. Every accepted move keeps the layout valid by the same
`validateLayout` that guards the proposal. Save, cancel, undo/redo and "re-propose" are available, and
a saved manual layout carries an "edited manually" marker. Manual fixes survive a circuit save or a
re-match as long as they are still valid on the new device set. This is the safety net under an
imperfect heuristic. It is not a mini-CAD (roadmap S-06 risk note).

## Current State Analysis

- **Storage.** Placements live in `project_device_placements`, one row per `project_devices` row: a
  rail index and `x_mm` from the rail start. They are written only by two RPCs, both security
  invoker. `save_project_circuits` stores them with the match, and `save_project_layout` replaces the
  whole set after checking that every id is a device of the project
  (`supabase/migrations/20261006130000_project_device_placements.sql:156-346`). Grants are select,
  insert and delete only, with "UPDATE is S-06's decision" (`:103-104`);
  `tests/integration/rls-layout.test.ts:282-286` asserts that UPDATE is refused.
- **Lifetime.** Every circuit save and every "Dobierz ponownie" deletes and re-inserts
  `project_devices` with new ids, so the placements are deleted with them. A supply change does the
  same. A cabinet change clears the placements by trigger (`:71-91`). Today a manual fix would
  therefore be lost even when a re-match picks identical devices. The S-05 brief left this to S-06
  (`context/archive/2026-10-06-cabinet-layout-proposal/plan-brief.md:84`).
- **Reading.** `computeLayoutView` re-validates stored placements on every render and returns
  `placed` only when they cover the snapshot exactly and pass `validateLayout`
  (`src/lib/layout-server.ts:62-85`). `validateLayout` checks coverage, staying on the rail, overlap,
  the interior, the bars, group contiguity (rule 1) and an RCBO alone in its group
  (`src/lib/cabinet-layout.ts:881`). Wires are routed only for `placed` (`layout-server.ts:92`).
- **Drawing.** `CabinetDrawing` (`src/components/cabinets/CabinetDrawing.tsx`) is hook-free and
  rendered on the server, at 1 SVG unit = 1 mm with no transforms (`:349-354`), so a pointer maps to
  mm through `getScreenCTM()` alone. It has no event props. Wires sit above devices (`:418-430`) and
  dim the others on CSS hover. `buildDrawnDevices` (`src/lib/cabinet-drawing.ts:218`) is pure.
- **Client safety.** `cabinet-layout.ts`, `cabinet-drawing.ts` and `cabinet-wiring.ts` have no
  server-only imports. `layout-server.ts` and `device-matching-server.ts` do (Supabase loaders), so an
  island must not import them.
- **Island pattern.** `src/components/circuits/CircuitEditor.tsx` is mounted `client:only` on the
  project page (`src/pages/dashboard/projects/[id].astro:403-414`). It posts with a hidden JSON field
  and a normal POST, validates on the client with the same parser the server uses, keeps a
  sessionStorage draft (`src/components/forms/draft-storage`), resets on `pageshow`, and has Polish
  screen-reader announcements and a non-drag alternative for every drag.
- **Section.** `src/components/projects/LayoutSection.astro` renders one state at a time: not
  current, `missing`, `outdated`, `does_not_fit` or `placed`. `placed` shows the wired drawing, the
  legend and the lengths table. The re-propose endpoint is `POST /api/projects/[id]/layout`
  (`src/pages/api/projects/[id]/layout.ts`).
- **Downstream.** The S-08 quote counts snapshot rows and ignores the layout
  (`src/lib/quote.ts:117`). S-09 prints the `placed` layout. Test-plan risk #4 requires the
  invariants after the proposal and "after every edit" (`context/foundation/test-plan.md:43,60`).

## Desired End State

On a project whose match is `current` and whose layout is `placed`, the "Układ w szafce" section is
an interactive editor showing the saved, wired layout:

- **Moving.** The electrician drags a whole group by its outline label, or a single device. With the
  keyboard: Tab to a device or group handle, Space or Enter to pick it up, ←/→ moves 0.5 TE, ↑/↓
  moves to the adjacent rail, Enter or Space drops, Escape cancels. A drop that would break the
  layout is refused and a Polish message says why.
- **Unsaved changes.** On the first one, the wires and the lengths table are hidden behind the note
  "Przewody zostaną przeliczone po zapisaniu". "Zapisz układ", "Anuluj" and undo/redo become active.
- **Save.** The server re-validates and stores the layout with `edited_manually = true`. After the
  reload the server draws the new wires and lengths, and a "Poprawiony ręcznie" badge appears in the
  section and the aside.
- **Re-propose.** "Zaproponuj układ od nowa" asks for confirmation, then replaces the manual layout
  with a fresh proposal and clears the badge.
- **Circuit save or re-match.** A manual layout whose placements still apply to the new device set
  and pass `validateLayout` is kept, with the badge. Otherwise a fresh proposal is stored and a
  notice says the manual fixes were replaced.
- **Cabinet change** still clears the layout (and with it the marker).

Verify with `npm run test:unit` (model, carry-over and payload tests, including a property test
that every accepted move leaves `validateLayout` empty), `npm run test:integration` (RLS and RPC
tests for the flag), the kitchen sink, and a browser walk-through on the three starter cabinets.

### Key Discoveries:

- `save_project_layout` already does a whole-set replace with an ownership check
  (`20261006130000_project_device_placements.sql:306-346`). A manual save can reuse it, so no UPDATE
  grant is needed.
- `validateLayout(devices, placements, geometry, groups)` is the single validator. It runs on the
  client after each drop, on the server before saving, and again on every render
  (`cabinet-layout.ts:881`, `layout-server.ts:72`).
- `proposeLayout` places devices off the 0.5 TE grid when it fills from the rail end
  (`cabinet-layout.ts:610`). The grid is therefore an editor affordance only, and the server must
  not enforce it.
- The circuits endpoint loads only `loadMatchBase` (`src/pages/api/projects/[id]/circuits.ts:51`).
  To carry fixes over, it must also read the stored snapshot and placements before the RPC deletes
  them.
- Stable ids make carry-over possible. Groups and circuits keep their ids across saves (AGENTS.md
  tripwire on `save_project_circuits`), so a new device can be matched to an old one by
  `(role, rcd_group_id, circuit_id)`.
- Wires above devices would swallow pointer events (`CabinetDrawing.tsx:418-430`). While the layout
  is dirty the wires are hidden anyway. In the clean state, devices need to be drawn above wires, or
  the wire layer needs pointer events off.

## What We're NOT Doing

- **Fixes that survive adding or removing a circuit.** Partial carry-over would need an incremental
  placer, which is optimiser and mini-CAD risk. A set that no longer fully applies is re-proposed.
- **Live wire re-routing on the client.** `routeConductors` stays on the server, and wires come back
  after save.
- **Relaxing rule 1 for manual edits.** A group stays contiguous unless it is wider than every rail.
  No warnings for rules 2 and 3 either: the electrician moved the device on purpose.
- **Enforcing the 0.5 TE grid on the server.**
- **An UPDATE grant on `project_device_placements`.** Placements stay insert and delete only, through
  the RPCs.
- **Carrying a layout across a cabinet change.** Rail indices of the old cabinet mean nothing on the
  new one.
- **Touch support** (PRD `## Non-Goals`), and **editing in `missing`, `outdated` or
  `does_not_fit`**. Those keep their existing re-propose and error panels.
- **The overlapping PE/N bar labels** deferred from S-02. They move to S-09, where drawing legibility
  on print is judged.
- **Print styles and the printed "edited manually" note.** That is S-09's decision.
- **Playwright e2e.** Test-plan Phase 3 (the e2e harness) has not started. Test-plan Phase 4 adds the
  editing e2e test.

## Implementation Approach

The pure model comes first, then storage, then the island, then docs. This follows the cookbook
pattern (§6.1) and the matcher/layout precedent: pure, tested modules, a thin endpoint, and an island
that only holds state changed by pure operations.

- **`src/lib/layout-editing.ts`** (new, client-safe). The movable units (blocks and devices), the
  move operations, snapping, keyboard steps, the drop verdict (by `validateLayout`), undo/redo
  history, the payload parser shared by the island and the endpoint, and `carryOverPlacements` for
  re-matches.
- **Storage.** One migration adds `project_device_placements.edited_manually`. `save_project_layout`
  gets an optional `p_edited_manually` parameter, and `save_project_circuits` reads an optional
  `edited_manually` per device item. The new `POST /api/projects/[id]/placements` endpoint saves a
  manual layout. The circuits and rematch endpoints carry fixes over.
- **UI.** `CabinetDrawing` gains optional, hook-free interaction props. A new `LayoutEditor` island
  (`client:only`) replaces the static drawing in the `placed` state. Its fallback slot is the static
  wired drawing, so the layout is visible before hydration.

## Critical Implementation Details

- **Timing and lifecycle.** The circuits and rematch endpoints must read the old snapshot and
  placements (`loadLayoutContext`) **before** calling `save_project_circuits`, because the RPC deletes
  them. A carry-over is only attempted when the old layout was edited manually; a proposed layout is
  re-proposed as today. Carried placements travel as `rail_index` / `x_mm` / `edited_manually` on
  the device items, so they land in the same transaction as the match.
- **User experience.**
  - A refused **pointer** drop snaps back to its origin.
  - A refused **keyboard** drop keeps the unit picked up where it is, announces the reason, and
    Escape returns it to its origin. Arrow moves only preview; the verdict comes on drop.
  - Dropping a group's device inside its own group's span is a **reorder**: the group is re-packed
    from its current start. Dropping it anywhere else breaks rule 1 and is refused.
  - A dirty draft registers `beforeunload`, so other forms on the page do not silently drop it.
- **State sequencing.** The draft keeps project device ids. If the snapshot changed under it (a
  re-match in another tab), the RPC refuses with P0002 `project_device_unavailable`, which maps to
  the existing `layout_device_unavailable` error. The saved sessionStorage draft is then dropped
  because its ids no longer match the snapshot.

## Phase 1: Editing model (pure)

### Overview

All editing logic as pure, client-safe functions with unit and property tests. No UI and no storage.

### Changes Required:

#### 1. Movable units and moves

**File**: `src/lib/layout-editing.ts` (new)

**Intent**: Turn a layout (devices, placements, geometry, groups) into what the editor can move and
apply one move at a time. A move is accepted only when the result passes `validateLayout`, so the
draft is always valid.

**Contract**:

- **Units.** `editUnits(devices, groups)` returns the movable units:
  - one `block` unit per non-empty RCD group (RCD/RCBO first);
  - one `device` unit per device.

  The main switch, ungrouped MCBs and catalog bars are free single devices. A group's devices are
  `device` units that may only reorder inside their group.

- **Moves.**
  - `moveUnit(draft, unit, target: { railIndex, xMm })` places a block at `target`, keeping its
    devices packed.
  - `moveDevice(draft, deviceId, target)` either reorders inside the own group (the drop falls in
    the group's span) or moves a free device.

  Both return `{ ok: true, draft } | { ok: false, issues: LayoutIssue[] }` and never mutate the input.

- **Snapping.**
  - `snapX(rail, xMm, widthMm)` rounds to multiples of `DIN_MODULE_MM / 2` measured from the rail
    start and clamps to `[0, lengthMm - widthMm]`.
  - `keyboardStep(draft, unit, direction)` moves 0.5 TE left or right, or to the adjacent rail with
    the snapped x kept. It returns a preview position, not a verdict.
- **Drawing input.** A `LayoutDraft` is `{ placements: Placement[] }` in snapshot order. Its
  `DrawnDevice[]` comes from `buildDrawnDevices`, unchanged.

#### 2. Issue messages

**File**: `src/lib/cabinet-layout.ts`, `src/lib/i18n/pl.ts`

**Intent**: A refused drop must say why in Polish. `LayoutIssue` codes have no messages yet because
the page never showed them.

**Contract**: `layoutIssueMessage(issue, names)`, exhaustive over `LayoutIssueCode` via a `Record`,
like `layoutFailureMessage`. The new keys are `t.layout.issues.*`, naming the device or group (for
example "Aparat „B16 Oświetlenie” nachodzi na inny aparat").

#### 3. Undo/redo history

**File**: `src/lib/layout-editing.ts`

**Intent**: Step back and forward through accepted moves before saving.

**Contract**: `history` is an immutable `{ past, present, future }` with `commit`, `undo`, `redo` and
`reset`, capped at 50 entries. A refused move never enters it.

#### 4. Payload parser

**File**: `src/lib/layout-editing.ts`

**Intent**: One parser for the hidden field, shared by the island (before submit) and the endpoint,
following `parseCircuitsPayload`. It never throws and never returns zod's English text.

**Contract**:

- `LAYOUT_FORM_FIELDS = { placements: "placements_payload" }`.
- `parsePlacementsPayload(raw: unknown)` returns
  `{ ok: true, placements: Placement[] } | { ok: false }`.
- Each item is `{ projectDeviceId: uuid, railIndex: integer ≥ 0, xMm: finite ≥ 0 with ≤ 2 decimals }`,
  at most 200 items, with no duplicate ids.
- Coverage and geometry are left to `validateLayout` on the server.

#### 5. Carry-over across a re-match

**File**: `src/lib/layout-editing.ts`

**Intent**: Decide whether a manual layout survives a new device set.

**Contract**: `carryOverPlacements(old: { devices: LayoutDevice[]; placements: Placement[] }, next:
LayoutDevice[], geometry, groups)` returns `Placement[]` keyed by the `next` ids, or `null`.

- **Key.** Old and new devices are matched by `(role, rcd_group_id, circuit_id)`.
- **Returns `null` when:**
  - a key is duplicated on either side;
  - a new device has no old counterpart;
  - an old placement has no new device;
  - the result fails `validateLayout`. For example, a wider replacement device now overlaps.
- **Caller.** The endpoints call it with `next` built the way `proposeSelectionLayout` builds its
  devices (index ids), so the result maps onto `SelectionPlacements`. This means extracting the
  selection-to-`LayoutDevice` mapping from `proposeSelectionLayout` into a shared helper in
  `layout-server.ts`.

#### 6. Tests

**File**: `src/lib/layout-editing.test.ts`, `src/lib/layout-editing.property.test.ts` (new)

**Intent**: Pin the model against the three seed geometries (`src/lib/cabinet-layout.fixtures.ts`)
with literal expected placements (cookbook §6.1: the oracle is literals, and the rules are not
imported).

**Contract**:

- **Named cases:**
  - a block moves to another rail and stays packed;
  - a reorder inside a group;
  - a group device dropped outside its group is refused (`group_not_contiguous`);
  - a drop that overlaps is refused (`overlaps_device`);
  - a drop past the rail end is clamped by the snap;
  - a drop onto a bar is refused (`overlaps_bar`);
  - an RCBO cannot join another group;
  - undo and redo restore exact drafts;
  - the payload parser rejects each malformed shape.
- **Carry-over cases:**
  - an identical set is kept;
  - a renamed circuit is kept (same ids);
  - an added circuit returns `null`;
  - a wider replacement device that overlaps returns `null`.
- **Property test** (fast-check): any random sequence of moves over a valid proposal leaves
  `validateLayout(...)` empty after every accepted move, and every refused move leaves the draft
  unchanged.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Mutation check: disabling the `validateLayout` call in `moveUnit` makes the property test fail

#### Manual Verification:

- The literal expected placements in the named tests were checked by hand against the seed
  geometries (rail lengths, 17.5 mm modules)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 2: Storage and write path

### Overview

The "edited manually" flag, the manual-save endpoint, carry-over in the circuits and rematch
endpoints, and the flag in the layout view.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261007120000_manual_layout_edits.sql` (new)

**Intent**: Store the marker on each placement, so that any cascade delete clears it with the rows,
and let both RPCs write it. The migration must stay backward-compatible with the deployed code.

**Contract**:

- **Column.** `project_device_placements.edited_manually boolean not null default false`.
- **`save_project_layout`.** Drop and recreate it as `(p_project_id uuid, p_placements jsonb,
p_edited_manually boolean default false)`. The deployed code calls it with two named arguments,
  which still resolve.
- **`save_project_circuits`.** Recreate it with the same signature. A device item's optional
  `edited_manually` is stored when present and defaults to false.
- **Unchanged.** Grants (`select`, `insert`, `delete`; no UPDATE), RLS policies and the
  cabinet-change trigger.
- **Style.** The header comment explains the backward compatibility, and every statement is
  re-runnable, like the earlier migrations.
- **Types.** Then run `npm run db:types`.

#### 2. Layout view carries the flag

**File**: `src/lib/layout-server.ts`

**Intent**: The page and the island need to know whether the stored layout is manual.

**Contract**:

- `PlacementRow` gains `edited_manually`, and `loadLayoutContext` selects it.
- `LayoutContext` gains `editedManually: boolean`, true when any stored row has the flag.
- `computeLayoutView`'s `placed` variant gains `editedManually`. Other states carry nothing, because
  an outdated manual layout is no longer shown as manual.
- `saveLayoutArgs(projectId, placements, editedManually = false)`.
- The selection-to-`LayoutDevice` mapping is extracted for `carryOverPlacements` (Phase 1 §5).

#### 3. Manual-save endpoint

**File**: `src/pages/api/projects/[id]/placements.ts` (new); `src/lib/project.ts`

**Intent**: Store the electrician's edited layout after re-validating it on the server.

**Contract**: `POST`, FormData with `placements_payload`, following `layout.ts` (the shape for
redirects, a uuid check, the not-configured branch, `layoutRpcErrorCode`).

1. Refuse unless the match is `current` (`layout_match_not_current`).
2. Parse the payload (`invalid_input`).
3. Require `validateLayout(snapshot, placements, geometry, groups)` to be empty (a new code,
   `layout_invalid`, with a Polish message in `t.projectErrors`).
4. Call `save_project_layout` with `p_edited_manually: true`.
5. Redirect to `?saved=layout_edited#layout`.

`projectPlacementsApiPath(id)` goes beside `projectLayoutApiPath`, with a test in
`src/lib/project.test.ts`.

#### 4. Carry-over in circuits and rematch

**File**: `src/pages/api/projects/[id]/circuits.ts`, `src/pages/api/projects/[id]/rematch.ts`;
`src/lib/device-matching-server.ts`

**Intent**: Keep a still-valid manual layout through a circuit save or a re-match. Otherwise store
the proposal and tell the electrician.

**Contract**:

- **Reading first.** Both endpoints read the stored snapshot and placements via `loadLayoutContext`
  before the RPC. `circuits.ts` today reads only the base; it switches to the layout context, which
  includes the base.
- **Choosing.** If `editedManually` and the result is `matched`, try `carryOverPlacements`. On
  success those placements are sent, with `edited_manually: true` on each device item.
- **Fallback.** On `null`, send `proposeSelectionLayout` as today and add `&layout_reset=1` to the
  redirect.
- **RPC arguments.** `saveCircuitsArgs` gains an optional `editedManually` flag that it writes on
  every device item carrying a placement.

#### 5. Page notices and the aside

**File**: `src/pages/dashboard/projects/[id].astro`, `src/lib/i18n/pl.ts`

**Intent**: Confirm a manual save, explain a reset, and show the marker.

**Contract**:

- `saved=layout_edited` shows `t.projects.page.savedLayoutEdited`.
- `layout_reset=1` shows a warning banner, `t.layout.section.manualReset` ("Ręczne poprawki układu
  nie pasowały do nowego doboru aparatów — zaproponowano układ od nowa.").
- The aside's layout row shows `layoutEditedManually` ("Poprawiony ręcznie") for a `placed` manual
  layout.

#### 6. Integration tests

**File**: `tests/integration/rls-layout.test.ts`

**Intent**: Assert the flag and the new parameter under RLS. The existing "UPDATE refused" test stays.

**Contract**:

- `save_project_layout` with `p_edited_manually: true` stores the flag on every row, and without it
  stores false.
- `save_project_circuits` stores `edited_manually` per item and defaults it to false.
- A cabinet change clears manual placements.
- Another electrician, the admin and anon are refused on the three-argument call, as before.

### Success Criteria:

#### Automated Verification:

- The migration applies cleanly on a fresh stack: `npx supabase db reset`
- Types are regenerated and committed: `npm run db:types`, then `git diff --exit-code` after a second
  run
- Unit tests pass: `npm run test:unit`
- RLS/RPC integration tests pass: `npm run test:integration`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification:

- A scripted POST to `/api/projects/[id]/placements` with an overlapping set redirects with
  `layout_invalid` and stores nothing
- On a project with a manual layout, renaming a circuit keeps the layout and the badge; adding a
  circuit shows the reset notice and a fresh proposal

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 3: Editor island

### Overview

The always-on editor in the `placed` state: pointer and keyboard moves, unsaved-change handling,
controls, announcements and the kitchen-sink states.

### Changes Required:

#### 1. Interaction props on the drawing

**File**: `src/components/cabinets/CabinetDrawing.tsx`

**Intent**: Let an island make devices and group handles interactive without forking the renderer or
adding hooks. The server and print rendering stay identical when the props are absent.

**Contract**: optional props.

- `interactive?: { deviceProps(id): SVGProps; groupHandleProps(groupKey): SVGProps; selectedId?;
liftedIds?: string[] }`. Each prop spreads tabIndex, role, aria-label and pointer and key handlers
  onto the device `<g>` and the group label.
- `hideWires?: boolean`.
- When `interactive` is set, the wire layer gets `pointer-events: none`, and the focused or selected
  device gets a token-coloured outline.

New visual states (selected, lifted, refused) go to `/dev/kitchen-sink` first (AGENTS.md UI rule),
and new colours become tokens in `src/styles/global.css`.

#### 2. The island

**File**: `src/components/projects/LayoutEditor.tsx` (new)

**Intent**: Hold the draft and history, map pointer and keyboard input to `layout-editing.ts`
operations, and submit via a hidden field and a normal POST, as `CircuitEditor` does.

**Contract**:

- **Props** (all serialisable):
  - layout data: `geometry`, `devices: LayoutDevice[]` (snapshot rows), `groups`, `placements`,
    `editedManually`;
  - server-drawn extras: `drawnDevices`, `wires`, `cables`, `lengths` (for the saved state) and
    `names` (labels for messages);
  - actions: `saveAction` (`projectPlacementsApiPath`), `reproposeAction` (`projectLayoutApiPath`);
  - draft handling: `draftKey`, `restoreDraft`.
- **Pointer.** On pointerdown on a device or group handle, map the pointer to mm via
  `getScreenCTM().inverse()`, preview the move while the pointer moves (snapped), and ask for the
  verdict on pointerup. A refused drop snaps back with the issue announced.
- **Keyboard.** Space or Enter picks up, ←/→ moves 0.5 TE, ↑/↓ moves to the adjacent rail, Enter or
  Space drops, Escape cancels. Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y undo and redo.
- **Announcements.** Polish texts in an `aria-live="polite"` region, with keys
  `t.layout.editor.*`: picked up, moved to rail N / position X TE, dropped, refused + reason,
  cancelled.
- **Dirty state.** When the draft differs from the saved placements, hide wires and cables, replace
  the lengths table with the note `t.layout.editor.wiresAfterSave`, enable "Zapisz układ", "Anuluj"
  and "Cofnij"/"Ponów", and register `beforeunload`.
- **Draft storage.** Write the draft to sessionStorage on submit (`writeStoredDraft`). Restore it
  after an error redirect only when its device ids equal the current snapshot's; otherwise clear it.
  Reset the submit state on `pageshow`.
- **Re-propose.** "Zaproponuj układ od nowa" posts to `reproposeAction` after a confirmation step.
  Add `alert-dialog` from the shadcn registry, since `src/components/ui/` has none.
- **Marker.** A "Poprawiony ręcznie" `Badge` when `editedManually`.

#### 3. Lengths table shared by Astro and the island

**File**: `src/components/projects/WireLengthsTable.tsx` (new); `LayoutSection.astro`

**Intent**: The island must hide and show the lengths table, so it moves from Astro markup to a
React component. Astro renders it without hydration; the island renders it hydrated.

**Contract**: `WireLengthsTable({ lengths, slackPercent })`, with the same markup and i18n keys as
`LayoutSection.astro:194-238` today.

#### 4. Section wiring

**File**: `src/components/projects/LayoutSection.astro`, `src/pages/dashboard/projects/[id].astro`

**Intent**: In `placed`, mount the island `client:only="react"` inside an anchored wrapper. Its
`slot="fallback"` is today's static drawing, legend and lengths, so the layout shows before
hydration. Other states are unchanged.

**Contract**: `LayoutSection` gains the props the island needs: snapshot devices, groups, placements,
`editedManually` and names. The page passes them from data it already loads.

#### 5. Kitchen sink

**File**: `src/lib/kitchen-sink-circuits.ts`, `src/pages/dev/kitchen-sink.astro`, `src/lib/i18n/pl.ts`

**Intent**: Every new UI state is reviewable in one place (AGENTS.md).

**Contract**:

- New editor fixtures built through the real pipeline: clean placed, placed with the "Poprawiony
  ręcznie" badge, dirty (an `initialDraft` prop for the kitchen sink only, with wires hidden and the
  note shown), and a device in the selected and lifted states.
- They are mounted like the CircuitEditor examples: `action="#"`, `restoreDraft={false}`.
- Captions go in `t.devTools.kitchenSink.layoutStates`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- Build succeeds: `npm run build`
- No palette classes, hex values or `rgba()` in the new components: a grep over
  `src/components/projects/LayoutEditor.tsx` and `WireLengthsTable.tsx`

#### Manual Verification:

- On each starter cabinet: drag a group to another rail, reorder an MCB inside its group, move the
  main switch, save. The reload shows the wires re-routed, the lengths updated and the badge
- A drop onto another device, a bar, or outside the group snaps back with a Polish reason
- Keyboard only: pick up, move across rails, an invalid drop is announced, Escape restores, a valid
  drop saves
- Undo/redo and Anuluj restore exact positions; leaving the page with a dirty draft prompts
- "Zaproponuj układ od nowa" asks first, then replaces the layout and clears the badge
- Before hydration (throttled network) the static wired drawing is visible
- Kitchen sink shows every new editor state

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 4: Docs and roadmap

### Overview

Record the new contracts where the next agent reads them, update the test-plan cookbook, and close
the slice on the roadmap.

### Changes Required:

#### 1. AGENTS.md tripwire

**File**: `AGENTS.md`

**Intent**: Update the "Layout placements are a snapshot" tripwire to cover three things:

- the manual-save endpoint, which writes through `save_project_layout` only after `validateLayout`;
- the `edited_manually` flag and its lifetime: it is deleted with the placements and cleared by a
  cabinet change;
- carry-over: a manual layout survives a circuit save or re-match only through
  `carryOverPlacements`, which applies only when the whole set still applies and passes
  `validateLayout`; otherwise a fresh proposal is stored.

The tripwire also gains one line: placements have no UPDATE grant on purpose.

**Contract**: The `## Tripwires` bullet on layout placements, plus the product summary paragraph at
the top, which should mention manual editing.

#### 2. Test-plan cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Fill §6.5 "layout or quote" for the layout half: invariants after the proposal and after
every edit, with `layout-editing.property.test.ts` as the reference test.

**Contract**: Only §6.5. Strategy §1–§5 stays frozen.

#### 3. Roadmap and README

**File**: `context/foundation/roadmap.md`, `README.md`

**Intent**:

- Note in S-09 that the overlapping PE/N bar labels are now its to fix.
- Update the README route table for `/dashboard/projects/[id]`, which now includes manual layout
  editing.
- Mirror the roadmap to GitHub (`node scripts/roadmap-to-github.mjs --apply` under the `Mr1008`
  account).

**Contract**: S-09 `Unknowns` or `Risk` text; README auth-route table row.

### Success Criteria:

#### Automated Verification:

- Linting passes (Prettier on markdown runs via lint-staged): `npm run lint`
- The roadmap sync plan shows no unexpected changes: `node scripts/roadmap-to-github.mjs`

#### Manual Verification:

- The GitHub issue #7 and S-09 issue bodies match the roadmap after `--apply`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `layout-editing.test.ts`:
  - named moves on the seed geometries, with literal expected placements;
  - every refusal reason;
  - snapping and clamping;
  - keyboard steps across rails;
  - undo and redo;
  - payload parser rejections;
  - carry-over (identical set, renamed circuit, added circuit, wider replacement device).
- `layout-editing.property.test.ts`: any move sequence keeps `validateLayout` empty after every
  accepted move, and refused moves leave the draft unchanged.
- `layout-server.test.ts`: `computeLayoutView` reports `editedManually`, `saveLayoutArgs` passes the
  flag, and the extracted selection mapping is unchanged.
- `project.test.ts`: `projectPlacementsApiPath`.

### Integration Tests:

- `rls-layout.test.ts`:
  - the flag on both RPCs and its default;
  - a cabinet change clears it;
  - the three-argument `save_project_layout` is refused for another electrician, the admin and anon;
  - UPDATE is still refused.

### Manual Testing Steps:

1. On a project with each starter cabinet, edit and save as in the Phase 3 criteria. Confirm the
   wires, the lengths and the badge after the reload.
2. Rename a circuit and save the circuits: the manual layout and badge stay. Add a circuit: the
   reset notice appears and a fresh proposal is drawn.
3. Change the supply, then re-match: no manual layout survives the supply change (devices
   re-created, placements gone), so a fresh proposal is drawn.
4. Change the cabinet: the layout is `missing` and the badge is gone.
5. Do the whole edit with the keyboard only and listen to the announcements in the screen-reader
   region (the accessibility tree).

## Performance Considerations

Each drop runs one `validateLayout` over at most ~60 devices, a pairwise overlap pass of a few
thousand comparisons, which is negligible in the browser. Pointer movement only snaps and re-renders
the lifted unit; validation runs on drop. The server cost per manual save is one `validateLayout`
plus the existing render. Carry-over adds one `validateLayout` per circuit save of a manual project.

## Migration Notes

- **Backward compatibility.** The new column defaults to false.
- **`save_project_layout`.** Recreated with a defaulted third parameter, so the deployed two-argument
  call keeps working during the deploy window.
- **`save_project_circuits`.** Ignores a missing `edited_manually`.
- **Existing data.** No backfill: existing placements are proposals.
- **Rollback.** A code rollback leaves the column and parameter unused, which is harmless.

## References

- Roadmap S-06: `context/foundation/roadmap.md` (issue #7); PRD FR-009, US-01
- S-05 archive: `context/archive/2026-10-06-cabinet-layout-proposal/plan.md`, `change.md:39-45`
- Placements migration: `supabase/migrations/20261006130000_project_device_placements.sql`
- Validator and proposer: `src/lib/cabinet-layout.ts:805`, `:881`
- Layout server: `src/lib/layout-server.ts:62-209`
- Island pattern: `src/components/circuits/CircuitEditor.tsx`
- Test-plan risk #4: `context/foundation/test-plan.md:43,60`; cookbook §6.1, §6.5

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Editing model (pure)

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:unit` — dcc599c
- [x] 1.2 Type checking passes: `npx astro check` — dcc599c
- [x] 1.3 Linting passes: `npm run lint` — dcc599c
- [x] 1.4 Mutation check: disabling the `validateLayout` call in `moveUnit` makes the property test fail — dcc599c

#### Manual

- [x] 1.5 The literal expected placements in the named tests were checked by hand against the seed geometries (rail lengths, 17.5 mm modules) — dcc599c

### Phase 2: Storage and write path

#### Automated

- [x] 2.1 The migration applies cleanly on a fresh stack: `npx supabase db reset`
- [x] 2.2 Types are regenerated and committed: `npm run db:types`, then `git diff --exit-code` after a second run
- [x] 2.3 Unit tests pass: `npm run test:unit`
- [x] 2.4 RLS/RPC integration tests pass: `npm run test:integration`
- [x] 2.5 Type checking passes: `npx astro check`
- [x] 2.6 Linting passes: `npm run lint`
- [x] 2.7 Build succeeds: `npm run build`

#### Manual

- [x] 2.8 A scripted POST to `/api/projects/[id]/placements` with an overlapping set redirects with `layout_invalid` and stores nothing
- [x] 2.9 On a project with a manual layout, renaming a circuit keeps the layout and the badge; adding a circuit shows the reset notice and a fresh proposal

### Phase 3: Editor island

#### Automated

- [ ] 3.1 Unit tests pass: `npm run test:unit`
- [ ] 3.2 Type checking passes: `npx astro check`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 Build succeeds: `npm run build`
- [ ] 3.5 No palette classes, hex values or `rgba()` in the new components: a grep over `src/components/projects/LayoutEditor.tsx` and `WireLengthsTable.tsx`

#### Manual

- [ ] 3.6 On each starter cabinet: drag a group to another rail, reorder an MCB inside its group, move the main switch, save. The reload shows the wires re-routed, the lengths updated and the badge
- [ ] 3.7 A drop onto another device, a bar, or outside the group snaps back with a Polish reason
- [ ] 3.8 Keyboard only: pick up, move across rails, an invalid drop is announced, Escape restores, a valid drop saves
- [ ] 3.9 Undo/redo and Anuluj restore exact positions; leaving the page with a dirty draft prompts
- [ ] 3.10 "Zaproponuj układ od nowa" asks first, then replaces the layout and clears the badge
- [ ] 3.11 Before hydration (throttled network) the static wired drawing is visible
- [ ] 3.12 Kitchen sink shows every new editor state

### Phase 4: Docs and roadmap

#### Automated

- [ ] 4.1 Linting passes (Prettier on markdown runs via lint-staged): `npm run lint`
- [ ] 4.2 The roadmap sync plan shows no unexpected changes: `node scripts/roadmap-to-github.mjs`

#### Manual

- [ ] 4.3 The GitHub issue #7 and S-09 issue bodies match the roadmap after `--apply`
