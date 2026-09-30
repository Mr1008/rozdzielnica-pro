# Matching and Validation Oracle Implementation Plan

## Overview

Rollout Phase 1 of `context/foundation/test-plan.md` — risks #1 and #3. The product's single worst
failure is proposing a device that fails a circuit's parameters, or silently substituting one when
the catalog has a gap (PRD `## Success Criteria` guardrail). The second risk is a dangerous
configuration passing without a block or warning. Both live in pure functions that already have
tests; this change makes those tests **prove the guardrail with an oracle taken from the PRD, the
S-04 rule table and PN-HD 60364-5-52 — never from the code under test**.

Everything is unit-layer, in the existing Vitest suite. The only production-code change is a
floating-point fix at the voltage-drop limit, which a new boundary test exposes.

## Current State Analysis

From `context/changes/testing-matching-oracle/research.md` (grounded against commit 648219f):

- **The matcher filters before it picks the cheapest.** Every `cheapest(...)` call receives an
  already-filtered candidate list (`src/lib/device-matching.ts:186-237`, `:287-290`), and any gap
  discards every selection (`:417`). The existing tests (`src/lib/device-matching.test.ts`) use
  hand-built fixtures and literal ids — for the rule checks they are independent oracles.
- **What risk #1 is missing:** boundary pairs inside one catalog (a device just below and just above
  the requirement side by side); several rule-table rows (3F RCBO poles, the 3F fallback, fallback
  with only the MCB half missing, RCD In exactly equal to the largest circuit In, type F against a B
  minimum, B for an A minimum); a behavioural "cheaper non-compliant device is not chosen" for the
  RCD, RCBO and FR roles (only MCB has it, `device-matching.test.ts:189-258`); and any
  property-based coverage. `fast-check` is not a dependency (`package.json`).
- **One existing guardrail test restates the implementation.** "FR never used as protection" asserts
  the full emission order `["rcd","mcb","mcb","rcbo","rcd","mcb","mcb"]`
  (`device-matching.test.ts:459-504`), so a reordering fails it and a real regression could hide in
  an updated literal.
- **The ampacity tables are pinned cell by cell** (`src/lib/supply-warnings.test.ts:56-77`,
  `src/lib/circuit-warnings.test.ts:82`). The **lookup path** is not: installation → reference
  method (`REFERENCE_METHOD_BY_INSTALLATION`, `src/lib/supply-warnings.ts`) and phase count → loaded
  conductors has only 3 spot checks (`circuit-warnings.test.ts:95-97`). A wrong mapping would read a
  different pinned cell without failing any pin.
- **"±1 A" is not literally testable.** Rated currents, pre-meter protections and cross-sections are
  discrete lists (`src/lib/circuit-params.ts:19-26`, `src/lib/supply-params.ts`). The boundary is
  "equal" vs "next list value". Equality is reachable in 4 circuit and 7 WLZ combinations; 1 of each
  is tested today.
- **Blockers are tested positively only.** Nothing asserts that TN-C-S or TT with an RCD group is
  _not_ blocked (`device-matching.test.ts:138-186`) — the case a `startsWith("TN-C")` refactor would
  break for every TN-C-S house.
- **The voltage-drop limit misfires at exact equality.** 1F, Cu, 10 mm², 16.1 m, 20 A evaluates to
  `0.5000000000000001` in IEEE-754 (verified with node during planning), so `percent > 0.5`
  (`supply-warnings.ts:190`) warns at exactly 0.5 % — the only warning where equality warns.
  `ceilTo2` would then display it as 0.51 %.
- **One warning test restates a constant.** The Al/Cu voltage-drop test expects the ratio `56 / 34`
  (`supply-warnings.test.ts:198`), i.e. the `CONDUCTIVITY` values themselves.

## Desired End State

- For risk #1, `npm run test:unit` fails if the matcher ever: chooses a device that misses a rule-table
  parameter; chooses a device when a cheaper compliant one exists; returns any selection alongside a
  gap; reports a gap when a compliant device exists; or uses an FR as protection. This is checked
  both by boundary tables and by a property test whose rule predicate is written in the test file
  from the PRD/S-04 table, importing no helper from `device-matching.ts`.
- For risk #3, every warning is tested at every reachable equality case (no warning) and at the next
  list value where one exists (warning), the installation mapping is table-tested against the
  standard, and the non-blocking earthing systems are asserted not to block. Exactly 0.5 % voltage
  drop no longer warns.
- `test-plan.md` §6.1 is the canonical recipe for "add a unit test for a domain rule", §7 records the
  two accepted MVP rules the tests pin, §3 row 1 is `complete`, and the three candidate warnings are
  S-04 `Unknowns` on the roadmap and mirrored to GitHub.

### Key Discoveries:

- Fixtures are built through the real `parseDeviceSpec` (`device-matching.test.ts:24-35`) — input
  construction, not an oracle; keep doing it so fixtures stay valid catalog rows.
- `matchDevices(input, catalog)` returns three disjoint statuses — `blocked` / `gaps` / `matched` —
  so "never a device on a gap" is a status assertion plus the absence of `selections`.
- The matcher trusts its catalog input; `activeCatalog` (`device-matching.ts:119-131`) is the
  archive/parse filter. The property test feeds `matchDevices` directly and never includes archived
  rows; archived-row handling at the caller belongs to test-plan Phase 3.
- The circuit ampacity path reuses the WLZ mapping (`circuit-warnings.ts:52-57`) and the same
  `WlzInstallation` union (`circuit-params.ts:59-68`), so one mapping table covers both.
- Warnings never block a save (AGENTS.md tripwire) — no test may expect one to.

## What We're NOT Doing

- **No new matcher rules or warnings.** Three candidate rules the research surfaced — a TT supply
  with no RCD, circuit In above the pre-meter protection, preferring 2P over a cheaper 4P RCD on 1F —
  go to S-04 as `Unknowns` (Phase 4). The 4P-on-1F choice is pinned as today's rule, not changed.
- **No breaking-capacity (Icn) comparison and no RCD-vs-group-load rule.** Both are accepted MVP
  rules; Phase 4 records them in test-plan §7 so no test pretends to cover them.
- **No re-pinning of the ampacity tables** — every cell is already pinned and electrician-verified.
- **No property tests for risk #3** — its input space is small and enumerable, so exhaustive
  `it.each` tables beat generators.
- **No `@fast-check/vitest` adapter** — bare `fast-check` inside ordinary `it()`.
- **No HTTP, database or UI tests** — test-plan Phases 2 and 3. No CI changes: `test:unit` already
  runs in CI and picks up the new files.
- **No change to the tie-break and selection-order tests** beyond a comment marking them as contract
  pins rather than guardrail evidence.

## Implementation Approach

Add coverage in order of risk: the guardrail's boundary tables first (cheap, literal, catches the
worst failure), then the property test that explores combinations no table author would write,
then the warning boundaries, then the documentation that makes the pattern reusable. Each phase is
one green commit. Every expected value comes from a literal written from the PRD, the S-04 rule table
(`context/changes/circuit-input-and-device-matching/plan.md:168-176`), the standard, or a hand
calculation shown in the test name or a comment.

## Critical Implementation Details

- **The oracle must not import the implementation's rules.** The property-test predicate and the new
  tables may import input _domains_ (the value lists in `circuit-params.ts`, `supply-params.ts`,
  `POLES_BY_KIND` in `device-spec.ts` for generating valid devices) but never `rcdTypeRank`, the
  matcher's pole sets, or any function from `device-matching.ts` except `matchDevices` itself. The
  type ranking and the allowed poles per role are written as literals in the test file. Importing
  them would recreate the oracle problem this change exists to remove.
- **Rounding at the voltage-drop limit applies to the comparison and the display alike.** Fixing only
  the comparison leaves `ceilTo2(0.5000000000000001)` = 0.51, and the same artefact can push other
  displayed values up by 0.01.

## Phase 1: Matcher boundary tables (risk #1)

### Overview

Extend `device-matching.test.ts` with literal, table-driven boundary cases for every role, and
replace the one guardrail assertion that restates the emission order.

### Changes Required:

#### 1. Boundary pairs per role

**File**: `src/lib/device-matching.test.ts`

**Intent**: For each role, put the exact/threshold device next to its list neighbours **in the same
catalog**, so the test proves the filter, not the fixture. Each case also includes a cheaper
non-compliant device that must not be chosen.

**Contract**: New `describe` blocks (or `it.each` tables) covering:

- MCB and RCBO: In−step, In, In+step coexisting (e.g. B10 / B16 / B20 for a B16 circuit) → the exact
  one; a cheaper In±step is never chosen.
- Group RCD: rated exactly = the largest circuit In → accepted; one list step below, cheaper → not
  chosen; mA must be exact (a cheaper 100 mA for a 30 mA group is not chosen).
- FR main switch: rated one step below the pre-meter protection, cheaper → not chosen; equality
  accepted (existing `fr-25` case stays).
- RCD type boundaries: F rejected for a B minimum; B accepted for an A minimum; AC accepted for an AC
  minimum; AC rejected for an A minimum. Rank order literal in the test: AC < A < F < B.
- 3F single-circuit group: RCBO poles 3P+N / 4P accepted, 1P+N / 2P rejected; the 3F RCD+MCB
  fallback selects a 4P RCD and a 3P / 3P+N / 4P MCB.
- Fallback with only the MCB half missing → status `gaps`, an RCBO gap plus an MCB gap marked
  `fallback: true`, no selections.
- 1F group with a cheaper 4P RCD than the cheapest 2P → the 4P wins. Test name says it documents
  today's accepted rule (candidate change handed to S-04 in Phase 4).

#### 2. FR-never-protection assertion

**File**: `src/lib/device-matching.test.ts`

**Intent**: Make the guardrail assertion independent of emission order: an FR appears only as
`main_switch`, and each other role's device has the role's kind.

**Contract**: The test (currently asserting the full kind sequence, around `:459-504`) asserts per
selection: `role === "main_switch"` ⇔ the device kind is `switch_disconnector`; `rcd` → `rcd`;
`rcbo` → `rcbo`; `mcb` → `mcb_b`. The selection-order and tie-break tests stay unchanged, with a
one-line comment marking them as output-contract pins, not guardrail evidence.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Mutation spot-check: temporarily changing `>=` to `>` in `matchRcd`'s rated-current filter, `===`
  to `>=` in `matchMcb`, and the FR `>=` to `>` each makes at least one new test fail (revert after)

#### Manual Verification:

- Each new case's expected device can be justified from the S-04 rule table or PRD alone, without
  reading `device-matching.ts`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Matcher property test (risk #1)

### Overview

Add `fast-check` and a property test that generates supplies, RCD groups, circuits and catalogs, and
checks the matcher's result against an independent rule predicate.

### Changes Required:

#### 1. Dependency

**File**: `package.json` (+ `package-lock.json`)

**Intent**: Add the property-based library the test plan names as the candidate.

**Contract**: `fast-check` `^4` in `devDependencies`, installed with `npm install -D fast-check`. No
adapter package.

#### 2. Property test

**File**: `src/lib/device-matching.property.test.ts` (new)

**Intent**: Explore catalog × circuit combinations no table author would write, with an oracle
derived from the PRD / S-04 rule table.

**Contract**:

- **Generators** (arbitraries): a supply drawn from the supply value lists (all four earthing
  systems, 1F/3F, every pre-meter value); 0–3 RCD groups (mA and minimum type from their lists);
  1–5 circuits (In from `CIRCUIT_RATED_CURRENTS_A`, phase count, group id or null, including an
  occasional 3F circuit on a 1F supply and a grouped circuit under TN-C so blockers are exercised); a
  catalog of 0–15 FR / RCD / RCBO / MCB devices with unique UUID ids, prices 1–10 000 grosze, poles
  from `POLES_BY_KIND`, and ratings **biased toward the generated requirements and their list
  neighbours** so that `matched`, `gaps` and `blocked` all occur regularly. Devices are built
  through `parseDeviceSpec`, as in the existing fixtures.
- **Independent oracle**, written in the test file from the rule table: `expectedBlocked(input)`
  (supply missing / no circuits / TN-C with a non-empty group / 3F circuit on 1F / unknown group);
  the list of requirements (main switch; per group of ≥2: an RCD with In ≥ max circuit In, exact mA,
  type rank ≥ minimum, poles 4P if any 3F else {2P, 4P}, plus an MCB per circuit; per single-circuit
  group: an RCBO, else an RCD + MCB pair; per ungrouped circuit: an MCB with note `no_rcd`); and
  `compliant(requirement, catalog)`. Type rank and allowed poles per role (including TN-C 1P/3P for
  the MCB and FR) are literals here.
- **Properties** (`fc.assert(fc.property(...))`, not a fixed seed):
  1. If the oracle expects a block, the status is `blocked` and there are no selections.
  2. Otherwise, if every requirement has a compliant device (with the RCBO → RCD+MCB rule), the status
     is `matched`; every selection's device is in its requirement's compliant set; its price equals
     the minimum price of that set; no selection uses an FR outside `main_switch`.
  3. Otherwise the status is `gaps`, there is no `selections` field, and every reported gap names a
     requirement whose compliant set is empty.
- **Distribution guard**: a counter over the run asserts that `matched`, `gaps` and `blocked` each
  occurred at least once, so a generator drift that only produces gaps fails loudly instead of
  passing vacuously.
- `numRuns` raised above the default (e.g. 500) as long as the file runs in well under 2 s locally.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint` (the new file is type-checked like the rest of `src/`)
- Build passes: `npm run build` (the dev dependency does not reach the Worker bundle)
- Mutation spot-check: temporarily making `cheapest` return the last candidate, and separately
  dropping the `residual_current_ma ===` check in `matchRcd`, each makes the property fail with a
  shrunk counterexample (revert after)
- The test file imports nothing from `./device-matching` except `matchDevices` and its types:
  `grep` confirms

#### Manual Verification:

- The oracle's rule literals read as a transcription of the S-04 rule table
  (`context/changes/circuit-input-and-device-matching/plan.md:168-176`), line by line

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Blocker and warning boundaries (risk #3)

### Overview

Exhaustive boundary tables for the ampacity warnings, a table test for the installation mapping,
negative blocker cases, the voltage-drop equality fix, and a hand-computed replacement for the
conductivity-ratio test.

### Changes Required:

#### 1. Circuit ampacity equality cases

**File**: `src/lib/circuit-warnings.test.ts`

**Intent**: Cover every reachable equality between a circuit's In and its cable's ampacity, plus the
next list value where one exists.

**Contract**: An `it.each` table (Cu only — circuits have no material): 3F / B2 / 2.5 mm² = 20 A
(existing), 3F / C / 4 mm² = 32 A, 3F / D1 / 10 mm² = 50 A, 1F / C / 10 mm² = 63 A → no warning;
the next In (B25, B40, B63; none above 63) → `cable_ampacity_below_in` with the literal ampacity.

#### 2. WLZ ampacity equality cases

**File**: `src/lib/supply-warnings.test.ts`

**Intent**: The same for the WLZ against the pre-meter protection.

**Contract**: An `it.each` table: Cu 3 / B2 / 2.5 = 20 (existing), Cu 3 / C / 4 = 32, Cu 3 / D1 / 10
= 50, Cu 2 / C / 10 = 63, Al 3 / C / 4 = 25, Al 3 / C / 6 = 32, Al 3 / D1 / 16 = 50 → no
`wlz_ampacity_below_protection`; the next pre-meter value where one exists → the warning. Assert on
the ampacity code only, since aluminium below 16 mm² also raises its own warning.

#### 3. Installation mapping table

**File**: `src/lib/supply-warnings.test.ts`

**Intent**: Pin installation → reference method and phase count → loaded conductors with values from
PN-HD 60364-5-52 Annex B, so a wrong mapping fails even though every table cell is pinned.

**Contract**: An `it.each` over all five `WLZ_INSTALLATIONS` with a literal expected method (surface
→ C, conduit_surface → B2, conduit_flush → B2, in_wall → C, in_ground → D1), checked through
`REFERENCE_METHOD_BY_INSTALLATION` and end-to-end through `wlzAmpacityA` / `circuitAmpacityA`
against a literal ampacity for 1F and 3F. The expected methods are literals in the test, not read
from the constant.

#### 4. Non-blocking earthing systems

**File**: `src/lib/device-matching.test.ts`

**Intent**: Prove TN-C-S, TN-S and TT with an RCD group are not blocked, next to the existing TN-C
block.

**Contract**: An `it.each` over `["TN-S", "TN-C-S", "TT"]` with a grouped circuit → status is not
`blocked` (and no `tn_c_with_rcd`).

#### 5. Voltage-drop equality fix

**File**: `src/lib/supply-warnings.ts`, `src/lib/supply-warnings.test.ts`

**Intent**: Make exactly 0.5 % not warn, consistent with every other warning's "equality never
warns", without rounding away any drop that is genuinely above the limit.

**Contract**: `supplyWarnings` rounds the computed percent to a fixed number of decimals (a named
constant, 9 places) before both the `> VOLTAGE_DROP_LIMIT_PERCENT` comparison and `ceilTo2`.
`voltageDropPercent` stays raw. Tests: 1F, Cu, 10 mm², 16.1 m, 20 A → no `voltage_drop_high`
(hand calculation 200·16.1·20 / (56·10·230) = 0.5 in the test name); the existing 13 m case still
warns with 0.51; the docblock of `supplyWarnings` notes the rounding.

#### 6. Conductivity test

**File**: `src/lib/supply-warnings.test.ts`

**Intent**: Replace the `56 / 34` ratio with hand-computed percentages, so the oracle is the formula
applied by hand rather than the constant.

**Contract**: The aluminium test asserts `voltageDropPercent` for its Al and Cu supplies with
`toBeCloseTo` against values computed by hand from ΔU% = 100·√3·L·I / (γ·S·400) (or the
single-phase form), the arithmetic written in a comment.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Mutation spot-check: temporarily mapping `in_wall` → B2, changing `circuit-warnings.ts`'s `>` to
  `>=`, and `startsWith("TN-C")` for the TN-C check, each fails at least one test (revert after)

#### Manual Verification:

- The electrician confirms the mapping table's five rows against PN-HD 60364-5-52 Annex B (table
  B.52.1), as for the earlier table pins
- The voltage-drop fix: an exact-0.5 % supply entered on a project page shows no voltage-drop warning
  (checked through the browser against the local dev server)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Cookbook, negative space and handoff

### Overview

Make the pattern reusable, record what the tests deliberately do not cover, close the rollout row,
and hand the three candidate rules to S-04.

### Changes Required:

#### 1. Test-plan cookbook and stack

**File**: `context/foundation/test-plan.md`

**Intent**: Turn §6.1 from `TBD` into the canonical recipe, and fill the property-based stack row.

**Contract**:

- §6.1 "Adding a unit test for a domain rule": location (`src/lib/<module>.test.ts` beside the
  helper; `<module>.property.test.ts` for property tests), naming (the test name carries the source:
  rule-table row, PRD section or hand calculation), reference tests (`device-matching.test.ts`
  boundary block, `device-matching.property.test.ts`, the `supply-warnings.test.ts` equality table),
  the oracle rule (no imports of the implementation's rules), boundary = "equal vs next list value",
  run command `npm run test:unit`.
- §6.6: a short Phase 1 note (what shipped, the voltage-drop float finding).
- §4 property-based row: `fast-check` with the installed version, `checked: <date>`.
- §3 row 1: status `complete`.

#### 2. Negative space

**File**: `context/foundation/test-plan.md` §7

**Intent**: Record the two accepted MVP rules so no test pretends to cover them.

**Contract**: Two entries — breaking capacity (Icn) is never compared, because no fault-level input
exists; the group RCD is rated against the largest circuit In, not the group load. Each with its
source (research Open Questions 1–2) and a re-evaluate trigger.

#### 3. S-04 handoff

**File**: `context/foundation/roadmap.md` (S-04 `Unknowns`), then GitHub

**Intent**: Hand the three candidate rules to S-04, where rules are decided, and keep the board in
sync.

**Contract**: Three `Unknowns` bullets under S-04, each `Owner: user. Block: no.`: TT supply with no
RCD neither warns nor blocks; circuit In above the pre-meter protection is not warned; a cheaper 4P
RCD wins on a 1F supply. Then `node scripts/roadmap-to-github.mjs --apply` under the `Mr1008` account,
run by a haiku subagent in the same turn (plan first, apply after reading the plan output).

### Success Criteria:

#### Automated Verification:

- Format passes: `npx prettier --check context/foundation/test-plan.md context/foundation/roadmap.md`
- `node scripts/roadmap-to-github.mjs` (plan mode) reports no pending changes after the apply
- Full CI reproduction passes: `npm run lint && npx astro check && npm run test:unit && npm run build`

#### Manual Verification:

- §6.1 is enough, on its own, for someone to add a boundary test for a new warning without reading
  this plan
- The three S-04 unknowns are visible on the GitHub issue / board for S-04

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human.

---

## Testing Strategy

### Unit Tests:

- Boundary tables per matcher role: exact vs list neighbours in one catalog, a cheaper non-compliant
  device beside each compliant one, type-rank and pole boundaries, 3F RCBO and fallback paths.
- A property test over generated supply × groups × circuits × catalog with an independent predicate.
- Ampacity equality at every reachable combination plus the next list value; the installation
  mapping; TN-S / TN-C-S / TT not blocked; voltage drop at exactly the limit.

### Integration Tests:

- None in this phase — test-plan Phase 2 owns CHECK↔parser parity and RLS.

### Manual Testing Steps:

1. Read the new boundary cases and the property oracle against the S-04 rule table only.
2. Electrician checks the five mapping rows against PN-HD 60364-5-52 Annex B.
3. Enter a supply at exactly 0.5 % voltage drop on a project page and confirm no warning appears.

## Performance Considerations

The property test must keep `npm run test:unit` fast: tune `numRuns` so the file runs in well under
2 s locally.

## Migration Notes

None — no schema or data change.

## References

- Research: `context/changes/testing-matching-oracle/research.md`
- Quality contract: `context/foundation/test-plan.md` (§2 risks #1, #3; §3 Phase 1; §6.1)
- Rule table: `context/changes/circuit-input-and-device-matching/plan.md:168-176`
- Matcher: `src/lib/device-matching.ts:186-237`, `:287-290`, `:325-417`
- Warnings: `src/lib/circuit-warnings.ts:52-57`, `:141`; `src/lib/supply-warnings.ts:175-190`
- Existing tests: `src/lib/device-matching.test.ts`, `src/lib/circuit-warnings.test.ts`,
  `src/lib/supply-warnings.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Matcher boundary tables (risk #1)

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:unit` — ef18ed9
- [x] 1.2 Lint passes: `npm run lint` — ef18ed9
- [x] 1.3 Mutation spot-check on matchRcd, matchMcb and the FR filter fails new tests — ef18ed9

#### Manual

- [x] 1.4 Each new case's expected device is justified from the rule table or PRD alone — ef18ed9

### Phase 2: Matcher property test (risk #1)

#### Automated

- [x] 2.1 Unit tests pass: `npm run test:unit` — 8f2c778
- [x] 2.2 Lint passes: `npm run lint` — 8f2c778
- [x] 2.3 Build passes: `npm run build` — 8f2c778
- [x] 2.4 Mutation spot-check on cheapest and the RCD mA check fails the property — 8f2c778
- [x] 2.5 Property test imports only matchDevices and types from device-matching — 8f2c778

#### Manual

- [x] 2.6 Oracle rule literals read as a transcription of the S-04 rule table — 8f2c778

### Phase 3: Blocker and warning boundaries (risk #3)

#### Automated

- [x] 3.1 Unit tests pass: `npm run test:unit`
- [x] 3.2 Lint passes: `npm run lint`
- [x] 3.3 Type check passes: `npx astro check`
- [x] 3.4 Mutation spot-check on the mapping, the ampacity operator and the TN-C check fails tests

#### Manual

- [x] 3.5 Electrician confirms the mapping rows against PN-HD 60364-5-52 Annex B
- [x] 3.6 Exact-0.5 % supply shows no voltage-drop warning on the project page

### Phase 4: Cookbook, negative space and handoff

#### Automated

- [ ] 4.1 Format passes on test-plan.md and roadmap.md
- [ ] 4.2 Roadmap-to-GitHub plan mode reports no pending changes after apply
- [ ] 4.3 Full CI reproduction passes

#### Manual

- [ ] 4.4 §6.1 is enough on its own to add a boundary test for a new warning
- [ ] 4.5 The three S-04 unknowns are visible on GitHub
