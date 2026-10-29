<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Catalog Lists and Cabinet Picker at Production Scale

- **Plan**: context/changes/catalog-pickers/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-29
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success criteria (run on master @ af77e5d)

- `npm run lint`: pass
- `npx astro check`: 0 errors
- `npm run test:unit`: 67 files, 1618 tests passed
- `npm run build`: pass
- `npm run test:integration`: 11 files, 384 tests passed
- `npm run test:e2e`: 11 passed, with users provisioned fresh as CI does (`E2E_USERNAME=` and `E2E_PASSWORD=` blank). With the `E2E_USERNAME` / `E2E_PASSWORD` accounts from `.env`, sign-in failed, most likely because the Phase 1 `db reset` removed that account; this is the local environment, not the code.
- Manual rows 1.6–1.7, 3.5–3.8 and 4.5–4.7: ticked by the phase sessions, which checked them in the browser and the database. Each session's report cites the evidence.

## Findings

### F1 — Clearing the filters can close the checked cabinet's group

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/catalog/catalog-filter.ts:203
- **Detail**: The plan's critical detail says the checked cabinet never hides and its group stays open. While a filter narrows, that holds. When the filter is cleared, though, `group.open` is restored from `openBeforeNarrowing` without looking at the checked radio. Repro on the project page: filter to "Podtynkowa", check a flush cabinet, clear the filters, and the flush group closes with the selection inside it. Submitting still works. No e2e test covers this.
- **Fix**: When restoring, keep any group that contains `input:checked` open (`group.open = openBeforeNarrowing[index] || group.querySelector("input:checked") !== null`), and add that step to `tests/e2e/cabinet-picker.spec.ts`.
- **Decision**: FIXED — a group keeps `open` when it holds `input:checked` after the filters clear; new e2e "a cabinet chosen under a filter keeps its group open once the filters clear" (went red with the fix reverted).

### F2 — The browser filter script ships zod, the device parser and the whole Polish dictionary

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/catalog-list.ts:3 (comment at :15-18)
- **Detail**: `catalog-list.ts` imports `POLE_CONFIGS` and `RCD_TYPES` at runtime from `device-spec.ts`. That module imports zod, `cabinet-geometry` and `i18n`, and builds schemas at the top of the module. The build emits `dist/client/_astro/device-spec.*.js` and `i18n.*.js` chunks for the catalog pages. This contradicts the module's own comment that the browser script stays free of the parser. It works, but every catalog page downloads parser code it never runs.
- **Fix A ⭐ Recommended**: Move `POLE_CONFIGS` and `RCD_TYPES` (plain constant arrays) into a small dependency-free module, for example `src/lib/device-constants.ts`, and have `device-spec.ts` re-export them.
  - Strength: The fix is at the source; every importer keeps working, and the client chunk drops zod.
  - Tradeoff: Touches `device-spec.ts`, a guarded-twice file (data-guards.md); a pure move with a re-export changes no rule.
  - Confidence: HIGH — the constants are literal arrays.
  - Blind spot: Whether `pl.ts` still gets pulled in through `plural()` from `@/lib/i18n`; check the build chunks afterwards.
- **Fix B**: Pass the pole and RCD-type order into the script from the server as `data-*` attributes.
  - Strength: The client imports nothing from `src/lib`'s parser layer.
  - Tradeoff: A second source for the ordering, which is exactly the drift Phase 2 set out to prevent.
  - Confidence: MED.
  - Blind spot: None significant.
- **Decision**: FIXED via Fix A — `POLE_CONFIGS` / `RCD_TYPES` moved to `src/lib/device-constants.ts`, re-exported by `device-spec.ts`; the filter script chunk now imports only `format`.

### F3 — An existing `lessons.md` entry was rewritten in an append-only file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/foundation/lessons.md:5-10
- **Detail**: The Phase 1 session added a "Supabase on Podman" lesson, which is useful, but it also rewrote the title, Context and Rule of the existing wslc entry. The file's header says it is append-only, and the edit has nothing to do with catalog pickers. The rewritten text is correct: the old rule said "keep Supabase on Docker", which is no longer true on this machine.
- **Fix**: Accept the edit as a correction of a now-false rule, or restore the original entry and let the new Podman entry supersede it.
- **Decision**: FIXED — the original wslc entry is restored verbatim; the appended Podman entry now says it supersedes the "stays on Docker" part.

### F4 — Server-rendered cabinet group count includes archived cabinets

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/cabinets/CabinetCatalogList.astro:125
- **Detail**: `l.count(group.items.length)` counts archived cabinets too. The script then recounts only visible items, so on the admin list the number changes after load, and without JavaScript it disagrees with the device list, which uses `activeCount`.
- **Fix**: Render the count from active items (`archived_at === null`), as `DeviceCatalogList.astro` does.
- **Decision**: FIXED — the server-rendered group count counts active cabinets only.

### F5 — `sortForCatalogList` no longer has a production caller

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/catalog.ts:16
- **Detail**: Every list now sorts with `compareCabinetsForCatalog` / `compareDevicesForCatalog`. `sortForCatalogList` is referenced only by its test, so it is a second ordering rule nothing uses.
- **Fix**: Delete it and its test cases.
- **Decision**: FIXED — `sortForCatalogList` and its tests deleted.

### F6 — Non-Karwasz production cabinets stay unclassified

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261029120000_cabinet_mounting.sql
- **Detail**: The backfill covers only Karwasz RN / RNH / UNI SYSTEM / RP. Any other production cabinet stays null; it can be found only under "all mountings" and lands in "Bez rodzaju montażu". This is expected by the plan's Migration Notes.
- **Fix**: Before the planned NOT NULL migration, query production for `mounting is null` and have the admin set those rows.
- **Decision**: ACCEPTED — tracked as a production check (`mounting is null`) before the planned NOT NULL migration; no code change.

### F7 — The DOM half of the filter script is covered only by the picker e2e spec

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/components/catalog/catalog-filter.ts
- **Detail**: The predicates are well unit-tested. But the admin device list's behaviour (catalog-gap sections kept via `data-catalog-keep`, the archived toggle) has no automated test; only the Phase 4 manual checks covered it.
- **Fix**: Add a short e2e spec for the admin device list: search narrows, the archived toggle reveals archived rows, and an empty kind keeps its gap message.
- **Decision**: FIXED — new `tests/e2e/admin-device-list.spec.ts`: closed sections, B6 before B10, search narrows, archived row hidden until "Pokaż zarchiwizowane". The empty-kind message is not covered (the seed has no empty kind; the kitchen-sink is dev-only).

## Triage summary (2026-10-29)

- Fixed: F1, F2 (Fix A), F3, F4, F5, F7
- Accepted: F6
- Gates after fixes: lint, `astro check`, `test:unit` (1614), `test:integration` (384), `test:e2e` (14, includes the build) all pass.
