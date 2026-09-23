<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Admin Cabinet Catalog

- **Plan**: context/changes/admin-cabinet-catalog/plan.md
- **Mode**: Deep
- **Date**: 2026-09-23
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | PASS    |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

9/9 paths ✓, 4/4 symbols ✓, brief↔plan ✓, Progress↔Phases 24/24 ✓. Verified: Astro `checkOrigin`
defaults on for `output: "server"` (covers the new POST form endpoints); `createClient<Database>`
breaks none of its 4 callers (all use only `supabase.auth.*`); the `/api/admin` entry breaks no
`route-access.test.ts` invariant.

## Findings

### F1 — Local and cloud grants differ, so the tests' outcome depends on where they run

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 — Migration, RLS integration tests
- **Detail**: The local stack (CLI 2.117, no `auto_expose_new_tables`) auto-grants ALL on new
  `public` tables to anon/authenticated; Supabase dropped that default for projects created after
  2026-05-30 and removes it everywhere on 2026-10-30, so the September cloud project most likely
  gets nothing. "Nothing to anon" is false locally without a REVOKE, and "admin delete removes 0
  rows" / "anon reads nothing" pass only because of the automatic grants — without them PostgREST
  returns `42501`.
- **Fix**: `revoke all on public.cabinets from anon;` + `revoke delete on public.cabinets from authenticated;`
  in the migration; tests expect `42501` for anon select and admin delete.
- **Decision**: FIXED (fix in plan)

### F2 — The "db:types produces no diff" criterion conflicts with the pre-commit hook

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Generated database types (criterion 2.2)
- **Detail**: lint-staged runs `eslint --fix` (with Prettier as a rule) on every `*.ts` at commit,
  so the committed generated file will differ from CLI output and 2.2 always fails. The plan
  excludes it only "if it trips".
- **Fix**: Unconditionally add `src/lib/database.types.ts` to `eslint.config.js` ignores and
  `.prettierignore` in the same step that adds `db:types`.
- **Decision**: FIXED (fix in plan)

### F3 — Second integration file would duplicate ~130 lines of harness

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 — RLS integration tests
- **Detail**: The helpers to "reuse" are inline in `tests/integration/rls-profiles.test.ts:19-148`;
  there is no shared module, so reuse means copy-paste.
- **Fix**: Extract into `tests/integration/support.ts`, imported by both files.
- **Decision**: FIXED (fix in plan)

### F4 — Three input edge cases left to whatever the code does

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 4 — Form parsing, Pages and endpoints
- **Detail**: (a) non-UUID `[id]` → `22P02` → `unknown`, not the promised 404; (b) pre-filling the
  price with `formatMoney` yields "1 234,56 zł" (NBSP) which the parser rejects; (c) the unique
  constraint is case-sensitive ("Hager" ≠ "hager").
- **Fix**: UUID-validate `[id]` (invalid → 404); pre-fill price as a plain decimal and test it;
  unique index on `(lower(manufacturer), lower(model))`.
- **Decision**: FIXED (fix in plan)
