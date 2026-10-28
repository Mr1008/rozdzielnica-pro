# Observability — Remaining Audit Fixes Implementation Plan

## Overview

Close GitHub issue #29 ("Observability: logger, error tracking, metryki") by finishing fix steps 3–6 of
the 2026-10-21 observability audit on top of the `logServerError` helper that `server-error-logging`
shipped. Cloudflare Workers Logs stays the only sink: server failures, Supabase Auth outages and browser
errors all reach it as structured records, a handful of info/warn events stand in for metrics, and
every deploy carries a version tag and source-mapped stacks.

## Current State Analysis

- **Logger exists, error level only.** `src/lib/server-log.ts` (`serverErrorRecord`, `logServerError`)
  writes one privacy-safe record per failure and is used at every DB read/write failure (34 files).
  There is no warn or info level.
- **Auth results are read without their `error` (C1, H4, H5, M9, L1, L2).** `src/middleware.ts:16-25`
  ignores the errors of `getUser()` and `getClaims()`, so an Auth outage resolves to "signed out" or
  "no role" — 302s only. `signin.ts`/`signup.ts` redirect with `error.code ?? "unknown"` and log nothing;
  `signout.ts:7` ignores its error; both read `formData()` without the `.catch` every other route has.
  `resolveRouteAccess` (`src/lib/route-access.ts`) returns only allow or redirect.
- **The browser is blind (C5, M13).** `useWiringDrawing` (`src/components/projects/WiringDrawing.tsx:33-41`)
  runs `buildWiringDrawing` in a bare `setTimeout`; a throw leaves "loading wires" forever and the print
  button (`print.astro:193-205`, enabled only on `wiring-ready`) disabled. No error boundary, no
  `window.onerror`, no endpoint that receives browser errors.
- **Fallbacks pick a plausible state silently (C4, H1, H3, M1, M2, M3, M7).**
  `previousLayoutFromReads` (`src/lib/layout-server.ts:366-375`) turns a failed placements read into
  "no manual layout", so a circuit save deletes the manual layout with no `layout_reset=1` (the read
  failure is already logged with `projectId` at `:398`). `activeCatalog` (`src/lib/device-matching.ts:169-181`)
  drops unparseable rows and discards the issues; `parseCatalog` (`device-matching-server.ts:82-97`)
  logs ids only. `loadMatchBase` (`device-matching-server.ts:125`) turns an unparseable
  `cabinet_geometry` into `null` — the same value as "no cabinet" — which silently drops the PE/N-bar
  and busbar requirements. `computeLayoutView` (`layout-server.ts:75-97`) turns `validateLayout`
  issues into "outdated" without a trace; `chooseSelectionLayout` (`:201-226`) keeps no reason for a
  failed carry-over. The project page renders a match-load failure at HTTP 200 (`[id].astro:137`).
- **Boundaries (M12, H2, H6, H7).** No `src/pages/500.astro` — an uncaught throw is a blank 500. In
  `print.astro` only `computePrintView` is guarded (`:99-107`); its sum-invariant throw
  (`quote-print.ts:133`) carries two sums and nothing else. `cabinet-layout.ts:241` throws on a
  catalog row without `n_terminal_side` inside every save, re-match and render.
- **Deploy identity.** `deploy.yml:86` runs `npx wrangler deploy` with no `--tag`/`--message`;
  `wrangler.jsonc` has `observability.enabled: true` but no `upload_source_maps`; stacks point at
  hashed `dist/server/chunks/*.mjs`.
- **Proof harness exists.** The audit's probe suite lives in
  `.claude/worktrees/agent-ae7a77891485cc62c/probe/` (`bash probe/suite.sh`). Its 2026-10-22 run
  (`probe/out/`, see `context/archive/2026-10-21-server-error-logging/probe-before-after.md`) shows C1
  and C5 unchanged — that is the "before" for this change.

## Desired End State

- A Supabase Auth outage is logged as such, and gated routes answer **503** with a Polish "temporarily
  unavailable" page instead of sending the user to sign in; a missing session is still a normal
  sign-out. A signed-in user without a role is logged once with their id and whether the claim key exists.
- Sign-in/sign-up log only infrastructure failures (status ≥ 500 or 0, retryable fetch errors, hook or
  unmapped codes) — never `invalid_credentials`, never an email.
- An uncaught server error shows a Polish 500 page, not a blank one.
- A browser error in any island, a global `error`/`unhandledrejection`, or a wiring-router failure is
  sent to `POST /api/client-errors` (signed-in users only, capped payload) and logged through
  `logServerError` with the user id. A wiring failure shows a Polish alert instead of an endless
  "loading wires"; "Drukuj" stays disabled (no partial printout).
- A circuit save whose previous-layout read fails is **refused** with the generic banner; the manual
  layout survives. A non-null cabinet snapshot that does not parse blocks matching instead of
  dropping the bar/busbar requirements. Dropped catalog rows log their kind and issue codes.
- Each circuit save and re-match writes one info record (`projectId`, `status`, `gapCount`,
  `droppedCount`, `layoutReset` and its reason); server-side validation refusals write a warn record
  with the first issue codes and no payload.
- The print pipeline is guarded as one unit and logs the offending rows at the invariant throw; the
  layout proposal throw is caught, logged with project and device id, and shown as the unknown banner.
- Every production deploy carries `--tag <short sha>` and `--message <subject>`, and Workers Logs
  shows source-mapped server stacks.

Verified by: unit tests, `astro check`, build, the probe suite's C1/C5 runs, and browser checks.

### Key Discoveries:

- `logServerError` must never throw (`server-log.ts:62-71`) — the warn/info functions keep that property.
- `resolveRouteAccess` is pure and unit-tested; `ROLE_HOME` targets must stay reachable by their own
  role (`route-access.test.ts`). The 503 outcome belongs in that function, not in the middleware.
- `chooseSelectionLayout` is shared by `circuits.ts:82` and `rematch.ts:48`; `rematch.ts` reads its
  previous layout via `loadLayoutContext`, `circuits.ts` via `loadPreviousLayout` (`circuits.ts:65`).
- The matching-quote rule "never a partial document" (`context/foundation/agent-rules/matching-quote.md`)
  settles the print behaviour on a wiring failure: the button stays disabled.
- Islands: `SignInForm`/`SignUpForm` (public), `CabinetEditor`/`DeviceEditor` (admin), the circuit and
  layout editors, `WiringDrawing` and `QuoteDocument` (elektryk). A beacon gated to both roles covers
  all but the public forms.
- AGENTS.md UI rules: every new UI state goes to `/dev/kitchen-sink` first; tokens only, no palette
  classes; Polish strings via `src/lib/i18n/pl.ts`.

## What We're NOT Doing

- No third-party error tracker (Sentry, Datadog, OTel) and no Analytics Engine binding — Workers Logs only.
- No alert rules or notification channels (dashboard-side, out of repo).
- No `raise warning` in `custom_access_token_hook` (H5's migration half) — Postgres logs are not
  monitored; the app-side "user without role" log covers the case.
- No rate-limit store for the beacon; signed-in gating and payload caps are the bound.
- No beacon on public pages (sign-in/sign-up island errors stay in the browser console).
- No change to the catalog-gap behaviour for unparseable rows (H1) — still a gap, now with a reason in the log.
- No fix for L3 (`setAll` cookie throw), L4 (catalog paging), L7 (overflow counts beacon), L9
  (confirm-email wording), L10 (latent grouping mismatch), M4 (SQLSTATE remapping), M10 beyond the
  infra/user classification used for logging.
- No change to `scripts/smoke.mjs` or `enable_confirmations`.

## Implementation Approach

Build the small pure pieces first (log levels, auth error classification, client payload parser) with
unit tests, then wire each audit step in its own phase, each leaving the app shippable. Server-side
logic changes stay in pure functions where they already live (`resolveRouteAccess`,
`previousLayoutFromReads`, `chooseSelectionLayout`, `activeCatalog`), so they are unit-testable; routes
and pages only log and branch on their results. Proof is the existing probe suite plus browser checks.

## Critical Implementation Details

- **Middleware rewrite, not redirect, for 503.** Render the unavailable page with `next("/<path>")`
  (an Astro rewrite that does not re-run the middleware) and set status 503 in that page; a redirect
  would lose the status and a rewrite through `context.rewrite` re-enters the middleware and loops on
  the same outage. The unavailable page itself must be ungated.
- **`AuthSessionMissingError` is the normal "no session" case**, not a failure — it must never be
  logged or turn into a 503, or every anonymous visit would log and be refused.
- **Block C4 before the RPC.** `save_project_circuits` deletes the old snapshot and placements, so the
  read failure must be detected and the save refused before matching/saving runs, not after.
- **Source maps for the server build only.** Enabling Vite source maps globally would also publish
  client `.map` files from `dist/client` as static assets; verify none are emitted there.

## Phase 1: Logging primitives

### Overview

Add the reusable pieces every later phase calls: warn/info logging, auth-error classification and a
capped client-error payload parser.

### Changes Required:

#### 1. Warn and info levels

**File**: `src/lib/server-log.ts`, `src/lib/server-log.test.ts`

**Intent**: Let routes record expected-but-interesting events (validation refusals, match outcomes)
without writing them at error level.

**Contract**: `logServerWarn(event, fields)` and `logServerInfo(event, fields)` write one flat record
`{ event, level, ...fields }` via `console.warn` / `console.info`; fields are `ServerLogContext`-typed
(strings, numbers, null), never an error object. Like `logServerError`, they never throw.

#### 2. Auth error classification

**File**: `src/lib/auth-errors.ts`, `src/lib/auth-errors.test.ts`

**Intent**: Separate "the user did something wrong" from "Supabase Auth is failing", so routes log only
the latter (H4, M10) and the middleware can tell an outage from a missing session (C1).

**Contract**: `isAuthInfraError(error): boolean` — true for status ≥ 500, status 0/absent with a
retryable fetch error name, `unexpected_failure`, `hook_*` codes and any code not in the mapped
user-error set; false for `AuthSessionMissingError` and the mapped user codes (`invalid_credentials`,
`user_already_exists`, weak password, …). `authErrorRecord(error)` returns only `{ code, status, name }`
for logging (never message or email).

#### 3. Client error payload parser

**File**: `src/lib/client-errors.ts`, `src/lib/client-errors.test.ts`

**Intent**: One place that turns an untrusted browser report into a bounded log record, shared by the
endpoint (parse) and the browser reporter (build).

**Contract**: `parseClientErrorReport(body: unknown)` → `{ ok: true, report } | { ok: false }` with
`report = { source: "boundary" | "window" | "rejection" | "wiring", message ≤ 200, stack ≤ 2048, path ≤ 200, projectId?: uuid }`;
unknown keys dropped, wrong types rejected. `buildClientErrorReport(source, error, extra)` builds the
same shape in the browser.

### Success Criteria:

#### Automated Verification:

- Unit tests for the three helpers pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Auth, middleware and error pages

### Overview

Audit step 3 plus M12: Auth outages are logged and answered with 503, auth routes log infra failures,
and uncaught errors land on a Polish 500 page.

### Changes Required:

#### 1. Route access learns "auth unavailable"

**File**: `src/lib/route-access.ts`, `src/lib/route-access.test.ts`

**Intent**: Keep the access decision in the pure function: a gated route requested while Auth is
failing is refused with 503; an ungated route is allowed (renders as signed out).

**Contract**: `RouteRequest` gains `authUnavailable: boolean`; `RouteAccess` gains
`{ allowed: false; unavailable: true }`. Export the unavailable page path (e.g. `UNAVAILABLE_PATH`).
Tests: gated + unavailable → unavailable; ungated + unavailable → allowed; the unavailable path is
never gated; existing invariants hold.

#### 2. Middleware reads Auth errors

**File**: `src/middleware.ts`

**Intent**: Read `error` from `getUser()` and `getClaims()`; treat `AuthSessionMissingError` as no
session; log anything else with `isAuthInfraError` classification (name, status, code, path — never
email) and pass `authUnavailable`. When `user !== null && role === null`, log once with the user id
and whether the claims contain a `user_role` key (H5). On an `unavailable` verdict, rewrite to the
unavailable page.

**Contract**: `context.locals` unchanged in shape; unavailable verdict → `next(UNAVAILABLE_PATH)`
(see Critical Implementation Details). The null-client branch stays as is.

#### 3. Auth routes log infra failures

**File**: `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`

**Intent**: Log only infra-class failures (H4), log a freshly minted token without `user_role` (M9),
log a non-trivial `signOut()` error but still redirect (L1), and read `formData()` with
`.catch(() => new FormData())` like every other route (L2). Redirect codes are unchanged.

**Contract**: `logServerError("auth.signin failed", authErrorRecord(error), { path })` style — event
names `auth.signin`, `auth.signup`, `auth.signout`, `auth.claims missing`; no email in any record.

#### 4. Polish error pages

**File**: `src/pages/500.astro`, `src/pages/unavailable.astro` (or the path chosen in 2.1),
a shared error-page component under `src/components/`, `src/lib/i18n/pl.ts`, `src/pages/dev/kitchen-sink.astro`

**Intent**: Replace the blank 500 with a Polish page and give the 503 a page of its own, both built
from one shared component on the existing `Layout.astro`, tokens only.

**Contract**: `500.astro` renders the generic message (Astro already logs the stack; the page adds no
second log). The unavailable page sets `Astro.response.status = 503`. New `t.errors.*` keys; both
states shown on `/dev/kitchen-sink`.

### Success Criteria:

#### Automated Verification:

- Route-access, auth-errors tests pass: `npm run test:unit`
- Lint and type check pass: `npm run lint && npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- With the local stack's auth container stopped, `/dashboard` answers 503 with the Polish page and Workers Logs (dev console) shows one classified record; `/` still renders signed out
- With the stack up and no session, `/dashboard` still redirects to `/auth/signin` and nothing is logged
- A forced throw in a page frontmatter shows the Polish 500 page
- Wrong password on sign-in logs nothing; the banner is unchanged

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Browser error path

### Overview

Audit step 4: browser errors reach Workers Logs, and a wiring-router failure stops leaving the page
stuck.

### Changes Required:

#### 1. Beacon endpoint

**File**: `src/pages/api/client-errors.ts`, `src/lib/route-access.ts`

**Intent**: Receive browser reports from signed-in users and log them through the server helper.

**Contract**: `POST /api/client-errors`, JSON body (≤ 8 KB read), parsed with
`parseClientErrorReport`; valid → `logServerError("client.<source>", report, { userId })`; always
answers 204 (invalid bodies are dropped silently). `PROTECTED_ROUTES` gains
`{ prefix: "/api/client-errors", roles: ["elektryk", "admin"] }`.

#### 2. Browser reporter and global handlers

**File**: `src/lib/client-error-reporter.ts` (browser-only), `src/layouts/AppLayout.astro` (signed-in layout)

**Intent**: Send one report per distinct error via `navigator.sendBeacon` (fallback `fetch` with
`keepalive`), and install `window` `error` / `unhandledrejection` listeners on signed-in pages only.

**Contract**: `reportClientError(source, error, extra?)` never throws; deduplicates by
`source + message` within a page load and stops after a small cap (e.g. 5 reports). Installed from a
bundled `<script>` in the signed-in layout(s), not on the public auth pages.

#### 3. Error boundary per island

**File**: `src/components/IslandErrorBoundary.tsx`, each island mount (circuit editor, layout editor,
`WiringDrawing`, `QuoteDocument`, `CabinetEditor`, `DeviceEditor`), `src/lib/i18n/pl.ts`,
`src/pages/dev/kitchen-sink.astro`

**Intent**: A render error shows a Polish "this part of the page failed — reload" alert instead of an
unmounted island, and is reported.

**Contract**: Class component with `getDerivedStateFromError` + `componentDidCatch` →
`reportClientError("boundary", error, { component })`; fallback uses `Alert` with tokens. Wrap at the
island root components (not in every `.astro` mount) so the boundary ships with the island. Kitchen-sink
shows the fallback.

#### 4. Wiring-router failure state

**File**: `src/components/projects/WiringDrawing.tsx`, `src/pages/dashboard/projects/[id]/print.astro`,
`src/lib/i18n/pl.ts`, `src/pages/dev/kitchen-sink.astro`

**Intent**: A throw inside the router timer becomes a failed state: a Polish alert replaces
"loading wires", the error is reported with `projectId`, and the print page shows why "Drukuj" stays
disabled instead of waiting forever (C5).

**Contract**: `useWiringDrawing` returns a failure state alongside `Wiring | null`; the pending marker
`data-wiring-pending` is removed and a `wiring-failed` window event fires; `print.astro` listens for it
and shows the explanation. The button is never enabled without wires.

### Success Criteria:

#### Automated Verification:

- Unit tests pass (route-access entry, payload parser reuse): `npm run test:unit`
- Lint and type check pass: `npm run lint && npx astro check`
- Build passes: `npm run build`

#### Manual Verification:

- A forced throw in `buildWiringDrawing` on the project page shows the Polish alert, and a `client.wiring` record with userId and projectId appears in the dev server log
- The same forced throw on the print page shows the explanation and "Drukuj" stays disabled
- A forced render error in an island shows the boundary fallback and is reported once
- An anonymous POST to `/api/client-errors` is redirected and logs nothing
- The kitchen-sink shows the boundary fallback, the wiring failure alert and the print explanation

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Loud fallbacks and metrics

### Overview

Audit step 5 plus M5/M6: fallbacks that used to pick a plausible state either block or leave a
reasoned log record, and saves and refusals emit info/warn events.

### Changes Required:

#### 1. Failed previous-layout read blocks the circuit save (C4)

**File**: `src/lib/layout-server.ts`, its test, `src/pages/api/projects/[id]/circuits.ts`

**Intent**: A failed read of the stored snapshot or placements refuses the save with the generic
`unknown` banner, so the manual layout survives a transient failure.

**Contract**: `previousLayoutFromReads` / `loadPreviousLayout` return
`{ ok: true; previous: PreviousLayout } | { ok: false }`; `circuits.ts` checks it before matching and
the RPC and redirects with the `unknown` error code. Tests: either read failing → `ok: false`; both
succeeding → unchanged behaviour.

#### 2. Dropped catalog rows carry reasons (H1, L6)

**File**: `src/lib/device-matching.ts`, its test, `src/lib/device-matching-server.ts`

**Intent**: Keep a dropped row a catalog gap, but log what was wrong with it.

**Contract**: `activeCatalog` keeps its return type; a new `activeCatalogWithDrops(rows)` (or an
added second return) yields `dropped: { id, kind, issueCodes }[]`. `parseCatalog` logs one warn record
with `count`, the first ten `id:kind:code` entries and `projectId`.

#### 3. Unparseable cabinet snapshot blocks matching (M1)

**File**: `src/lib/device-matching-server.ts`, its test

**Intent**: Tell "no cabinet chosen" (`cabinet_geometry` null → geometry null, as today) from "a
snapshot that does not parse" (logged with project id and issue codes → `LoadFailure` `unknown`),
so matching never runs without the bar/busbar requirements.

**Contract**: `loadMatchBase` returns `{ ok: false, code: "unknown" }` for a non-null snapshot that
fails `parseCabinetGeometry`. Update the `cabinetBarKinds` / `maxRailMm` doc comments accordingly.

#### 4. Reasons for outdated layouts, failed carry-overs and unparseable circuits (M2, M3, M7)

**File**: `src/lib/layout-editing.ts`, `src/lib/layout-server.ts`, their tests,
`src/pages/dashboard/projects/[id].astro`, `src/pages/api/projects/[id]/circuits.ts`, `rematch.ts`,
`src/lib/device-matching-server.ts`

**Intent**: Every silent downgrade keeps its reason and logs it once at the call site.

**Contract**: `carryOverPlacements` returns a reason on failure (`device_set_changed`,
`ambiguous_key`, `invalid`), surfaced by `chooseSelectionLayout` as `resetReason`. The project page
logs a warn with the first issue codes when `computeLayoutView` returns `outdated` for a non-empty
stored set. The "stored circuits do not parse" log carries issue count and the first few
`{ id, field, code }`.

#### 5. Match-load failure is a 500 (H3)

**File**: `src/pages/dashboard/projects/[id].astro`

**Intent**: Status-based views see the failure; the existing alert stays.

**Contract**: `Astro.response.status = 500` when `matchLoad` is a failure (the record is already logged
with `projectId` in `loadMatchBase`/`loadMatchContext`).

#### 6. Save, re-match and refusal events (M5, M6)

**File**: `src/pages/api/projects/[id]/circuits.ts`, `rematch.ts`, `supply.ts`, `cabinet.ts`,
`placements.ts`

**Intent**: The "metrics" of this change — one queryable record per outcome.

**Contract**: After a successful RPC: `logServerInfo("projects.circuits.saved" | "projects.rematch.saved",
{ projectId, userId, status, gapCount, droppedCount, layoutReset, resetReason })`. On a server-side
validation refusal (`circuits_invalid`, `invalid_input`, `layout_invalid`):
`logServerWarn("<route> refused", { projectId, userId, issueCount, issueCodes })` — first codes only,
no payload values.

### Success Criteria:

#### Automated Verification:

- Unit tests for layout-server, device-matching, device-matching-server, layout-editing pass: `npm run test:unit`
- RLS integration suite still passes against the local stack: `npm run test:integration`
- Lint and type check pass: `npm run lint && npx astro check`

#### Manual Verification:

- With a probe trigger failing the placements read, a circuit save on a project with a manual layout shows the generic banner and the manual layout is unchanged afterwards
- A normal circuit save writes one `projects.circuits.saved` info record with the expected counts
- A tampered circuits POST (invalid payload) writes one warn record with issue codes and no values

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Server boundaries and deploy identity

### Overview

Audit step 6: the print pipeline and the layout proposal fail into logged, Polish states, and deploys
carry version and source maps.

### Changes Required:

#### 1. Print pipeline guard (H2, H7)

**File**: `src/pages/dashboard/projects/[id]/print.astro`, `src/lib/quote-print.ts`, its test

**Intent**: One guard over the whole compute pipeline (`computeMatchView` → `computeLayoutView` →
`computeQuoteView` → `buildLayoutDrawing` → `computePrintView`) logs route, `projectId`, `userId`,
the failing branch and the stack; the invariant throw carries the offending rows.

**Contract**: `quote-print.ts` throws a named error (e.g. `PrintInvariantError`) with a `rows` field
(device id, role, piece, price — no client data) that the page logs; every branch that chooses the
"load failed" 500 logs `{ branch }`, including `!supabase || !user`. Rendered output unchanged.

#### 2. Guarded layout proposal (H6)

**File**: `src/lib/cabinet-layout.ts`, `src/pages/api/projects/[id]/circuits.ts`, `rematch.ts`,
`src/pages/dashboard/projects/[id].astro`

**Intent**: A catalog row that breaks the layout step is logged with project and device id and shown
as the `unknown` banner (API) or the section's load-failed alert (page), not a blank 500.

**Contract**: The throw at `cabinet-layout.ts:241` becomes a named error carrying `deviceId`; the
routes and page catch around `chooseSelectionLayout` / `computeLayoutView` and log
`{ projectId, userId, deviceId }`.

#### 3. Deploy tag and source maps

**File**: `.github/workflows/deploy.yml`, `wrangler.jsonc`, `astro.config.mjs`

**Intent**: Logged stacks name the release and point at source lines.

**Contract**: `npx wrangler deploy --tag "${GITHUB_SHA::7}" --message "<commit subject, truncated>"`;
`"upload_source_maps": true` in `wrangler.jsonc`; server-only source maps from the Astro/Vite build.
`dist/client` must contain no `.map` files.

#### 4. Automatic traces

**File**: `wrangler.jsonc`

**Intent**: Turn on Cloudflare's automatic Workers tracing so each request shows its outgoing
Supabase REST/Auth calls as timed spans in the dashboard (added 2026-10-27 at the user's request;
included in the free tier per the user).

**Contract**: `observability.traces.enabled: true` with `head_sampling_rate: 1` (one user — sample
everything), beside the existing `observability.enabled`. No SDK, no code change.

### Success Criteria:

#### Automated Verification:

- quote-print and cabinet-layout tests pass: `npm run test:unit`
- Lint, type check and build pass: `npm run lint && npx astro check && npm run build`
- Build emits server source maps and no client ones: `dist/server` has `.map` files, `dist/client` has none
- `npx wrangler deploy --dry-run` accepts the config with `upload_source_maps`

#### Manual Verification:

- A forced throw inside the print pipeline shows the Polish load-failed state and logs branch, projectId, userId and a stack
- A catalog device without `n_terminal_side` makes a circuit save show the unknown banner and logs the device id
- After the first deploy from `master`, Workers Logs shows the version tag and a source-mapped stack for a forced error
- After the first deploy from `master`, the dashboard's Observability view shows traces with Supabase subrequest spans

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 6: Proof and docs

### Overview

Prove C1 and C5 closed with the same probes that found them, and update the project documents.

### Changes Required:

#### 1. Probe suite re-run

**File**: `.claude/worktrees/agent-ae7a77891485cc62c/probe/`, `context/changes/observability/probe-before-after.md`

**Intent**: Merge this branch into the probe worktree, run `bash probe/suite.sh` against the local
stack, and compare with the 2026-10-22 run (`probe/out/`). Adjust the C1/C5 probe assertions only
where the expected behaviour changed (503 instead of 302; wiring alert instead of a stuck marker).

**Contract**: `probe-before-after.md` with one row per probe (before, after, PASS/FAIL), as in
`context/archive/2026-10-21-server-error-logging/probe-before-after.md`.

#### 2. Project documents

**File**: `AGENTS.md`, `context/foundation/roadmap.md`

**Intent**: Record the logging convention for future work, and reflect that observability is no
longer absent.

**Contract**: One AGENTS.md tripwire line: server failures go through `logServerError` /
`logServerWarn` / `logServerInfo` in `src/lib/server-log.ts`, browser errors through
`reportClientError`; never `console.*` directly, never `details` or emails. In the roadmap, update the
`Observability:` baseline line and the #29 `## Parked` entry (English, per the 2026-10-27 docs
decision), then mirror with `node scripts/roadmap-to-github.mjs --apply` under the `Mr1008` account.

### Success Criteria:

#### Automated Verification:

- Probe suite C1 and C5 runs pass: `bash probe/suite.sh` in the probe worktree
- Full local gate passes: `npm run lint && npx astro check && npm run test:unit && npm run build`
- Roadmap sync plan shows only the intended issue change: `node scripts/roadmap-to-github.mjs`

#### Manual Verification:

- `probe-before-after.md` reads as evidence: C1 and C5 changed from missed to logged
- Issue #29 on GitHub reflects the updated roadmap entry

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `server-log`: warn/info records are flat, never throw, never include error objects.
- `auth-errors`: `AuthSessionMissingError` and mapped user codes are not infra; 5xx, status 0
  retryable, `unexpected_failure`, `hook_*` and unmapped codes are; `authErrorRecord` holds no message.
- `client-errors`: caps, type rejection, unknown-key drop, uuid check on `projectId`.
- `route-access`: unavailable verdict only on gated routes; unavailable page ungated; loop invariant kept.
- `layout-server`: either previous read failing → `ok: false`; carry-over reasons.
- `device-matching` / `-server`: drop reasons; non-null unparseable geometry → `unknown`; null geometry unchanged.
- `quote-print`: invariant error carries rows; `cabinet-layout`: named error carries `deviceId`.

### Integration Tests:

- `npm run test:integration` unchanged and green (no schema change in this plan).
- Probe suite C1 (auth outage) and C5 (wiring throw) against a production-like build on workerd.

### Manual Testing Steps:

1. Stop the auth container; open `/dashboard` → Polish 503; `/` → signed-out home; one log record.
2. Force a wiring throw; open the project page and the printout → alert, disabled print with reason, one `client.wiring` record.
3. Fail the placements read with a probe trigger; save circuits on a manual layout → generic banner, layout intact.
4. Save circuits normally → one `projects.circuits.saved` info record.

## Performance Considerations

Logging adds at most a few `console.*` calls per request. The beacon is deduplicated and capped per
page load. Server source maps increase the upload size only, not the Worker's runtime cost.

## Migration Notes

No database migration. Deploy config changes (`--tag`, `upload_source_maps`) take effect on the next
push to `master`; they are reverted by reverting the commit.

## References

- Audit: `context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md` (fix order §6, steps 3–6)
- Runtime audit: `context/audits/observability/2026-10-21_runtime-sign-in-circuits-layout-quote.md`
- Previous change: `context/archive/2026-10-21-server-error-logging/plan.md`, `probe-before-after.md`
- Logger: `src/lib/server-log.ts`
- Issue: https://github.com/Mr1008/rozdzielnica-pro/issues/29

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Logging primitives

#### Automated

- [x] 1.1 Unit tests for the three helpers pass: `npm run test:unit` — 5352df8
- [x] 1.2 Lint passes: `npm run lint` — 5352df8
- [x] 1.3 Type check passes: `npx astro check` — 5352df8

### Phase 2: Auth, middleware and error pages

#### Automated

- [x] 2.1 Route-access, auth-errors tests pass: `npm run test:unit` — 1f4cf44
- [x] 2.2 Lint and type check pass: `npm run lint && npx astro check` — 1f4cf44
- [x] 2.3 Build passes: `npm run build` — 1f4cf44

#### Manual

- [x] 2.4 With the local stack's auth container stopped, `/dashboard` answers 503 with the Polish page and Workers Logs (dev console) shows one classified record; `/` still renders signed out
- [x] 2.5 With the stack up and no session, `/dashboard` still redirects to `/auth/signin` and nothing is logged
- [x] 2.6 A forced throw in a page frontmatter shows the Polish 500 page
- [x] 2.7 Wrong password on sign-in logs nothing; the banner is unchanged

### Phase 3: Browser error path

#### Automated

- [x] 3.1 Unit tests pass (route-access entry, payload parser reuse): `npm run test:unit` — b2fecb4
- [x] 3.2 Lint and type check pass: `npm run lint && npx astro check` — b2fecb4
- [x] 3.3 Build passes: `npm run build` — b2fecb4

#### Manual

- [x] 3.4 A forced throw in `buildWiringDrawing` on the project page shows the Polish alert, and a `client.wiring` record with userId and projectId appears in the dev server log
- [x] 3.5 The same forced throw on the print page shows the explanation and "Drukuj" stays disabled
- [x] 3.6 A forced render error in an island shows the boundary fallback and is reported once
- [x] 3.7 An anonymous POST to `/api/client-errors` is redirected and logs nothing
- [x] 3.8 The kitchen-sink shows the boundary fallback, the wiring failure alert and the print explanation

### Phase 4: Loud fallbacks and metrics

#### Automated

- [x] 4.1 Unit tests for layout-server, device-matching, device-matching-server, layout-editing pass: `npm run test:unit` — d9633e5
- [x] 4.2 RLS integration suite still passes against the local stack: `npm run test:integration` — d9633e5
- [x] 4.3 Lint and type check pass: `npm run lint && npx astro check` — d9633e5

#### Manual

- [x] 4.4 With a probe trigger failing the placements read, a circuit save on a project with a manual layout shows the generic banner and the manual layout is unchanged afterwards
- [x] 4.5 A normal circuit save writes one `projects.circuits.saved` info record with the expected counts
- [x] 4.6 A tampered circuits POST (invalid payload) writes one warn record with issue codes and no values

### Phase 5: Server boundaries and deploy identity

#### Automated

- [x] 5.1 quote-print and cabinet-layout tests pass: `npm run test:unit` — 480c96a
- [x] 5.2 Lint, type check and build pass: `npm run lint && npx astro check && npm run build` — 480c96a
- [x] 5.3 Build emits server source maps and no client ones: `dist/server` has `.map` files, `dist/client` has none — 480c96a
- [x] 5.4 `npx wrangler deploy --dry-run` accepts the config with `upload_source_maps` — 480c96a

#### Manual

- [x] 5.5 A forced throw inside the print pipeline shows the Polish load-failed state and logs branch, projectId, userId and a stack
- [x] 5.6 A catalog device without `n_terminal_side` makes a circuit save show the unknown banner and logs the device id — 5841a31
- [ ] 5.7 After the first deploy from `master`, Workers Logs shows the version tag and a source-mapped stack for a forced error
- [x] 5.8 After the first deploy from `master`, the dashboard's Observability view shows traces with Supabase subrequest spans

### Phase 6: Proof and docs

#### Automated

- [x] 6.1 Probe suite C1 and C5 runs pass: `bash probe/suite.sh` in the probe worktree — 17c4782
- [x] 6.2 Full local gate passes: `npm run lint && npx astro check && npm run test:unit && npm run build` — 17c4782
- [x] 6.3 Roadmap sync plan shows only the intended issue change: `node scripts/roadmap-to-github.mjs` — 17c4782

#### Manual

- [x] 6.4 `probe-before-after.md` reads as evidence: C1 and C5 changed from missed to logged
- [x] 6.5 Issue #29 on GitHub reflects the updated roadmap entry
