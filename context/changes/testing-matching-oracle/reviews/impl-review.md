<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Matching and Validation Oracle

- **Plan**: context/changes/testing-matching-oracle/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-30
- **Verdict**: APPROVED
- **Findings**: 0 critical, 1 warning, 6 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: re-ran `npm run test:unit` (607/607 at HEAD), `npm run lint`, `npx astro check` (0 errors), prettier on
test-plan.md/roadmap.md, the import grep, and `npm run build`. All pass. The mutation spot-checks (1.3, 2.4, 3.4)
were run live during implementation, and every mutation turned tests red. A brute force over all 980,000
reachable supply inputs confirms the 9-place voltage-drop rounding. It never rounds a real drop above 0.5 % down:
the smallest real excess is 2.66e-5. It changes the warning verdict only for the five inputs that are exactly
0.5 %.

Scope note: the property test is stricter than planned. It checks the exact set of block codes, the exact
selection keys and notes, and the exact gap list. Commit b8a36a2 also carried the pre-existing S-04 `in-progress`
flip in roadmap.md, which the user approved at commit time. Both are benign and inside the change's intent.

Environment note: this does not affect HEAD. The working tree currently fails
`device-matching.test.ts > messages > names exactly what is missing…` because of the S-04 session's uncommitted
`src/lib/i18n/pl.ts` edits: a new RCD-gap message with a curly `”` quote. That session needs to update the test
alongside its message change.

## Findings

### F1 — Property-test catalog never smaller than 4 devices

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/device-matching.property.test.ts:416
- **Detail**: The plan specifies a catalog of 0–15 devices; the generator uses `minLength: 4, maxLength: 15`, so an
  empty or near-empty catalog (the all-gaps case, including a missing main switch) is never explored by the property.
  The minimum was raised to lift the `matched` share during implementation.
- **Fix**: Set `minLength: 0` (keep `size: "max"` so large catalogs still dominate) and confirm the distribution
  guard still sees all three statuses.
- **Decision**: FIXED (Fix now)

### F2 — Rounding comment overstates a general guarantee

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/supply-warnings.ts:195-196
- **Detail**: "any drop genuinely above 0.5 % stays above it" holds only because inputs are discrete (0.1 m length
  steps, fixed lists); the smallest real excess is 2.66e-5, far above the 5e-10 rounding window. A finer length
  step or a continuous input would need re-checking.
- **Fix**: Reword the comment to state the discrete-input reason and the measured margin.
- **Decision**: FIXED (Fix now)

### F3 — Display improvement from the rounding is not pinned

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/supply-warnings.test.ts:263
- **Detail**: The rounding also fixes 165 displayed values (e.g. 1F Cu 2.5 mm², 16 A, 16.1 m showed 1.61 %, now
  the exact 1.60 %). Only the exact-0.5 % case is tested, so a revert would be caught only at the limit.
- **Fix**: Add one case asserting `percent: 1.6` for 1F Cu 2.5 mm², 16 A, 16.1 m (hand calc 200·16.1·16 /
  (56·2.5·230) = 1.6).
- **Decision**: FIXED (Fix now)

### F4 — RCBO type-rank rejection asserts weakly

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/device-matching.test.ts:713
- **Detail**: The rejected branch only asserts `toContain("rcbo")`. The group-RCD twin asserts the exact list. The
  test is not vacuous (`gapsOf` throws on a non-gaps result), but it would miss an extra or missing fallback gap.
- **Fix**: Assert the exact sorted gap roles (`["mcb", "rcbo", "rcd"]`: the RCBO plus both fallback parts, since
  the catalog has neither an RCD nor an MCB).
- **Decision**: FIXED (Fix now)

### F5 — §6.1 calls a comment a "blok"

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/foundation/test-plan.md:111
- **Detail**: "blok „Boundary tables (risk #1)”" is a block comment in device-matching.test.ts. The actual
  `describe` names are `boundaries — …`, so a reader searching for a describe won't find it.
- **Fix**: Reword to "the `boundaries — …` describes (under the „Boundary tables (risk #1)” comment)".
- **Decision**: FIXED (Fix now)

### F6 — Row 4.2's title doesn't describe what was verified

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/testing-matching-oracle/plan.md (Progress 4.2)
- **Detail**: `roadmap-to-github.mjs` plan mode never queries GitHub, so it always lists every operation; "no pending
  changes" cannot occur. The sync was verified instead by the apply's "już istnieje" output and by reading issue #5's
  body. The row is checked with an unstated adaptation.
- **Fix**: Add a one-line note under the Phase 4 Progress rows recording the adaptation (row titles stay unchanged).
- **Decision**: FIXED (Fix now)

### F7 — Pre-existing `ceilTo2` overstatement on 64 inputs

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/supply-warnings.ts:162
- **Detail**: 64 single-phase inputs with drops ≥ 1.12 % still display 0.01 high (e.g. 17.61 instead of 17.60,
  because `17.6 * 100 = 1760.0000000000002`). This predates this change, is never low, and fits the
  informational intent.
- **Fix**: Out of scope here. If wanted, `Math.ceil(Number((value * 100).toFixed(6))) / 100` in a follow-up.
- **Decision**: FIXED (Fix now)
