<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Circuit Input and Device Matching

- **Plan**: context/changes/circuit-input-and-device-matching/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-30
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated gates run at review time (HEAD a0fbaff plus uncommitted testing-matching-oracle edits in the working tree):

- `npm run lint`: pass
- `npx astro check`: 0 errors
- `npm run test:unit`: 607/607
- `npm run test:integration`: 118/118
- `npm run build`: pass
- `npm run smoke`: not re-run, because it needs a running server; the plan records it as passing at 8f9ac8a

Manual items are all ticked. Evidence for 1.4 is in the code (the `Verified 2026-09-29` comment in `circuit-warnings.ts`). Items 4.6–4.9 are browser checks, and the diff cannot confirm them.

## Findings

### F1 — Stored snapshot is not re-checked for compliance; S-08 must not consume a stale one

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260929120000_circuits_and_device_matching.sql:193-213; src/pages/api/projects/[id]/circuits.ts:52-60; src/components/projects/MatchResult.astro:116
- **Detail**: The endpoint runs the match in one step and calls `save_project_circuits` in the next. The snapshot trigger copies whatever the catalog row holds when the RPC runs, and it only checks `archived_at is null`. That leaves two races:
  - An admin edits a device in place between the two steps (for example, changes its In from 16 to 20). The stored snapshot then holds a spec that fails the circuit.
  - The supply changes in the same window. The main switch is then stored against the old pre-meter protection.

  `computeMatchView` re-matches on every render, so both races show as `stale`, not `current`. Two gaps remain:
  - The stale snapshot still renders under "Dobrane aparaty", with the non-compliant parameters visible.
  - The contract "S-08 reads the snapshot" does not say S-08 may only use a snapshot whose view state is `current`.

  The database does not enforce compliance, only the TypeScript matcher does. An electrician can write their own project's snapshot directly through PostgREST.

- **Fix A ⭐ Recommended**: Write down the gating contract. Add a sentence to the AGENTS.md `project_devices` tripwire and to change.md's S-08 contract: S-08 and S-09 price and print only when `computeMatchView(...).state === "current"`, and otherwise block with "Dobierz ponownie".
  - Strength: S-08 is not built yet, so this costs nothing now. It closes the only path by which a non-compliant stored device could reach a quote, and it reuses the stale check that already runs.
  - Tradeoff: The guardrail relies on each consumer remembering the rule; the database still does not enforce it.
  - Confidence: HIGH — the stale detection compares selections by device id, and both races change which device the fresh match picks.
  - Blind spot: An in-place edit that changes a spec without changing which device is cheapest would still read as `current`. Example: B16 edited to B20 while a cheaper B16 remains elsewhere; the fresh match moves to the other device, so the state is `stale`. It is `current` only if the edited device is re-picked, which requires it still to comply. I have not proven this for every field.
- **Fix B**: Enforce compliance in the database. Pass the required parameters for each selection in `p_device_ids` (poles, exact or minimum In, IΔn, minimum type), and have the snapshot trigger raise `P0002 device_unavailable` when the copied row no longer satisfies them.
  - Strength: The stored snapshot becomes proof of compliance, and the race rolls back with the existing `device_unavailable` message.
  - Tradeoff: The rule table would live in two places (SQL and `device-matching.ts`). That creates another "two guards must change together" tripwire, plus a migration and new RLS tests.
  - Confidence: MED — straightforward, but it doubles the most sensitive logic in the product.
  - Blind spot: A direct PostgREST write could still send weaker requirements, so this checks the snapshot against what the caller claims rather than against the actual circuits.
- **Decision**: FIXED (Fix A) — gating rule added to the AGENTS.md `project_devices` tripwire and to change.md's S-08 contract.

### F2 — Unparseable catalog devices are dropped silently, not logged

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/device-matching.ts:119-131 (`activeCatalog`), called from src/lib/device-matching-server.ts:105
- **Detail**: Phase 3 §2 said to drop and log devices that fail `parseDeviceSpec`, with the SQLSTATE or id only. `activeCatalog` drops them with no trace. A malformed catalog row therefore surfaces as an unexplained catalog gap, and nothing in `wrangler tail` shows the reason.
- **Fix**: In `loadMatchContext`, compare the raw row count with `activeCatalog`'s output and log the dropped ids through the existing `logLoadFailure`-style `console.error`. Keep `activeCatalog` itself pure.
- **Decision**: FIXED — `loadMatchBase` logs the ids of devices dropped as unparseable (`parseCatalog` in device-matching-server.ts).

### F3 — Unplanned additions are not recorded as plan addenda

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: context/changes/circuit-input-and-device-matching/plan.md
- **Detail**: The plan diffs in 53d5b4f, 389442a, 8f9ac8a and a0fbaff only tick checkboxes. None of the following behaviour changes is written down:
  - the `circuit_group_unknown` blocker;
  - empty RCD groups being skipped, with no RCD selected;
  - the fifth view state, `cleared`;
  - the aside badges "Zablokowany" and "Niedostępny";
  - the RPC's 42501 refusal of an id from another project of the same owner;
  - 42501 mapped to `forbidden`;
  - the fifth AGENTS.md tripwire, on `save_project_circuits`.

  All of them are benign hardening, but S-05 and S-08 will read this plan as ground truth.

- **Fix**: Append an `## Addendum (implementation)` section to plan.md listing these behaviours in one line each.
- **Decision**: FIXED — `## Addendum (implementation and impl-review, 2026-09-30)` appended to plan.md.

### F4 — The RPC's same-owner cross-project id guard has no test

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260929120000_circuits_and_device_matching.sql:441-449, 477-484; tests/integration/rls-circuits.test.ts
- **Detail**: The integration tests cover another owner's id (42501) and a foreign group through the foreign key (23503). They do not cover an owner reusing a group or circuit id from their own project A while saving project B. In that case the upsert has already overwritten A's row, and correctness depends entirely on the exception rolling it back.
- **Fix**: Add one integration test: save B with an id from A, expect 42501, then assert that A's label and position are unchanged.
- **Decision**: FIXED — integration test "reusing a group or circuit id from the owner's other project raises 42501 and rolls back".

### F5 — The group RCD rule is `In ≥ max(circuit In)`, not the summed load

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/device-matching.ts:206
- **Detail**: Three 16 A circuits accept a 16 A RCD. This is deliberate: it is in the plan's rule table, and the electrician confirmed it at step 1.5. It is still the one place where "compliant" is weaker than common practice (RCD In ≥ the upstream protection, or ≥ the summed load). Breaking capacity is also never checked, which the plan records as out of scope.
- **Fix**: No code change. Record it in change.md, or as an Open Question in the PRD, so the choice stays visible when S-08 quotes these devices.
  - Strength: Keeps the confirmed rule and makes the tradeoff explicit.
  - Tradeoff: The weaker rule stays until someone revisits it.
  - Confidence: HIGH — the electrician already made the decision.
  - Blind spot: None significant.
- **Decision**: FIXED (differently, per user) — rule changed to `RCD In ≥ ΣIn × (100 + margin) / 100`, with the margin a per-group field (default 15 %, list 0–50) chosen in the group card. New migration `20260930120000_rcd_group_margin.sql`, parser, draft, matcher, gap text, editor hint, and unit + property + integration tests updated; recorded in the plan addendum and in AGENTS.md.

### F6 — Mixed closing quotation marks in pl.ts

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/i18n/pl.ts (`circuitSection.servesGroup`/`servesCircuit`, `circuitWarnings.*`, `matching.gaps.*`, `matching.blockReasons.*`)
- **Detail**: These strings close `„…"` with an ASCII `"`, while `circuits.editor` and `circuits.dnd` use the typographic `”`.
- **Fix**: Replace the ASCII closing `"` after `„${…}` with `”` in those groups.
- **Decision**: FIXED — 10 closing quotes normalised to ” in pl.ts.

### F7 — Redundant queries in loadMatchContext

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard/projects/[id].astro (~:119); src/pages/api/projects/[id]/circuits.ts:51
- **Detail**: The page queries `projects` again, although it has already loaded the row. The circuits endpoint loads the stored groups, circuits and snapshot, and never uses them. The queries run in parallel and the catalog is small, so the cost is negligible.
- **Fix**: Leave as is for MVP. Revisit if the catalog grows.
- **Decision**: FIXED — `loadMatchBase` split out; the save endpoint no longer loads the stored rows, and the page passes its project row.

## Triage summary

- Fixed: F1 (Fix A), F2, F3, F4, F5 (differently: sum + per-group margin), F6, F7 (7)
- Post-fix gates: lint ✅ · astro check 0 errors ✅ · test:unit 613 ✅ · test:integration 120 ✅ · build ✅
- The kitchen sink shows the new margin select and the RCD requirement hint.
