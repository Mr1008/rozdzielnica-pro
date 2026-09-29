---
date: 2026-09-29T15:11:30+02:00
researcher: Claude (Opus 5.5) for Jakub Michałek
git_commit: 648219f
branch: master
repository: rozdzielnica-pro
topic: "Ground rollout Phase 1 of test-plan.md — matching and validation oracle (risks #1, #3)"
tags: [research, testing, device-matching, circuit-warnings, supply-warnings, oracle]
status: complete
last_updated: 2026-09-29
last_updated_by: Claude (Opus 5.5)
---

# Research: Matching and validation oracle (test-plan Phase 1)

**Date**: 2026-09-29T15:11:30+02:00
**Researcher**: Claude (Opus 5.5) for Jakub Michałek
**Git Commit**: 648219f (working tree has uncommitted S-04 p2 changes, incl. `src/lib/circuit-params.ts`)
**Branch**: master
**Repository**: rozdzielnica-pro

## Research Question

Ground risks #1 (device that fails a circuit's parameters is proposed, or a catalog gap is silently
substituted) and #3 (dangerous configuration passes without block or warning; ampacity table error)
from `context/foundation/test-plan.md` §2 in the current code. Verify or correct the Risk Response
Guidance, locate existing tests, classify their oracles, and name the cheapest useful test layer.

## Summary

- **Risk #1 is real and mostly well-guarded; the gaps are in coverage shape, not in the filter.** In
  the inspected matcher, `cheapest()` is called only on already-filtered candidates
  (`src/lib/device-matching.ts:145-154`, used at :192, :208, :227, :287). The result is
  all-or-nothing: any gap discards all selections (:417). The existing tests use hand-built fixtures
  with literal expected ids and are, for the rule checks, independent oracles. What is missing is
  (a) **boundary pairs in one catalog** (a device just below and just above the requirement, side by
  side), (b) several **untested rule-table rows** (3F RCBO, type F vs a B minimum, a cheaper 4P RCD
  on 1F, fallback with only the MCB missing, RCD In exactly equal to the largest circuit In), and
  (c) **no property-based coverage** of "every selected device satisfies the rule predicate, and no
  cheaper compliant device exists". `fast-check` is not a dependency (`package.json`: only
  `vitest ^5.0.1` at :69).
- **Risk #3 is real, and the guidance needs one correction.** The "±1 A" wording cannot be tested
  literally. Rated currents, pre-meter protections and cross-sections are discrete lists
  (`src/lib/circuit-params.ts:19`, `src/lib/supply-params.ts`), so the boundary is "equal" vs "next
  list value". Equality is reachable in exactly 4 circuit combinations and 7 WLZ combinations
  (listed below). The existing tests cover 1 of each.
- **The ampacity tables are pinned value-by-value.** Every `AMPACITY_A` cell is pinned
  (`src/lib/supply-warnings.test.ts:56-77`), as is the separate 1.5 mm² table
  (`src/lib/circuit-warnings.test.ts:82`). Both carry an electrician-verification comment dated
  2026-09-25 / 2026-09-29. So "table values pinned to the standard" is **already satisfied**. The
  residual risk is the lookup _path_ (installation → reference method → loaded conductors), which
  only has 3 spot checks (`circuit-warnings.test.ts:95-97`).
- **Findings that are not test gaps but domain questions** go to the user, not into tests (see Open
  Questions):
  - breaking capacity is never compared;
  - RCD In is checked against the largest MCB, not the group load;
  - TT with no RCD neither warns nor blocks;
  - circuit In above the pre-meter protection is not warned.

## Detailed Findings

### Risk #1 — the matcher guardrail

**The rule table** (as implemented; it matches the S-04 plan table at
`context/changes/circuit-input-and-device-matching/plan.md:168-176`):

| Role                 | Where                                        | Comparison                                                                                                                                                                               |
| -------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main switch (FR)     | `device-matching.ts:287-290`, poles :162-166 | `rated_current_a >= premeter_protection_a`. Poles: 1F → 2P (TN-C 1P); 3F → 4P (TN-C 3P)                                                                                                  |
| MCB (`mcb_b`)        | `matchMcb` :186-198, poles :168-172          | `rated_current_a === circuit In` exactly. Poles: 1F {1P, 1P+N, 2P}, 3F {3P, 3P+N, 4P}; TN-C 1P/3P only                                                                                   |
| Group RCD            | `matchRcd` :200-218, poles :174-176          | `rated_current_a >= max(circuit In)` (:206); `residual_current_ma ===` group; `rcdTypeRank >=` minimum, ranks `{AC:0, A:1, F:2, B:3}` (:108). Poles: 4P if any 3F circuit, else {2P, 4P} |
| Single-circuit group | `matchRcbo` :220-237, poles :178-180         | In exact, IΔn exact, type rank ≥. Poles: 1F {1P+N, 2P}, 3F {3P+N, 4P}. Fallback to RCD + MCB (:335-352)                                                                                  |
| Ungrouped circuit    | :414                                         | MCB with note `no_rcd`                                                                                                                                                                   |

**Cheapest after the filter.** Every `cheapest(...)` call receives the output of
`ofKind(...).filter(...)` (:192, :208, :227, :287). The tie-break is price → manufacturer → model →
id, using code-unit comparison (:134-154), so it is deterministic and locale-independent. The
guidance's "must challenge" holds in the inspected code path. A test should still prove it
_behaviourally_: a cheaper non-compliant device sits in the same fixture and is not chosen. That
test exists for MCB B20-vs-B16 (`device-matching.test.ts:189-258`) but not for the RCD, RCBO or FR
roles.

**Catalog hygiene.** `activeCatalog` (:119-131) drops rows that are archived, have a non-UUID id, or
fail `parseDeviceSpec`. `matchDevices` does not re-check `archived_at` itself; it trusts its input.
This is an inference boundary: a caller that skips `activeCatalog` would reach archived devices.
That caller path is in S-04 p3 (not yet built), so it belongs to test-plan Phase 3 / an integration
check, not to Phase 1.

**Gap shape.** `CatalogGap` (:67-101) carries role, kind, allowed poles, the min or exact rating,
mA and min type (RCD/RCBO), the group/circuit identity and `fallback`. That is enough to name the
missing device. `catalogGapMessage` renders it (:446-466). If any gap exists, selections are
dropped (:417), and a test asserts this (`device-matching.test.ts:487`).

**RCBO fallback** (:325-390):

- It runs only for a group with exactly one circuit.
- If both halves (RCD and MCB) are found, both are selected with `rcbo_fallback`.
- Otherwise the result is the RCBO gap plus a gap for each failing half, marked `fallback: true`.
- It never returns a device when a half is missing.
- Tested: the pair, and the case where the RCD half is missing (:401-457). Untested: only the MCB
  half missing, and any 3F fallback.

**Oracle classification of the existing tests** (`device-matching.test.ts`):

- **Independent** (hand-built fixtures, literal ids, rules from the PRD/plan):
  - `rcdTypeRank` (:129);
  - the blockers (:137-187);
  - the MCB rules (:189-258);
  - FR ≥ pre-meter, including the equality `fr-25` for 25 A, and the FR poles `it.each` (:260-315);
  - the RCD rules (:317-399);
  - the RCBO literals (:401-457);
  - "no partial result";
  - `activeCatalog` (:506-545);
  - `sameSelection` and messages (:547-654).
- **Derived from the implementation** (conventions restated, not requirements):
  - the "FR never used as protection" test asserts the full emission order
    `["rcd","mcb","mcb","rcbo","rcd","mcb","mcb"]`;
  - the selection-order test;
  - the tie-break-order test (:459-504).

  These are legitimate as contract pins, but they are not guardrail evidence. The "FR never used as
  protection" test should assert _kind_ per role instead of the full sequence, so that reordering
  does not mask a real regression or fail spuriously.

- Fixtures are built through the real `parseDeviceSpec` (:24-35). That is input construction only,
  not an oracle, and it is acceptable.

**Not tested** (candidate cases for Phase 1):

1. RCD In exactly = the largest circuit In (the accept boundary), next to an RCD one list step below
   in the same catalog.
2. An MCB or RCBO at In−step and In+step coexisting with the exact one. Today's test proves "B20 not
   chosen" but has no B10 next to it.
3. Type boundaries: F rejected for a B minimum; B accepted for an A minimum; an AC-minimum group
   accepting AC.
4. 3F RCBO poles (3P+N/4P) and the 3F fallback path.
5. A cheaper 4P RCD on a 1F supply. The rule allows it, so the test documents the choice.
6. A fallback with only the MCB half missing.
7. The property: for a generated catalog × circuit set, every `matched` selection satisfies the rule
   predicate. The predicate must be written independently from the PRD table, not imported from
   `device-matching.ts`. No compliant device is cheaper than the chosen one. Otherwise the result is
   `gaps`, and each gap corresponds to a requirement no catalog row meets.

### Risk #3 — blockers and warnings

**Blockers** (`device-matching.ts:239-271`) are boolean conditions, all tested directly
(`device-matching.test.ts:138-186`):

- `supply_missing`;
- `no_circuits`;
- `circuit_group_unknown` (:250-253);
- `tn_c_with_rcd`, which fires only when a circuit points at an existing group (:253-257); an empty
  group does not block (test :164);
- `circuit_phase_exceeds_supply`, one per 3F circuit on a 1F supply (:258-263).

**Gap:** no test asserts that TN-C-S and TT with an RCD group are _not_ blocked. That negative is
where a wrong refactor (e.g. `startsWith("TN-C")`) would silently block every TN-C-S house. TN-C-S
appears only in the FR poles test (:279-281); TT appears in no matching test.

**Warnings and their operators** (equality never warns in any of them):

| Warning                               | Where                                 | Condition                           |
| ------------------------------------- | ------------------------------------- | ----------------------------------- |
| Circuit cable ampacity                | `circuit-warnings.ts:141`             | `rated_current_a > ampacityA`       |
| WLZ ampacity                          | `supply-warnings.ts:175`              | `ampacityA < premeter_protection_a` |
| Aluminium minimum                     | `supply-warnings.ts:179`              | `cross_section < 16`                |
| PEN minimum (TN-C, TN-C-S)            | `supply-warnings.ts:183-186`          | `cross_section < {Cu:10, Al:16}`    |
| Voltage drop                          | `supply-warnings.ts:190`              | raw `percent > 0.5`                 |
| Bars missing / terminals / entry side | `circuit-warnings.ts:109, :119, :150` | count and set checks                |

**The circuit ampacity path**:

- `circuitAmpacityA` (`circuit-warnings.ts:50-57`) maps installation → reference method through the
  WLZ mapping `REFERENCE_METHOD_BY_INSTALLATION`, and phase → loaded conductors (2 / 3).
- It then reads `CU_1_5_MM2_AMPACITY_A` (:34-39) for 1.5 mm², or `AMPACITY_A.Cu` otherwise.
- Copper-only: circuits have no material field.

**Discrete boundaries — the correction to "±1 A".** Circuit In ∈ {6, 10, 13, 16, 20, 25, 32, 40,
50, 63} (`circuit-params.ts:19`). Cross-sections ∈ {1.5, 2.5, 4, 6, 10, 16}. Pre-meter ∈ {16, 20,
25, 32, 40, 50, 63}.

Reachable **equality** cases, computed against the table values in `supply-warnings.ts` /
`circuit-warnings.ts`:

- **Circuits (Cu):**
  - 3 loaded / B2 / 2.5 mm² = 20 A (tested at `circuit-warnings.test.ts:107`);
  - 3 / C / 4 = 32 A;
  - 3 / D1 / 10 = 50 A;
  - 2 / C / 10 = 63 A.
  - No other combination is equal; the 1.5 mm² values are non-integers except 22 and 15, and
    neither is in the In list.
- **WLZ:**
  - Cu 3 / B2 / 2.5 = 20 A (tested at `supply-warnings.test.ts:105`);
  - Cu 3 / C / 4 = 32;
  - Cu 3 / D1 / 10 = 50;
  - Cu 2 / C / 10 = 63;
  - Al 3 / C / 4 = 25;
  - Al 3 / C / 6 = 32;
  - Al 3 / D1 / 16 = 50.
- **Voltage drop at exactly 0.5 %:** 1F, Cu, 10 mm², 16.1 m, 20 A gives
  200·16.1·20 / (56·10·230) = 64400/128800 = 0.5. Floating point may land either side of the strict
  `>`. This case is untested, and it is the most informative single boundary test for the voltage
  drop.

**The "next list value" side** is tested only as +5 A (B20 → B25, `circuit-warnings.test.ts:111`;
WLZ 20 → 25, `supply-warnings.test.ts:110`). That is the true neighbour here, so it is adequate.

**Oracle classification:**

- The warning tests use literals or hand calculations: an independent oracle.
- One exception: the Al/Cu voltage-drop test expects the ratio `56/34` (`supply-warnings.test.ts:198`),
  which restates the `CONDUCTIVITY` constant. It should become a hand-computed percentage.
- `expect(AMPACITY_A.Cu[3].B2[2.5]).toBe(20)` reads the table but compares it to a literal, so it is
  still independent.

**"The table is complete, so it is correct".** Completeness tests exist
(`supply-warnings.test.ts:34`, `circuit-warnings.test.ts:67`), and every cell is also pinned
literally. So the challenge is already met for the tables. It is **not** met for the mapping. The 5
installations × 2 phase counts → (method, loaded conductors) mapping has no table-driven test: one
row per installation, expected method taken from PN-HD 60364-5-52 Annex B, as documented in
`supply-warnings.ts` (the `REFERENCE_METHOD_BY_INSTALLATION` comment). A wrong mapping (e.g.
`in_wall` → B2) would change which pinned cell is read without failing any pin.

**Database mirror (for context; Phase 2 owns parity):** the circuit CHECKs in
`supabase/migrations/20260929120000_circuits_and_device_matching.sql` (:57-110) mirror the TS lists.
The numeric lists have no compile-time sync; only the enums do (`circuit-params.ts:48-50`).

### Cheapest useful layer

For both risks: **unit**, in the existing Vitest suite. No infrastructure is needed.

- The matcher is a pure function by design (plan `Implementation Approach`).
- The warnings are pure functions of parsed inputs.
- Property-based testing adds real signal only for risk #1: the (catalog × circuits) space is
  combinatorial, and the invariant is crisp.
- For risk #3 the input space is small and enumerable (the 4 + 7 equality cases, the 10 mapping
  rows), so exhaustive `it.each` tables beat generators. Property tests there would mostly
  re-discover the same finite list.

### Hot-spot evidence

The `src/lib/` churn (30 commits in 30 days) is accurate but broad. The risk-relevant files are
`device-matching.ts`, `circuit-warnings.ts`, `circuit-params.ts` and `supply-warnings.ts`, all
landed or changed in commit 648219f (S-04 p1). The likelihood rating for #1 (High) is justified by
the fresh code and S-04 still being in progress. For #3 (Medium) the evidence is the archived D1
transcription error. It is now mitigated by the pins, which argues Medium is right, not higher.

## Code References

- `src/lib/device-matching.ts:108` — `rcdTypeRank` ranks AC<A<F<B
- `src/lib/device-matching.ts:119-131` — `activeCatalog` drops archived, non-UUID and unparseable rows
- `src/lib/device-matching.ts:145-154` — `cheapest`, deterministic tie-break
- `src/lib/device-matching.ts:162-180` — pole sets per role and system
- `src/lib/device-matching.ts:186-237` — `matchMcb`, `matchRcd`, `matchRcbo`
- `src/lib/device-matching.ts:239-271` — `blockReasons`
- `src/lib/device-matching.ts:287-290` — FR ≥ pre-meter
- `src/lib/device-matching.ts:325-417` — group loop, RCBO fallback, all-or-nothing return
- `src/lib/device-matching.ts:446-466` — `catalogGapMessage`
- `src/lib/device-matching.test.ts:137-504` — blocker, MCB, FR, RCD, RCBO and shape tests
- `src/lib/circuit-warnings.ts:34-57` — 1.5 mm² table and `circuitAmpacityA`
- `src/lib/circuit-warnings.ts:109-150` — bars, terminals, ampacity and entry-side checks
- `src/lib/supply-warnings.ts:175-190` — WLZ warning conditions
- `src/lib/supply-warnings.test.ts:34, 56-77, 105-110, 182, 198` — completeness, pins, boundaries, conductivity ratio
- `src/lib/circuit-warnings.test.ts:67, 82, 95-97, 107-117` — completeness, 1.5 mm² pins, spot checks, boundaries
- `src/lib/circuit-params.ts:19` — circuit rated-current list
- `package.json:69` — `vitest ^5.0.1`; no property-based library

## Architecture Insights

- The guardrail is a single pure function with an explicit rule table. That makes an **independent
  predicate** (written from the PRD/plan table in the test file) the natural oracle for a property
  test. Importing any helper from `device-matching.ts` into that predicate would recreate the
  oracle problem.
- The results are three disjoint statuses (`blocked` / `gaps` / `matched`), so "never a device on a
  gap" reduces to a status assertion plus `selections` being absent.
- The warnings never block (AGENTS.md tripwire). A test that expects a save to fail on a warning
  would be wrong.

## Historical Context (from prior changes)

- `context/changes/circuit-input-and-device-matching/plan.md:328-341` — the "tests must pin" list.
  **Supported:** every item has a test in `device-matching.test.ts`.
- `plan.md:716-719` — circuit-warnings boundaries "In = ampacity (no warning) and In = ampacity + 1
  (warning)". **Partial:** equality is tested, and the "+1" is realised as the next list value
  (+5 A). A literal +1 A is unreachable through the parser.
- `plan.md:779-780` — electrician verified the 1.5 mm² values and the rule table (progress 1.4, 1.5,
  commit 648219f). **Supported** by the source comments.
- `context/archive/2026-09-24-project-setup-and-supply-params/` — the first D1 transcription was
  wrong. **Supported:** the comment at `supply-warnings.ts` (AMPACITY_A docblock) records the
  correction.

## Related Research

- `context/changes/circuit-input-and-device-matching/` (plan only; no research.md inspected)

## Open Questions

These are product/domain decisions for the user. They are not test gaps, and Phase 1 should not
encode an answer silently.

1. **Breaking capacity (Icn) is never compared** (no fault-level input exists). Is this accepted for
   the MVP? If yes, say so in the rule table so no test pretends to cover it.
2. **RCD In ≥ largest MCB, not ≥ the group load.** B16+B20+B20 passes a 25 A RCD. Is that the
   intended rule? (The electrician confirmed the table at plan progress 1.5, so probably yes, but it
   is worth a sentence in the plan.)
3. **TT with no RCD** neither warns nor blocks. In TT an RCD is effectively required for fault
   protection. Should this become a warning (S-04) or stay out of scope?
4. **Circuit In above the pre-meter protection** (e.g. B32 on a 25 A supply) is not warned.
5. A **cheaper 4P RCD on a 1F supply** wins. Is that acceptable, or should 1F prefer 2P?

Items 3–5 are candidate _new_ warnings or rules: they would enter via S-04, not via this testing
change.
