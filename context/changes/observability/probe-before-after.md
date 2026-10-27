# Probe suite — before / after (observability)

Ran `bash probe/suite.sh` (C1, C2, C3, C5) in the probe worktree
`.claude/worktrees/agent-ae7a77891485cc62c` against a production-like build (`astro preview` on
workerd) and the local Supabase stack, on 2026-10-27, after fast-forwarding it to `480c96a` (phases
1–5). Before: the 2026-10-22 run kept as `probe/out-2026-10-22/` (C1 and C5 unchanged since the
audit). After: `probe/out/`. Probe changes: the C5 throw is re-injected inside the router's new
`try`, and `pw.mjs` also records `failedMarkerPresent` / `failedExplanationVisible`.

| Probe                                    | Before (2026-10-22)                                                         | After (2026-10-27)                                                                                                                     | Result |
| ---------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C1 Auth down, signed-in `GET /dashboard` | 302 → `/auth/signin`, nothing logged                                        | 503 Polish "unavailable" page; `auth.getUser failed`, `AuthRetryableFetchError`, status, path — no email                               | PASS   |
| C1 Auth down, project page               | 302 → `/auth/signin`, nothing logged                                        | 503, one record with the path                                                                                                          | PASS   |
| C1 Auth down, `GET /auth/signin`         | 200                                                                         | 200 (public page renders signed out), one record                                                                                       | PASS   |
| C1 control: Auth up, anonymous           | 302 → `/auth/signin`, nothing logged                                        | unchanged: 302, nothing logged                                                                                                         | PASS   |
| C5 wiring router throws (print page)     | uncaught `Error: probe-c5`, pending marker forever, Drukuj disabled, no log | no page error; Polish explanation shown, Drukuj disabled; `POST /api/client-errors` 204; `client.wiring` with userId, projectId, stack | PASS   |
| C5 control                               | Drukuj enabled                                                              | unchanged: Drukuj enabled, no report                                                                                                   | PASS   |
| C2 REST down, circuits save              | 302 `?error=unknown`, read logs                                             | 302 `?error=unknown`; refused at `previous layout load failed` before the RPC (C4)                                                     | PASS   |
| C3 forced `XX000` on circuit save        | `projects.circuits.rpc failed` with ids                                     | unchanged; the control save now also writes `projects.circuits.saved` (info)                                                           | PASS   |

Notes:

- The browser stack in the C5 record points at a hashed client chunk: client source maps are
  deliberately not built (Phase 5), so only server stacks are source-mapped.
- The C1 outage requests took up to 60 s on the first call (the auth client retries before failing);
  later calls ~5 s, per the server log. The before run recorded no timings, so this was not compared;
  a slow outage response is a possible follow-up, not part of this change.
