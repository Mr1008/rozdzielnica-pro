---
type: observability-audit
date: 2026-10-21 11:41
mode: audit
commit: 5ae96c4
branch: master
dirty_tree: false
areas: [sign-in, circuits-matching, layout-editing, quote-print]
area_source: foundation
runtime_proof: not-run
error_tracker: none (Cloudflare Workers Logs via wrangler.jsonc observability)
previous_report: null
findings: { critical: 4, high: 8, medium: 13, low: 10 }
---

# Observability audit — sign-in, circuits + matching, layout editing, quote + print (2026-10-21)

## 1. TL;DR

- **Every write failure becomes a 302 that nothing logs.** The `*ErrorFromPostgrest` / `*RpcErrorCode`
  mappers are pure and every API route redirects with `?error=<code>`. 21 of 22 `if (error)` branches
  in `src/pages/api/**` write no log line, including the whole admin catalog. In Workers Logs a failed
  save is indistinguishable from a successful one.
- **The only logging convention throws away the error.** `console.error(what, error.code)` at 20
  sites: no project or user id, no message/details/hint, no stack. For network and 5xx failures
  postgrest-js sets `code: ""`, so the line is literally empty — and the redirect becomes `?error=`
  with no banner at all.
- **A Supabase Auth outage looks like everyone signing out.** `src/middleware.ts:16-25` drops the
  `error` of `getUser()` and `getClaims()`; an outage resolves to "not signed in" or "no role", 302s
  only, nothing logged.
- **Fallbacks degrade to plausible states with no signal.** A failed previous-layout read silently
  replaces a manual layout and reports "saved"; an unparseable catalog row shows up as a catalog gap
  ("contact the admin"); an unparseable cabinet geometry silently drops the PE/N-bar and busbar
  requirements from matching.
- **The browser is a blind spot.** No `window.onerror`, no `unhandledrejection`, no error boundary;
  the wiring router runs in a bare `setTimeout`, so its throw leaves "Drukuj" disabled forever and
  reaches nobody.
- **Single most important consequence:** a Supabase connectivity blip during a circuit save produces
  a page that reloads with no message, an unsaved change, and no trace in any log.

## 2. Capture model

- **Runtime:** one Cloudflare Worker (`wrangler.jsonc:4`, main `@astrojs/cloudflare/entrypoints/server`),
  Astro `output: "server"` (`astro.config.mjs:11`). No background work: no `waitUntil`, cron, queues
  or Durable Objects in `src` or the built `wrangler.json`.
- **Error tracker:** none. No Sentry/Datadog/OTel SDK in `package.json` or `src`. The only sink is
  Cloudflare Workers Logs, enabled in repo at `wrangler.jsonc:13` (`observability.enabled: true`).
- **Server boundary:** Astro's own. `node_modules/astro/dist/core/routing/handler.js:101-103` catches
  every middleware, endpoint and frontmatter exception, logs `err.stack || err.message` as one string
  through the console logger, and calls `renderErrorFromState`. With no `src/pages/500.astro`,
  `core/errors/default-handler.js:105` returns `new Response(null, { status: 500 })` — a blank page.
  The Worker's `fetch` never rejects, so the invocation outcome stays "ok". Errors thrown **after**
  streaming starts are not logged at all (`runtime/server/render/astro/render.js:72` only calls
  `controller.error`).
- **App logging:** 20 `console.error` calls, all `(message, error.code)` except
  `device-matching-server.ts:88` (an id array) and `print.astro:104` (`error.message`). No
  `console.warn`/`info`. No structured fields.
- **Write path:** all mutations are native form POSTs (no `fetch()` in `src`); every endpoint
  redirects, none returns a 5xx.
- **Client:** `@astrojs/react` uses plain `createRoot`/`hydrateRoot`; no global handlers or error
  boundaries anywhere in `src`.
- **Scrubbing:** none in code beyond the deliberate "log the code, never the message" rule.
- **Deploy identity:** no version binding, no release tag in code, `deploy.yml:86` runs
  `npx wrangler deploy` without `--tag`/`--message`; `dist/server` carries no source maps.

**Assumptions (outside the repo, not findings) — all unconfirmed:**

- Workers Logs collects console output and invocation logs in production (request URL + status).
- Workers Logs does **not** record the response `Location` header, so the `?error=<code>` of a
  redirect reaches only the user's browser.
- A passed `Error` object would be serialized with `name`/`message`/`stack`.
- Alert rules, notification channels, retention and sampling live in the Cloudflare dashboard.
- Whether Workers Logs tags lines with the script version id.
- Supabase's own Auth/API/Postgres logs are not monitored as part of this pipeline.
- Source-map upload (`upload_source_maps`) and deploy tagging are deploy-config choices; their
  absence makes Astro's stack strings point at hashed `dist/server/chunks/*.mjs`.

## 3. What reaches the tracker (static-only — no runtime probes were run)

| Failure shape                                              | Response                              | Workers Logs                                                | Verdict |
| ---------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------- | ------- |
| Throw in endpoint / page frontmatter / middleware          | blank 500                             | Astro stack string, no project/user id, hashed chunk frames | poor    |
| Throw after SSR streaming started (template, island SSR)   | truncated 200                         | nothing from the app or Astro                               | missed  |
| Supabase `{ error }` on a write (RPC, insert, update)      | 302 `?error=<code>`                   | URL + 302 only                                              | missed  |
| Supabase transport/5xx failure (`code: ""`) on a write     | 302 `?error=` (no banner)             | URL + 302 only                                              | missed  |
| Supabase `{ error }` on a page read                        | 500 + Polish alert (some pages 200)   | `"<what> load failed" <code>`                               | poor    |
| Auth outage in middleware                                  | 302 to sign-in / `/?error=no_role`    | 302 only                                                    | missed  |
| Sign-in / sign-up failure (incl. GoTrue 5xx, hook failure) | 302 `?error=<code>`                   | 302 only                                                    | missed  |
| Client island render error                                 | island unmounts                       | nothing                                                     | missed  |
| Client throw in a timer (wiring router)                    | stuck "loading wires", Print disabled | nothing                                                     | missed  |
| `computePrintView` sum-invariant throw                     | 500 + Polish alert                    | `print view failed <message>` (no stack, no id)             | poor    |

## 4. Systemic root causes

1. **Errors are mapped to a redirect code before anything logs them.** `projectErrorFromPostgrest`
   (`src/lib/project-errors.ts:75-88`), `device-errors.ts` (`deviceErrorFromPostgrest`),
   `circuitsRpcErrorCode` (`src/lib/device-matching-server.ts:322-329`), `layoutRpcErrorCode`
   (`src/lib/layout-server.ts:299-306`) and the auth routes (`src/pages/api/auth/signin.ts:18-22`,
   `signup.ts:16-20`) are pure mappers; the routes then `context.redirect(...)`. This follows the
   AGENTS.md form-endpoint convention, which is right for the UI, but no step in it logs. The comment
   "an unrecognised code still reaches the URL (so it stays diagnosable)" holds only for whoever is
   looking at the browser. It also has a hole: `error.code ?? unknown` does not catch `""`, so
   transport failures reach the URL empty and `projectErrorMessage("")` shows nothing.
   Explains C2, C3, H4, M4, M5, L1.
2. **The logging convention keeps the code and drops everything else.** 20 sites log
   `console.error(what, error.code)` (e.g. `device-matching-server.ts:71`, `layout-server.ts:338`,
   `:401`, `[id].astro:92`). The rule exists so Supabase's English text never reaches the user, but it
   was applied to the server log as well: no project id, user id, route, `details`/`hint`, stack or
   cause, and an empty string for transport failures. `print.astro:104` keeps only `error.message` of
   the one caught internal bug. Explains H1, H2, H7, M7, M11 and weakens every other finding's trail.
3. **Supabase Auth results are read without their `error`.** `src/middleware.ts:16-19` and `:24-25`,
   `signin.ts:27-29`, `signout.ts:7`. Combined with fail-closed role resolution
   (`src/lib/roles.ts:31-34`), every Auth failure becomes a legitimate-looking state — signed out, no
   role, signed-in admin landing on `/`. Explains C1, H5, M9, L1.
4. **Fallbacks pick a plausible state instead of a failure state, and leave no signal.**
   `previousLayoutFromReads` (`layout-server.ts:367-369`) turns a failed read into "no manual layout";
   `activeCatalog` (`src/lib/device-matching.ts:169-182`) drops unparseable devices and discards the
   parse issues; `device-matching-server.ts:125` turns an unparseable geometry into `null`;
   `computeLayoutView` (`layout-server.ts:82-97`) turns validation issues into "outdated"; the project
   page renders a matching-load failure with status 200 (`[id].astro:139-149`). Several are commented
   "unreachable" — exactly the guards that fire under migrate-before-deploy drift. Explains C4, H1, H3,
   M1, M2, M3, L6.
5. **The edges have no boundary of their own.** No `500.astro` (blank 500), no client handlers or
   error boundaries, the wiring router in a bare `setTimeout` (`src/components/projects/WiringDrawing.tsx:35`),
   and Astro's streaming path that never logs. Explains C5, H2, H6, L5.

## 5. Findings by area

Severity assumes Workers Logs is collected in production. IDs are stable for the next run.

### Sign-in / session

| #   | Location                                                                                                                    | Category            | Severity                 | What happens in production                                                                                                                                                                                                                                                                          | Fix direction                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | `src/middleware.ts:16-25`                                                                                                   | missing-throw       | critical                 | Supabase Auth slow/down → `getUser()` returns `{ error }`, `user` null → every gated request 302s to `/auth/signin`; a `getClaims()` failure alone → signed-in users get `/?error=no_role` "contact the admin". Responder sees a flood of 302s, no log line. Indistinguishable from real sign-outs. | Read `error`; treat `AuthSessionMissingError` as normal, log anything else with name/status/code/path; consider 503 for gated routes.                      |
| H5  | `src/middleware.ts:25`, `route-access.ts` no-role path, `supabase/migrations/20260922083135_roles_and_profiles.sql:160-163` | flattened-response  | high                     | Missing hook in the cloud project, a hook error, or a missing profile row all produce the same "no role" banner; the hook returns the event untouched with no `raise warning`. Nothing tells a responder which.                                                                                     | When `user !== null && role === null`, log once with user id and whether the JWT has a `user_role` key; `raise warning` in the hook for a missing profile. |
| H4  | `src/pages/api/auth/signin.ts:18-22`, `signup.ts:16-20`                                                                     | logged-not-captured | high                     | GoTrue 5xx, `unexpected_failure`, hook failures and network errors (`AuthRetryableFetchError`, no code → `"unknown"`) end as the same 302 as a wrong password; `status`/`name` dropped; nothing logged.                                                                                             | Log server-side classes only (status ≥ 500 or 0, retryable, hook/unmapped codes) with code, status, route; never log `invalid_credentials`.                |
| M9  | `src/pages/api/auth/signin.ts:27-29`                                                                                        | missing-throw       | medium                   | `getClaims()` failure right after sign-in → role null → an admin lands on `/` with no banner. The one moment a missing claim is detectable passes silently.                                                                                                                                         | Log when a freshly minted token has no `user_role`.                                                                                                        |
| M10 | `src/lib/auth-errors.ts:24-40`                                                                                              | flattened-response  | medium                   | Unmapped codes (`unexpected_failure`, `signup_disabled`, `validation_failed`, `hook_*`) collapse into one generic message; the code lives only in the browser URL.                                                                                                                                  | Classify user-error vs infra-error; log the infra class in the route.                                                                                      |
| L1  | `src/pages/api/auth/signout.ts:7`                                                                                           | missing-throw       | low                      | `signOut()` error ignored; a failed server-side revoke looks like a successful sign-out.                                                                                                                                                                                                            | Log a non-trivial error; keep the redirect.                                                                                                                |
| L2  | `signin.ts:8`, `signup.ts:6`                                                                                                | coverage-gap        | low                      | `formData()` without `.catch` (every other route has one): a non-form POST is a blank 500.                                                                                                                                                                                                          | Same `.catch(() => new FormData())` as the other routes.                                                                                                   |
| L3  | `src/lib/supabase.ts:16-20` (`setAll`)                                                                                      | coverage-gap        | low (static, unverified) | If a cookie write throws after headers are sent, a rotated refresh token is lost and the user is later logged out with no trace. Throw conditions in `@supabase/ssr` not confirmed.                                                                                                                 | try/catch in `setAll`, log cookie name and path (never the value).                                                                                         |

### Circuits save + device matching

| #   | Location                                                                                                                                                                                                      | Category             | Severity | What happens in production                                                                                                                                                                                                                                                                                                                                                                                                   | Fix direction                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| C2  | `src/lib/project-errors.ts:86` (`error.code ?? unknown`), `:57-60`; reached from `circuits.ts:84-88`, `rematch.ts`, `supply.ts:38`, `cabinet.ts:38`, `layout.ts`, `placements.ts`, `quote.ts:91-96`           | flattened-response   | critical | **Verified in `@supabase/postgrest-js` 2.116.0** (`toTransportFailure`, `toOpenApiError`): a fetch rejection or non-JSON 5xx yields `code: ""`. `?? unknown` does not catch it → redirect to `?error=` → `projectErrorMessage("")` returns null → no banner; the circuit draft is restored silently. User: page reloads, nothing saved, no message. Responder: one 302, no log.                                              | Treat empty/missing code as `unknown`; log `code                                                               |     | "transport"`plus`error.name` and a truncated message server-side. |
| C3  | every `if (error)` in `src/pages/api/**` (22 branches; only `quote.ts:64` logs) — notably `circuits.ts:84-88`, `rematch.ts`, `supply.ts:38`, `cabinet.ts:38`, `api/admin/devices/**`, `api/admin/cabinets/**` | logged-not-captured  | critical | An RPC failure, RLS refusal, statement timeout, or a CHECK drift between a "guarded twice" pair ends as a 302 with a generic banner (`23514` even shows "check your input"). Workers Logs: an ordinary 302. An admin catalog write that fails is equally invisible.                                                                                                                                                          | One shared `logDbFailure(route, { projectId, userId }, error)` called in the mappers or before every `back()`. |
| H1  | `src/lib/device-matching.ts:169-182`, `src/lib/device-matching-server.ts:82-91`                                                                                                                               | identity-lost        | high     | A catalog row that fails `parseDeviceSpec` (e.g. a new-schema row read by old code during the migrate-before-deploy window) is dropped; the matcher reports a catalog gap and the user is told to contact the admin. The log lists only ids — no kind, no failing field, no project — on every render, undeduplicated; rows without an id log an empty array. The product's worst-failure path is visible but misattributed. | Return `{ catalog, dropped: [{ id, kind, issues }] }`; log once with count and issue codes.                    |
| H3  | `src/pages/dashboard/projects/[id].astro:139-149`, `:178`                                                                                                                                                     | flattened-response   | high     | A matching-context load failure replaces both the circuit editor and the layout with "load failed" at **HTTP 200**; the pricing-profile read failure too. Status-based views see success; the log line has no project id.                                                                                                                                                                                                    | `Astro.response.status = 500` when `matchLoad` fails; add project and user id to the log.                      |
| M1  | `src/lib/device-matching-server.ts:120-126` → `cabinetBarKinds`/`maxRailMm` (`:230`, `:238`)                                                                                                                  | swallowed            | medium   | An unparseable geometry snapshot becomes `null` with no log; matching then requires no PE/N bars and selects no busbars, reports `matched`, and the save succeeds. Layout shows nothing / "match not current". Commented "unreachable".                                                                                                                                                                                      | Log the parse issues with project id; block the match with an explicit reason.                                 |
| M4  | `project-errors.ts:81-84`, `device-matching-server.ts:327`, `layout-server.ts:299-306`                                                                                                                        | flattened-response   | medium   | Any `P0002` with an unrecognised message is shown as "cabinet unavailable"; `42501` from `group_belongs_to_another_project` reads as a plain permission error; `23514` (a parser/CHECK drift, i.e. a bug) reads as user input.                                                                                                                                                                                               | Log before mapping; map `P0002` → cabinet only on `cabinet.ts`.                                                |
| M5  | `circuits.ts:47`, `supply.ts:27`, `cabinet.ts:27`, `placements.ts:45-49`, `:63-65`                                                                                                                            | noise / coverage-gap | medium   | Server-side `circuits_invalid` / `invalid_input` / `layout_invalid` mean an island/server parser divergence, version skew or tampering — none logged, so a spike after a release is invisible.                                                                                                                                                                                                                               | `warn` with the first issue codes, no payload.                                                                 |
| M6  | `circuits.ts:68-87`, `rematch.ts:46-62`                                                                                                                                                                       | coverage-gap         | medium   | Match outcome (gaps, blockers) is never recorded; the user gets `saved=circuits`. A catalog-gap spike after an admin edit cannot be seen.                                                                                                                                                                                                                                                                                    | One `info` line per save: `{ projectId, status, gapCount, droppedCount }`.                                     |
| M7  | `device-matching-server.ts:157-161`                                                                                                                                                                           | identity-lost        | medium   | Stored circuits that no longer parse block editor and match; the log carries only `issues[0].code`, no project or row.                                                                                                                                                                                                                                                                                                       | Log project id, issue count, first N `{ id, field, code }`.                                                    |
| L4  | `device-matching-server.ts:107`                                                                                                                                                                               | coverage-gap         | low      | Catalog `select("*")` without paging; at PostgREST `max_rows` a truncated catalog yields false gaps, unlogged. Not reachable at today's size.                                                                                                                                                                                                                                                                                | Warn at `length === max_rows`, or page.                                                                        |
| L6  | `device-matching-server.ts:88`                                                                                                                                                                                | noise                | low      | The dropped-device line fires on every project view, print and save for a persistent bad row.                                                                                                                                                                                                                                                                                                                                | Deduplicate / include reason (see H1).                                                                         |

### Layout + manual edits + wiring

| #   | Location                                                                          | Category           | Severity | What happens in production                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Fix direction                                                                                                        |
| --- | --------------------------------------------------------------------------------- | ------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| C5  | `src/components/projects/WiringDrawing.tsx:33-41`; `print.astro:195-209`          | coverage-gap       | critical | **Verified:** `buildWiringDrawing` runs in a bare `setTimeout`, outside React. A throw (`cabinet-wiring.ts:2494`, `cabinet-layout.ts:241`) is an uncaught browser error: wires never draw, "loading wires" stays forever, `wiring-ready` never fires so **Drukuj stays disabled** — the deliverable is blocked. No log anywhere; the server never learns.                                                                                                                       | try/catch in the timer → Polish error state; a minimal error beacon endpoint that logs project id + message + stack. |
| C4  | `src/lib/layout-server.ts:367-369` (`previousLayoutFromReads`), `:383-405`        | swallowed          | high     | **Verified:** a failed `project_device_placements` read returns `editedManually: false`, so `chooseSelectionLayout` proposes a fresh layout and reports `reset: false`. The electrician's manual layout is deleted by `save_project_circuits` and the page says "saved" — no `layout_reset=1`. The only trace is `previous layout load failed: project_device_placements <code>`, not linked to any project. The comment documents the choice, but it loses user work silently. | Treat a failed placements read as a carry-over failure (`reset: true` or block the save) and log with project id.    |
| M2  | `src/lib/layout-server.ts:82-97` (`computeLayoutView`)                            | identity-lost      | medium   | `validateLayout` issues become an "outdated" badge and are never logged; a deploy that tightens validation turns every manual layout outdated with no signal.                                                                                                                                                                                                                                                                                                                   | Log issue codes once per render when a non-empty stored set fails.                                                   |
| M3  | `src/lib/layout-editing.ts:446-476`, `layout-server.ts:207-227`                   | flattened-response | medium   | `carryOverPlacements` → `null` means device set changed, ambiguous key (bug), validation failure, or a failed snapshot read — all one reset, no reason kept.                                                                                                                                                                                                                                                                                                                    | Return a reason and log it.                                                                                          |
| H6  | `src/lib/cabinet-layout.ts:241`, `:414` via `proposeLayout` / `computeLayoutView` | coverage-gap       | high     | A bad catalog row (N-carrying device without `n_terminal_side`) throws on the server in every circuit save, re-match and project-page render: blank 500 (no `500.astro`), stack on hashed chunks, no project or device id.                                                                                                                                                                                                                                                      | Guard the layout step, log project and device id, return the `unknown` banner; add a Polish `500.astro`.             |
| L7  | `cabinet-wiring.ts:2582-2600`                                                     | coverage-gap       | low      | `conductors_do_not_fit` is computed and shown only in the browser; how often it fires is unknown. Informational by design.                                                                                                                                                                                                                                                                                                                                                      | Optional counts-only beacon.                                                                                         |

### Quote + printout

| #   | Location                                                                                                           | Category                     | Severity | What happens in production                                                                                                                                                                                                                                                                                | Fix direction                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H2  | `src/pages/dashboard/projects/[id]/print.astro:99-107`, `:109-137`                                                 | identity-lost / coverage-gap | high     | Only `computePrintView` is wrapped; its sum-invariant throw (`quote-print.ts:132-136`, a money bug) logs `error.message` only — two sums, no project, no stack, no rows. `computeMatchView`, `computeLayoutView`, `computeQuoteView`, `buildLayoutDrawing` and `QuoteDocument` are unguarded → blank 500. | One guard over the whole pipeline logging route, project id, user id and the stack; at the invariant throw, log the offending snapshot rows (ids, role, piece, price). |
| H7  | `print.astro:50`, `:87-93`, `:133-136`                                                                             | flattened-response           | high     | Project query error, any of three profile reads, a layout-context failure or a `not_found` race, and the print-view throw all render the same "load failed" 500; the branch is never logged, and `!supabase \|\| !user` returns without a log.                                                            | Log `{ route, projectId, userId, branch }` where the 500 is chosen.                                                                                                    |
| M8  | `src/pages/api/projects/[id]/quote.ts:57-67`, `:72`, `:91-96`; `api/profile/pricing.ts:29-32`; `business.ts:32-35` | logged-not-captured          | medium   | A failed labour-override update, pricing or business upsert is only a redirect (part of C3); a `42501` (RLS/claim broken) or `23514` (bounds drift between `quote.ts`/`pricing-profile.ts` and the CHECK) is invisible.                                                                                   | Covered by the C3 helper; treat `23514` from a parser-validated form as a server bug.                                                                                  |
| L5  | `node_modules/astro/dist/runtime/server/render/astro/render.js:72`                                                 | coverage-gap                 | low      | A throw after streaming starts (template body, `client:load` island SSR such as `QuoteDocument`) truncates a 200 response and is logged by nobody.                                                                                                                                                        | Keep throwing helpers out of templates; compute in frontmatter.                                                                                                        |
| L8  | `src/pages/dashboard.astro:19-34`                                                                                  | swallowed                    | low      | A failed pricing-profile check hides the "not configured" notice (justified as degradation); logged with code only.                                                                                                                                                                                       | Add user id.                                                                                                                                                           |

### Platform / plumbing

| #   | Location                                                                                  | Category           | Severity     | What happens in production                                                                                                                                                                                                                                                         | Fix direction                                                                        |
| --- | ----------------------------------------------------------------------------------------- | ------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| M11 | all 20 `console.error` sites                                                              | missing-context    | medium       | No project id, user id, route or step in any line, though all are in scope; lines are unstructured, so Workers Logs cannot filter by project.                                                                                                                                      | A small `logError(scope, error, ctx)` helper emitting one JSON object.               |
| M12 | no `src/pages/500.astro` (`astro/dist/core/errors/default-handler.js:105`)                | flattened-response | medium       | Any uncaught server exception shows a blank page; the only trace is Astro's stack string pointing at hashed chunks.                                                                                                                                                                | Add a Polish `500.astro`; keep logging in the app.                                   |
| M13 | client islands (`@astrojs/react` plain roots), no `window.onerror` / `unhandledrejection` | coverage-gap       | medium       | A render error unmounts the island (editors, sign-in forms) and reaches only the browser console.                                                                                                                                                                                  | Error boundary per island plus a global handler, both posting to the beacon from C5. |
| L9  | `src/pages/auth/confirm-email.astro:8`                                                    | config             | low          | The message depends on `import.meta.env.DEV`, not on whether the sign-up returned a session. Email confirmation is currently off and planned to be enabled; until then the page asks users to wait for an email that is not sent.                                                  | Base the message on `data.session`.                                                  |
| L10 | `src/lib/quote.ts:126-140` vs `src/lib/quote-print.ts:70-98`                              | config             | low (latent) | The two groupings differ (`(device_id, busbar_piece)` vs `(device_id, price)`); segments of one piece at different prices would break the invariant. A single RPC save copies one price to every segment, so not currently reachable; if it is, it surfaces through H2's weak log. | Derive `materialLines` from the same grouping, or rely on H2's richer log.           |

Counts: critical 4 (C1, C2, C3, C5) · high 8 (C4, H1–H7) · medium 13 (M1–M13) · low 10 (L1–L10).
C4 keeps its "C" id from the area auditor but is rated high: the failure leaves a (context-free) log line.

## 6. Recommended fix order

1. **A shared server logging helper** — `logError(scope, error, { projectId, userId, route })` that
   writes one JSON object with `code || "transport"`, `name`, `details`/`hint`, and a stack for
   `Error`s. Server log only; the user path keeps codes. Prerequisite for everything below. Closes
   M11, partially every other finding.
2. **Log in the mappers, and fix the empty code.** Call the helper from `projectErrorFromPostgrest`,
   `deviceErrorFromPostgrest`, `circuitsRpcErrorCode`, `layoutRpcErrorCode` (or a single `fail()` per
   route), and map `""` to `unknown`. One file per mapper covers all 22 branches. Closes C2, C3, M4,
   M8, part of H4. Constraint: don't log expected refusals at error level (`invalid_input`,
   `layout_invalid` → `warn`, M5).
3. **Middleware and auth routes read `error`.** Separate "no session" from failures; log the latter;
   decide 302 vs 503 for gated routes. Closes C1, H4, H5, M9, L1. Constraint: never log credentials or
   emails — user id only.
4. **Client error path.** try/catch around `buildWiringDrawing`, a Polish error state, a print-button
   timeout, and a tiny `POST /api/client-errors` that logs through the helper; then an error boundary
   per island. Closes C5, M13, L7.
5. **Make the silent fallbacks loud.** `previousLayoutFromReads` reports a failed read as a reset (or
   blocks), `activeCatalog` returns drop reasons, geometry parse failures are logged and block the
   match, `[id].astro` sets 500 on load failure. Closes C4, H1, H3, M1, M2, M3, M7.
6. **Boundaries and identity.** `500.astro`, one guard around the print pipeline with the snapshot
   rows at the invariant throw, guarded layout proposal, and (deploy config, outside this audit's
   scope) source-map upload and `wrangler deploy --tag <sha>`. Closes H2, H6, H7, M12.

## 7. Changes since last audit

First run — no previous report.

## 8. Method and limits

- **Agents:** four area auditors (sign-in/session, circuits + matching, layout + edits + wiring,
  quote + print) and one plumbing auditor, all read-only, Sonnet.
- **Spot-checked by hand:**
  - `postgrest-js` 2.116.0 `toTransportFailure`/`toOpenApiError` set `code: ""`, and
    `projectErrorFromPostgrest`'s `?? unknown` does not catch it; `projectFormErrorPath` encodes `""`
    as `?error=` (C2).
  - `previousLayoutFromReads` / `chooseSelectionLayout` drop a manual layout with `reset: false` on a
    failed placements read (C4).
  - `useWiringDrawing` runs the router in a bare `setTimeout` (C5).
  - Astro `handler.js:101-103`, `default-handler.js:105`, `render.js:72` (capture model).
  - `materialLines` vs `devicesCostGrosze` grouping — **downgraded** from the auditor's medium to a
    latent low (L10): one save copies one price per piece.
  - `src/middleware.ts:16-25` (C1).
- **Not verified:** Workers Logs' treatment of the `Location` header, Error-object serialization and
  truncated-stream outcomes; `@supabase/ssr` cookie-write throw conditions (L3); React 19 unmount
  behaviour (taken from docs).
- **Repo-wide sweep** (excluding tests, e2e, scripts): 20 `console.error`, 0 `console.warn`/`info`;
  8 binding-less `catch {}` (all bounded fallbacks — draft storage ×3, JSON parses in `circuits.ts:27`,
  `placements.ts:21`, form parsers, `i18n/format.ts:64`); 13 `.catch(() => new FormData())`; 0 of 3
  production `throw new Error` carry a `cause`; 4 Supabase Auth calls whose `error` is unread.
- **Runtime proof:** not run. It needs the local Supabase stack (Docker) and an isolated worktree
  with probe triggers; no harness exists yet.
- **Out of scope:** admin catalog UI flows beyond the plumbing sweep; Postgres-side logging.
