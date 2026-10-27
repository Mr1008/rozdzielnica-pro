# Observability — Remaining Audit Fixes — Plan Brief

> Full plan: `context/changes/observability/plan.md`
> Research: `context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md` (and the runtime audit beside it)

## What & Why

Issue #29 asks for observability: logger, error tracking, metrics. The logger shipped in
`server-error-logging`, but the audit's critical and high findings outside the DB paths are still
open: a Supabase Auth outage looks like a mass sign-out, browser errors reach nobody (a wiring-router
throw leaves "Drukuj" disabled forever), a failed read silently deletes a manual layout, and an
uncaught error is a blank page.

## Starting Point

`src/lib/server-log.ts` logs every DB failure as one structured record (error level only). The
middleware and auth routes ignore Supabase Auth errors; there is no error boundary, beacon,
`500.astro`, deploy tag or source map. The audit's probe suite still exists and its last run shows C1
and C5 unchanged.

## Desired End State

Auth outages are logged and gated routes answer a Polish 503; browser errors from signed-in pages
land in Workers Logs with the user id; fallbacks either block (C4, M1) or log their reason; each
circuit save and re-match writes one info record; uncaught errors show a Polish 500; every deploy is
tagged with source-mapped stacks.

## Key Decisions Made

| Decision        | Choice                                                     | Why (1 sentence)                                                        | Source   |
| --------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- | -------- |
| Scope           | Audit fix steps 3–6, all four                              | Closes #29 and every remaining critical/high finding in one change      | Plan     |
| Error tracker   | Workers Logs only, browser errors via our own beacon       | No vendor, secret or SDK; reuses the structured records already emitted | Plan     |
| Metrics         | Info/warn events in logs (M5, M6)                          | Answers "did catalog gaps spike?" with no new binding                   | Plan     |
| Auth outage     | Log + 503 page on gated routes; public pages as signed out | An outage stops looking like a sign-out to the user and in the logs     | Plan     |
| C4 fallback     | Block the circuit save                                     | A transient read failure must not cost the user their manual layout     | Plan     |
| Beacon          | Signed-in only (both roles), capped payload, always 204    | Anonymous traffic cannot flood the logs; every report has a user id     | Plan     |
| Deploy identity | `--tag`/`--message` + server-only source maps              | Stacks name the release and a source line instead of a hashed chunk     | Plan     |
| Proof           | Re-run the audit probe suite + browser checks              | The same probes before and after turn "fixed" into evidence             | Plan     |
| Wiring failure  | Alert; "Drukuj" stays disabled                             | Matching-quote rule: never a partial printout                           | Research |
| H1 drops        | Still a catalog gap, now logged with kind and issue codes  | The safe direction stays; only the trail improves                       | Research |

## Scope

**In scope:** warn/info logging; auth error classification; middleware 503 verdict + page; auth
route logging; `500.astro`; `POST /api/client-errors` + reporter + island boundaries + wiring failure
state; C4 block, H1/M1/M2/M3/M7 reasons, H3 status; save/re-match/refusal events; print and layout
guards; deploy tag + source maps; probe re-run; AGENTS.md line; roadmap + GitHub sync.

**Out of scope:** third-party tracker, Analytics Engine, alert rules; the hook `raise warning`
migration; beacon on public pages; rate limiting; L3, L4, L7, L9, L10, M4.

## Architecture / Approach

Pure functions decide (`resolveRouteAccess` gains an "unavailable" verdict, `previousLayoutFromReads`
an ok/failure result, `chooseSelectionLayout` a reset reason); routes and pages only log and branch.
Every record — server, auth, browser — goes through `server-log.ts` into Workers Logs; the browser
reaches it through a signed-in `sendBeacon` endpoint that parses a capped payload.

## Phases at a Glance

| Phase                                  | What it delivers                                                 | Key risk                                                              |
| -------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Logging primitives                  | warn/info, auth classification, client payload parser + tests    | Misclassifying a user error as infra → noisy logs                     |
| 2. Auth, middleware, error pages       | 503 on outage, auth-route logging, Polish 500/503 pages          | Treating `AuthSessionMissingError` as an outage → every visit refused |
| 3. Browser error path                  | beacon, global handlers, island boundaries, wiring failure state | Report loops; boundary placement missing an island                    |
| 4. Loud fallbacks + metrics            | C4 block, drop/geometry/carry-over reasons, H3, info/warn events | Behaviour change near the matcher's correctness rules                 |
| 5. Server boundaries + deploy identity | print/layout guards, `--tag`, server source maps                 | Client `.map` files published; verifiable only after a real deploy    |
| 6. Proof + docs                        | probe before/after, AGENTS.md line, roadmap + #29 sync           | Probe worktree out of date; stack must be running                     |

**Prerequisites:** local Supabase stack on Docker (phases 2–4, 6); probe worktree
`agent-ae7a77891485cc62c`; `Mr1008` gh account for the roadmap sync.
**Estimated effort:** ~2–3 sessions across 6 phases.

## Open Risks & Assumptions

- Astro's middleware `next(path)` rewrite renders the unavailable page with its own 503 status (assumed from Astro docs, verify in phase 2).
- Workers Logs applies uploaded source maps to `console.error` stacks, not only to uncaught exceptions (unverified; seen only after deploy).
- `sendBeacon` posts are not blocked by the session cookie's `SameSite` setting on same-origin requests.

## Success Criteria (Summary)

- During an Auth outage the electrician sees "temporarily unavailable", not the sign-in page, and the log says why.
- A wiring failure shows a message instead of an endless spinner, and the server learns about it.
- A transient read failure during a circuit save never deletes a manual layout.
