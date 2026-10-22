# Probe before/after (phase 4)

Ran `bash probe/suite.sh` (C1, C2, C3, C5 + transport vitest) in the probe worktree
`.claude/worktrees/agent-ae7a77891485cc62c` against the production-like build (astro preview on workerd)
and the local Supabase stack. Before run: 2026-10-21 (`probe/out-before/`). After run: 2026-10-22
(`probe/out/`), on `master` at b3071be (phases 1-3 merged into the worktree branch; fast-forward).
Probe change: `probe/transport.probe.test.ts` case A now asserts `"unknown"` and the generic text.

| Criterion                       | Before                                                                                    | After                                                                                                                                                                                   | Result |
| ------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| C2-transport case A             | `projectErrorFromPostgrest=""`, `?error=`, message `null`                                 | `"unknown"`, `?error=unknown`, "Coś poszło nie tak. Spróbuj ponownie"                                                                                                                   | PASS   |
| C3 server log                   | nothing logged for the failed save                                                        | `projects.circuits.rpc failed`, `code: 'XX000'`, `message: 'probe_c3'`, `projectId` + `userId`                                                                                          | PASS   |
| C2 REST-down reads/writes       | `previous layout load failed: project_devices undefined`, `project load failed undefined` | structured records, `code: 'none'`, `userId`/`projectId` set (e.g. `project load failed`, `match context load failed`, `projects.supply.update failed`); no `undefined` in any log line | PASS   |
| User-facing parity (C1, C3, C5) | -                                                                                         | C1 identical after normalising ids/timings; C3 landing still shows the generic alert; C5 identical except the issue date and asset hashes                                               | PASS   |
| Suite cleanup                   | -                                                                                         | auth + rest running, `probe_fail` trigger count 0, function dropped                                                                                                                     | PASS   |

Notes:

- The only `undefined` left in `C2.txt` is `error.code=undefined` in the transport cases B/C, which is the
  raw postgrest-js shape the probe prints, not a log line.
- C2 landing pages and the REST-down supply/circuits redirects keep `?error=unknown`; the project page 500 with
  one alert is unchanged.
- Records print `name: 'UnknownError'` — the helper's fallback, because postgrest-js returns a plain object
  with no `name`; for the same reason there is no `stack`. No `hint` was set by these failures.

Verdict: logging fix verified at runtime; the only user-facing change is C2 case A (empty `?error=` now `unknown`).
