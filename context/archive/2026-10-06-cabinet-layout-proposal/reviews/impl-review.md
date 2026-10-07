<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Propozycja układu aparatów w szafce (cabinet-layout-proposal)

- **Plan**: context/changes/cabinet-layout-proposal/plan.md
- **Scope**: Full plan (quick, low-cost pass — no sub-agents; targeted reads of endpoint, migrations, wiring constants)
- **Reviewed phases**: 0, 1, 2, 3, 4, 5, 5b, 5c, 6
- **Date**: 2026-10-07
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Checked: `save_project_layout` / `save_project_circuits` are `security invoker`, `search_path = ''`, EXECUTE revoked from public/anon and granted only to authenticated; `project_device_placements` has RLS with per-operation own-project policies, no UPDATE grant (matches "not doing" S-06). `POST /api/projects/[id]/layout` validates the UUID, handles the null client, refuses unless the match is `current`, and redirects with error codes. Ran: `npm run lint` (0 errors), `npx astro check` (0 errors), `npm run test:unit` (pass). Not re-run: `test:integration`, build, smoke.

## Findings

### F1 — Progress criterion 5.1 still says "exactly 15%" slack

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/cabinet-layout-proposal/plan.md (Progress 5.1 and Phase 5 automated criteria)
- **Detail**: Code uses `WIRE_SLACK_RATIO = 0.3` (src/lib/cabinet-wiring.ts:103), a documented user decision in change.md; the plan's criterion text was never updated.
- **Fix**: Change "15%" to "30%" in the Phase 5 criterion text (the Progress step title may stay; add a note instead if titles must not change).
- **Decision**: FIXED (plan text updated to 30%)

### F2 — roadmap-to-github.mjs extended in Phase 5 commit without a plan entry

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: scripts/roadmap-to-github.mjs (commit 724a01f, +166 lines)
- **Detail**: Adds mirroring of `## Parked` entries as `odłożone` issues. Benign and already documented in AGENTS.md tripwires, but it is tooling unrelated to the layout and landed inside a feature commit.
- **Fix**: Add a one-line addendum to the plan's Phase 6 noting the parked-entry sync; no code change.
- **Decision**: FIXED (Phase 6 addendum)
