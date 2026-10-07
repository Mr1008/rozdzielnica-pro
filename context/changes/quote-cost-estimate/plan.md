# Quote Cost Estimate (S-08) Implementation Plan

## Overview

The project page gets a "Wycena" section. It shows the material cost (the cabinet as its own line, plus every matched device), the estimated labour time (device count × mount minutes + project overhead, both from the electrician's pricing profile), and the labour cost (time × hourly rate). The electrician can override the estimated time in hours + minutes. The override is stored on the project, so S-09 prints the number the electrician settled on. When the estimate later moves, the override stays but is flagged as outdated. The section blocks, and never invents values, when the pricing profile is missing or the device match is not `current`.

## Current State Analysis

- **Profile.** `pricing_profiles` (`supabase/migrations/20260924120000_pricing_profiles.sql`) holds `hourly_rate_grosze`, `mount_minutes_per_device` (1–600) and `project_overhead_minutes` (0–6000), one row per electrician, with own-row RLS. No row means "not configured". The S-07 contract (`context/archive/2026-09-24-electrician-pricing-profile/change.md`) says S-08 must block and link to `/dashboard/profile`. That contract also leaves three things to S-08: the rounding rule, totals beyond int4, and whether to add a rate ceiling.
- **Device snapshot.** `computeMatchView` (`src/lib/device-matching-server.ts:228`) returns `{ state, fresh, snapshot }`, where `state` is `current | stale | cleared | gaps | blocked`. The AGENTS.md tripwire allows quoting only when `state === "current"`. Each snapshot row (`project_devices`, `Tables<"project_devices">`) carries `price_grosze`, copied by the `project_devices_snapshot_device` trigger. Catalog PE/N bars are ordinary rows with the roles `pe_bar` / `n_bar`.
- **Cabinet price.** `projects.cabinet_price_grosze` (non-null) is snapshotted by `projects_snapshot_cabinet` (`supabase/migrations/20260924150000_projects.sql`). The project page's explicit column list (`src/pages/dashboard/projects/[id].astro`, `loadProject()`) does not select it yet. The trigger touches only the five `cabinet_*` columns, so new columns on `projects` are safe from it.
- **Project page.** It composes `loadLayoutContext` → `computeMatchView` → `computeLayoutView`. Sections are listed in the `sections` array, in the order details, cabinet, supply, circuits, layout, delete. The aside ends with a `dl` of status badges (matching, layout). `?saved=` banners are mapped in an if/else chain.
- **Endpoints.** The pattern to copy is `src/pages/api/projects/[id]/supply.ts`: FormData → parser → `update().eq("id").select("id")`. It redirects with `projectFormErrorPath(id, code)` or `?saved=…`. Errors go through `PROJECT_ERROR` / `projectErrorFromPostgrest` (`src/lib/project-errors.ts`), and path helpers live in `src/lib/project.ts`.
- **Money.** `formatMoney` takes złote, so callers divide grosze by 100 (as `MatchResult.astro:272` does). There is no rounding helper. The minutes parser in `src/lib/pricing-profile.ts` (`WHOLE_MINUTES`, `parseMinutes`) is private.
- **Fixtures.** The kitchen-sink fixtures are in `src/lib/kitchen-sink-circuits.ts` (`kitchenSinkMatchStates`, `kitchenSinkLayoutStates` run the real view functions). The page is `src/pages/dev/kitchen-sink.astro`.

## Desired End State

On `/dashboard/projects/[id]`, a "Wycena" section between "Układ w szafce" and "Usuń projekt" shows one of:

- **No profile.** A warning with the existing `t.pricingProfile.notConfigured` copy and a link to `/dashboard/profile`. No numbers are shown.
- **Match not current.** A notice that the quote needs a current device match, with a link to `#circuits`. No numbers are shown.
- **Ready.** A breakdown table:
  - Material: the cabinet (name + price), devices (count + summed price), material total.
  - Labour: device count × mount minutes + overhead = estimated time; the time used (estimate or override, marked "nadpisany"); the hourly rate; labour cost.
  - Total: material + labour.

  Below the table is an override form (h + min) with "Zapisz czas" and, when overridden, "Przywróć estymację". A warning appears when the override is outdated (it shows the new estimate) and when the rate exceeds 500 zł/h.

The aside gets a "Wycena" row: the total, or a state badge. Everything is Polish, from `pl.ts`. A hand-computed example matches: 11 devices × 15 min + 90 min = 255 min (4 h 15 min); at 120,50 zł/h, labour = 512,13 zł.

### Key Discoveries:

- `computeMatchView` state `current` is the only state that may be quoted (`src/lib/device-matching-server.ts:228`, AGENTS.md tripwire "A stored snapshot is not proof of compliance").
- Catalog bars exist only when the cabinet lacks a built-in bar of that kind (`cabinetBarKinds`, `src/lib/device-matching-server.ts:224`). Summing snapshot prices plus the cabinet price never double-counts.
- `projects_snapshot_cabinet` restores the `cabinet_*` columns on every update where `cabinet_id` is unchanged, and ignores other columns (`supabase/migrations/20260924150000_projects.sql`, trigger around l.253–284).
- `pricing_profiles` has no admin policy and own-row select (`supabase/migrations/20260924120000_pricing_profiles.sql`). The page reads it with the user's SSR client.
- Integer safety: an override is at most 59 999 min. 59 999 × int4 rate ≈ 1.3 × 10¹⁴, below 2⁵³, so JS integer math is exact. Nothing computed is stored except minutes.

## What We're NOT Doing

- No printing or export of the quote. That is S-09, which reads what this slice computes.
- No hourly rate ceiling or CHECK change on `pricing_profiles`. The decision was a warning only.
- No VAT or net/gross handling. Catalog prices are summed as entered by the admin.
- No per-device mount times and no TE-based weighting. The PRD formula is a single average.
- No "finalized" quote snapshot or `quotes` table. Totals are always derived on render; only the override minutes are stored.
- No automatic clearing of the override by triggers. A changed estimate flags it as outdated instead.
- No dependency on the layout state. A quote can exist while the layout is missing or does not fit.
- No cabinet-exclusion toggle. The cabinet is always a material line.

## Implementation Approach

The pure domain module comes first, so every number is unit-tested against hand-computed examples before any UI exists (test-plan risk #5). Storage stays minimal: two nullable integer columns on `projects`, set or null together, guarded by named CHECKs mirrored in TypeScript (the "guarded twice" pattern). The endpoint recomputes the estimate on the server, from the same view function the page uses, and stores it as the override's base. The page then flags the override as outdated whenever today's estimate differs from that base.

## Critical Implementation Details

- **Rounding is integer-only:** `labourGrosze = Math.floor((minutes * rateGrosze + 30) / 60)`, which is half-up on non-negative integers. Never route it through `minutes / 60 * rate` floats. The tests pin `125 min × 12 050 → 25 104` and `255 min × 12 050 → 51 213`.
- **Outdated is a comparison, not a stored flag:** `outdated = override.baseMinutes !== estimateMinutes` on every render, so a profile change (which no trigger on `projects` can see) is caught too.
- **Migration backward-compatibility:** the columns are nullable with no default backfill. The deployed code selects explicit columns, so it ignores them.

## Phase 1: Quote domain

### Overview

A pure, fully unit-tested `src/lib/quote.ts`: the view model, the override form parser, the rate warning and the time formatting helpers.

### Changes Required:

#### 1. Quote module

**File**: `src/lib/quote.ts`

**Intent**: The single place where S-08's arithmetic and states live, so the page, the endpoint and S-09 all read the same numbers.

**Contract**:

- `MIN_LABOUR_OVERRIDE_MINUTES = 1`, `MAX_LABOUR_OVERRIDE_HOURS = 999`, `MAX_LABOUR_OVERRIDE_MINUTES = 59_999`. These mirror the CHECKs of Phase 2; change one, change the other.
- `RATE_WARNING_THRESHOLD_GROSZE = 50_000`. Above it warns; exactly 500 zł/h does not ("equality never warns", as in `supply-warnings.ts`).
- `estimateLabourMinutes(deviceCount, profile) = deviceCount × mount_minutes_per_device + project_overhead_minutes`.
- `labourCostGrosze(minutes, rateGrosze)`: integer half-up, as described under Critical Implementation Details.
- `computeQuoteView({ matchView, cabinet: { name, priceGrosze }, profile: PricingProfile | null, override: { minutes, baseMinutes } | null })` returns a discriminated union:
  - `{ state: "no_profile" }`, checked first. The profile block applies even when the match is not current, so the electrician is sent to fix it.
  - `{ state: "not_current" }` when `matchView.state !== "current"`.
  - `{ state: "ready", deviceCount, devicesGrosze, cabinet, materialGrosze, estimateMinutes, override: null | { minutes, baseMinutes, outdated }, labourMinutes, rateGrosze, labourGrosze, totalGrosze, rateWarning }`.
  - `deviceCount = matchView.snapshot.length`, covering every role including `pe_bar` / `n_bar`.
  - `labourMinutes` is the override when one exists (outdated or not), otherwise the estimate.
- `splitMinutes(total) → { hours, minutes }`, used by the form's default values and the display.
- `parseLabourOverrideForm(form: FormData)`:
  - Returns `{ ok: true, intent: "set", minutes } | { ok: true, intent: "clear" } | { ok: false, code: "invalid_input" }`.
  - The fields are in an exported `QUOTE_FIELDS` (`intent`, `labour_hours`, `labour_minutes`).
  - Hours are whole numbers 0–999 and minutes 0–59. The total must be ≥ 1.
  - Use the same digits-only rule as `pricing-profile.ts`'s `WHOLE_MINUTES`: either export that regex from `pricing-profile.ts`, or keep an identical local one. Pick whichever keeps `pricing-profile.ts`'s public surface smaller.
  - Never throws.

#### 2. Unit tests

**File**: `src/lib/quote.test.ts`

**Intent**: The oracle is hand calculation in grosze and minutes, never the formula re-typed from the code (test-plan risk #5 anti-pattern).

**Contract**: Tables of literal expected values:

- **Estimate.** 11 devices, 15 min, 90 min overhead → 255 min.
- **Rounding.** 255 × 12 050 → 51 213; 125 × 12 050 → 25 104; 270 × 12 050 → 54 225 (exact); 1 × 1 → 0 (0,0167 gr rounds down); 1 × 30 → 1 (0,5 gr rounds up).
- **Material.** A cabinet of 249,99 zł plus devices → their sum. A snapshot with catalog bars counts and prices them.
- **States.**
  - Missing profile and stale match → `no_profile`.
  - Each non-current match state → `not_current`.
  - Override present with base = estimate → not outdated; base ≠ estimate → outdated, and `labourMinutes` is still the override.
  - Override cleared → estimate.
- **Rate warning.** 50 000 → false, 50 001 → true.
- **Parser.**
  - Accepted: `4`/`30` → 270; `0`/`1` → 1; `999`/`59` → 59 999.
  - Rejected: `0`/`0`, `1000`/`0`, `1`/`60`, `-1`, `1,5`, `1e2`, empty, a missing intent, an unknown intent.
  - `clear` ignores the h/min fields.
- **Split.** `splitMinutes(255)` → `{ 4, 15 }`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

**Implementation Note**: Pause after this phase for confirmation before proceeding.

---

## Phase 2: Override storage and endpoint

### Overview

Persist the override with its base estimate, guarded by the database and the parser alike, plus the POST endpoint that sets or clears it.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261007120000_project_labour_override.sql`

**Intent**: Store the electrician's time on the project, so it survives reloads and reaches S-09, alongside the estimate it was set against.

**Contract**:

- `projects.labour_minutes_override integer null` and `projects.labour_override_base_minutes integer null`.
- Named, re-runnable CHECKs (`drop constraint if exists` then `add constraint`, as in the existing migrations):
  - `projects_labour_override_range`: override between 1 and 59 999.
  - `projects_labour_override_base_valid`: base ≥ 0.
  - `projects_labour_override_all_or_nothing`: both null or both set.
- No new policy: the existing own-row update policy on `projects` covers it.
- The migration is backward-compatible with the deployed code (nullable, no backfill).
- A comment at the top names the TypeScript mirror (`src/lib/quote.ts`).

#### 2. Types

**File**: `src/lib/database.types.ts`

**Intent**: Regenerate after the migration so the new columns are typed.

**Contract**: `npm run db:types` against the local stack. The Supabase stack runs on Docker, not wslc (lessons.md).

#### 3. Error codes and paths

**File**: `src/lib/project-errors.ts`, `src/lib/project.ts`, `src/lib/i18n/pl.ts`

**Intent**: Polish messages for the two ways a save can be refused, and the endpoint path helper.

**Contract**:

- New `PROJECT_ERROR` codes: `quoteMatchNotCurrent` and `quotePricingNotConfigured`, with `t.projectErrors.*` strings.
- `projectErrorFromPostgrest` already maps `23514` to `invalidInput`.
- `projectQuoteApiPath(id)` in `src/lib/project.ts`.
- `project-errors.test.ts` covers the new codes in its exhaustiveness check, if it has one.

#### 4. Endpoint

**File**: `src/pages/api/projects/[id]/quote.ts`

**Intent**: Set or clear the override. On set, recompute today's estimate on the server and store it as the base, so the client never supplies the base.

**Contract**: Follows `src/pages/api/projects/[id]/supply.ts` step for step (uuid check, auth, FormData, parse, `createClient` null branch, `update().eq("id", id).select("id")`, an empty result → notFound). It differs in four ways:

- **Set:**
  1. Load the project's supply and cabinet with `loadLayoutContext` or `loadMatchContext`, whichever the page uses.
  2. Load the pricing profile.
  3. Run `computeQuoteView` with no override. If the state is `no_profile` → `quotePricingNotConfigured`; if `not_current` → `quoteMatchNotCurrent`.
  4. Otherwise write `{ labour_minutes_override: minutes, labour_override_base_minutes: view.estimateMinutes }`.
- **Clear:** write both columns as null. There is no state precondition, so a stale override can always be cleared.
- **Success:** redirect to `projectPath(id) + "?saved=quote#quote"`.
- The route gate (`/api/projects` in `src/lib/route-access.ts`) already covers it. Check that, and add nothing if it does.

#### 5. Integration test

**File**: `tests/integration/rls-projects.test.ts` (or a new `tests/integration/rls-project-quote.test.ts`, following `support.ts`)

**Intent**: Prove the database half of the guard pair, and that isolation holds for the new columns (risks #6, #7).

**Contract**:

- Electrician A sets both columns → ok.
- A sets only one → 23514.
- Override 0 or 60 000 → 23514.
- Electrician B updating A's override → zero rows.
- The same boundary fixture values as the Phase 1 parser tests (1, 59 999, 60 000).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `npx supabase db reset`
- Types regenerated with no unrelated diff: `npm run db:types`
- Integration tests pass against the local stack: `npm run test:integration`
- Unit tests pass: `npm run test:unit`
- Lint and type check pass: `npm run lint && npx astro check`

**Implementation Note**: Pause after this phase for confirmation before proceeding.

---

## Phase 3: Quote section on the project page

### Overview

Render the quote on the project page and the aside, show the rate warning on the profile page, and add every state to the kitchen sink first.

### Changes Required:

#### 1. i18n

**File**: `src/lib/i18n/pl.ts`

**Intent**: Every user-facing string of the section.

**Contract**:

- A new `quote` block:
  - section title and description;
  - row labels (cabinet, devices with a `plural` count, material total, estimated time, time used, "nadpisany" marker, hourly rate, labour cost, total);
  - a formula line, e.g. "11 aparatów × 15 min + 90 min";
  - `duration(hours, minutes)` → "4 h 15 min";
  - the not-current notice and link, the override form labels (h, min, Zapisz czas, Przywróć estymację), and the outdated warning with the new estimate;
  - the rate warning (threshold in zł);
  - aside badges (ready → the total, no profile, not current).
- `t.projects.page.savedQuote` for the banner.
- Reuse `t.pricingProfile.notConfigured` / `notConfiguredLink` for the no-profile state.

#### 2. Kitchen-sink states

**File**: `src/lib/kitchen-sink-circuits.ts`, `src/pages/dev/kitchen-sink.astro`

**Intent**: Every new UI state is on `/dev/kitchen-sink` before the page uses it (AGENTS.md UI rule).

**Contract**: `kitchenSinkQuoteStates()` runs the real `computeQuoteView` over existing match fixtures. The states are: no profile; not current; ready with the estimate; ready with an override; outdated override; rate warning; a cabinet without bars (catalog bars counted). Add a new kitchen-sink section with a `t.devTools.kitchenSink.sections.quote` label and captions.

#### 3. Section component

**File**: `src/components/projects/QuoteSection.astro`

**Intent**: Present the view model. It does no arithmetic of its own: all numbers come from `QuoteView`.

**Contract**:

- **Props:** `view: QuoteView` and `projectId`.
- **Money and time:** money via `formatMoney(grosze / 100)`, time via `t.quote.duration(splitMinutes(...))`.
- **Override form:** posts to `projectQuoteApiPath`. It uses native constraints (`type="number"`, min/max/step) mirroring the parser, and its defaults are the current labour time split into h/min. "Przywróć estymację" is a separate submit with `intent=clear`, shown only when an override exists.
- **Components and tokens:** only `src/components/ui` components and token classes, with no palette classes, hex or rgba. Use Alert variants `warning` / `info` and a `Table`.
- **Numbers:** right-aligned `font-mono tabular-nums`, as in `MatchResult.astro`.

#### 4. Project page

**File**: `src/pages/dashboard/projects/[id].astro`

**Intent**: Wire the section in.

**Contract**:

- Add `cabinet_price_grosze, labour_minutes_override, labour_override_base_minutes` to the `loadProject()` select list.
- Load the pricing profile row. A load error shows a destructive Alert in the section, never defaults.
- Call `computeQuoteView`.
- Add `{ id: "quote" }` to `sections` between layout and delete, and render `QuoteSection` there with the same `<section>`/`Card` scaffolding.
- Map `?saved=quote` → `t.projects.page.savedQuote`.
- Add a "Wycena" row to the aside `dl`.
- When `matchContext` is null, follow the existing failure pattern.

#### 5. Profile page rate warning

**File**: `src/pages/dashboard/profile.astro`

**Intent**: Surface the implausible-rate warning where the typo is made, using the same threshold constant.

**Contract**: When the stored `hourly_rate_grosze > RATE_WARNING_THRESHOLD_GROSZE`, show a warning Alert with the shared `t.quote` rate-warning string. The save is never blocked.

### Success Criteria:

#### Automated Verification:

- Lint, type check, unit tests and build pass: `npm run lint && npx astro check && npm run test:unit && npm run build`

#### Manual Verification:

- `/dev/kitchen-sink` shows all seven quote states readably.
- On a project with a current match and a configured profile, the section's numbers match a hand calculation (device count from the "Dobrane aparaty" table, the cabinet price, minutes and rate from the profile).
- Saving 4 h 30 min shows the "Zapisano" banner, the "nadpisany" marker and the recomputed labour cost. After a reload the value persists. "Przywróć estymację" returns to the estimate.
- Setting an override and then adding a circuit and re-matching shows the outdated warning with the new estimate; the override is still used.
- With the profile row deleted (local DB), the section shows the profile notice and a link, and no numbers. With the match stale (edit circuits without saving a re-match), it shows the not-current notice.
- A rate of 600 zł/h shows the warning on both the quote and the profile page.
- Out-of-range input (60 min, or 0 h 0 min) is refused by the browser. A forged POST is refused with the Polish "invalid data" banner.
- A second electrician gets "not found" when posting to the first one's `/api/projects/<id>/quote`.

**Implementation Note**: Pause after this phase for confirmation before proceeding. Run the manual checks yourself in the browser pane (memory: run manual checks myself).

---

## Phase 4: Docs and contracts

### Overview

Record the new guard pair and the route, and close out the roadmap bookkeeping.

### Changes Required:

#### 1. AGENTS.md

**File**: `AGENTS.md`

**Intent**: Add the tripwire future slices (S-09 above all) must know.

**Contract**: One Tripwires entry:

- The labour override bounds are guarded twice: `projects_labour_override_*` CHECKs ↔ `src/lib/quote.ts` constants, changed together.
- The override is stored with its base estimate. "Outdated" is computed on render, never stored.
- Quote numbers come only from `computeQuoteView`, and only in state `ready`. S-09 prints that, never re-derives it.

Also update the product-code summary line to mention the quote.

#### 2. README

**File**: `README.md`

**Intent**: Keep the route table true.

**Contract**: The `/dashboard/projects/[id]` row mentions the quote (material and labour, with the time override).

#### 3. Test plan cookbook

**File**: `context/foundation/test-plan.md`

**Intent**: Only if its §6 has an entry this change's tests exemplify (a unit test with hand-computed oracle values). Point it at `src/lib/quote.test.ts`. Otherwise leave the file untouched.

**Contract**: §6 entry location / reference test only. §1–§5 stay frozen.

### Success Criteria:

#### Automated Verification:

- Formatting passes: `npm run lint && npx prettier --check AGENTS.md README.md`

#### Manual Verification:

- The AGENTS.md tripwire reads correctly next to the existing "guarded twice" entries.

---

## Testing Strategy

### Unit Tests:

- `src/lib/quote.test.ts`: hand-computed values for the estimate, rounding (both directions at 0,5 gr), material with and without catalog bars, every view state, outdated detection, the rate threshold boundary, and parser boundaries.

### Integration Tests:

- The project override columns: the all-or-nothing and range CHECKs at the same boundary values as the parser, and cross-electrician update isolation.

### Manual Testing Steps:

1. Open a project with a current match: compare the quote against a hand calculation.
2. Override with 4 h 30 min, reload, then restore the estimate.
3. Override, add a circuit, re-match: the outdated warning appears.
4. Remove the profile row: the quote blocks with a link to the profile.
5. Set the rate to 600 zł/h: warnings appear on the quote and the profile page.

## Performance Considerations

There is one extra single-row select (`pricing_profiles`) per project page render, and O(n) arithmetic over at most ~85 snapshot rows. This is negligible next to the layout and wiring work the page already does.

## Migration Notes

There are two nullable columns and no backfill. Old code ignores them, so the migrate-then-deploy window is safe. Rollback of the code leaves them unused.

## References

- PRD: FR-010, FR-011, FR-013, US-01 (`context/foundation/prd.md`)
- S-07 contracts: `context/archive/2026-09-24-electrician-pricing-profile/change.md`
- Test plan risk #5: `context/foundation/test-plan.md`
- Endpoint pattern: `src/pages/api/projects/[id]/supply.ts`
- Match view: `src/lib/device-matching-server.ts:228`
- Kitchen-sink fixtures: `src/lib/kitchen-sink-circuits.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Quote domain

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:unit` — adb9ca4
- [x] 1.2 Lint passes: `npm run lint` — adb9ca4
- [x] 1.3 Type check passes: `npx astro check` — adb9ca4

### Phase 2: Override storage and endpoint

#### Automated

- [x] 2.1 Migration applies cleanly: `npx supabase db reset` — 5dc5092
- [x] 2.2 Types regenerated with no unrelated diff: `npm run db:types` — 5dc5092
- [x] 2.3 Integration tests pass against the local stack: `npm run test:integration` — 5dc5092
- [x] 2.4 Unit tests pass: `npm run test:unit` — 5dc5092
- [x] 2.5 Lint and type check pass: `npm run lint && npx astro check` — 5dc5092

### Phase 3: Quote section on the project page

#### Automated

- [x] 3.1 Lint, type check, unit tests and build pass: `npm run lint && npx astro check && npm run test:unit && npm run build` — 962ace1

#### Manual

- [x] 3.2 `/dev/kitchen-sink` shows all seven quote states readably — 962ace1
- [x] 3.3 Section numbers match a hand calculation on a real project — 962ace1
- [x] 3.4 Override 4 h 30 min saves, persists after reload, and restores to the estimate — 962ace1
- [x] 3.5 Override then re-match with an extra circuit shows the outdated warning — 962ace1
- [x] 3.6 Missing profile and stale match each block the section without numbers — 962ace1
- [x] 3.7 A rate of 600 zł/h warns on the quote and profile pages — 962ace1
- [x] 3.8 Out-of-range and forged override input is refused — 962ace1
- [x] 3.9 A second electrician cannot post to another's quote endpoint — 962ace1

### Phase 4: Docs and contracts

#### Automated

- [x] 4.1 Formatting passes: `npm run lint && npx prettier --check AGENTS.md README.md`

#### Manual

- [x] 4.2 The AGENTS.md tripwire reads correctly next to the existing "guarded twice" entries
