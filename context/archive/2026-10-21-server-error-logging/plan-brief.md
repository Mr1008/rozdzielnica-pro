# Server error logging — Plan Brief

> Full plan: `context/changes/server-error-logging/plan.md`
> Research: `context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md` and `2026-10-21_runtime-sign-in-circuits-layout-quote.md`

## What & Why

Database failures on the server mostly leave no trace in Cloudflare Workers Logs, the app's only
error sink. Write failures are turned into `?error=<code>` redirects with no log line (runtime-proven:
a forced `XX000` on the circuit save printed nothing), read failures log a bare code (`undefined` for
a gateway outage), and a refused connection yields an empty code that shows the user no message.

## Starting Point

Five pure `*ErrorFromPostgrest` mappers (plus two RPC mappers built on them) feed 22 `if (error)`
redirect branches in `src/pages/api/**`; 20 separate `console.error(what, error.code)` calls cover
reads. None logs a project or user id.

## Desired End State

Every server database failure — read or write — writes one structured record (event, code or
`transport`/`none`, name, hint, truncated message, project/user id; never `details`). A refused
connection now shows the generic Polish banner. Nothing else changes for the user.

## Key Decisions Made

| Decision                | Choice                                                                    | Why (1 sentence)                                                           | Source   |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------- | -------- |
| Where to log            | Call-site helper `logServerError`; mappers stay pure                      | The ids are only in scope at the route, and mapper tests stay console-free | Plan     |
| What a record holds     | code, name, hint, message ≤ 200 chars, stack for `Error`; never `details` | Makes gateway/transport failures diagnosable without row values in logs    | Plan     |
| Migration scope         | All 22 write sites + all 20 read logs                                     | Closes C2, C3, M11 and M14 in one change                                   | Plan     |
| Empty code              | `""`/missing → `unknown` in every mapper                                  | postgrest-js sets `code: ""` on fetch failure, which `??` passes through   | Research |
| `""` vs missing in logs | `"transport"` vs `"none"`                                                 | They are different failures (refused connection vs gateway body)           | Research |
| Proof                   | Re-run the 2026-10-21 probe suite                                         | Same probes before and after turn "should be fixed" into evidence          | Research |

## Scope

**In scope:** `src/lib/server-log.ts` + test; empty-code fix and tests in the mappers; logging at 22
API write branches; the 20 read logs moved onto the helper; probe re-run.

**Out of scope:** middleware/auth routes (C1, H4, H5), client wiring errors (C5), silent fallbacks
(C4, H1, H3), `500.astro` and print guard, validation-refusal logging (M5), SQLSTATE remapping (M4),
any UI text or deploy config.

## Architecture / Approach

A route catches `{ error }`, calls `logServerError(event, error, { userId, projectId })`, then maps and
redirects as today. The helper normalises any error into a small record and writes it with one
`console.error(object)` so Workers Logs keeps the fields filterable.

## Phases at a Glance

| Phase                             | What it delivers                                     | Key risk                                                                       |
| --------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. Helper and empty-code fix      | `server-log.ts` + tests; `""` → `unknown` in mappers | Accidentally logging `details` — pinned by a test                              |
| 2. Log write failures             | 22 API branches log before redirect                  | Missing a branch — a grep count check                                          |
| 3. Move read logs onto the helper | 20 read logs with ids; `print.astro` keeps the stack | Changing behaviour of the "unreachable" fallbacks — out of scope, logging only |
| 4. Before/after proof             | Probe suite re-run and compared                      | Worktree merge; stack must be running                                          |

**Prerequisites:** local Supabase stack (Docker) for phase 4; the probe worktree kept.
**Estimated effort:** ~1 session across 4 phases.

## Open Risks & Assumptions

- Workers Logs keeps a plain object passed to `console.error` as structured fields (assumed, not observed).
- A constraint `message` can name a column; it never carries row values once `details` is dropped.
- Saved log searches on the old `"… load failed"` strings would need the new event names.

## Success Criteria (Summary)

- A failed save shows up in Workers Logs as one record with the code, the route and the project/user id.
- A refused connection shows the generic banner instead of a silent reload.
- The probe suite's C3 and C2 runs show those records; C1 and C5 are unchanged (later changes).
