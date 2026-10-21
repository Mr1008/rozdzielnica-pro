---
type: observability-audit
date: 2026-10-21 13:40
mode: audit
commit: 5ae96c4
branch: master
dirty_tree: true
areas: [sign-in, circuits-matching, layout-editing, quote-print]
area_source: user
runtime_proof: partial
error_tracker: none (Cloudflare Workers Logs via wrangler.jsonc observability)
previous_report: context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md
findings: { critical: 3, high: 9, medium: 14, low: 10 }
---

# Observability audit — runtime proof of C1, C2, C3, C5 (2026-10-21)

This run adds runtime evidence to the static audit
`2026-10-21_sign-in-circuits-layout-quote.md` for its four critical findings. The rest of that report's
findings were not re-checked and stand as written there. The tree was dirty because a parallel
session had uncommitted, unrelated work (`karwasz_cabinets`). The probes ran in a separate worktree
at the same commit, so that work was not part of what was probed.

## 1. TL;DR

- **C1 proven.** With the Auth container stopped, a signed-in electrician gets the same
  `302 /auth/signin` as an anonymous visitor. The server prints nothing but the access line. Latency
  (60 s first request, ~5 s after) is the only difference.
- **C3 proven.** A database failure (`XX000`) on the circuit save becomes `302 ?error=XX000#circuits`.
  The user sees the generic banner. Neither the code nor the message appears in the server output.
- **C5 proven.** A throw in the wiring timer reaches only the browser's `pageerror` event. "Drukuj"
  stays disabled and "loading wires" stays on after 10 s. No request goes to the server.
- **C2 narrowed, and downgraded to high.** A gateway-shaped outage (Kong 502/503 with REST down)
  gives `code: undefined`, which maps to `unknown`, so **the banner shows**. Only a true fetch
  failure (connection refused / DNS) gives `code: ""`, which leads to `?error=` and no banner. That
  was shown at unit level through the project's own mapping, not through a live endpoint.
- **New: gateway errors log the literal string `undefined` as the code** (`project load failed
undefined`, `match context load failed: projects undefined`). The code-only logging convention
  leaves an outage with no diagnostic content at all (M14).

## 2. Capture model

Unchanged from the previous report. For this run, the local stand-in for Workers Logs was the
stdout/stderr of `astro preview` running the built worker on workerd. That is the same code path,
but not the real sink.

**Assumptions:** unchanged. In addition, a cloud Supabase outage seen from a Worker is more likely
to look like a gateway 5xx (the C2 "unknown" case) than a refused connection. This is unconfirmed.

## 3. What reaches the tracker (runtime-observed)

| Probe        | Failure shape                                                                      | Response                                  | Server console                                                                                                     | User sees                                                   | Verdict                             | Observed / inferred                    |
| ------------ | ---------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| C1           | Auth container stopped; signed-in cookies; `GET /dashboard`, project page          | `302 /auth/signin` (60 030 ms, then ~5 s) | access line only                                                                                                   | sign-in page, 0 alerts; `?error=no_role` never shown        | missed (proven)                     | observed                               |
| C1 control   | Auth up; anonymous                                                                 | `302 /auth/signin` (8–27 ms)              | access line only                                                                                                   | identical page (18 093 bytes)                               | indistinguishable                   | observed                               |
| C2 supply    | REST stopped (Kong answers non-JSON 502)                                           | `302 ?error=unknown`                      | access line only                                                                                                   | "Coś poszło nie tak. Spróbuj ponownie"                      | poor (claim not met for this shape) | observed                               |
| C2 circuits  | same                                                                               | `302 ?error=unknown#circuits`             | `previous layout load failed: project_devices undefined` ×2 lines, `match context load failed: projects undefined` | same banner                                                 | poor                                | observed                               |
| C2 page      | same; `GET` project page                                                           | 500                                       | `project load failed undefined`, `project quote profile load failed undefined`                                     | page alert                                                  | poor                                | observed                               |
| C2 transport | fetch to `127.0.0.1:1` through `projectErrorFromPostgrest` / `projectErrorMessage` | `code: ""` → `?error=`                    | —                                                                                                                  | no banner (`projectErrorMessage` → null)                    | missed (unit level)                 | observed (mapping); inferred (HTTP/UI) |
| C3           | temp trigger raising `XX000` on `project_devices` insert; circuits save            | `302 ?error=XX000#circuits`               | access line only; `probe_c3` / `XX000` nowhere                                                                     | generic banner                                              | missed (proven)                     | observed                               |
| C3 control   | trigger dropped                                                                    | `302 ?saved=circuits`                     | access line                                                                                                        | —                                                           | ok                                  | observed                               |
| C5           | `?probe-wiring-throw` on print page                                                | 200                                       | `GET …/print 200` only                                                                                             | Drukuj `disabled`, `data-wiring-pending` present after 10 s | missed (proven)                     | observed                               |
| C5 control   | no param                                                                           | 200                                       | access lines                                                                                                       | Drukuj enabled                                              | ok                                  | observed                               |

C5's only error trace was the browser's `pageerror: Error: probe-c5`. No console error was
recorded, and the page made 3–4 JS chunk GETs and no report request.

## 4. Systemic root causes

Unchanged; root causes 1, 2, 3 and 5 of the previous report are now runtime-backed. Root cause 2
(code-only logging) is worse than stated: for gateway errors the code is absent, so the line reads
`… undefined`.

## 5. Findings changed by this run

| #         | Location                                                                                                                                                                  | Category           | Severity            | What happens in production                                                                                                                                                          | Fix direction                                                                           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| C2 → high | `src/lib/project-errors.ts:86`, `:57-60`                                                                                                                                  | flattened-response | high (was critical) | Gateway 5xx: `?error=unknown`, banner shown, nothing logged by the write endpoint. True fetch failure: `?error=`, no banner, nothing logged. Either way the responder gets nothing. | Unchanged: map `""` to `unknown`; log in the mappers.                                   |
| M14 (new) | all 20 `console.error(what, error.code)` sites, e.g. `src/lib/device-matching-server.ts:71`, `src/lib/layout-server.ts:401`, `src/pages/dashboard/projects/[id].astro:92` | identity-lost      | medium              | A Supabase gateway outage logs `project load failed undefined`, with no status, no message and no project. It is the only server-side trace of an outage, and it carries no cause.  | Log `status`, `name` and a truncated message when `code` is missing (fix order step 1). |

C1, C3, C5: severity unchanged (critical), now **proven** at runtime.

## 6. Recommended fix order

Unchanged from the previous report. Steps 1–2 (shared logger, log in the mappers, empty code →
`unknown`) close C2, C3 and M14. Step 3 closes C1. Step 4 closes C5. The probe suite below is
the before/after check for each.

## 7. Changes since last audit

| Previous id | Status                                          | Evidence                                         |
| ----------- | ----------------------------------------------- | ------------------------------------------------ |
| C1          | still open — runtime-proven                     | `probe/out/C1.txt`                               |
| C2          | changed — narrowed to true fetch failures; high | `probe/out/C2.txt`, `probe/out/C2-transport.txt` |
| C3          | still open — runtime-proven                     | `probe/out/C3.txt`                               |
| C5          | still open — runtime-proven                     | `probe/out/C5.txt`                               |
| all others  | not re-checked                                  | —                                                |

## 8. Method and limits

- **Agent:** one runtime prober (Sonnet) in an isolated worktree; nothing committed or pushed.
- **Setup:** `npm run build` + `astro preview` (workerd) on port 4399, against the local Supabase stack
  (Docker). Outages were simulated by `docker stop` of `supabase_auth_…` / `supabase_rest_…`. C3 used a
  temporary `probe_fail` trigger and function on `public.project_devices`. C5 used a probe-gated throw
  in `WiringDrawing.tsx` and Playwright Chromium. The E2E seed user was given a temporary pricing
  profile for C5 (the print page needs one), which was removed afterwards.
- **Hand-verified after the run:** all Supabase containers up (auth/db healthy; REST has no
  healthcheck), `pg_trigger`/`pg_proc` count for `probe_fail` = 0/0, evidence files read.
- **Not verified:** a refused connection through a live endpoint, because that needs the Kong container
  stopped, which was outside the allowed set; the real Workers Logs sink; Cloudflare's gateway behaviour
  when cloud Supabase is down.
- **Harness:** worktree `.claude/worktrees/agent-ae7a77891485cc62c` (branch
  `worktree-agent-ae7a77891485cc62c`), files under `probe/` (`suite.sh`, `pw.mjs`, `banner.mjs`,
  `transport.probe.test.ts`, `vitest.probe.config.ts`, `out/`). Probe-only change:
  `src/components/projects/WiringDrawing.tsx` (gated on `?probe-wiring-throw`). Rerun from the
  worktree root: `bash probe/suite.sh` (`SKIP_BUILD=1` to reuse the build). The suite's `trap` restarts
  the containers and drops the trigger. For a before/after check, apply the fix in this worktree (or
  merge it in) and rerun.
