<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Manual Layout Editing

- **Plan**: context/changes/manual-layout-editing/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-08
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated checks re-run during this review: `npm run lint` (pass), `npx astro check` (0 errors), `npm run test:unit` (979 passed), `npm run test:integration` (151 passed, local stack), `npm run build` (pass). Not re-run: `npx supabase db reset` and the `db:types` idempotence check.

Plan drift: none material. The migration is `20261008120000_manual_layout_edits.sql`, not the planned `20261007120000`; it still orders correctly and AGENTS.md names the real file. The extras are justified: `chooseSelectionLayout`, `layout-editor-data.ts`, `LayoutLegend.tsx`, `previewMove`, and the stricter parser caps that match the column types.

## Findings

### F1 — Circuit save now fails when stored rows don't parse

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/projects/[id]/circuits.ts:57
- **Detail**:
  - The endpoint switched from `loadMatchBase` to `loadLayoutContext`, which re-parses the stored groups and circuits. A parse failure returns `unknown` (`device-matching-server.ts:158-160`), and the endpoint answers `back(unknown)`.
  - Before this change, a circuit save never read the stored rows, so it was the way to overwrite bad stored data. Now bad stored data blocks it.
  - This is unreachable past today's CHECKs, but the coupling is new. The extra reads exist only to serve carry-over.
- **Fix**: Load the base as before; load the snapshot and placements separately, and treat any failure there as "no carry-over" (`editedManually = false`).
  - Strength: Restores the old guarantee that a circuit save always works on a valid base, and carry-over degrades to the safe default (a fresh proposal).
  - Tradeoff: A second loader path in `layout-server.ts`, plus a test for the fallback.
  - Confidence: MED — the failure is theoretical today.
  - Blind spot: Not checked whether `rematch.ts` deliberately needs the stored rows to parse (it re-matches stored circuits, so it probably does).
- **Decision**: FIXED — `loadPreviousLayout` / `previousLayoutFromReads` in `layout-server.ts`; circuits.ts uses `loadMatchBase` + it; 3 unit tests

### F2 — Layout draft restored after any `?error=`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/projects/[id].astro:276, :542
- **Detail**:
  - `LayoutEditor` gets `restoreDraft={restoreCircuitDraft}`, which is true for any `?error=`.
  - Example: a failed manual save, then a failed "Zaproponuj od nowa" (e.g. `layout_does_not_fit`), brings the old manual draft back as unsaved changes.
  - A draft that fails `validateLayout` is never restored, so the effect is only surprising, not invalid.
- **Fix**: Restore the layout draft only for layout save errors (`layout_invalid`, `layout_device_unavailable`, `invalid_input` returned to `#layout`), or clear the draft in the re-propose form's submit handler.
- **Decision**: FIXED — re-propose form's onSubmit clears the stored layout draft (`LayoutEditor.tsx`)

### F3 — A group split across rails can't be moved as a block

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/layout-editing.ts:209-221
- **Detail**: `moveUnit` packs every member onto the target rail. For a group wider than every rail (rule 1's exception) it is therefore always refused with `outside_rail`. This is safe, but the block handle is useless for such a group, which can only be edited device by device.
- **Fix**: Omit the block handle for split groups (or say so in the hint), and note it in the module header.
- **Decision**: FIXED — `editUnits(devices, groups, geometry?)` gives no block to a group wider than every rail; the editor passes `geometry`; header note + 1 unit test

### F4 — `placements.ts` parses the form after loading from the database

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/projects/[id]/placements.ts:48-60
- **Detail**: `circuits.ts:46-50` parses and refuses bad input before `createClient` and before any query. `placements.ts` loads the whole layout context (about 7 queries) first. The outcome is the same either way.
- **Fix**: Move `formData()` and `parsePlacementsPayload` above `createClient`.
- **Decision**: FIXED — payload parsed before `createClient` and the context load, as in circuits.ts

### F5 — The owner can set `edited_manually` directly

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261008120000_manual_layout_edits.sql:120-127
- **Detail**:
  - The owner can set the flag on their own rows through either RPC or a direct INSERT.
  - It drives only the badge and the carry-over decision, and carry-over still runs `validateLayout`. The impact is cosmetic.
  - This is the same kind of convention as `labour_override_base_minutes`.
- **Fix**: Note in the migration header (and the AGENTS.md tripwire) that the flag is a convention, not enforced by the database.
- **Decision**: FIXED — AGENTS.md placements tripwire states the flag is a convention, not DB-enforced

### F6 — Manual save can race a cabinet change

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/projects/[id]/placements.ts:48-67
- **Detail**:
  - The endpoint validates against geometry loaded before the RPC.
  - If a cabinet change lands in between, the RPC stores a set that was validated against the old cabinet.
  - The next render re-validates it and shows `outdated`, so it is never drawn. `layout.ts` has the same window.
- **Fix**: Accept; no change.
- **Decision**: ACCEPTED — render-time re-validation shows the set as outdated and never draws it

### F7 — Kitchen-sink editors point at a real endpoint

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/pages/dev/kitchen-sink.astro:642, :670, :715
- **Detail**: The plan said to mount the editors with `action="#"`, like the CircuitEditor examples. Instead they get `projectId={KS_PROJECT_ID}`, so clicking save posts to `/api/projects/<fixture id>/placements` and comes back not-found. This is dev-only.
- **Fix**: Let `LayoutSection`/`LayoutEditor` accept explicit actions, and pass `"#"` from the kitchen sink.
- **Decision**: FIXED — `LayoutSection` `formAction` override (editor + S-05 propose forms); the kitchen sink passes `"#"`

### F8 — Unrelated `.claude/launch.json` in the feature diff

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .claude/launch.json
- **Detail**: A `dev-4322` preview config used for the manual browser checks. It is harmless, but it is not part of S-06.
- **Fix**: Keep it as dev tooling, or drop it from the branch before merge.
- **Decision**: FIXED — `.claude/launch.json` reverted to master's version

## Triage summary (2026-10-08)

- Fixed: F1, F2, F3, F4, F5, F7, F8 (7)
- Accepted: F6 (1)

Verified after the fixes: `npm run lint` passes, `npx astro check` reports 0 errors, `npm run test:unit` passes (983 tests, 4 of them new), and `npm run build` succeeds. On `/dev/kitchen-sink` in the browser, every layout-editor form now posts to `#` and the group handles still render. `test:integration` was not re-run: no fix touches SQL or RLS.
