# Test rollout phase 2 — data integrity and isolation — Plan Brief

> Full plan: `context/changes/testing-data-integrity-isolation/plan.md`
> Research: `context/changes/testing-data-integrity-isolation/research.md`

## What & Why

This closes test-plan Phase 2. It covers risk #6 (one electrician reaches another's data, the admin
sees projects, a table ships without RLS) and risk #7 (a DB CHECK and its TS parser drift apart, or
a catalog edit reaches an existing project). The work is mostly integration tests, plus making
`test:integration` a CI gate.

## Starting Point

- 8 RLS suites already test the owner, a second electrician, the admin and anon on all 10 tables.
- Nothing guards a _new_ table.
- No CHECK↔parser pair is tested with one fixture on both sides.
- The device snapshot's immutability is untested.
- `test:integration` does not run in CI.

## Desired End State

- **New tables.** A table without RLS, without a classification or without a suite fails the
  integration suite. So does a stray `anon` grant or `security definer` function.
- **Service-role key.** A service-role reference in `src/` fails the unit suite.
- **Parity.** 7 pairs share one fixture table each, and both guards agree on every row.
- **Device snapshot.** An admin device edit leaves project snapshots untouched.
- **CI.** The `smoke` job runs the whole integration suite.

## Key Decisions Made

| Decision                  | Choice                                                                        | Why (1 sentence)                                                                   | Source   |
| ------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| Catalog access from tests | `npx supabase db query --local -o json`                                       | Works with the pinned CLI, needs no `pg` driver and no helper RPC in the schema    | Research |
| "Every table has a test"  | Literal classification map + suite file per table                             | A new table fails until someone classifies it and writes its suite                 | Plan     |
| Endpoint premise          | Unit test: no service-role reference under `src/`                             | RLS protects endpoints only while they use the user's token; runs in the `ci` job  | Plan     |
| Parity oracle             | Literal verdicts from CHECK text; `parser-stricter` as a third verdict        | Independent of parser constants; documents the safe-direction asymmetries          | Research |
| Pairs in scope            | Device, supply, circuits, pricing, business, labour override, project details | busbar_piece has no parser; geometry's CHECK is weak by design                     | Research |
| CI shape                  | A step in the existing `smoke` job, before the build                          | Reuses the started stack; needs no secrets; avoids interleaving with smoke signups | Research |

## Scope

**In scope:**

- `rls-coverage.test.ts`
- the B-against-A gap fills in `rls-profiles` and `rls-projects`
- `src/lib/rls-premise.test.ts`
- `check-parser-parity.test.ts`
- the device snapshot case
- the CI step
- updates to AGENTS.md, `deploy-tooling.md` and `test-plan.md`

**Out of scope:**

- the HTTP IDOR e2e (Phase 3)
- stale-match unit tests
- `busbar_piece` parity
- two-way geometry parity
- any schema or product change

## Architecture / Approach

Tests talk to the local stack the way the app does: the anon key plus the user's token, or the
signed-in admin. The service client is used only for setup and cleanup, and catalog queries go
through the Supabase CLI. Parity fixtures are row-shaped. A thin adapter per pair turns a row into
the parser's input (`FormData` or a payload) and into a DB write.

## Phases at a Glance

| Phase                           | What it delivers                                           | Key risk                                                          |
| ------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. RLS coverage guard           | Schema-wide guard, B-vs-A gaps, no-service-role unit test  | `db query` output format changes with a CLI upgrade               |
| 2. CHECK↔parser parity          | One fixture table per pair, both guards asserted           | FormData adapters (zł, comma decimals) wrong → false disagreement |
| 3. Device snapshot immutability | Admin edit and archive leave `project_devices` unchanged   | —                                                                 |
| 4. CI gate and docs             | `test:integration` in `smoke`; rules and test plan updated | First CI run only verifiable after a push                         |

**Prerequisites:** a local Supabase on Docker (`npx supabase start`).
**Estimated effort:** one session, 4 commits.

## Open Risks & Assumptions

- The CI gate is verified only once the user pushes. This change does not push.
- The classification map is a maintained list. That is intended, because it forces a decision for
  each new table.

## Success Criteria (Summary)

- A new table cannot land without RLS and an RLS suite unnoticed.
- No CHECK can drift from its parser without a red test.
- CI runs the integration suite on every push and PR to `master`.
