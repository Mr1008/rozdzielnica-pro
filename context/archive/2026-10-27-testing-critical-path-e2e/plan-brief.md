# Critical-path e2e (test-plan Phase 3) — Plan Brief

> Full plan: `context/changes/testing-critical-path-e2e/plan.md`
> Research: `context/changes/testing-critical-path-e2e/research.md`

## What & Why

Unit and RLS-integration tests prove the domain and the database, but no suite exercises HTTP or the
page. This change adds browser/HTTP tests for the two places that gap can hurt:

- **Risk #2:** the electrician sees a stale or lost match result.
- **Risk #6:** electrician B reaches A's project by URL.

It also covers the S-08 quote-override candidates, and makes e2e a CI gate with no secrets.

## Starting Point

- **Playwright.** Bootstrapped, with two specs: a catalog gap (#2) and a manual layout edit (#4).
- **Users.** The e2e user was made by hand. CI has no user and no browser, and there is no second
  electrician.
- **Provisioning.** `tests/integration/support.ts` can already provision confirmed electricians from
  the local stack.

## Desired End State

`npm run test:e2e` runs five specs green on a fresh local stack without a hand-made user, and the CI
`smoke` job runs them. test-plan §3 Phase 3 is `complete`.

## Key Decisions Made

| Decision                | Choice                                                                                    | Why (1 sentence)                                                                                   | Source          |
| ----------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------- |
| #2 stale marker trigger | Change the WLZ length → state `cleared` → "Dobierz ponownie" → re-match                   | No browser path makes circuits stale, and the supply trigger is what the electrician actually hits | Research        |
| Catalog-drift `stale`   | Stays unit-level                                                                          | Already tested and rendered by the same alert; an e2e would mutate the shared seed catalog         | Research        |
| #2 round-trip           | Same flow spec, non-default value in every field, read back after reload                  | A per-variant e2e is the named anti-pattern                                                        | Task + Research |
| #6 scope                | One spec: B GETs both pages and POSTs a valid body to all 9 endpoints, then A re-reads    | Handlers validate the body before ownership; RLS tests can't see the handler conversion            | Research        |
| Quote candidates' layer | HTTP inside Playwright with a throwaway electrician; no direct handler unit tests         | Mocks would encode the RLS behaviour under test; pure logic is already unit-tested                 | Research → Plan |
| Electrician A           | `.env` credentials if set, else provisioned through the local admin API                   | CI needs no secrets and no user step; local habits keep working                                    | Plan            |
| Other electricians      | `provisionElectrician` + sign-in through the real `/api/auth/signin` in their own context | Isolated state (pricing profile) and a real cookie session                                         | Plan            |
| CI placement            | e2e in `smoke` after `test:integration`, before the explicit build/smoke                  | Reuses the stack; Playwright's preview stops before smoke's starts, so no port clash               | Plan            |

## Scope

**In scope:**

- `tests/e2e/support.ts` (helpers, provisioning)
- `auth.setup.ts` provisioning fallback
- refactor of the two existing specs
- `idor.spec.ts`, `circuits-match-state.spec.ts`, `quote-override.spec.ts`
- the CI step + report artifact
- test-plan and test-stack docs

**Out of scope:**

- RLS re-tests
- quote amounts (Phase 4)
- the admin catalog-edit e2e
- production-code changes, unless a spec finds a defect

## Architecture / Approach

Specs copy the `seed.spec.ts` layout (risk header, unique project, asserted `afterEach` delete,
Polish role selectors, `waitForIslands`). HTTP checks use the context's `request` with
`maxRedirects: 0` and a same-origin `Origin`. Provisioning reuses `tests/integration/support.ts`
(`npx supabase status` → service client → `auth.admin.createUser`), which is local by construction.

## Phases at a Glance

| Phase               | What it delivers                                                   | Key risk                                                    |
| ------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1. Harness          | helpers, provisioned A, existing specs refactored                  | Playwright resolving `@/` in the integration support import |
| 2. IDOR (#6)        | B refused on 2 pages + 9 endpoints, A unchanged                    | building a valid body for `placements` / `circuits`         |
| 3. Match state (#2) | round-trip + `cleared` marker + re-match                           | hydration timing; select values vs labels                   |
| 4. Quote override   | no-profile / not-current refusals, server base, clear always works | reading the stored base without coupling to markup          |
| 5. CI + docs        | `smoke` runs e2e; Phase 3 closed in test-plan                      | CI time; first CI run is a manual check                     |

**Prerequisites:** a local Supabase stack on Docker (`npx supabase start`).
**Estimated effort:** ~1 session, 5 commits.

## Open Risks & Assumptions

- The exact matched device set is unverified, so specs assert states, not counts.
- The CI run is verified only on the next push (this change does not push).

## Success Criteria (Summary)

- Each spec fails under its deliberate break and passes on the real code.
- A fresh clone and CI run the whole e2e suite with no hand-made user and no secrets.
