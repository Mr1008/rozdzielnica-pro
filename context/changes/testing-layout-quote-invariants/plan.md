# Test-plan Phase 4 — Layout and Quote Invariants Implementation Plan

## Overview

Close rollout Phase 4 of `context/foundation/test-plan.md` (risks #4 and #5). Prove the quote from
hand-counted bills of materials run through the real matcher, add a property-level check of the
rounding and of the formula's metamorphic relations, run the production Karwasz cabinets through the
layout property tests, and record the result (§3, §6.5, §6.6) plus a dated visual review of the
printout.

Planning note: the interview was skipped under the skill's settled-input exception — the research
(`research.md`) resolves every design decision, and the parent session's brief asked for the chain to
run without stopping between stages. Complexity: LOW (tests and docs only, no production code).

## Current State Analysis

- `src/lib/quote.test.ts` proves the arithmetic with independent, hand-worked literals (formula,
  half-up rounding incl. the exact .5 and int4 cases, profile-first block, `not_current`, override and
  `outdated`, busbar piece pricing). Every `computeQuoteView` case hands in snapshot rows the test
  wrote itself, so "device count = list length" (`quote.ts:147`) is assumed, never challenged against
  a project's real bill of materials.
- No property test covers the rounding or the formula.
- `src/lib/cabinet-layout.property.test.ts` (proposal, 400 runs × 4 geometries) and
  `src/lib/layout-editing.property.test.ts` (edits, 300 runs × 3 geometries) use seed and synthetic
  geometries only; the 33 production Karwasz cabinets (`src/lib/karwasz-cabinets.ts:82`) never reach
  the proposer or the edit model.
- Nothing deterministic detects an unreadable cabinet drawing or printout.

## Desired End State

- A unit suite derives device count, material, minutes and labour for 4 small projects from a
  hand-counted bill of materials written above each case, running circuits through `matchDevices` and
  the result through `computeQuoteView`; a deliberate break of the count or the busbar rule turns it
  red.
- A property suite checks labour rounding against the definition of half-up rounding (BigInt) and the
  formula's metamorphic relations on snapshot rows.
- Both layout property tests also run on every Karwasz geometry, with a non-vacuity guard.
- test-plan §3 Phase 4 is `complete`, §6.5 has the quote pattern, §6.6 has the Phase 4 note, §4 the
  visual-review `checked:` date.

### Key Discoveries:

- One snapshot row per matcher selection; a single-circuit group is 1 RCBO row or RCD + MCB on
  fallback (`src/lib/device-matching.ts:392-423`); catalog bars only for a kind the cabinet lacks
  (`:504-518`); busbar rows last, only with `maxRailMm` (`:523`).
- Busbar cutting is first-fit-decreasing over pins = `ceil(group width / 17.5)`; groups with ≥ 2 MCBs
  may buy a piece, single-MCB groups only use offcuts (`src/lib/busbar-cutting.ts:1-24`, `:70-134`).
- Matcher fixture helpers to copy (not import — they are test-local): `device()`, `fr()`, `mcb()`,
  `rcd()`, `rcbo()`, `circuit()`, `group()`, `TN_S_1F` in `src/lib/device-matching.test.ts:28-108`.
- The snapshot trigger copies the catalog row for a selection; the quote reads only `price_grosze`,
  `device_id`, `role`, `busbar_piece` (`QuoteInput`, `quote.ts:80-91`).

## What We're NOT Doing

- No second geometric oracle beside `validateLayout` (§6.5 keeps it the single definition).
- No new e2e spec: `quote-override.spec.ts` (Phase 3) covers the override endpoint and the page renders
  `computeQuoteView` as is; no `test-stack.md` change.
- No change to production code; a failing new test is reported, then fixed in its own commit only if
  it is a real defect.
- No `npx astro check` (the parent session runs it as the final gate).

## Implementation Approach

Unit tests only, oracle from the PRD and the archived decisions (research table "Grounded decisions"),
never from `quote.ts`. Each test file names the source of each expected number; each new test is
checked against a deliberate break, then the break is reverted.

## Phase 1: Quote worked examples through the matcher

### Overview

Challenge "the device count is the list length" with projects whose bill of materials is counted by
hand.

### Changes Required:

#### 1. Worked-example suite

**File**: `src/lib/quote.examples.test.ts` (new)

**Intent**: For each project, write a small fixture catalog with distinct prices (plus at least one
cheaper non-compliant decoy), the circuits and groups, and above the case a comment table: the
devices an electrician would mount (one line each), their count, prices, the material sum in grosze,
minutes = count × mount + overhead, and labour = minutes × rate / 60 rounded half-up — all computed
by hand. Run `matchDevices`, map each selection to a quote row by catalog id (the only adapter: what
the snapshot trigger copies), call `computeQuoteView`, and compare with literals. Also assert the
sorted role list against the hand BOM, so a count that matches by accident still fails.

**Contract**: the four projects (1F TN-S, 30 mA type A groups, 15 % margin, profile and rate chosen
so at least one labour cost lands on a .5 grosz):

- **A — RCBO and a built-in-bar cabinet** (`cabinetBarKinds: ["PE","N"]`, no `maxRailMm`): FR 2P; a
  group of three circuits (RCD + 3 MCBs); a single-circuit group (one RCBO). 6 devices.
- **B — RCBO fallback**: project A on a catalog with no compliant RCBO → RCD + MCB for the single
  group. 7 devices.
- **C — catalog bars**: project A on a cabinet without built-in bars (`cabinetBarKinds: []`) → plus a
  PE bar and an N bar. 8 devices; the cabinet price is its own line, not a device.
- **D — comb busbars**: two multi-MCB groups and `maxRailMm` set, with one catalog busbar long enough
  for both groups' pins: 2 segments counted in labour, 1 piece priced; then a shorter busbar that
  forces a second piece: 2 pieces priced.
- On project A: no profile → `{ state: "no_profile" }`; an override (e.g. 3 h 0 min) → labour from
  the override, hand-computed; the same override against a profile whose mount time changed →
  `outdated: true`, override still used.

### Success Criteria:

#### Automated Verification:

- `npx vitest run src/lib/quote.examples.test.ts` passes
- Deliberate break — `deviceCount` computed as distinct `device_id`s, or busbar rows priced per row,
  turns the suite red (reverted)
- `npm run lint` and `npm run test:unit` pass

---

## Phase 2: Quote property test

### Overview

Rounding and formula invariants over arbitrary inputs, with an oracle from the definition of rounding.

### Changes Required:

#### 1. Property suite

**File**: `src/lib/quote.property.test.ts` (new)

**Intent**: fast-check over minutes 1…59 999 and rates 0…2 147 483 647: `labourCostGrosze` is the
half-up rounding of minutes × rate / 60, checked in BigInt as `m·r − 30 < 60·c ≤ m·r + 30`. Over
random snapshot rows and a profile: adding one non-busbar row adds exactly the mount minutes and its
price; adding a segment of an already-priced `(device_id, busbar_piece)` adds the mount minutes and no
material; permuting rows changes nothing; total = material + labour; an override sets labour minutes
to the override whatever the rows.

**Contract**: imports only the public functions under test; no formula from `quote.ts` is re-used as
an expected value.

### Success Criteria:

#### Automated Verification:

- `npx vitest run src/lib/quote.property.test.ts` passes
- Deliberate break — `+ 30` changed to `+ 29` in `labourCostGrosze` turns it red (reverted)
- `npm run lint` and `npm run test:unit` pass

---

## Phase 3: Production cabinets in the layout property tests

### Overview

Run proposals and edits on the geometries electricians actually pick.

### Changes Required:

#### 1. Proposal property test

**File**: `src/lib/cabinet-layout.property.test.ts`

**Intent**: add every `KARWASZ_CABINETS` geometry (`karwaszGeometry`) to the proposal property, with a
run count per geometry that keeps the file's run time bounded, and a non-vacuity guard that holds for
the smallest cabinet (at least one `ok` proposal per geometry, and a higher total across the set).

**Contract**: the invariant is unchanged — every `ok` proposal places each non-busbar device once,
is deterministic, has two-decimal offsets and passes `validateLayout`; a non-`ok` one is `does_not_fit`.

#### 2. Edit property test

**File**: `src/lib/layout-editing.property.test.ts`

**Intent**: the same Karwasz geometries in the edit property, with its existing accepted/refused
distribution guards adapted per geometry where a small cabinet cannot meet them.

**Contract**: unchanged invariant — accepted moves keep `validateLayout` empty; refused moves change
nothing.

### Success Criteria:

#### Automated Verification:

- Both property files pass; the added runtime stays under ~30 s on this machine (measured, noted in
  the commit body)
- `npm run lint` and `npm run test:unit` pass

---

## Phase 4: Test-plan close-out and visual review

### Overview

Record the delivered coverage and run the optional visual review.

### Changes Required:

#### 1. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: §3 Phase 4 → `complete`; §6.5 "Quote: TBD" replaced by the quote pattern (where, oracle =
hand BOM through the matcher, naming, deliberate break, how to add a case); §6.5 layout lines mention
the Karwasz geometries; §6.6 Phase 4 note (delivered, findings, the visual review and its date); §4
AI-native row `checked:` date; "Last updated".

**Contract**: English prose; no change to §1–§2.

#### 2. Change record

**File**: `context/changes/testing-layout-quote-invariants/change.md`

**Intent**: status per the implement skill.

### Success Criteria:

#### Automated Verification:

- `npm run lint` and `npm run test:unit` pass

#### Manual Verification:

- Multimodal review of the printout and the cabinet drawing on `/dev/kitchen-sink` (1–2 screens):
  labels readable, no device or label overlap, material table on one page; result dated in §6.6

---

## Testing Strategy

### Unit Tests:

- Worked examples (Phase 1), property tests (Phases 2–3), each with a deliberate break.

### Integration Tests:

- None added; `test:integration` and `test:e2e` are untouched by this change and are not re-run.

### Manual Testing Steps:

1. Start the dev server, open `/dev/kitchen-sink`, review the printout and drawing states.

## Performance Considerations

The Karwasz runs multiply property-test time; bound the runs per geometry and measure.

## References

- Research: `context/changes/testing-layout-quote-invariants/research.md`
- Pattern: `src/lib/quote.test.ts`, `src/lib/cabinet-layout.property.test.ts`,
  `src/lib/device-matching.test.ts:28-108`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Quote worked examples through the matcher

#### Automated

- [x] 1.1 `npx vitest run src/lib/quote.examples.test.ts` passes — 4052220
- [x] 1.2 Deliberate break — `deviceCount` computed as distinct `device_id`s, or busbar rows priced per row, turns the suite red (reverted) — 4052220
- [x] 1.3 `npm run lint` and `npm run test:unit` pass — 4052220

### Phase 2: Quote property test

#### Automated

- [x] 2.1 `npx vitest run src/lib/quote.property.test.ts` passes — 46e1190
- [x] 2.2 Deliberate break — `+ 30` changed to `+ 29` in `labourCostGrosze` turns it red (reverted) — 46e1190
- [x] 2.3 `npm run lint` and `npm run test:unit` pass — 46e1190

### Phase 3: Production cabinets in the layout property tests

#### Automated

- [x] 3.1 Both property files pass; the added runtime stays under ~30 s on this machine (measured, noted in the commit body) — bdadff5
- [x] 3.2 `npm run lint` and `npm run test:unit` pass — bdadff5

### Phase 4: Test-plan close-out and visual review

#### Automated

- [x] 4.1 `npm run lint` and `npm run test:unit` pass

#### Manual

- [x] 4.2 Multimodal review of the printout and the cabinet drawing on `/dev/kitchen-sink` (1–2 screens): labels readable, no device or label overlap, material table on one page; result dated in §6.6
