<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Project Setup and Supply Parameters

- **Plan**: context/changes/project-setup-and-supply-params/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3
- **Date**: 2026-09-25
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 6 observations
- **Triage**: 8 fixed (F1–F7, F9), 2 accepted (F8, F10); all gates re-run green after fixes (lint, astro check, test:unit 345, build, test:integration 98, smoke)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Success criteria re-run during the review: lint clean, `astro check` 0 errors / 0 warnings, `test:unit` 336 passed, build complete, `test:integration` 98 passed, smoke all passed. All 30 Progress rows are `[x]`; the manual rows were driven in the browser (3.7 by the electrician against HD 60364-5-52:2011 B.52.2/B.52.4).

Known, accepted adaptations (not findings): inert defaults on the snapshot columns; `not_found` redirects to the list; the shared `src/components/projects/*` components; extra exports; D1 ampacity corrected against the standard and pinned; the archived-cabinet notice; the integration tests going beyond the plan.

## Findings

### F1 — Voltage-drop warning compares the rounded value

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/supply-warnings.ts:179
- **Detail**: ΔU is rounded to 2 decimals before the `> 0.5` comparison, so a true 0.500–0.505 % never warns. Example: 25 A, 13 m, Cu 10 mm², single-phase gives 0.5047 %, which shows as 0,50 % with no warning. This contradicts the module's "errs on the high side" framing.
- **Fix**: Compare the raw `voltageDropPercent(params)` against the limit, and round only for display, upwards (`Math.ceil(x * 100) / 100`) so the shown figure is never at or below the limit when the warning fires. Add a 13 m boundary test.
- **Decision**: FIXED — raw ΔU compared; display rounded up to 0.01; 13 m boundary test added (15 m case now shows 0,59 %)

### F2 — Server-rendered dates are formatted in UTC, not local time

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/i18n/format.ts:14, first SSR use at src/pages/dashboard/projects/index.astro:98
- **Detail**: `Intl.DateTimeFormat` has no `timeZone`, and on Workers the runtime zone is UTC. A project changed at 00:30 Warsaw time shows the previous day. This breaks the AGENTS.md / PRD rule that dates are stored in UTC and shown in the user's local time.
- **Fix A ⭐ Recommended**: Set `timeZone: "Europe/Warsaw"` in the shared formatters in `format.ts`.
  - Strength: A one-place fix that covers every current and future server-rendered date. The MVP ships one locale (`pl`) for Polish users.
  - Tradeoff: Hard-codes the zone. A future second locale or a user abroad would need a per-user zone.
  - Confidence: HIGH — `format.ts` is the single formatting source by design.
  - Blind spot: Existing `formatDate` tests may assume the runtime zone.
- **Fix B**: Render `<time datetime="…">` on the server and format it in the browser's zone on the client.
  - Strength: Truly the viewer's local zone, which is the letter of the rule.
  - Tradeoff: Needs a client script (the pages are island-free today), and the text flashes from ISO to formatted.
  - Confidence: MED — works, but introduces a new pattern.
  - Blind spot: The printed quote (S-09) would need the same treatment.
- **Decision**: FIXED differently (user's call) — viewer's zone from Cloudflare `request.cf.timezone`, resolved once per request in `src/middleware.ts` into `locals.timeZone` (validated; fallback Europe/Warsaw); `formatDate`/`formatDateTime` now require a zone; per-zone formatter cache; `format.test.ts` added; AGENTS.md convention line extended. Verified on dev: cf.timezone = Europe/Warsaw

### F3 — PEN minimum is checked only for TN-C, not TN-C-S

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/supply-warnings.ts:173
- **Detail**: The plan scoped the PEN warning to `earthing_system = TN-C`. In the common Polish TN-C-S arrangement the PEN splits in the switchboard itself, so the WLZ still carries a PEN, and Cu 6 mm² in TN-C-S raises nothing. The code follows the plan; this is a domain question about the plan.
- **Fix A ⭐ Recommended**: Also apply the PEN minimum for `TN-C-S`, with a comment saying it assumes the split is in the switchboard (not in the connection box).
  - Strength: Errs on the side of warning, consistent with the product guardrail. The warnings are informational only.
  - Tradeoff: A false warning where the split really happens in the connection box.
  - Confidence: MED — depends on the typical local practice, which the electrician knows.
  - Blind spot: Where the split happens isn't captured in the data.
- **Fix B**: Keep TN-C only and document that TN-C-S is deliberately excluded.
  - Strength: No false positives, and the plan stays unchanged.
  - Tradeoff: Misses an undersized PEN in the most common arrangement.
  - Confidence: MED.
  - Blind spot: Same as Fix A.
- **Decision**: FIXED via Fix A — PEN minimum for TN-C and TN-C-S; message and module doc updated; test fixture moved to TN-S

### F4 — Text parser trims more than the database CHECK

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/project.ts:83-94 vs supabase/migrations/20260924150000_projects.sql:86-96
- **Detail**: JS `trim()` strips all whitespace, but `btrim(x)` strips only spaces. A direct PostgREST write of `"\tDom"` or of a tab-only name passes the CHECK, even though the plan says the parsers "reject exactly what the CHECKs reject". The risk runs one way only: nothing the form accepts is refused by the database. The migration is not pushed yet (4 commits ahead of origin), so it can still be edited in place.
- **Fix**: In the three text CHECKs, compare against a regex trim, e.g. `name !~ '^\s|\s$'` alongside the `char_length` bound, then `npx supabase db reset` and add an RLS test for a tab-prefixed name (23514).
- **Decision**: FIXED — the three text CHECKs use `!~ '^[[:space:]]|[[:space:]]$'` instead of `btrim`; RLS test covers tab, newline and NBSP edges (23514). Residual: U+0085 may be DB-whitespace but not JS-whitespace — refused as invalid_input (safe direction)

### F5 — `23503` mapped to `cabinet_unavailable` can mislabel the `user_id` FK

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/project-errors.ts:57
- **Detail**: The BEFORE trigger raises P0002 for a missing cabinet before the FK is checked, so the only reachable `23503` is `user_id → profiles`. It would be shown as a cabinet problem.
- **Fix**: Drop `23503` from the mapping so it passes through as a code, and adjust `project-errors.test.ts`.
- **Decision**: FIXED — 23503 dropped from the map (passes through as a code); test asserts it is not labelled a cabinet problem

### F6 — Inline "·" separator in CabinetPicker

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/projects/CabinetPicker.astro:57
- **Detail**: `{cabinet.manufacturer} · {cabinet.model}` composes user-facing text inline, against the "never inline user-facing text" rule.
- **Fix**: Add `t.projects.cabinet.manufacturerModel(manufacturer, model)` to `pl.ts` and use it.
- **Decision**: FIXED — `t.projects.cabinet.manufacturerModel(manufacturer, model)` in pl.ts, used by CabinetPicker

### F7 — Redirect helpers duplicated across four endpoints

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/projects/[id]/{index,cabinet,delete,supply}.ts:15-18
- **Detail**: `notFound` and `back` are copy-pasted in each file. The cabinet endpoints use shared path builders in `src/lib/cabinet-catalog.ts`.
- **Fix**: Add `projectsErrorPath(code)` and `projectErrorPath(id, code)` to `src/lib/project.ts`, with tests, and use them.
- **Decision**: FIXED — `projectsErrorPath(code)` and `projectFormErrorPath(id | null, code)` in src/lib/project.ts (mirroring cabinet-catalog.ts), tested; all five endpoints use them

### F8 — Non-elektryk direct insert gets P0002 rather than 42501

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260924150000_projects.sql:151-181
- **Detail**: The BEFORE trigger runs before RLS WITH CHECK, so a caller who can't see active cabinets gets "cabinet unavailable" instead of "forbidden". The route gate makes this unreachable over HTTP, and nothing leaks.
- **Fix**: None needed — accept.
- **Decision**: ACCEPTED — unreachable over HTTP (route gate), nothing leaks

### F9 — Stale route-gate comment omits `supply`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/route-access.ts:27
- **Detail**: The comment lists "(create, details, cabinet, delete)" but not the Phase 3 supply endpoint.
- **Fix**: Add "supply" to the comment.
- **Decision**: FIXED — comment now lists supply

### F10 — Unrelated toolkit files landed in the Phase 1 commit

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: commit b9d3c66
- **Detail**: `CLAUDE.md`, `.claude/skills/10x-{frame,research,ui}/`, `.claude/.10x-cli-manifest.json` and the roadmap flip went in with Phase 1 by explicit choice ("Stage all"). This is commit hygiene only.
- **Fix**: None — accepted at commit time; history is unpushed if you want to split it.
- **Decision**: ACCEPTED — bundled by explicit "Stage all" at the phase 1 commit
