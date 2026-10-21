# Server error logging Implementation Plan

## Overview

Make every server-side database failure leave a useful line in Cloudflare Workers Logs, and stop a
transport failure from producing an empty `?error=` that shows the user nothing. This implements fix
steps 1–2 of the observability audit: one shared logging helper, logging at every write failure
before it is mapped to a redirect, the existing read-side logs moved onto the helper with ids, and
`""` treated as `unknown` in the error mappers.

## Current State Analysis

From `context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md` and the runtime
proof in `2026-10-21_runtime-sign-in-circuits-layout-quote.md`:

- **There is no error tracker.** Workers Logs (`wrangler.jsonc:13`) is the only sink, so a failure
  that the code neither logs nor throws leaves nothing.
- **Write failures (C3, runtime-proven).** 22 `if (error)` branches in `src/pages/api/**` map the
  Supabase error to a code and redirect with `?error=<code>`, and none of them logs. A forced `XX000`
  on the circuit save printed only the access line.
- **Empty code (C2).** The five `*ErrorFromPostgrest` mappers return `error.code ?? <X>_ERROR.unknown`.
  postgrest-js 2.116.0 sets `code: ""` on a fetch failure, which `??` passes through, so the redirect
  is `?error=` and `*ErrorMessage("")` returns null — no banner. A gateway 5xx gives
  `code: undefined` → `unknown`, so it is only the refused-connection case.
- **Code-only read logs (M11, M14).** 20 `console.error(what, error.code)` calls, each with its own
  `eslint-disable-next-line no-console`. None has a project or user id, and a gateway outage logs
  the literal `undefined` (runtime-observed: `project load failed undefined`).

### Key Discoveries:

- Mappers: `src/lib/project-errors.ts:86`, `device-errors.ts:54`, `cabinet-errors.ts:54`,
  `pricing-errors.ts:50`, `business-errors.ts:50` (each `return error.code ?? …unknown`).
  `circuitsRpcErrorCode` (`src/lib/device-matching-server.ts:322`) and `layoutRpcErrorCode`
  (`src/lib/layout-server.ts:299`) fall through to `projectErrorFromPostgrest`, so they inherit the
  fix. Each mapper has a unit test beside it.
- Write call sites (22): `src/pages/api/admin/cabinets/{index,[id]/index,[id]/archive,[id]/restore}.ts`,
  `src/pages/api/admin/devices/{index,[id]/index,[id]/archive,[id]/restore}.ts`,
  `src/pages/api/profile/{pricing,business}.ts`,
  `src/pages/api/projects/{index,[id]/index,[id]/delete,[id]/supply,[id]/cabinet,[id]/quote,[id]/circuits,[id]/rematch,[id]/layout,[id]/placements}.ts`
  (some files have more than one branch; grep `ErrorFromPostgrest\|RpcErrorCode` in `src/pages/api`).
- Read log sites (20): `src/lib/device-matching-server.ts:71` (`logLoadFailure`) and `:88`,
  `src/lib/layout-server.ts:338`, `:401`, `src/pages/api/projects/[id]/quote.ts:64`,
  `src/pages/admin/{cabinets,devices}/{index,[id]}.astro`, `src/pages/dashboard.astro:30`,
  `src/pages/dashboard/profile.astro:58,84`, `src/pages/dashboard/projects/{index,new}.astro`,
  `src/pages/dashboard/projects/[id].astro:92,110,178`, `src/pages/dashboard/projects/[id]/print.astro:41,71,104`.
- `loadMatchBase` / `loadMatchContext` / `loadLayoutContext` / `loadPreviousLayout` already take the
  `projectId`; the user id is only in scope at the page or route (`Astro.locals.user` /
  `context.locals.user`).
- Unit-test pattern to copy: `src/lib/roles.test.ts` (Vitest, `src/**/*.test.ts`).
- `no-console` warns under ESLint; the helper should hold the one disable so call sites carry none.

## Desired End State

Every database failure on the server — read or write — produces exactly one structured
`console.error` line carrying a stable event name, the error code (or `"transport"` / `"none"`
when there is none), the error name, the hint, a message truncated to 200 characters, and the
project and user id where they are in scope. `details` is never logged. A thrown `Error` caught by
the app (the print view) is logged with its stack. User-facing behaviour is unchanged except that a
transport failure now redirects with `?error=unknown` and shows the generic banner.

Verified by: the new unit tests, the existing suite, and the probe suite in
`.claude/worktrees/agent-ae7a77891485cc62c` re-run after the change (C2 transport → `?error=unknown`;
C3 → a log line with `XX000`; REST-down read logs with `"none"` and ids instead of `undefined`).

## What We're NOT Doing

- The middleware and auth routes (C1, H4, H5, M9, L1) — fix step 3, a separate change.
- The client error path for the wiring router (C5) — fix step 4.
- Making silent fallbacks loud (C4, H1, H3, M1–M3) and boundaries (`500.astro`, print pipeline guard)
  — fix steps 5–6. The dropped-catalog log at `device-matching-server.ts:88` moves onto the helper
  unchanged in meaning; adding drop reasons is H1, not this change.
- Logging validation refusals (`circuits_invalid`, `layout_invalid`, `invalid_input`) — M5; they are
  not database failures.
- Remapping specific SQLSTATEs (`P0002`, `42501`, `23514`) — M4.
- Any user-facing text change, error tracker SDK, or `wrangler.jsonc` / deploy change.
- Logging `details` or any row value.

## Implementation Approach

Keep the mappers pure: logging happens at the call site, where the ids are, through one helper. The
helper normalises an unknown error (Supabase `PostgrestError`/`AuthError`-shaped objects and plain
`Error`s) into a small record and writes it with a single `console.error` call. Call sites log first,
then map and redirect exactly as today.

## Critical Implementation Details

- **Privacy contract.** The helper reads only `code`, `name`, `hint`, `message` (truncated) and, for
  an `Error`, `stack`. It must never read `details` and never spread the error object, because
  `details` echoes row values (e.g. `Key (email)=(…)`). The unit test asserts `details` is absent.
- **Empty code vs missing code.** `""` and `undefined`/`null` are logged differently (`"transport"`
  vs `"none"`), because they mean different failures (refused connection vs gateway/non-PostgREST
  body). In the mappers both map to `unknown`.
- **Log in Workers Logs as an object.** Pass one plain object to `console.error` so Workers Logs keeps
  its fields filterable; do not `JSON.stringify` it and do not pass extra positional arguments.

## Phase 1: Helper and empty-code fix

### Overview

Add the logging helper and make the mappers treat an empty code as `unknown`. Closes C2.

### Changes Required:

#### 1. Server logging helper

**File**: `src/lib/server-log.ts`

**Intent**: One place that turns any caught error into a privacy-safe log record and writes it, so
call sites stay one line and carry no `eslint-disable`.

**Contract**: `logServerError(event: string, error: unknown, context?: { userId?: string | null; projectId?: string | null; [key: string]: string | number | null | undefined }): void`.
Writes one `console.error(record)` where `record` has `event`, `code` (string code; `"transport"` when
the code is `""`; `"none"` when absent), `name`, `hint` (when present), `message` (≤ 200 chars, with
an ellipsis when cut), `stack` (only for `Error` instances), and the context fields. Never `details`.
Also export the pure record builder (e.g. `serverErrorRecord`) so it is testable without spying.

#### 2. Helper unit test

**File**: `src/lib/server-log.test.ts`

**Intent**: Pin the privacy and normalisation contract.

**Contract**: Cases: PostgREST error with a code; `code: ""` → `"transport"`; no code → `"none"`;
`details` never present; message longer than 200 is truncated; a plain `Error` keeps `name`, `message`
and `stack`; a non-object (string, `undefined`) still produces a record; context ids are copied;
`logServerError` calls `console.error` exactly once with one argument.

#### 3. Empty code maps to `unknown`

**File**: `src/lib/project-errors.ts`, `device-errors.ts`, `cabinet-errors.ts`, `pricing-errors.ts`,
`business-errors.ts`

**Intent**: A transport failure must reach the user as the generic banner, not as `?error=`.

**Contract**: In each `*ErrorFromPostgrest`, the `default:` branch returns `<X>_ERROR.unknown` when
`error.code` is `""`, `null` or `undefined`, and the code otherwise. Update the doc comment of
`projectErrorFromPostgrest` to say so. Add an `""` case to each mapper's existing test file.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes, including the new `server-log.test.ts` cases and an `""` → `unknown` case per mapper
- `npm run lint` passes
- `npx astro check` passes

#### Manual Verification:

- Read `src/lib/server-log.ts` and confirm it never reads `details` and never spreads the error object

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Log write failures

### Overview

Call the helper at every `if (error)` branch in `src/pages/api/**` before mapping. Closes C3 and
the write half of M8.

### Changes Required:

#### 1. API write sites

**File**: the 22 branches listed under Key Discoveries (`src/pages/api/admin/**`, `src/pages/api/profile/**`, `src/pages/api/projects/**`)

**Intent**: A failed insert, update, delete or RPC leaves a log line with the route, user and
project/entity before the redirect, so a 302 is no longer the only trace.

**Contract**: Before the existing `return back(...)` / `context.redirect(...)`, call
`logServerError("<area>.<action> failed", error, { userId: context.locals.user?.id, projectId: id })`
— the entity id key matches the route (`projectId`, `deviceId`, `cabinetId`; none for profile/list
creates). Event names are stable, lower-case, dot-separated (e.g. `projects.supply.update failed`,
`projects.circuits.rpc failed`, `admin.devices.create failed`). Redirect targets and codes are unchanged.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes
- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- Every `ErrorFromPostgrest(` / `RpcErrorCode(` call in `src/pages/api` has a `logServerError(` call in the same branch: `grep -c` of the two match (22 each)

#### Manual Verification:

- Spot-read three routes (one admin, one profile, one project RPC) and confirm event name, ids and unchanged redirect

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Move read logs onto the helper

### Overview

Replace the 20 existing `console.error(what, error.code)` calls with the helper, adding the project
and user id where in scope. Closes M11 and M14.

### Changes Required:

#### 1. Server libraries

**File**: `src/lib/device-matching-server.ts`, `src/lib/layout-server.ts`

**Intent**: Load failures in the shared loaders carry the project id and the full normalised error
instead of a bare code.

**Contract**: `logLoadFailure` takes the error and `projectId` and calls
`logServerError("match context load failed", error, { projectId, what })`; the stored-circuits parse
failure logs its issue code via the same helper's context (it has no Supabase error — pass
`undefined` as the error and the issue code as a context field). The dropped-catalog line becomes
`logServerError("match catalog devices dropped", undefined, { dropped: <ids joined> , count })`.
`layout-server.ts:338` and `:401` follow the same shape with `projectId`.

#### 2. Pages and the quote route

**File**: `src/pages/admin/{cabinets,devices}/{index,[id]}.astro`, `src/pages/dashboard.astro`,
`src/pages/dashboard/profile.astro`, `src/pages/dashboard/projects/{index,new}.astro`,
`src/pages/dashboard/projects/[id].astro`, `src/pages/dashboard/projects/[id]/print.astro`,
`src/pages/api/projects/[id]/quote.ts`

**Intent**: Each page-level load failure logs the user id (and the project/entity id where the page
has one) through the helper.

**Contract**: Replace each `console.error(...)` with `logServerError("<page> <what> load failed", error, { userId: Astro.locals.user?.id, projectId })`
and drop its `eslint-disable-next-line`. `print.astro:104` passes the caught value itself (not
`error.message`), so the stack is kept. No `console.error` remains in `src` outside `server-log.ts`.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes
- `npm run lint` passes
- `npx astro check` passes
- `npm run build` passes
- No `console.error` in `src` outside `src/lib/server-log.ts`: `grep -rn "console.error" src --include=*.ts --include=*.astro --include=*.tsx | grep -v "\.test\." | grep -v server-log.ts` prints nothing

#### Manual Verification:

- Spot-read `print.astro` and confirm the caught error object (not its message) reaches the helper

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Before/after proof with the probe suite

### Overview

Re-run the recorded runtime probes against the changed code and compare with the 2026-10-21 run.

### Changes Required:

#### 1. Bring the change into the probe worktree

**File**: `.claude/worktrees/agent-ae7a77891485cc62c` (branch `worktree-agent-ae7a77891485cc62c`)

**Intent**: Run the identical suite on the fixed code without touching the main checkout.

**Contract**: Merge the commits from phases 1–3 into the worktree branch (its only local change is the
probe-gated throw in `WiringDrawing.tsx`, which these phases do not touch), then
`bash probe/suite.sh` from the worktree root with the local Supabase stack running. Keep the previous
`probe/out/` by copying it to `probe/out-before/` first.

#### 2. Extend the transport probe

**File**: `probe/transport.probe.test.ts` (worktree only)

**Intent**: The refused-connection case was proven only through the mapping; assert the fixed mapping.

**Contract**: Case A now expects `projectErrorFromPostgrest` → `"unknown"` and `projectErrorMessage` → the generic text.

### Success Criteria:

#### Automated Verification:

- `bash probe/suite.sh` completes and its `trap` leaves the auth/rest containers running and no `probe_fail` trigger
- `probe/out/C2-transport.txt` case A shows `?error=unknown`

#### Manual Verification:

- `probe/out/C3.txt` shows a `projects.circuits.rpc failed` record with `code: "XX000"` and the project id
- `probe/out/C2.txt` REST-down read lines show `code: "none"` with project/user ids and no literal `undefined`
- No user-facing difference other than C2 case A: the C1, C3 and C5 landing pages match the before run
- A short before/after note is added to the change folder (or a `mode: verify` audit report is written with `/10x-observability-audit --verify`)

---

## Testing Strategy

### Unit Tests:

- `src/lib/server-log.test.ts`: normalisation (`""` → `"transport"`, absent → `"none"`), truncation at 200, `details` never present, `Error` stack kept, non-object errors, context copied, one `console.error` call with one argument.
- Each mapper test: `{ code: "" }` → `unknown`.

### Integration Tests:

- None added; `tests/integration/**` covers RLS, not logging.

### Manual Testing Steps:

1. Run the probe suite before/after (Phase 4).
2. With the local stack up, stop `supabase_rest_…`, submit the supply form in the browser, and check the server output for one structured record with ids.

## Performance Considerations

One extra `console.error` per failure only; nothing on the success path.

## Migration Notes

None — no schema, data or config change. Workers Logs will show the new records after deploy;
any saved log search on the old `"… load failed"` strings needs the new event names.

## References

- Audit: `context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md`
- Runtime proof: `context/audits/observability/2026-10-21_runtime-sign-in-circuits-layout-quote.md`
- Probe harness: `.claude/worktrees/agent-ae7a77891485cc62c/probe/`
- Test pattern: `src/lib/roles.test.ts`
- Mapper convention: `src/lib/project-errors.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Helper and empty-code fix

#### Automated

- [x] 1.1 `npm run test:unit` passes, including the new `server-log.test.ts` cases and an `""` → `unknown` case per mapper — 0f45f14
- [x] 1.2 `npm run lint` passes — 0f45f14
- [x] 1.3 `npx astro check` passes — 0f45f14

#### Manual

- [x] 1.4 Read `src/lib/server-log.ts` and confirm it never reads `details` and never spreads the error object — 0f45f14

### Phase 2: Log write failures

#### Automated

- [x] 2.1 `npm run test:unit` passes
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npx astro check` passes
- [x] 2.4 `npm run build` passes
- [x] 2.5 Every `ErrorFromPostgrest(` / `RpcErrorCode(` call in `src/pages/api` has a `logServerError(` call in the same branch

#### Manual

- [x] 2.6 Spot-read three routes (one admin, one profile, one project RPC) and confirm event name, ids and unchanged redirect

### Phase 3: Move read logs onto the helper

#### Automated

- [ ] 3.1 `npm run test:unit` passes
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npx astro check` passes
- [ ] 3.4 `npm run build` passes
- [ ] 3.5 No `console.error` in `src` outside `src/lib/server-log.ts`

#### Manual

- [ ] 3.6 Spot-read `print.astro` and confirm the caught error object (not its message) reaches the helper

### Phase 4: Before/after proof with the probe suite

#### Automated

- [ ] 4.1 `bash probe/suite.sh` completes and its `trap` leaves the auth/rest containers running and no `probe_fail` trigger
- [ ] 4.2 `probe/out/C2-transport.txt` case A shows `?error=unknown`

#### Manual

- [ ] 4.3 `probe/out/C3.txt` shows a `projects.circuits.rpc failed` record with `code: "XX000"` and the project id
- [ ] 4.4 `probe/out/C2.txt` REST-down read lines show `code: "none"` with project/user ids and no literal `undefined`
- [ ] 4.5 No user-facing difference other than C2 case A: the C1, C3 and C5 landing pages match the before run
- [ ] 4.6 A short before/after note is added to the change folder (or a `mode: verify` audit report is written)
