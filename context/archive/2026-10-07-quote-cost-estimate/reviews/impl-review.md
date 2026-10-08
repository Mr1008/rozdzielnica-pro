<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Quote Cost Estimate (S-08)

- **Plan**: context/changes/quote-cost-estimate/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-08
- **Verdict**: REJECTED (one critical finding, F1. It is cheap to fix because nothing is pushed yet.)
- **Findings**: 1 critical, 2 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

Automated checks re-run on 2026-10-08:

- PASS: `test:unit` (908), lint, `astro check` (0 errors), Prettier, build.
- FAIL: `test:integration`, in the 6 labour-override tests. The local database was reset by the parallel S-06 worktree (see F1). Its schema history records version `20261007120000` as `manual_layout_edits`, so the override columns are absent (42703 / PGRST204). The same suite passed 32/32 at 5dc5092.

Manual checks 3.2–3.9 and 4.2 are `[x]` with browser evidence recorded in the session. 4.2 was confirmed by the user.

## Findings

### F1 — Migration version collides with S-06

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20261007120000_project_labour_override.sql
- **Detail**:
  - The parallel worktree `claude/manual-layout-editing-344a77` (S-06) has an uncommitted `20261007120000_manual_layout_edits.sql` with the same version.
  - `supabase db push` tracks migrations by version. Whichever branch reaches master second would have its migration silently skipped in the cloud, and its code would then run against a schema that lacks its columns.
  - Locally, the S-06 session's reset already put its own migration under that version. That is why `test:integration` fails now.
  - Neither branch is pushed: `origin/master` does not contain adb9ca4…644bfc8.
- **Fix A ⭐ Recommended**: Rename this change's migration to a unique later version, e.g. `20261008090000_project_labour_override.sql`, in a new commit (not an amend). Update the AGENTS.md tripwire path, reset the local stack, and re-run `test:integration`.
  - Strength: Fully in this change's control. The commits are unpushed, so no cloud history is affected.
  - Tradeoff: The local stack still holds S-06's migration until the next reset. That reset also replays S-06's file if it is ever on the same checkout.
  - Confidence: HIGH — the CLI orders and tracks by the filename version only.
  - Blind spot: The S-06 session may also rename its file. Coordinate so the two don't swap into a new clash.
- **Fix B**: Ask the S-06 session to rename its uncommitted migration instead.
  - Strength: S-06 has not committed it, and it merges after S-08, so it is the natural one to move.
  - Tradeoff: It depends on another session acting. Until then, both worktrees keep resetting the shared local DB with different migrations under one version.
  - Confidence: MED — it requires coordination outside this change.
  - Blind spot: The S-06 session's current state and intent.
- **Decision**: FIXED via Fix A — renamed to `20261008090000_project_labour_override.sql`; AGENTS.md path updated; db reset + test:integration 148/148

### F2 — Formula line reads the profile outside QuoteView

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/components/projects/QuoteSection.astro:29, 132-136
- **Detail**:
  - The plan's contract gives QuoteSection only `view` and `projectId`, with every number taken from `QuoteView`.
  - The AGENTS.md tripwire tells S-09 to print only the view.
  - The formula line ("6 aparatów × 15 min + 90 min") needs mount minutes and overhead, which `ReadyQuote` lacks. A `profile` prop was added to supply them.
  - As a result, S-09 would also need the profile row to print the formula.
- **Fix**: Add `mountMinutesPerDevice` and `overheadMinutes` to `ReadyQuote` in `computeQuoteView`, drop the `profile` prop, and extend the `quote.test.ts` ready-state expectations.
  - Strength: Keeps the tripwire true: one view object carries every printed number.
  - Tradeoff: A small API change touching the page, the kitchen sink and the tests.
  - Confidence: HIGH — the values are already inputs to `computeQuoteView`.
  - Blind spot: None significant.
- **Decision**: FIXED — `ReadyQuote` carries `mountMinutesPerDevice` / `overheadMinutes`; `profile` prop removed from QuoteSection, the page and the kitchen sink; quote.test.ts expects both

### F3 — Override base is the estimate at POST time, not the one displayed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/projects/[id]/quote.ts:72-84
- **Detail**:
  - The endpoint recomputes the estimate on the server and stores it as the base.
  - Suppose the snapshot, catalog or profile changes between rendering the page and submitting the form, e.g. in another tab. The override is then stored against an estimate the electrician never saw, and it is never flagged as outdated.
  - This is low likelihood with one user per account, and it fails toward "no warning".
- **Fix A ⭐ Recommended**: Accept the risk and document it next to the endpoint's base computation.
  - Strength: No added surface. With one user per account the window is a second-tab edit.
  - Tradeoff: The rare silent mismatch remains.
  - Confidence: MED — it depends on usage staying single-tab.
  - Blind spot: S-09 may make "print right after editing" more common.
- **Fix B**: Post the displayed `estimateMinutes` as a hidden field, used only for comparison. On a mismatch, redirect with a new `quote_estimate_changed` error so the electrician sees the new estimate before saving.
  - Strength: Closes the gap without trusting the client: the base is still server-computed.
  - Tradeoff: A new error code, a Polish string, a form field and a test.
  - Confidence: HIGH — a standard optimistic-concurrency check.
  - Blind spot: It adds friction on every save after any re-match.
- **Decision**: ACCEPTED via Fix A — risk documented next to the base computation in `src/pages/api/projects/[id]/quote.ts`

### F4 — AGENTS.md says the base is "written only by the endpoint"; the DB does not enforce it

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: AGENTS.md:106-114
- **Detail**: The owner's JWT can update `labour_override_base_minutes` directly through PostgREST (table-wide UPDATE grant, no guarding trigger). The only effect is that an owner can fake their own "outdated" flag, but the tripwire overstates the guarantee.
- **Fix**: Reword it to "written by the endpoint (convention — not enforced by the database)".
- **Decision**: FIXED — AGENTS.md now says the base is written by the endpoint as a convention, not enforced by the database

### F5 — Extra queries on the quote paths

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/projects/[id]/quote.ts:72; src/pages/dashboard/projects/[id].astro:~169
- **Detail**:
  - The endpoint uses `loadLayoutContext`, which also queries placements the quote never reads.
  - The page loads the pricing profile only after the project and match loads, adding one sequential round trip per render.
- **Fix**: Call `loadMatchContext` in the endpoint, and start the profile load in parallel with the project load on the page.
- **Decision**: FIXED — endpoint uses `loadMatchContext` (no placements query); the project page loads the pricing profile in parallel with the project

### F6 — Minutes input uses a literal max

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/projects/QuoteSection.astro:231
- **Detail**: The minutes input has `max={59}`, while hours uses `MAX_LABOUR_OVERRIDE_HOURS`. The parser's bound is private (`MINUTES_PER_HOUR - 1`).
- **Fix**: Export `MAX_LABOUR_OVERRIDE_MINUTE_PART = 59` from quote.ts and use it in both the parser and the input.
- **Decision**: FIXED — `MAX_LABOUR_OVERRIDE_MINUTE_PART` exported from quote.ts, used by the parser and the minutes input

### F7 — Endpoint decisions have no automated coverage

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/pages/api/projects/[id]/quote.ts
- **Detail**: Three behaviours are verified only manually (3.6, 3.8, 3.9): refusing to set an override in `no_profile` / `not_current`, storing the server-computed base, and clearing with no precondition. This matches the documented "suites cover no HTTP" tripwire.
- **Fix**: Leave it to test-plan rollout Phase 3 (e2e), and note these cases as its first candidates.
- **Decision**: FIXED — the endpoint cases are listed as e2e candidates in `context/foundation/test-plan.md` §6.3

### F8 — Unrelated GH-sync rework bundled into the p1 commit

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/roadmap-to-github.mjs (commit adb9ca4)
- **Detail**: The fetch→diff→execute rewrite of the roadmap sync script landed in `feat(quote-cost-estimate): Quote domain (p1)`. The user chose "Stage all", and the commit body says so, but `git log -- scripts/` now attributes it to S-08.
- **Fix**: No code change. Accept as recorded.
- **Decision**: ACCEPTED — recorded; no code change
