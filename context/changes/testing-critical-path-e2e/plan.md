# Critical-path e2e (test-plan Phase 3) Implementation Plan

## Overview

Prove in the browser and over HTTP the two things the unit and RLS-integration suites cannot see:

- **Risk #2:** the project page shows what the domain decided. Saved circuits come back without
  loss, and a supply change surfaces the "Dobierz ponownie" marker until the electrician re-matches.
- **Risk #6:** another electrician cannot reach A's project through an id in a URL or form.

Also cover the S-08 quote-override candidates from test-plan §6.3, then gate all of it in CI with no
repository secrets.

## Current State Analysis

From `context/changes/testing-critical-path-e2e/research.md`:

- **Existing e2e.** Playwright is bootstrapped (`playwright.config.ts`, the `setup` project,
  `tests/e2e/auth.setup.ts`). There are two specs: `seed.spec.ts` (#2 catalog gap) and
  `layout-manual-edit.spec.ts` (#4). Both repeat the same "new project + supply" bootstrap and the
  asserted delete cleanup.
- **Users.**
  - The e2e user `E2E_USERNAME` was created by hand. CI has none, and `supabase/seed.sql` seeds only
    the admin.
  - There is no second electrician.
  - `tests/integration/support.ts` already provisions confirmed electricians through the local
    stack's admin API (`readStackEnv` → `createServiceClient` → `createElectrician`), reading the
    keys from `npx supabase status`, so it needs no repository secrets.
- **CI.** The `smoke` job in `.github/workflows/ci.yml` starts the stack and writes `.env` /
  `.dev.vars`. It then runs `test:integration`, build, a background preview on 4321 and the smoke
  script. No Playwright browsers are installed.
- **Match states.**
  - `computeMatchView` returns `blocked | gaps | cleared | current | stale`.
  - A supply-column change deletes the snapshot through the `projects_clear_device_snapshot`
    trigger, which leaves the page in `cleared`.
  - `cleared` and `stale` share one alert with the "Dobierz ponownie" button
    (`MatchResult.astro:255-267`).
  - Saving circuits re-matches in the same call, so circuits never go stale.
  - Catalog-drift `stale` is unit-tested.
- **IDOR.**
  - Both project pages answer 404 for an invisible id.
  - All 9 `src/pages/api/projects/[id]/` handlers answer 302 → `/dashboard/projects?error=not_found`
    for one. `circuits`, `placements` and `quote set` validate the body first.
  - No endpoint returns success to B.
- **Quote endpoint.**
  - `intent=clear` needs no profile and no current match.
  - `intent=set` refuses `quote_pricing_not_configured` before `quote_match_not_current`.
  - It stores the server-recomputed `labour_override_base_minutes` and reads only `intent`,
    `labour_hours`, `labour_minutes`.

## Desired End State

`npm run test:e2e` runs five specs green against a fresh local stack, with no hand-made user
required:

| Spec                   | Risk                                 |
| ---------------------- | ------------------------------------ |
| `seed`                 | #2 catalog gap                       |
| `layout-manual-edit`   | #4                                   |
| `circuits-match-state` | #2 stale marker + circuit round-trip |
| `idor`                 | #6                                   |
| `quote-override`       | #5/#6 endpoint candidates            |

The CI `smoke` job runs the same suite and uploads the report on failure. test-plan §3 Phase 3 reads
`complete`, and §6.3/§6.4 and test-stack.md describe the new specs and the user model.

### Key Discoveries:

- `src/lib/device-matching-server.ts:250-266`: `cleared` (empty snapshot, fresh match ok) is what
  the electrician sees after a supply change, not `stale`.
- `supabase/migrations/20260929120000_circuits_and_device_matching.sql:228-253`: the snapshot is
  cleared only when a supply value actually changes.
- `src/pages/api/projects/[id]/quote.ts:47-98`: clear branch, ownership, refusal order, server-side
  base.
- `tests/integration/support.ts:65,96,125,137`: reusable provisioning helpers.
- `src/components/circuits/CircuitEditor.tsx:396-397`: circuits post as one `circuits_payload` JSON
  field in a form. A crafted POST can reuse this shape.

## What We're NOT Doing

- **No e2e per match variant.**
  - `gaps` is already covered by `seed.spec`.
  - `blocked` and catalog-drift `stale` are unit-covered (`device-matching-server.test.ts`).
  - The admin in-place-edit path would mutate the shared seed catalog under parallel specs.
- **No RLS re-tests.** Every table's denial is in `tests/integration/rls-*.test.ts` (Phase 2).
- **No direct Astro-handler unit tests.** Mocking `createClient` would encode the RLS behaviour the
  test should prove. There is no precedent in the repo.
- **No hand-computed quote amounts.** That is Phase 4 (#5). Here the quote spec checks refusals and
  which base is stored, not money.
- **No production-code changes**, unless a spec exposes a real defect. That would be a finding,
  reported and fixed in its own commit.
- **No change to the Origin-check behaviour.** Specs send a same-origin `Origin`, as `seed.spec`
  does.

## Implementation Approach

Browser specs follow the `/10x-e2e` loop for each risk (plan → generate → review → verify) and copy
`seed.spec.ts`'s layout:

- a `// risk:` header;
- a unique project name;
- the asserted `afterEach` cleanup;
- Polish role and label selectors;
- `waitForIslands` before island input.

HTTP-only checks (IDOR POSTs, quote refusals) use `page.request` / `context.request` with
`maxRedirects: 0` and a same-origin `Origin`. They run inside Playwright because they need the real
preview and its cookies.

There are two user kinds:

- **Electrician A, the default `storageState`.** The `setup` project uses `E2E_USERNAME` /
  `E2E_PASSWORD` when both are set. Otherwise it provisions a fresh electrician through the local
  stack's admin API. CI therefore needs no user step.
- **Throwaway electricians, provisioned per spec** (B for IDOR; an isolated user for the quote spec,
  whose pricing-profile state the spec owns). Each is signed in through the real
  `POST /api/auth/signin` in its own browser context.

Provisioning always targets the stack `npx supabase status` reports, which is local by
construction.

## Critical Implementation Details

- **Valid bodies.** Several endpoints validate the body before the ownership check, so an IDOR POST
  with an empty body returns `?error=…invalid…` on A's URL, not `not_found`. Each IDOR POST must
  carry a body the endpoint accepts. Only then does the assertion prove ownership, not validation.
- **Change a supply value.** The supply change in the #2 spec must change a value: re-saving
  identical values leaves the snapshot, and no marker appears. Change only "Długość WLZ (m)" (10 → 12) so the circuits stay matchable.
- **Hydration.** Circuit and editor islands are `client:only`. After every `page.reload()`, call
  `waitForIslands` before reading values, and compare selects by option _value_ (`"2.5"`), not by
  label.

## Phase 1: E2E harness — shared helpers and provisioned users

### Overview

Factor out the duplicated bootstrap and cleanup. Make the `setup` project provision electrician A
when no credentials are given. Add a helper that provisions and signs in a throwaway electrician.
Existing specs move onto the helpers unchanged in behaviour.

### Changes Required:

#### 1. Shared e2e helpers

**File**: `tests/e2e/support.ts` (new)

**Intent**: One home for the steps every spec repeats, so new specs stay short and the cleanup
contract (asserted 302 + `deleted=1`) lives once.

**Contract**:

- `createProjectWithSupply(page, name)` returns `{ id, url }`. It drives the new-project form and the
  seed.spec supply (63 A, TN-S, 1 faza, 10 m, 16 mm², Cu, Natynkowo), waits for `saved=supply` and
  then calls `waitForIslands`.
- `deleteProject(request, baseURL, id)` asserts 302 and `deleted=1`.
- `sameOrigin(baseURL)` returns the headers object.
- `provisionElectrician(label)` returns `{ email, password }`. It reuses `readStackEnv`,
  `createServiceClient` and `createElectrician` from `tests/integration/support.ts`, importing them
  rather than copying.
- `signedInContext(browser, baseURL, user)` returns a new `BrowserContext` signed in through
  `POST /api/auth/signin` (form `email`, `password`, same-origin `Origin`). It asserts the redirect
  is not back to `/auth/signin`.

#### 2. Auth setup provisions A when unset

**File**: `tests/e2e/auth.setup.ts`

**Intent**: Remove the hand-made-user prerequisite: CI and a fresh clone get a working A without
secrets, and an existing local `.env` user keeps working.

**Contract**:

- Credentials = `E2E_USERNAME` / `E2E_PASSWORD` when both are set; otherwise
  `provisionElectrician("e2e-a")`.
- The UI sign-in and `playwright/.auth/user.json` are unchanged.
- One set without the other is still an error.

#### 3. Existing specs on the helpers

**File**: `tests/e2e/seed.spec.ts`, `tests/e2e/layout-manual-edit.spec.ts`

**Intent**: Replace the duplicated bootstrap and cleanup with the helpers. Assertions stay as they
are.

**Contract**: The seed header comment still names it the pattern to copy, and points to `support.ts`
for the bootstrap.

#### 4. Example env

**File**: `.env.example`

**Intent**: Document that `E2E_USERNAME` / `E2E_PASSWORD` are optional (the setup provisions a user
when they are unset).

**Contract**: Both keys listed as commented-out optional entries.

### Success Criteria:

#### Automated Verification:

- `npm run test:e2e` green with `.env`'s E2E credentials (seed + layout-manual-edit)
- `npm run test:e2e` green with `E2E_USERNAME`/`E2E_PASSWORD` unset in the shell and `.env` (provisioned A)
- `npm run lint` and `npx astro check` pass

---

## Phase 2: Risk #6 — IDOR via URL and form

### Overview

One spec, `tests/e2e/idor.spec.ts`. A creates a matched project. B, a throwaway electrician, walks
every id-taking route. A then proves nothing changed.

### Changes Required:

#### 1. IDOR spec

**File**: `tests/e2e/idor.spec.ts` (new)

**Intent**: Answer "there is RLS, so the endpoint is secure" at the layer RLS tests cannot see: the
handler's conversion of an invisible row into a refusal, with no data in the response and no write.

**Contract**:

Setup as A (default `storageState`):

- `createProjectWithSupply`;
- one RCD group with two 16 A circuits, saved;
- `current` match ("Dobrane aparaty" visible).

As B (`signedInContext`):

- `GET /dashboard/projects/<A-id>` and `/dashboard/projects/<A-id>/print` → status 404, the
  not-found text, and the body never contains A's project name.
- A POST with a body the endpoint accepts and a same-origin `Origin`, `maxRedirects: 0`, to each of
  the 9 endpoints:
  - `index`
  - `supply`
  - `cabinet`
  - `circuits` (a valid `circuits_payload`)
  - `rematch`
  - `layout`
  - `placements` (a valid placement payload, read from the editor's form shape)
  - `quote` (`intent=set` with valid hours, and `intent=clear`)
  - `delete` (last)

  Each → 302 with `location` ending `/dashboard/projects?error=not_found`.

Afterwards, as A, reload:

- the name, supply values, circuits and the `current` match are unchanged;
- the project still exists (A's own `afterEach` delete returns 302).

`// risk: test-plan.md #6` header.

### Success Criteria:

#### Automated Verification:

- `npx playwright test tests/e2e/idor.spec.ts` green
- Deliberate break: temporarily remove the `data.length === 0` check in `src/pages/api/projects/[id]/index.ts` → the spec goes red on the `index` POST; revert
- `npm run lint` and `npx astro check` pass

---

## Phase 3: Risk #2 — match state and circuit round-trip on the project page

### Overview

One flow spec, `tests/e2e/circuits-match-state.spec.ts`: saved circuits come back without loss, then
a supply change surfaces the re-match marker, and re-matching clears it.

### Changes Required:

#### 1. Match-state spec

**File**: `tests/e2e/circuits-match-state.spec.ts` (new)

**Intent**: Challenge "the endpoint calls the parser and the matcher, so the UI is OK" by asserting
what the electrician sees after each state transition. Assert on the stored state, after a reload.

**Contract**:

1. `createProjectWithSupply`. Add a group with non-default values: name, IΔn, min type, margin 20 %.
   Add two circuits in it with non-default names, installation and entry side ("Dół"), with
   In 16 A / 1 faza / 2,5 mm² so they match. Save → `saved=circuits`.
2. Reload + `waitForIslands`. Every field of the group card and both circuit rows reads back the
   saved value (`toHaveValue` on option values). "Dobrane aparaty" is visible. "Dobierz ponownie"
   and "Luki w katalogu aparatów" are hidden. The aside badge is not "Nieaktualny".
3. Change "Długość WLZ (m)" to 12, save → `saved=supply`, reload. The "Dobierz ponownie" button is
   visible inside a `role="status"` alert carrying the `cleared` text. The aside badge reads
   "Nieaktualny". The circuits still read back unchanged.
4. Click "Dobierz ponownie" → `saved=rematch`, reload. "Dobrane aparaty" is visible and
   "Dobierz ponownie" is hidden.

`// risk: test-plan.md #2` header. Assert headings and states, never a device count.

### Success Criteria:

#### Automated Verification:

- `npx playwright test tests/e2e/circuits-match-state.spec.ts` green
- Deliberate break: temporarily disable the `projects_clear_device_snapshot` effect by skipping the `wlz_length_m` comparison in a scratch local migration, OR make `computeMatchView` return `current` for an empty snapshot → the spec goes red at step 3; revert (and `npx supabase db reset` if the database was touched)
- `npm run lint` and `npx astro check` pass

---

## Phase 4: Quote override endpoint (§6.3 candidates)

### Overview

One spec, `tests/e2e/quote-override.spec.ts`, with its own throwaway electrician, so the
pricing-profile state is the spec's alone.

### Changes Required:

#### 1. Quote-override spec

**File**: `tests/e2e/quote-override.spec.ts` (new)

**Intent**: Cover the S-08 impl-review F7 candidates at the one layer that exercises the real
handler: refusal without a profile, refusal with a non-current match, a server-side base, and clear
always succeeding. Another electrician's `not_found` is already in the IDOR spec.

**Contract**:

Setup: a provisioned electrician in its own `signedInContext`, with a project and two matched
circuits.

1. With no pricing profile:
   - POST `intent=set` → 302 to the project with `error=quote_pricing_not_configured`;
   - POST `intent=clear` → 302 with `saved=quote`.
2. Create the pricing profile through the real form endpoint `POST /api/profile/pricing` (same
   fields as `/dashboard/profile`), then change the supply length. While the match is `cleared`:
   - POST `intent=set` → `error=quote_match_not_current`;
   - POST `intent=clear` → `saved=quote`.
3. Re-match. POST `intent=set` with valid hours/minutes **and** a forged
   `labour_override_base_minutes=1` → `saved=quote`. The stored
   `projects.labour_override_base_minutes` (read via the service client from `support.ts`) is not 1
   and equals the estimate the page shows. The quote section shows no "outdated override" marker.
4. "Przywróć estymację" in the UI → the override is gone (the estimate is shown as the labour time
   again).

`// risk: test-plan.md #5, #6` header.

### Success Criteria:

#### Automated Verification:

- `npx playwright test tests/e2e/quote-override.spec.ts` green
- Deliberate break: temporarily store the form's `labour_hours*60+labour_minutes` as the base in `quote.ts` → step 3 goes red; revert
- `npm run lint` and `npx astro check` pass

---

## Phase 5: CI gate and documents

### Overview

Run the e2e suite in the CI `smoke` job against its local stack, and close test-plan Phase 3 in the
documents.

### Changes Required:

#### 1. CI e2e step

**File**: `.github/workflows/ci.yml`, `playwright.config.ts`

**Intent**: Make `test:e2e` a required gate with no repository secrets, reusing the `smoke` job's
stack.

**Contract**:

- In `smoke`, after `test:integration` and before the explicit build + smoke steps: install the
  browser with `npx playwright install --with-deps chromium`, then run `npm run test:e2e`.
  Playwright's own `webServer` builds and previews, then stops before the smoke step starts its
  preview, so there is no port clash.
- An `if: failure()` step uploads `playwright-report/` and `test-results/`.
- In `playwright.config.ts` the CI reporter is `[["list"], ["html", { open: "never" }]]`. Locally
  stays `html`.
- The `ci` job is untouched.

#### 2. Documents

**File**: `context/foundation/test-plan.md`, `context/foundation/test-stack.md`

**Intent**: Record what Phase 3 delivered and how to add the next e2e.

**Contract**:

- test-plan §3 row 3 → `complete`.
- §4 e2e row: "local + CI `smoke`".
- §5 e2e gate → "local + CI `smoke`, required".
- §6.3:
  - helpers in `tests/e2e/support.ts`;
  - the user model (A from env or provisioned; throwaway users via `provisionElectrician` +
    `signedInContext`);
  - "valid body before ownership";
  - a coverage list with the new specs;
  - the S-08 candidates marked covered.
- §6.4 "New endpoint": add the endpoint to `idor.spec.ts`.
- §6.6 Phase 3 note → complete, with findings.
- test-stack.md:
  - the E2E specs table gets the three new rows;
  - the "full-suite command … not in CI yet" and "auth setup project" lines are updated to the
    provisioned-user and CI facts.
- `Last updated: 2026-10-27`.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check`, `npm run test:unit` pass
- `npm run test:integration` passes against the local stack
- `npm run test:e2e` passes (all five specs)
- `ci.yml` parses (actionlint or `npx yaml-lint`-equivalent check, or a dry review if no linter is available)

#### Manual Verification:

- The CI `smoke` job is green on the next push to `master`, including the e2e step (not pushed by this change)
- Read the test-plan §6.3 cookbook as a newcomer: it is enough to add a new e2e without reading this plan

---

## Testing Strategy

### Unit Tests:

- None new. The refusal and parse logic is already in `src/lib/quote.test.ts` and
  `device-matching-server.test.ts`.

### Integration Tests:

- None new. RLS denial for every table is Phase 2.

### Manual Testing Steps:

1. Push to `master` (outside this change) and watch the `smoke` job's e2e step.

## Performance Considerations

The e2e step adds the browser install (~1 min) and one more build + suite run (~2–3 min) to `smoke`.
CI runs Playwright with 1 worker and 2 retries.

## References

- Research: `context/changes/testing-critical-path-e2e/research.md`
- Pattern: `tests/e2e/seed.spec.ts`
- Provisioning: `tests/integration/support.ts:65-140`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: E2E harness — shared helpers and provisioned users

#### Automated

- [x] 1.1 `npm run test:e2e` green with `.env`'s E2E credentials (seed + layout-manual-edit)
- [x] 1.2 `npm run test:e2e` green with `E2E_USERNAME`/`E2E_PASSWORD` unset in the shell and `.env` (provisioned A)
- [x] 1.3 `npm run lint` and `npx astro check` pass

### Phase 2: Risk #6 — IDOR via URL and form

#### Automated

- [ ] 2.1 `npx playwright test tests/e2e/idor.spec.ts` green
- [ ] 2.2 Deliberate break: remove the 0-row check in `index.ts` → red; revert
- [ ] 2.3 `npm run lint` and `npx astro check` pass

### Phase 3: Risk #2 — match state and circuit round-trip on the project page

#### Automated

- [ ] 3.1 `npx playwright test tests/e2e/circuits-match-state.spec.ts` green
- [ ] 3.2 Deliberate break: empty snapshot reads as `current` → red at step 3; revert
- [ ] 3.3 `npm run lint` and `npx astro check` pass

### Phase 4: Quote override endpoint (§6.3 candidates)

#### Automated

- [ ] 4.1 `npx playwright test tests/e2e/quote-override.spec.ts` green
- [ ] 4.2 Deliberate break: base taken from the form → red; revert
- [ ] 4.3 `npm run lint` and `npx astro check` pass

### Phase 5: CI gate and documents

#### Automated

- [ ] 5.1 `npm run lint`, `npx astro check`, `npm run test:unit` pass
- [ ] 5.2 `npm run test:integration` passes against the local stack
- [ ] 5.3 `npm run test:e2e` passes (all five specs)
- [ ] 5.4 `ci.yml` parses

#### Manual

- [ ] 5.5 The CI `smoke` job is green on the next push to `master`, including the e2e step
- [ ] 5.6 The §6.3 cookbook is enough to add a new e2e without reading this plan
