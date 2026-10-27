# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-10-27

## 1. Strategy

Tests in this project follow three principles:

1. **Cost × signal.** The cheapest test that gives a real signal for a given
   risk wins. We do not promote a test to e2e because it "feels safer".
   We do not put a vision model on a deterministic difference that already
   catches the regression.
2. **The user's fears are first-class evidence.** The risk "the author fears
   the system will design an unsafe switchboard (rozdzielnica) that the
   electrician (elektryk) then takes responsibility for" weighs as much as a PRD
   line or churn data.
3. **Risks are scenarios, not code locations.** This plan describes _what can
   break_ and _why we consider it likely_ — based on documents, the interview and
   signals from the code (churn, structure, the test base). It does NOT claim
   which line is responsible for a failure. That knowledge is produced by
   `/10x-research` in each rollout phase. When the plan and the research
   disagree about where a failure is, the research is the source of truth.

An additional domain principle: **a test's oracle comes from the requirements or
the standard, never from the code under test.** The expected device, block or
amount is derived from the PRD, a table in the standard or a hand-computed
example.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`,
`scripts/` (excluding `src/lib/database.types.ts` and `src/lib/i18n/pl.ts`).

## 2. Risk Map

| #   | Risk (failure scenario)                                                                                                                                                                                                                                             | Impact | Likelihood       | Source (evidence — not anchor)                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The system proposes a device that does not meet the circuit's parameters (In too low, wrong poles, IΔn too high or RCD type too low, FR below the upstream-of-meter protection), or on a catalog gap silently substitutes a replacement instead of raising an error | High   | High             | PRD `## Success Criteria` (guardrail), US-01 AC; interview Q1; roadmap S-04 in-progress; hot-spot dir `src/lib/` (30 commits/30d)                                                                                      |
| 2   | The domain computes correctly, but the electrician sees something else: a stale match after a supply (przyłącze) or circuit (obwód) change, an invisible gap error, an RCD+MCB fallback shown like an ordinary proposal, a circuit save that loses data             | High   | High             | interview Q4 (no e2e); AGENTS.md Tripwires (suite covers no HTTP); `context/changes/circuit-input-and-device-matching/plan.md` p3 (manual steps about the stale state); hot-spot dir `src/pages/api/` (12 commits/30d) |
| 3   | An unsafe configuration passes without a block or warning: RCD in TN-C, a 3F circuit on a 1F supply, conductor ampacity below In, an error in the transcribed ampacity table                                                                                        | High   | Medium           | interview Q1; PRD FR-005, `## Non-Goals` (simple validations only); archive `2026-09-24-project-setup-and-supply-params` (the first transcription of D1 was wrong)                                                     |
| 4   | A layout proposal or a manual edit yields a physically impossible layout or one that breaks the rules (device off the rail or overlapping another, an MCB detached from its RCD, a single-circuit group without an RCBO), which ends up on the printout             | High   | High (from S-05) | interview Q3 (cabinet and layout editor, many future changes); PRD FR-008, FR-009, `## Business Logic`; roadmap S-05, S-06; hot-spot dir `src/components/cabinets/` (8 commits/30d)                                    |
| 5   | A wrong quote: wrong device count, rounding of grosze or minutes, default values instead of a block when there is no profile, an estimate shown as final and not overridable                                                                                        | High   | Medium           | PRD FR-010, FR-011, FR-013, `## Business Logic`; AGENTS.md Tripwires (no profile row = not configured); roadmap S-08                                                                                                   |
| 6   | Abuse: an electrician reads or changes someone else's project or circuits (IDOR via an id in the URL or form), the admin sees projects, a new table lands in the database without RLS                                                                               | High   | Medium           | PRD `## Access Control`, isolation NFR; roadmap F-01; hot-spot dir `supabase/migrations/` (9 commits/30d)                                                                                                              |
| 7   | Catalog↔project data drift: the CHECK in the database and the TS parser stop agreeing (devices, supply, quote, circuits), or an admin's catalog edit changes an existing project or its match                                                                       | Medium | Medium           | AGENTS.md Tripwires (rules guarded twice, S-03 snapshot); interview Q5 (catalog data matters, not looks); hot-spot dir `supabase/migrations/` (9 commits/30d)                                                          |

A high-impact × low-likelihood event (a Supabase or Cloudflare outage, a migration
corrupting production data) belongs to observability and the deployment process,
not to tests.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                                        | Must challenge                                                                                                | Context `/10x-research` must ground                                                                               | Likely cheapest layer                                                           | Anti-pattern to avoid                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| #1   | For every combination of circuit and fixture catalog the chosen device meets every parameter; on a gap there is an error naming the missing device, never a device | "Cheapest" computed only after the correctness filter; the existing matching tests have an independent oracle | the matching rule table, the RCBO → RCD+MCB fallback behaviour, where the current tests get their expected values | unit (table-driven + property-based on the fixture catalog)                     | expectations copied from the implementation (oracle problem) |
| #2   | The project page shows the same result as the domain: the gap error, the stale-match marker, no substitute; saved circuits come back without loss                  | "The endpoint calls the parser and the matcher, so the UI is OK"                                              | the form → endpoint → save → render path, the `?error=` mapping, the match snapshot                               | e2e on 2–3 critical flows, the rest integration                                 | e2e for every variant instead of for the flow                |
| #3   | Every blocker and warning fires at the boundary (In equal to ampacity, ±1 A); table values pinned to the standard                                                  | "The table is complete, so it is correct"                                                                     | the source of the table values, the conditions of blocks and warnings                                             | unit with boundary values                                                       | a test of only the plainly unsafe case                       |
| #4   | After a proposal and after every edit: no collisions, devices within the rails, a group next to its RCD, an RCBO for a single-circuit group                        | "The heuristic produced a layout, so it is physically correct"                                                | the layout model from S-05, the decided rule precedence (OQ#2)                                                    | unit on invariants + 1 e2e of editing + selective visual review of the printout | an SVG snapshot without meaning                              |
| #5   | Amounts from hand-computed examples in grosze and minutes; a missing profile blocks; an overridden time changes the cost                                           | "The device count is the list length"                                                                         | what counts as a device, rounding, the override path                                                              | unit with examples from the PRD                                                 | a formula copied from the code into the test                 |
| #6   | Electrician B gets a refusal or an empty response for A's resources; the admin does not see projects; every table with electrician data has an RLS test            | "There is RLS, so the endpoint is secure"                                                                     | the full list of tables with electrician data, endpoints that take an id                                          | integration (RLS) + 1 e2e IDOR via URL                                          | a test of only one's own read                                |
| #7   | The same fixture passes or fails identically in the TS parser and in the database CHECK; editing a cabinet or device does not change an existing project           | "A parser unit test is enough"                                                                                | the CHECK↔parser pairs, the snapshot trigger, the match snapshot                                                  | integration (live database)                                                     | separate fixtures for the database and the parser            |

## 3. Phased Rollout

| #   | Phase name                     | Goal (one line)                                                                                                         | Risks covered | Test types                                    | Status      | Change folder                                       |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------- | ----------- | --------------------------------------------------- |
| 1   | Matching and validation oracle | Prove the matching guardrail and the blocks on data from the requirements and the standard, not from the code           | #1, #3        | unit (table-driven, boundary, property-based) | complete    | `context/changes/testing-matching-oracle/`          |
| 2   | Data integrity and isolation   | CHECK↔parser parity, snapshot immutability, RLS on every table; `test:integration` in CI                                | #6, #7        | integration + CI gate                         | complete    | `context/changes/testing-data-integrity-isolation/` |
| 3   | Critical-path e2e              | Playwright bootstrap: project → supply → circuits → matching, catalog gap, stale state, IDOR via URL (after S-04 p3–p4) | #2, #6        | e2e + CI gate                                 | not started | —                                                   |
| 4   | Layout and quote invariants    | Layout and edit invariants, quote from hand-computed examples, visual review of the printout (after S-05, S-06, S-08)   | #4, #5        | unit + e2e + multimodal visual review         | not started | —                                                   |

## 4. Stack

| Layer                 | Tool                                                          | Version              | Notes                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| unit                  | Vitest (`vitest.config.ts`)                                   | ^5.0.1               | `src/**/*.test.ts`, no infrastructure, in CI                                                                                                                 |
| integration (RLS, DB) | Vitest (`vitest.integration.config.ts`) + local Supabase      | ^5.0.1 / CLI ^2.23.4 | `tests/integration/**`; local + CI `smoke` job (since §3 Phase 2)                                                                                            |
| property-based        | fast-check — checked: 2026-09-30                              | ^4.10.2              | `src/lib/*.property.test.ts`, in `test:unit` and in CI                                                                                                       |
| e2e                   | Playwright Test (`playwright.config.ts`)                      | ^1.64.1              | `tests/e2e/**`, `npm run test:e2e`; local only (build + preview, local Supabase) — to CI in §3 Phase 3; details in `test-stack.md`                           |
| HTTP smoke            | `scripts/smoke.mjs`                                           | —                    | auth and role gates only                                                                                                                                     |
| (optional) AI-native  | multimodal review of the quote printout — checked: 2026-09-29 | n/a                  | Only 1–2 screens (cabinet drawing, printout). When NOT to use: when a deterministic layout-invariant test or a DOM comparison already catches the regression |

**Stack grounding tools (current session):**

- Docs: Supabase MCP `search_docs` — available, unused at this stage; Context7 not available in current session; checked: 2026-09-29
- Search: WebSearch/WebFetch — available, unused; Exa.ai not available in current session; checked: 2026-09-29
- Runtime/browser: built-in browser (Claude Browser) — for manual verification, not as a test layer; checked: 2026-09-29
- Provider/platform: Supabase MCP, SonarQube MCP — potentially for a quality gate (coverage, issues), unused; checked: 2026-09-29

## 5. Quality Gates

| Gate                     | Where                             | Required?                 | Catches                                   |
| ------------------------ | --------------------------------- | ------------------------- | ----------------------------------------- |
| lint + `astro check`     | local (pre-commit lint) + CI `ci` | required                  | types, formatting, TS↔database enum drift |
| `test:unit`              | local + CI `ci`                   | required                  | domain-logic regressions                  |
| `test:integration`       | local + CI `smoke`                | required                  | RLS, CHECK↔parser parity, snapshots       |
| e2e on critical flows    | local (`test:e2e`), later CI      | required after §3 Phase 3 | broken critical electrician flows         |
| smoke (`smoke.mjs`)      | CI `smoke`                        | required                  | build, Cloudflare adapter, auth over HTTP |
| multimodal visual review | on demand                         | optional after §3 Phase 4 | an unreadable cabinet drawing or printout |

## 6. Cookbook Patterns

### 6.1 Adding a unit test for a domain rule

- **Where:** `src/lib/<module>.test.ts` next to the helper; property-based tests in `src/lib/<module>.property.test.ts`. Run with `npm run test:unit` (no infrastructure, in CI).
- **Naming:** the test name (or a comment above the table) points to the source of the expected value: a row of the rule table, a PRD section or a hand computation. Without a source a test is only a description of the code.
- **Oracle:** expected values are literals from the PRD, the standard or a hand computation. The test does not import implementation rules (lists, tables, predicates) — the predicate in a property-based test is written from scratch from the S-04 rule table.
- **Boundary:** the values are discrete (lists of In, cross-sections, protections), so "±1 A" does not exist. The boundary is "equal" versus "the next value from the list"; equality never warns or rejects a device.
- **Reference tests:**
  - `src/lib/device-matching.test.ts`, the `describe("boundaries — …")` blocks under the "Boundary tables (risk #1)" comment (devices just below and just above the requirement in one catalog),
  - `src/lib/device-matching.property.test.ts` (an independent predicate, "cheapest among the compliant", the exact list of gaps, a status-distribution guard),
  - the `it.each` equality table in `src/lib/supply-warnings.test.ts` (the `wlz_ampacity_below_protection` block).
- **How to add a boundary test for a new warning (without reading the plan):**
  1. Name the source of the rule (PRD, a table in the standard, a hand computation) and write it in a comment above the table.
  2. From the discrete values, list every combination where the value is exactly equal to the threshold, and the next value from the list on the warning side.
  3. Put them in one `it.each`; in each row the expected warning codes and numbers are literals, never read from the implementation code.
  4. Assertion: equality does not warn, the next value warns (`toContainEqual` with the full warning object).
  5. Check that the test guards something: change an operator in the implementation (`>` to `>=`) or a value in the table and make sure the test fails; revert the change.
  6. For floating-point computations add a case exactly on the threshold (e.g. a 0.5 % voltage drop).

### 6.2 Adding an integration test (RLS, CHECK↔parser parity)

- **Where:** `tests/integration/<name>.test.ts`, against the local stack (`npx supabase start`). Run with `npm run test:integration` (locally and in the CI `smoke` job). Files run serially and share one database: create your own users with `createElectrician` and unique names, and clean up what you write.
- **Clients:** act as the app does — the anon key plus the user's own token (`signIn`), the signed-in `SEEDED_ADMIN` for catalog writes. The service client (`createServiceClient`) is for setup, cleanup and "the row really is unchanged" re-reads only. Catalog questions (`pg_class`, grants) go through `queryDatabase` in `support.ts` (`npx supabase db query --local`); there is no `pg` driver.
- **RLS — denial, not only one's own read:** for each table, electrician B reads zero of A's rows, B's update and delete affect zero rows (re-read A's row to prove it), B's insert into A's parent is refused (`42501`), B's RPC call on A's id is refused, and the admin and anon see nothing. Reference: the `describe("as another electrician")` blocks in `rls-circuits.test.ts` and `rls-projects.test.ts`.
- **CHECK↔parser parity — one fixture, both guards:** add a `describe` to `tests/integration/check-parser-parity.test.ts`. Each row is `{ label, row, verdict }` with `verdict` one of `valid` (parser ok, database accepts), `invalid` (parser rejects, database `23514`) or `parser-stricter` (parser rejects, database accepts — a deliberate, safe-direction asymmetry such as the NIP checksum or extra decimal places). The pair's adapter builds the parser input from the row (`FormData` with zł and comma decimals, as the form sends them) and writes the parser's output when it accepts, or the raw row when it rejects, then reverts. Verdicts are literals from the CHECK text — never computed from the parser's `MIN_`/`MAX_` constants. Rows sit on the bound and on the next value beyond it.
- **Snapshot immutability:** snapshot through the app's path, edit and archive the catalog row as the signed-in admin, prove the catalog row changed (service client), then compare the owner's snapshot row with its pre-edit read. Reference: "survives the admin editing and archiving the cabinet" (`rls-projects.test.ts`) and "…the device" (`rls-circuits.test.ts`).
- **Deliberate break:** flip one row's verdict, or move a parser bound in `src/lib/` (e.g. `MAX_WLZ_LENGTH_M`), and confirm exactly that row goes red; revert.

### 6.3 Adding an e2e test for an electrician flow

- **Where:** `tests/e2e/<flow>.spec.ts`. Run with `npm run test:e2e` (the whole suite) or `npx playwright test tests/e2e/<name>.spec.ts`. Requires a local Supabase and `E2E_USERNAME` / `E2E_PASSWORD` in `.env`; the config builds the app and starts `astro preview`. Configuration: `context/foundation/test-stack.md`.
- **Pattern:** `tests/e2e/seed.spec.ts` — risk #2, a catalog gap (no B40 in the local seed) shown on the project page as an error, never as a substitute. Every new test copies its layout.
- **Header:** a `// risk: test-plan.md #<n> — …` comment with the risk number from §2 and the path the test walks.
- **Data and cleanup:** the test creates its own project with a unique name and deletes it in `afterEach` via `POST /api/projects/[id]/delete` with an `Origin` header and an assertion of 302 — a cleanup that fails turns the run red.
- **Selectors:** roles and accessible names in Polish (`getByRole`, `getByLabel`), and after island hydration `waitForIslands` from `tests/e2e/hydration.ts`.
- **Coverage today:** `seed.spec.ts` (#2, catalog gap), `layout-manual-edit.spec.ts` (#4, a rejected edit that detaches an MCB from its RCD group, and saving only the accepted one). Missing: the stale-match state (#2), IDOR via URL (#6), the CI gate.
- Candidates from S-08 (`quote-cost-estimate`, impl-review F7) — checked only manually today, because no suite covers HTTP: `POST /api/projects/[id]/quote` refuses to override the time without a pricing profile and with a stale match; it saves the estimate base computed on the server, not from the form; "Przywróć estymację" always works; a second electrician gets `not_found`.

### 6.4 Adding a test for a new table or endpoint

- **New table (checklist):** (1) `enable row level security` and per-operation, per-role policies in the migration; (2) add the table to `TABLES` in `tests/integration/rls-coverage.test.ts` with its kind (`electrician` / `catalog` / `profile`) and suite file — until you do, that test fails; (3) write or extend `tests/integration/rls-<table>.test.ts` with the owner, second-electrician, admin and anon cases from §6.2; (4) if it has a CHECK with a TypeScript twin, add its `describe` to `check-parser-parity.test.ts` and its pair to `context/foundation/agent-rules/data-guards.md`. The same guard fails on any `anon` grant on a public table and on any `security definer` function other than `handle_new_user`.
- **New endpoint:** it must build its client with `createClient(request.headers, cookies)` (the user's token) — `src/lib/rls-premise.test.ts` fails if any application file references the service-role key, because RLS protects an endpoint only while it acts as the user. The IDOR-via-URL e2e for endpoints with an id is §3 Phase 3.

### 6.5 Adding a test for layout or quote

- **Layout — where:** `src/lib/layout-editing.property.test.ts` (next to the edit model `layout-editing.ts`; the proposal and validation are covered by `cabinet-layout.test.ts`). Run with `npm run test:unit`.
- **Layout — invariant:** after a proposal and after every accepted move `validateLayout` returns `[]` (every device placed once, without overlap, within the rail and the interior, an RCD group in one piece, an RCBO alone in its group). A refused move returns a non-empty list of problems and does not change the draft. The predicate is `validateLayout` — it is the single definition of layout correctness, the test does not write its own.
- **Layout — naming:** `every accepted move on <cabinet> passes validateLayout; every refused one changes nothing`, one test per cabinet geometry.
- **Layout — distribution guard:** the test is non-vacuous only if accepted moves, refused moves and whole-block moves each occur in numbers above a threshold (`expect(accepted).toBeGreaterThan(…)`); with a new geometry, check those thresholds.
- **Layout — how to add a rule:** add the problem code to `validateLayout` and its case to `describe("validateLayout")` in `cabinet-layout.test.ts`, and a refused move with that code to `describe("moves")` in `layout-editing.test.ts`; the property test picks up the rule unchanged.
- **Quote:** TBD — see §3 Phase 4 (pattern: a quote from a hand-computed example).

### 6.6 Per-rollout-phase notes

**Phase 3 — Critical-path e2e (partially delivered outside the rollout, 2026-10-20; status stays `not started` until its change opens).** Delivered: the Playwright bootstrap (`playwright.config.ts`, a `setup` project with `storageState`, `tests/e2e/auth.setup.ts`), the seed `tests/e2e/seed.spec.ts` for the catalog gap (#2) and the `npm run test:e2e` script. Remaining: the stale-match state after a supply change (#2), IDOR via URL (#6) and an e2e job in CI.

**Phase 4 — Layout and quote invariants (partially delivered outside the rollout, 2026-10-20; status stays `not started` until its change opens).** Delivered for layout (#4): move invariants in `src/lib/layout-editing.property.test.ts` and one editing e2e `tests/e2e/layout-manual-edit.spec.ts` (a rejected move of an MCB out of its RCD group, only the accepted move saved and redrawn). Remaining: a quote from hand-computed examples (#5) as the §6.5 pattern, and the visual review of the printout.

**Phase 2 — Data integrity and isolation (complete, 2026-10-27).** Delivered: a schema-wide RLS guard (`tests/integration/rls-coverage.test.ts`: every public table has RLS, is classified and has a suite; no `anon` grants; `security definer` allowlist), the missing second-electrician cases (update/delete of another's `profiles` row, insert of a project for another electrician), a unit guard that `src/` never references the service-role key (`src/lib/rls-premise.test.ts`), CHECK↔parser parity on one shared fixture per pair for seven pairs (`tests/integration/check-parser-parity.test.ts`, 194 rows), device snapshot immutability after an admin edit and archive (`rls-circuits.test.ts`), and `npm run test:integration` in the CI `smoke` job. Findings: no real parser/CHECK disagreement; the asymmetries are all parser-stricter (NIP checksum, extra decimal places on lengths, cross-sections and device dimensions, terminal-group shape). Not covered by parity, by design: `busbar_piece` (no parser, DB-only cases stay in `rls-circuits.test.ts`), cabinet geometry (the CHECK is deliberately weak), enum columns (refused by type cast `22P02`, not a CHECK).

**Phase 1 — Matching and validation oracle (complete, 2026-09-30).** Delivered: boundary tables for device matching (`device-matching.test.ts`), a property-based matching test (`device-matching.property.test.ts`, `fast-check`), ampacity equality tables, pinning of the installation-method mapping to the reference method (`supply-warnings.test.ts`, `circuit-warnings.test.ts`) and the "TN-S / TN-C-S / TT does not block" cases (`device-matching.test.ts`). Finding: the voltage drop for 1F, Cu 10 mm², 16.1 m, 20 A is exactly 0.5 %, but in IEEE-754 it came out as 0.5000000000000001 and `supplyWarnings` warned falsely. Fix: the drop is rounded to 9 decimal places before comparison and display. Conclusion: boundary tests on floating-point-computed values must include a case exactly on the threshold. After S-04 closed, a group's RCD is matched to ΣIn × (1 + group margin), not to the largest In — the boundary tables and the property-based test's predicate were re-pointed to that rule, so the entry about it disappeared from §7.

## 7. What We Deliberately Don't Test

- **The look of the admin panel** — the only user is the author, a crude UI is acceptable. The correctness of the catalog _data_ is still tested (#7). Re-evaluate when a second admin appears. (Source: Phase 2 interview Q5.)
- **Touch and mobile UI** — outside MVP scope. (Source: PRD `## Non-Goals`.)
- **Short-circuit capacity (Icn) of devices** — never compared, because the app has no short-circuit-level input, so no test pretends to cover it. Re-evaluate when a short-circuit-level field appears on the supply. (Source: research `testing-matching-oracle`, Open Question 1.)
- **Full standard calculations** — we test only the simplified checks and the transcribed tables, not full compliance with the standard. (Source: PRD `## Non-Goals`.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-29
- Stack versions last verified: 2026-09-29
- AI-native tool references last verified: 2026-09-29

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
