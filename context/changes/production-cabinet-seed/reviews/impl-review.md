<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Produkcyjny seed szaf Karwasz

- **Plan**: context/changes/production-cabinet-seed/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-10-21
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated criteria re-run on master at 0f45f14: `test:unit` (57 files, 1377 tests), `test:integration` (9 files, 175 tests), lint, `astro check` (0 errors) and build all pass. All 33 data rows match the plan table. The only items beyond the plan are small: two extra "rails do not fit" guards, a bar-depth check, and a test that a too-narrow cabinet throws with the model name. None contradicts the plan.

## Findings

### F1 — `on conflict do nothing` silently skips an existing production row

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261021120000_karwasz_cabinets.sql:51
- **Detail**: Suppose production already holds a Karwasz row with one of these models, for example because an admin entered "RN-24" by hand or archived one. Then the migration keeps that row unchanged, with its own geometry and price, and the cloud catalog silently differs from the module. The plan assumed the cloud has no catalog cabinets, but that was never checked. Switching to `do update` would overwrite admin data, so it is not an option.
- **Fix**: Before pushing, run a read-only `select model, archived_at, price_grosze from public.cabinets where lower(manufacturer) = 'karwasz'` against production, and push only if it returns 0 rows.
  - Strength: It turns the assumption into a fact at the one moment it matters, without changing the migration.
  - Tradeoff: A manual pre-deploy step.
  - Confidence: HIGH — the conflict target matches `cabinets_manufacturer_model_key` exactly.
  - Blind spot: Production contents are not yet inspected.
- **Decision**: FIXED — read-only select on production (project `csrdjjfffgduezgbmpgt`, 2026-10-21) returned 0 cabinets in total and no Karwasz rows, so all 33 rows will insert.

### F2 — Integration test asserts every Karwasz row in the database

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: tests/integration/karwasz-cabinets.test.ts:15-25
- **Detail**: The test selects every row with `manufacturer = 'Karwasz'`, expects exactly 33, and throws on any model not in the module. If someone adds a Karwasz cabinet locally through the UI, the test breaks. `rls-cabinets.test.ts:228-236` deliberately filters by the seeded models to avoid exactly that.
- **Fix**: Filter `.in("model", KARWASZ_CABINETS.map((c) => c.model))` and assert `toHaveLength(KARWASZ_CABINETS.length)`.
- **Decision**: FIXED — filtered by the module's models and asserted `KARWASZ_CABINETS.length`; the test passes and lint is clean.

### F3 — `rls-circuits` picks an arbitrary active cabinet

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/rls-circuits.test.ts:251
- **Detail**: The test takes `archived_at is null limit(1)` with no `order`, so it may now get a Karwasz cabinet. It passes today (175/175). `rls-layout.test.ts:199` orders by model, so it still reaches the PRZ rows.
- **Fix**: Leave it unless the test starts to depend on a specific geometry; if it does, select by a seeded PRZ model.
- **Decision**: ACCEPTED — passes today; revisit only if the test starts to depend on a specific geometry.

### F4 — The depth-overlap fallback hardcodes z 20/35 and is untested

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/karwasz-cabinets.ts:51-52,166-172
- **Detail**: The third placement (bars overlapping in depth) uses `BAR_Z_FRONT_MM`/`BAR_Z_BACK_MM` (gap 15) rather than `BAR_Z_CLEARANCE_MM` from `cabinet-geometry.ts`. No real row reaches that branch. Any future row that does would still go through the per-row `parseCabinetGeometry` test, so it cannot ship invalid geometry.
- **Fix**: Leave it; the parser test already guards every row that could reach the branch.
- **Decision**: ACCEPTED — no row reaches the branch; the per-row `parseCabinetGeometry` test guards any that would.

### F5 — Migration timestamp vs parallel sessions

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261021120000_karwasz_cabinets.sql
- **Detail**: This is currently the latest migration. A parallel session that later lands a migration with an earlier timestamp after this one deploys would be refused by `supabase db push` as out of order.
- **Fix**: Check `ls supabase/migrations` right before pushing. A data-only migration may be renamed to a later timestamp, but only before it deploys.
- **Decision**: ACCEPTED — pre-push check: `ls supabase/migrations` before pushing master.
