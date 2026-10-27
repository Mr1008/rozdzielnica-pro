# Test rollout phase 2 — data integrity and isolation Implementation Plan

## Overview

Close rollout Phase 2 of `context/foundation/test-plan.md` (risks #6 and #7). This change adds
integration tests and a CI gate only; it does not change product code or the schema. The tests
cover:

- a schema-wide RLS guard,
- the remaining cross-electrician gaps,
- CHECK↔parser parity on one shared fixture per pair,
- device snapshot immutability.

`npm run test:integration` then becomes a required CI gate.

## Current State Analysis

From `research.md` (2026-10-27):

- **RLS is in place.** All 10 public tables have RLS enabled. 8 suites test the owner, a second
  electrician, the admin and anon on each table and on both write RPCs.
- **No guard catches a new table.** A table added without RLS or without a test fails nothing.
- **Cross-electrician gaps:**
  - `profiles` has no case of B updating or deleting A's row.
  - `projects` has no case of B inserting a row owned by A.
- **Endpoints rely entirely on RLS.** They build their client with the user's token
  (`createClient(request.headers, cookies)`), and nothing pins that `src/` never holds a
  service-role key.
- **No CHECK↔parser pair is tested with one fixture on both sides.** Integration tests are DB-only
  (`23514`) and unit tests are parser-only.
- **Device snapshot immutability is untested.** The cabinet snapshot is covered
  (`rls-projects.test.ts:389`). Nothing covers an admin editing or archiving a device that is
  already in `project_devices`.
- **`test:integration` does not run in CI.** The `smoke` job already starts a local Supabase with
  the token hook and the seeded admin.

## Desired End State

- `npm run test:integration` fails if:
  - any public table lacks RLS,
  - any public table is missing from the classification list,
  - an electrician-data table has no RLS suite,
  - `anon` holds any grant on a public table,
  - a `security definer` function appears outside the allowlist.
- `npm run test:unit` fails if a file under `src/` references a service-role key.
- For each of the 7 parser-backed pairs, every row of one fixture table produces the same literal
  verdict in the TS parser and in the database. Deliberate parser-stricter rows are named as such.
- An admin edit or archive of a snapshotted device leaves the `project_devices` row unchanged.
- The CI `smoke` job runs `npm run test:integration`.
- AGENTS.md, `deploy-tooling.md` and `test-plan.md` say so: §3 row `complete`, and the §6.2/§6.4
  patterns written.

### Key Discoveries:

- `npx supabase db query --local -o json "<sql>"` (CLI 2.117.0, pinned in `package-lock.json:10490`)
  returns `{ rows: [...] }` and can read `pg_catalog`. There is no `pg` driver in the repo, and
  PostgREST does not expose the catalog.
- Live state on 2026-10-27:
  - `anon` holds no grant on any public table.
  - The only `security definer` function in `public` is `handle_new_user`.
- The parsers already emit DB column names:
  - `parseDeviceSpec(input)` (`device-spec.ts:399`) is row-shaped.
  - The form parsers take `FormData`: `parseSupplyForm` (`supply-params.ts:143`),
    `parsePricingForm` (`pricing-profile.ts:65`), `parseBusinessForm` (`business-profile.ts:101`),
    `parseLabourOverrideForm` (`quote.ts:219`) and `parseProjectDetailsForm` (`project.ts:140`).
  - `parseCircuitsPayload(raw)` (`circuit-params.ts:224`) takes the nested JSON payload.
- Parser-stricter by design: NIP checksum, WLZ length decimal places, device decimal places, cabinet
  geometry.
- `project_devices_snapshot_device` fires BEFORE INSERT only, and the table has no UPDATE grant. No
  FK action or trigger connects `devices` to `project_devices`.

## What We're NOT Doing

- **No HTTP IDOR e2e.** That is Phase 3 (`tests/e2e/`).
- **No stale-match assertion after a catalog edit.** `computeMatchView` is TypeScript and belongs in
  unit tests.
- **No parity for `busbar_piece`.** It has no parser, only a mapping. Its CHECK stays covered
  DB-only in `rls-circuits.test.ts:572-598`.
- **No two-way parity for cabinet geometry.** Its CHECK is deliberately weak. The existing "a stored
  row passes the parser" tests stay.
- **No schema or product-code changes.** No helper RPC for catalog queries.
- **No new CI job.** The step goes into the existing `smoke` job, which already has the stack.

## Implementation Approach

Each phase lands as its own Conventional Commit on `master` once green:

- integration tests in `tests/integration/`,
- one shared catalog-query helper in `support.ts`,
- one unit test in `src/lib/`.

Fixture verdicts are literals taken from the migrations' CHECK text and the PRD, never computed
from parser constants. That keeps the oracle independent of the code under test (test-plan §1).

## Critical Implementation Details

- **`db query` output.** Its JSON carries `boundary` and `warning` keys next to `rows`. Parse it
  with zod and read only `rows`. Run it with `execSync` like `runSupabaseStatus`, from the repo root.
  The CLI prints a "new version available" notice on stderr; that must not break parsing.
- **Parity fixtures and the DB side.** For the DB side, write each fixture through the same client
  the app uses (the user's token for owner tables, the admin for devices), then clean up. A row
  that the DB accepts must be deleted or reverted so that later rows start from a known state.
  `pricing_profiles` and `business_profiles` have no DELETE grant, so use the service client for
  cleanup.

## Phase 1: RLS coverage guard (#6)

### Overview

Make "a new table ships without RLS or without a test" fail the suite, close the two
cross-electrician gaps, and pin the premise that endpoints carry no service-role key.

### Changes Required:

#### 1. Catalog query helper

**File**: `tests/integration/support.ts`

**Intent**: Let integration tests read the Postgres catalog of the local stack without a driver or a
schema change.

**Contract**: `queryDatabase(sql: string): unknown[]`. It shells out to
`npx supabase db query --local -o json`, validates `{ rows: unknown[] }` with zod, and throws a
message naming `npx supabase start` when the stack is unreachable.

#### 2. Schema-wide RLS guard

**File**: `tests/integration/rls-coverage.test.ts` (new)

**Intent**: Prove the isolation preconditions hold for every public table, not just the ones that
already have a suite.

**Contract**:

- A literal classification map: table → `"electrician" | "catalog" | "profile"`, plus the suite file
  that covers it. Assertions:
  - The set of `public` base tables equals the map's keys, so an unclassified new table fails with a
    message telling the author to classify it and write its RLS suite.
  - Every table has `relrowsecurity = true`.
  - Every mapped suite file exists and mentions the table name.
- `anon` holds no privilege on any public table.
- The set of `security definer` functions in `public` equals `{handle_new_user}`.

#### 3. Cross-electrician gap fills

**Files**: `tests/integration/rls-profiles.test.ts`, `tests/integration/rls-projects.test.ts`

**Intent**: Close the two B-against-A gaps found by the research.

**Contract**:

- Electrician B's update and delete of A's `profiles` row affect 0 rows. A re-read through the
  service client shows A's row unchanged.
- Electrician B inserting a project with `user_id` = A is refused (42501), and A sees no new project.

#### 4. No service-role key in application code

**File**: `src/lib/rls-premise.test.ts` (new)

**Intent**: Pin the premise behind "there is RLS, so the endpoint is secure". Every server path uses
the user's token only while no application code can reach the service-role key.

**Contract**:

- Walk `src/` and fail if any non-test file matches `/service[_-]?role/i` or `SERVICE_ROLE_KEY`, naming
  the file.
- A self-check asserts the walk visited `src/lib/supabase.ts` and at least one `src/pages/api/**`
  file, so the test cannot pass by scanning nothing.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes, including `rls-coverage.test.ts` and the new B-against-A cases
- `npm run test:unit` passes, including `src/lib/rls-premise.test.ts`
- Deliberate break: removing a table from the classification map makes `rls-coverage.test.ts` fail (reverted)
- `npm run lint` and `npx astro check` pass

---

## Phase 2: CHECK↔parser parity (#7)

### Overview

For every parser-backed pair, one fixture table drives both guards, and each row asserts the same
literal verdict on both sides.

### Changes Required:

#### 1. Parity suite

**File**: `tests/integration/check-parser-parity.test.ts` (new)

**Intent**: Replace "a parser unit test is enough" with evidence that the parser and the CHECK
agree on the same inputs at the boundaries.

**Contract**:

- **Fixture rows.** One `describe` per pair. Each row has:
  - `label`,
  - the row-shaped values,
  - `verdict: "valid" | "invalid" | "parser-stricter"`.
- **Per-pair adapters.** `toParserInput(row)` builds `FormData` (or the payload object) from the row.
  Rates are in zł and lengths use a comma decimal, as the form sends them. `writeToDatabase(row)`
  returns the Postgres error code or `null` and cleans up after itself.
- **Assertions:**
  - `valid`: the parser returns `ok` and the DB write succeeds.
  - `invalid`: the parser rejects and the DB answers `23514`.
  - `parser-stricter`: the parser rejects and the DB accepts. These are the recorded safe-direction
    asymmetries.
- **Pairs and minimum boundary rows.** Each row is "equal to the bound" or "the next value beyond
  it", and verdicts are literals from the CHECK text:
  - **Device spec** (`parseDeviceSpec` ↔ `devices_parameters_match_kind` and price/dimension CHECKs):
    - one valid row per kind,
    - a missing required parameter,
    - a foreign parameter,
    - an off-set pole,
    - `n_terminal_side` present or absent against N poles,
    - comb busbar poles,
    - parser-stricter: an extra decimal place.
  - **Supply** (`parseSupplyForm` ↔ `projects_*_valid`):
    - every list edge (premeter protection, phase count, cross-section),
    - WLZ length 0, 0.1, 500 and 500.1,
    - parser-stricter: 12.34 m.
  - **Circuits/groups** (`parseCircuitsPayload` ↔ `rcd_groups_*`, `circuits_*`, `rcd_groups_margin_valid`):
    - off-list rated current, cross-section, residual current, margin and phase count,
    - label and name length bounds.
  - **Pricing** (`parsePricingForm` ↔ `pricing_profiles_*`): rate 0 and 1, mount minutes 0/1/600/601,
    overhead -1/0/6000/6001.
  - **Business** (`parseBusinessForm` ↔ `business_profiles_*_valid`):
    - length bounds, phone and email patterns,
    - NIP of 9 or 11 digits,
    - parser-stricter: 10 digits with a bad checksum.
  - **Labour override** (`parseLabourOverrideForm` ↔ `projects_labour_override_range`): 0, 1 and
    59999 minutes, and the first value above the maximum.
  - **Project details** (`parseProjectDetailsForm` ↔ `projects_name/client_name/site_address_valid`):
    empty after trim, the length bound and the bound plus one.
- **File header.** The file's header comment names `context/foundation/agent-rules/data-guards.md`
  as the list of pairs, so a new pair gets a `describe` here.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes, including `check-parser-parity.test.ts` with all 7 pairs
- Deliberate break: flipping one fixture's verdict (or one parser bound) makes the suite fail on that row (reverted)
- `npm run lint` and `npx astro check` pass

---

## Phase 3: Device snapshot immutability (#7)

### Overview

Prove that an admin catalog edit never reaches an existing project's device snapshot. This mirrors
the existing cabinet test.

### Changes Required:

#### 1. Device edit and archive after snapshot

**File**: `tests/integration/rls-circuits.test.ts`

**Intent**: Close the device half of "editing a cabinet or device does not change an existing
project".

**Contract**:

1. Electrician A saves circuits, which snapshots a test device into `project_devices`.
2. The admin (signed-in seeded admin, as the app would) updates the device's price, name and a
   parameter, then archives it.
3. A's `project_devices` row equals its pre-edit read in every snapshot column. A can still read it.
4. A's project row (the cabinet snapshot columns) is also unchanged.

### Success Criteria:

#### Automated Verification:

- `npm run test:integration` passes, including the new device-edit snapshot case
- Deliberate break: asserting the edited price instead of the snapshotted one fails (reverted)
- `npm run lint` and `npx astro check` pass

---

## Phase 4: CI gate and documentation

### Overview

Make `test:integration` a required CI gate, and bring the rules files and the test plan in line.

### Changes Required:

#### 1. CI step

**File**: `.github/workflows/ci.yml`

**Intent**: Run the integration suite against the local Supabase the `smoke` job already starts, so
risks #6 and #7 are gated with no repository secrets.

**Contract**:

- Add a `npm run test:integration` step to job `smoke`, after "Start local Supabase" and before the
  build and the smoke run, so it does not interleave with the smoke signups.
- Job id `smoke` is unchanged. A display `name` stating it also runs the integration suite is allowed.

#### 2. Rules files

**Files**: `AGENTS.md` (Tripwires, first bullet, and `## Commands`),
`context/foundation/agent-rules/deploy-tooling.md` (`## CI and deploy`)

**Intent**: Remove the now-false "`test:integration` is local-only / not in CI" statements and
describe where it runs.

**Contract**: Edit the wording in those sections only. Keep the rule that `npm test` must never be
wired into a database-less job.

#### 3. Test plan

**File**: `context/foundation/test-plan.md`

**Intent**: Close Phase 2 and record the cookbook patterns.

**Contract**:

- §3 row 2 status `complete`.
- §4 integration row: in CI (`smoke` job).
- §5 `test:integration` row: where = local + CI `smoke`, required.
- §6.2: the parity pattern — where, fixture shape, verdicts, adapters, deliberate break, reference
  test.
- §6.4: the new-table checklist — classify in `rls-coverage.test.ts`, write its suite with B and
  admin denial cases. The new-endpoint IDOR test is still Phase 3.
- §6.6: a Phase 2 note with delivered items and findings.
- Bump "Last updated".

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check`, `npm run test:unit` and `npm run test:integration` pass locally
- `.github/workflows/ci.yml` parses as YAML, and the `smoke` job lists the `test:integration` step before the build

#### Manual Verification:

- After the next push to `master`, CI job `smoke` runs `test:integration` green on GitHub Actions

---

## Testing Strategy

### Unit Tests:

- `src/lib/rls-premise.test.ts`: no service-role reference under `src/`, with a non-vacuity self-check.

### Integration Tests:

- `rls-coverage.test.ts`: RLS on, every table classified and suited, no `anon` grants, the definer
  allowlist.
- `check-parser-parity.test.ts`: one fixture table per pair, each row checked against both guards.
- `rls-circuits.test.ts`: the device snapshot survives an admin edit and archive.
- `rls-profiles.test.ts` and `rls-projects.test.ts`: B-against-A update, delete and insert.

### Manual Testing Steps:

1. Push to `master` (done by the user; this change does not push) and confirm the `smoke` job's
   integration step is green.

## Performance Considerations

The parity suite performs roughly 100–150 single-row writes against the local stack, serially. That
is expected to add well under a minute to the `smoke` job.

## Migration Notes

None. No schema change.

## References

- Research: `context/changes/testing-data-integrity-isolation/research.md`
- Test plan: `context/foundation/test-plan.md` §2 (#6, #7), §3 Phase 2
- Pairs list: `context/foundation/agent-rules/data-guards.md`
- Existing cabinet snapshot test: `tests/integration/rls-projects.test.ts:389`
- Phase 1 rollout precedent: `context/archive/2026-09-29-testing-matching-oracle/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: RLS coverage guard (#6)

#### Automated

- [x] 1.1 `npm run test:integration` passes, including `rls-coverage.test.ts` and the new B-against-A cases — 330f146
- [x] 1.2 `npm run test:unit` passes, including `src/lib/rls-premise.test.ts` — 330f146
- [x] 1.3 Deliberate break: removing a table from the classification map makes `rls-coverage.test.ts` fail (reverted) — 330f146
- [x] 1.4 `npm run lint` and `npx astro check` pass — 330f146

### Phase 2: CHECK↔parser parity (#7)

#### Automated

- [x] 2.1 `npm run test:integration` passes, including `check-parser-parity.test.ts` with all 7 pairs — c9cf030
- [x] 2.2 Deliberate break: flipping one fixture's verdict (or one parser bound) makes the suite fail on that row (reverted) — c9cf030
- [x] 2.3 `npm run lint` and `npx astro check` pass — c9cf030

### Phase 3: Device snapshot immutability (#7)

#### Automated

- [x] 3.1 `npm run test:integration` passes, including the new device-edit snapshot case — 94233de
- [x] 3.2 Deliberate break: asserting the edited price instead of the snapshotted one fails (reverted) — 94233de
- [x] 3.3 `npm run lint` and `npx astro check` pass — 94233de

### Phase 4: CI gate and documentation

#### Automated

- [x] 4.1 `npm run lint`, `npx astro check`, `npm run test:unit` and `npm run test:integration` pass locally — 2e53b93
- [x] 4.2 `.github/workflows/ci.yml` parses as YAML, and the `smoke` job lists the `test:integration` step before the build — 2e53b93

#### Manual

- [ ] 4.3 After the next push to `master`, CI job `smoke` runs `test:integration` green on GitHub Actions
