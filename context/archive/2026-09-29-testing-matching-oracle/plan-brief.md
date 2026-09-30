# Matching and Validation Oracle — Plan Brief

> Full plan: `context/changes/testing-matching-oracle/plan.md`
> Research: `context/changes/testing-matching-oracle/research.md`

## What & Why

Test-plan rollout Phase 1 (risks #1 and #3). The product's worst failure is proposing a device that
fails a circuit's parameters, or silently substituting one when the catalog has a gap. The next
worst is a dangerous configuration passing without a block or warning. This change makes the unit
tests prove the guardrail with an oracle taken from the PRD, the S-04 rule table and
PN-HD 60364-5-52 — never from the code under test.

## Starting Point

The matcher and the warnings are pure functions with decent literal-fixture tests, and every
ampacity cell is already pinned. What is missing:

- boundary pairs inside one catalog;
- several rule-table rows (3F RCBO, the fallback with only the MCB half missing, the F/B type
  boundary);
- property-based coverage;
- the installation → reference-method mapping;
- negative blocker cases.

Planning also found a real float bug: a voltage drop of exactly 0.5 % evaluates to
0.5000000000000001 and warns.

## Desired End State

`npm run test:unit` fails if the matcher ever chooses a non-compliant or non-cheapest device, mixes
selections with gaps, reports a false gap, or uses an FR as protection. It also fails if any warning
misfires at a reachable equality case, the next list value, or through a wrong installation mapping.
Exactly 0.5 % no longer warns. test-plan §6.1 becomes the recipe for "add a unit test for a domain
rule".

## Key Decisions Made

| Decision                                     | Choice                                                                              | Why (1 sentence)                                                       | Source          |
| -------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------- |
| Test layer                                   | Unit only, existing Vitest suite                                                    | Pure functions; cheapest real signal                                   | Research        |
| Boundary definition                          | "Equal vs next list value", not ±1 A                                                | Inputs are discrete lists; ±1 A is unreachable                         | Research        |
| Property-based library                       | Bare `fast-check` ^4, no adapter                                                    | Stable 4.x; the 0.x adapter pins the vitest peer range                 | Plan            |
| Property oracle                              | Rule predicate written in the test from the S-04 table; imports only `matchDevices` | Importing the rules recreates the oracle problem                       | Research / Plan |
| Risk #3 technique                            | Exhaustive `it.each`, no generators                                                 | Small, enumerable space (4 + 7 equality cases, 5 mappings)             | Research        |
| Voltage drop at exactly 0.5 %                | Must not warn; round to 9 places before the comparison and `ceilTo2`                | Matches "equality never warns" in every other warning                  | Plan            |
| Weak-oracle tests                            | Rewrite "FR never protection" per role; hand-computed Al/Cu percentages             | Guardrail tests must not hinge on emission order or restated constants | Plan            |
| Icn, RCD vs group load                       | Accepted MVP rules, recorded in test-plan §7                                        | Nobody pretends to test them                                           | Plan            |
| TT without RCD, In > pre-meter, 4P RCD on 1F | S-04 `Unknowns` on the roadmap + GitHub sync; 4P-on-1F pinned as today's rule       | New rules belong to S-04, not to a test change                         | Plan            |

## Scope

**In scope:**

- boundary tables for every matcher role;
- the property test;
- ampacity equality tables and the mapping table;
- the TN-S / TN-C-S / TT non-block cases;
- the voltage-drop fix;
- the weak-oracle rewrites;
- test-plan §3, §4, §6 and §7 updates;
- the S-04 handoff.

**Out of scope:**

- new matcher rules or warnings;
- re-pinning the ampacity tables;
- HTTP, database or e2e tests (test-plan Phases 2–3);
- CI changes;
- `@fast-check/vitest`.

## Architecture / Approach

Tests are added in order of risk: literal boundary tables first, then a property test that
generates supply × groups × circuits × catalog. The generators are biased toward each requirement
and its list neighbours so that `matched`, `gaps` and `blocked` all occur. The results are checked
against an independent predicate, and a distribution guard fails the test if one status never
appears. Then come the warning boundaries, then documentation. One green commit per phase.

## Phases at a Glance

| Phase                             | What it delivers                                                            | Key risk                                                   |
| --------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1. Matcher boundary tables        | Exact vs neighbour devices per role in one catalog; per-role kind check     | Expected values accidentally read off the code             |
| 2. Matcher property test          | `fast-check` + independent rule predicate, 4 properties, distribution guard | Generator only produces gaps, so the test passes vacuously |
| 3. Blocker and warning boundaries | Equality tables, mapping table, non-block cases, voltage-drop fix           | The float fix rounds away a genuine exceedance             |
| 4. Cookbook and handoff           | test-plan §6.1/§7/§3, S-04 unknowns + GitHub sync                           | Roadmap sync forgotten, so the board drifts                |

**Prerequisites:** S-04 p1 domain logic (committed, 648219f). The `Mr1008` gh account for the Phase 4
sync.
**Estimated effort:** ~2–3 sessions across 4 phases.

## Open Risks & Assumptions

- S-04 p3 is being implemented in parallel (untracked endpoints in the working tree). This change
  touches only `src/lib/` tests, `supply-warnings.ts` and docs, so a conflict is unlikely but possible
  in `roadmap.md`.
- The mapping rows rest on PN-HD 60364-5-52 Annex B and need the electrician's confirmation (Phase 3,
  manual).
- The property test uses a random seed. A failure in CI is a real counterexample, and fast-check
  reports the seed and the shrunk input needed to reproduce it.

## Success Criteria (Summary)

- A deliberately introduced off-by-one in any matcher filter or warning operator fails at least one
  test (mutation spot-checks in Phases 1–3).
- The property test's oracle reads as a transcription of the S-04 rule table, with no imports of the
  implementation's rules.
- A newcomer can add a boundary test for a new warning from test-plan §6.1 alone.
