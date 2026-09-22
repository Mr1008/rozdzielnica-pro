# Roles and RLS Baseline Implementation Plan

## Overview

Make `admin` and `elektryk` distinguishable, give every user a profile record, and put
per-electrician data isolation in the database rather than in application code. The role travels as
a custom `user_role` JWT claim minted by a Postgres access-token hook, so RLS policies read it
directly from `auth.jwt()` with no table lookup. This is roadmap item **F-01**, the foundation that
unblocks `S-01`–`S-09`.

## Current State Analysis

The auth baseline works and is deliberately thin. `src/middleware.ts:12` performs the only
`getUser()` per request and writes `context.locals.user`; three files read it, and only ever the
`.email` field (`src/components/Topbar.astro:10`, `src/pages/dashboard.astro:15`, plus the
truthiness gate at `src/middleware.ts:19`). `App.Locals` is a single field (`src/env.d.ts:3`).

Below that line there is nothing. No `supabase/migrations/` directory, no `*.sql` anywhere, no
`seed.sql`, no RLS, no `src/types.ts`, no `zod`, and no test suite. `supabase/config.toml:53-58`
already enables migrations against Postgres 17, and `config.toml:60-65` already enables seeding from
`./seed.sql` — a file that does not exist.

Four constraints bound the work:

1. **RLS is the only boundary that exists.** `deployment-plan.md:138-143` settled on the publishable
   key precisely because `src/lib/supabase.ts:9` builds a cookie-scoped client acting _as the
   signed-in user_. There is no `service_role` escape hatch in the app, so a table without RLS is
   world-readable and no application code can mint an admin.
2. **Rollback is code-only.** `infrastructure.md:205-207` — `wrangler rollback` does not revert a
   migration, so every statement must be forward-compatible.
3. **Two databases, previously unlinked.** Local dev and CI use the Docker stack at
   `127.0.0.1:55321`; production uses a hand-created cloud project. `supabase/.temp/` holds no
   `project-ref`, so nothing in this repo has ever pushed to the cloud.
4. **The only end-to-end check is status-code-deep.** `scripts/smoke.mjs` signs up a real
   `smoke-<timestamp>@example.com` user and asserts `status` plus a `location` prefix — never a
   response body (`deployment-plan.md:312-314`: "a green status code is not a green render").

## Desired End State

Every row in `auth.users` has a `public.profiles` row carrying a role. A signed-in electrician's JWT
contains `user_role: "elektryk"`; an admin's contains `"admin"`. Opening `/admin` as an electrician
redirects away; opening `/dashboard` as an admin redirects to `/admin`. A user whose token carries no
recognised role reaches no gated route at all. At the database level, one electrician selecting
another's profile row receives zero rows rather than an error, and cannot change their own `role`
column by any route. The cloud database receives this schema automatically on push to `master`.

Verified by: `npm run test:unit`, `npm run test:integration` (RLS denial asserted against a live
local Postgres), `npm run smoke` (role gating asserted over HTTP), `npm run lint`, `npx astro check`,
`npm run build`.

### Key Discoveries:

- **The claim cannot be named `role`.** `JwtPayload` already carries a required `role` claim holding
  `authenticated`/`anon` — `node_modules/@supabase/auth-js/dist/module/lib/types.d.ts:2010-2016`. The
  custom claim is `user_role`.
- **`getClaims()` is available** in the installed auth-js 2.116.0 (`GoTrueClient.d.ts:2558`),
  returning `claims: JwtPayload` whose interface ends in `[key: string]: any` (`types.d.ts:2042`).
  Under the repo's `strictTypeChecked` ESLint config that `any` trips `no-unsafe-member-access`, so a
  validating guard is mandatory — this is what justifies adding `zod`.
- **The hook block already exists, commented out**, at `supabase/config.toml:267-269`. Enabling it
  locally is uncommenting, not inventing.
- **`config.toml:162` leaves `signing_keys_path` commented**, so the local stack signs with the legacy
  symmetric secret and `getClaims()` falls back to an Auth-server call there. Correctness is
  unaffected; the "no extra round-trip" benefit only materialises where asymmetric signing keys are
  active.
- **CI applies migrations implicitly in exactly one place.** The `smoke` job's `supabase start` picks
  up `supabase/migrations/*.sql` and `seed.sql`; the `ci` job never touches a database, and nothing
  currently reaches the cloud project.
- **Two profile-less users already exist in production** — leftover `smoke-*@example.com` accounts,
  one still flagged unremoved at `deployment-plan.md:229-230`.
- **`supabase config push` is a trap here.** It would carry `config.toml:154`'s
  `site_url = "http://127.0.0.1:3000"` to the cloud project and break production auth redirects. The
  hook is therefore enabled by hand in the dashboard, once.

## What We're NOT Doing

- **No catalog, project, cabinet or device tables.** The roadmap's F-01 risk note is explicit: role,
  profile and the RLS policy pattern for the first table — not the data model up front. `S-01`–`S-09`
  own their own schemas.
- **No pricing fields on `profiles`.** Hourly rate, average mount time and per-project overhead belong
  to `S-07`, which will add them in its own migration along with their units and precision.
- **No admin catalog UI.** `/admin` is a gate proof with a heading, nothing more. PRD Open Question #1
  (admin acceptance criteria) stays open and owned by the user.
- **No email confirmation change.** `enable_confirmations = false` stays as-is; `smoke.mjs` depends on
  it.
- **No `supabase config push` automation**, for the `site_url` reason above.
- **No rename of `config.toml:5`'s `project_id = "10x-astro-starter"`.** It only namespaces local
  Docker containers, it predates this change, and no document records a decision about it.
- **Not replacing `scripts/smoke.mjs` with the new test suite.** It guards the Cloudflare adapter and
  the real HTTP auth flow, which Vitest does not exercise.

## Implementation Approach

The phase order is dictated by one hazard: the gate fails closed, so application code that demands a
`user_role` claim must never reach production before the cloud database can mint one. Phase 1
therefore lands the schema, the hook and the delivery pipeline while no application code reads a role
— that intermediate state is deployable and harmless. Phase 2 proves phase 1 actually denies
cross-user reads before anything is built on top of it. Phase 3 teaches the app to read the claim but
gates nothing. Only phase 4 turns the gate on, by which point the claim is known to be present
everywhere.

RLS policies read `auth.jwt() ->> 'user_role'` rather than querying `profiles`. This avoids the
recursive-policy problem entirely — a policy on `profiles` that reads `profiles` to decide access
needs a `SECURITY DEFINER` helper to break the cycle, and the claim approach needs none.

## Critical Implementation Details

**The role-change guard must exempt callers with no JWT.** A `BEFORE UPDATE` trigger rejects a change
to `profiles.role` unless the caller is an admin — RLS policies cannot express column-level rules, and
`WITH CHECK` cannot see the old row. But `seed.sql` and any migration run as `postgres` with no JWT at
all, so the guard must treat a null `auth.jwt()` as a privileged context or seeding will fail.

**The hook function needs grants the migration must not forget.** `supabase_auth_admin` executes the
hook in a context where the `authenticated` policies do not apply; it needs `USAGE` on the schema,
`EXECUTE` on the function, `SELECT` on `profiles`, and its own permissive `SELECT` policy. Execute
must simultaneously be revoked from `authenticated`, `anon` and `public`, or any signed-in user can
call the hook directly.

**Migration delivery races the code deploy and always will.** GitHub Actions and Cloudflare Workers
Builds both trigger on push to `master` with no ordering between them (`infrastructure.md:233`).
Forward-compatible statements are what makes the race safe; the phase ordering is what makes the
fail-closed gate safe.

---

## Phase 1: Database foundation and migration pipeline

### Overview

Create the schema, the trigger, the RLS policies, the access-token hook and the automated path that
carries them to the cloud project. No application code changes, so this phase is deployable on its
own.

### Changes Required:

#### 1. The migration

**File**: `supabase/migrations/<timestamp>_roles_and_profiles.sql` (generate the name with
`npx supabase migration new roles_and_profiles` so the `YYYYMMDDHHmmss` prefix AGENTS.md requires is
correct)

**Intent**: Establish the role vocabulary, the profile table every user gets, the trigger that keeps
that invariant true, the policies that isolate rows, and a backfill for users who predate all of it.
Every statement must be re-runnable, because rollback cannot undo it.

**Contract**: A `public.user_role` enum of exactly `('admin', 'elektryk')` — the PRD closes the list at
two. `public.profiles` keyed by `id uuid primary key references auth.users(id) on delete cascade`,
with `role public.user_role not null default 'elektryk'`, `full_name text`, and
`created_at`/`updated_at` as `timestamptz not null default now()` (UTC storage per the repo
convention). RLS enabled, with granular per-operation policies for the `authenticated` role:
self-select, self-update, plus admin-wide select/insert/update/delete gated on the claim. The backfill
is an `insert … select … left join … where p.id is null`, which is naturally idempotent.

The admin predicate is the load-bearing expression and every policy depends on it, so it is fixed here
rather than left to the implementer:

```sql
create or replace function public.is_admin()
returns boolean language sql stable
as $func$ select coalesce(auth.jwt() ->> 'user_role', '') = 'admin' $func$;
```

#### 2. The signup trigger

**File**: same migration

**Intent**: Guarantee that a profile row exists for every account however it was created —
self-registration or admin-created in the dashboard — which is the invariant that lets the hook assume
a row is there.

**Contract**: `public.handle_new_user()` as `SECURITY DEFINER` with `set search_path = ''`, inserting
`(id)` into `public.profiles` and relying on the column default for the role; wired as
`after insert on auth.users for each row`. Use `on conflict (id) do nothing` so a re-run cannot break
signup.

#### 3. The role-change guard

**File**: same migration

**Intent**: Stop a user promoting themselves. RLS grants row access, not column access, so this is the
only place the rule can live.

**Contract**: `BEFORE UPDATE` trigger on `public.profiles` raising an exception when
`new.role is distinct from old.role` and the caller is neither an admin nor a privileged no-JWT
context. The second half of that condition is not optional — see Critical Implementation Details.

#### 4. The access-token hook

**File**: same migration

**Intent**: Stamp the role into every issued JWT so both the middleware and the RLS policies can read
it without a query.

**Contract**: `public.custom_access_token_hook(event jsonb) returns jsonb`. The grant set is the part
that silently breaks if incomplete, so it is specified rather than described:

```sql
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;
create policy "auth_admin_reads_profiles" on public.profiles
  for select to supabase_auth_admin using (true);
```

The function itself reads `public.profiles.role` for `event->>'user_id'`, writes it to
`claims.user_role`, and returns the event unchanged when no profile row is found — a missing row must
not break token issuance.

#### 5. Local hook configuration

**File**: `supabase/config.toml`

**Intent**: Turn the hook on for the local stack and CI.

**Contract**: Uncomment the block at lines 267-269 and set
`uri = "pg-functions://postgres/public/custom_access_token_hook"`. Change nothing else in the file.

#### 6. Local admin seed

**File**: `supabase/seed.sql` (new; `config.toml:60-65` already points at this path)

**Intent**: Give local dev and CI a working admin account so admin-gated routes can be exercised
without manual setup.

**Contract**: Insert one confirmed `auth.users` row with a known email and password, let the trigger
create its profile, then update that profile's role to `admin`. Must be idempotent — `supabase start`
and `supabase db reset` both run it.

#### 7. Automated migration delivery

**File**: `.github/workflows/db-migrate.yml` (new)

**Intent**: Apply pending migrations to the cloud project on every push to `master`, which is the
decision to automate what `infrastructure.md` previously reserved for a human.

**Contract**: Triggers on `push` to `master` only — never on `pull_request`, or a PR would migrate
production. Steps: `supabase/setup-cli@v3`, then
`supabase link --project-ref ${{ secrets.SUPABASE_PROJECT_REF }}` with `SUPABASE_ACCESS_TOKEN` in the
environment, then `supabase db push` with `SUPABASE_DB_PASSWORD`. Workers Builds cannot host this step
— it has no Supabase credentials — which is why it lives in Actions.

### Success Criteria:

#### Automated Verification:

- Local stack rebuilds from scratch with the migration and seed applied: `npx supabase db reset`
- The seeded admin's profile carries the admin role, confirmed by a select on `public.profiles` after a reset
- Repo checks still pass unchanged: `npm run lint && npx astro check && npm run build`
- The existing auth flow is unbroken by the trigger: `npm run smoke` against a locally served build

#### Manual Verification:

- The two leftover `smoke-*@example.com` users are deleted from the production project before the backfill reaches it
- `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD` are set as repository secrets
- The access-token hook is enabled by hand in the cloud dashboard, pointing at `public.custom_access_token_hook`
- A fresh sign-in against the cloud project yields a JWT containing `user_role`
- The `db-migrate` workflow run for this push is green and the cloud project shows the `profiles` table

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live
in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Test harness and RLS integration tests

### Overview

Introduce the repo's first test suite and use it immediately to prove phase 1's policies deny what
they are supposed to deny. Until this phase passes, the isolation claim is unverified.

### Changes Required:

#### 1. Vitest setup

**File**: `package.json`, `vitest.config.ts`, `vitest.integration.config.ts` (both new)

**Intent**: Two configurations because the two kinds of test have incompatible requirements — unit
tests must run with no infrastructure in the fast `ci` job, integration tests need a live database.

**Contract**: Add `vitest` as a devDependency and `zod` as a runtime dependency (AGENTS.md requires it
in `package.json` before any import). Scripts: `test:unit`, `test:integration`, and `test` running
both. Unit config includes `src/**/*.test.ts` with a `node` environment; integration config includes
`tests/integration/**/*.test.ts` and runs serially, since the tests share one database. Both need the
`@/*` → `./src/*` alias declared manually — Astro 7 does not export a `getViteConfig` helper.

#### 2. Lint coverage for test files

**File**: `eslint.config.js`

**Intent**: Keep the new files inside the same `strictTypeChecked` regime as the rest of the repo
rather than quietly exempting them.

**Contract**: Ensure `tests/**` and `*.test.ts` are linted and type-aware. Do not touch the
`fixupPluginRules(pluginReact)` wrapper or the `package.json` `overrides` block — both are load-bearing
per AGENTS.md.

#### 3. RLS integration tests

**File**: `tests/integration/rls-profiles.test.ts` (new)

**Intent**: Assert the security boundary at the layer that enforces it. HTTP tests cannot see an RLS
denial; this is the only mechanism that can.

**Contract**: Read the local stack's URL, anon key and service-role key from `supabase status -o env`
at setup — never from a committed file. Create two electrician users and sign each in to get a
cookie-scoped client. Assertions: (a) electrician A selecting B's profile row gets zero rows, not an
error; (b) A cannot update their own `role`; (c) the seeded admin can read both rows; (d) a signed-in
user's JWT actually contains `user_role`, which is what proves the hook is wired; (e) deleting an
`auth.users` row cascades its profile away.

### Success Criteria:

#### Automated Verification:

- Unit config runs with no database available: `npm run test:unit`
- Integration tests pass against a freshly reset local stack: `npx supabase db reset && npm run test:integration`
- Both new configs and the test files lint clean: `npm run lint`
- Type checking still passes: `npx astro check`

#### Manual Verification:

- Deliberately disabling one policy locally makes the corresponding test fail, confirming the tests can detect a regression rather than passing vacuously

---

## Phase 3: Claim plumbing

### Overview

Teach the application to read and validate `user_role`, and expose it on `locals`. Nothing is gated
yet, so this phase cannot lock anyone out.

### Changes Required:

#### 1. Role vocabulary and guard

**File**: `src/lib/roles.ts` (new)

**Intent**: One place that knows what a valid role is, converting the `any`-typed claim into a typed
value or `null`. Every consumer goes through it.

**Contract**: Export the `UserRole` union matching the database enum, a `zod` schema over it, and a
resolver taking the claims object and returning `UserRole | null`. Returning `null` rather than
throwing is what makes the fail-closed behaviour a single well-defined case.

#### 2. Locals shape

**File**: `src/env.d.ts`

**Intent**: Carry the role alongside the user so pages and middleware read it without re-deriving it.

**Contract**: `App.Locals` gains `role: UserRole | null`. The existing `user` field is unchanged, so
the three current readers keep working untouched.

#### 3. Middleware resolution

**File**: `src/middleware.ts`

**Intent**: Resolve the role once per request, in the same place the user is already resolved.

**Contract**: After the existing `getUser()` call, call `supabase.auth.getClaims()` and pass the result
through the phase-3 resolver to set `context.locals.role`. Both the Supabase-unconfigured branch and
any validation failure set it to `null`. Preserve the existing null-client handling — it is
load-bearing for CI builds with no secrets.

#### 4. Unit tests

**File**: `src/lib/roles.test.ts` (new)

**Contract**: Cover a valid `admin` claim, a valid `elektryk` claim, an absent claim, an unknown
string, and a non-string value — the last three must all resolve to `null`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- No unsafe-`any` lint violations from reading the claim: `npm run lint`
- Type checking passes: `npx astro check`
- Production build succeeds with no Supabase env vars set: `npm run build`
- Existing auth flow still passes end to end: `npm run smoke`

#### Manual Verification:

- Signing in locally as the seeded admin and as a self-registered user yields the expected role on each request, verified with a temporary log removed before commit

---

## Phase 4: Role gating and admin surface

### Overview

Turn the gate on: role-aware route protection, an `/admin` page, role-specific landing after sign-in,
and the Polish copy all of it needs.

### Changes Required:

#### 1. Role-aware route protection

**File**: `src/middleware.ts`

**Intent**: Replace the flat list of protected paths with a path-to-required-role mapping, so
`/dashboard` is electrician-only and `/admin` is admin-only.

**Contract**: `PROTECTED_ROUTES` becomes a prefix-to-roles structure, keeping the existing `startsWith`
matching semantics so `/dashboard/*` stays covered. Three outcomes: not signed in → `/auth/signin` as
today; signed in with the wrong role → the other role's home; signed in with no recognised role → `/`
carrying an error code. Gate new pages by adding an entry here, never by checking inside the page.

#### 2. Admin page

**File**: `src/pages/admin/index.astro` (new)

**Intent**: Give the admin role a real destination and prove the gate works end to end.

**Contract**: A heading and a short description, both from `pl.ts`. No catalog UI — `S-01` and `S-02`
own that.

#### 3. Role-aware sign-in redirect

**File**: `src/pages/api/auth/signin.ts`

**Intent**: Send each role to its own home instead of always `/`.

**Contract**: After a successful `signInWithPassword`, resolve the role from the freshly issued token
and redirect to `/admin` for an admin, `/` otherwise. Keep the existing error-redirect shape — errors
still travel as `?error=<code>`, never as a Supabase message.

#### 4. Polish copy and the roleless error

**File**: `src/lib/i18n/pl.ts`, `src/lib/auth-errors.ts`

**Intent**: Every new user-facing string goes through the catalog, and the no-role case reuses the
established error-code pattern rather than inventing a second one.

**Contract**: Add admin page and navigation keys under the existing structure, plus an `authErrors`
entry for the roleless case mapped from a new code in `auth-errors.ts`. Nothing user-facing is inlined
in a component.

#### 5. Gate assertions in the smoke script

**File**: `scripts/smoke.mjs`

**Intent**: Make the one existing end-to-end check aware that routes now have roles.

**Contract**: Extend the step list: a self-registered user is redirected away from `/admin`, and the
seeded admin reaches `/admin` but is redirected off `/dashboard`. Keep the existing assertion shape —
status code plus `location` prefix — and keep every current step passing.

#### 6. Unit tests for the gate predicate

**File**: colocated test beside the extracted helper (new)

**Contract**: Extract the route-matching decision into a pure function if it is not already one, and
cover: no user, right role, wrong role, no role, and an unprotected path.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Integration tests still pass: `npm run test:integration`
- Extended smoke script passes against a local production preview: `npm run smoke`
- Lint, type check and build pass: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- Signed in as the seeded admin: `/admin` renders and `/dashboard` redirects to `/admin`
- Signed in as a self-registered electrician: `/dashboard` renders and `/admin` redirects away
- Signed out: both routes redirect to `/auth/signin`
- All new strings render in Polish, including the roleless message
- The same three role checks pass against the deployed Worker after this phase reaches `master`

---

## Phase 5: Documentation sync

### Overview

Bring the repository's own instructions back in line with reality. Two statements in the docs become
false the moment phases 1 and 2 land, and a stale instruction file misleads the next agent more than a
missing one.

### Changes Required:

#### 1. Agent instructions

**File**: `AGENTS.md`

**Intent**: The "There is no test suite" tripwire is now wrong, and three new traps deserve to be
recorded where an agent will read them.

**Contract**: Rewrite the no-test-suite tripwire to describe what the suite does and does not cover,
and note that `smoke.mjs` remains a separate sanity script. Add the new commands to the command table.
Add tripwires for: the claim being `user_role` and never `role`; `supabase config push` being unsafe
because of `site_url`; and role changes being blocked by a database trigger rather than by application
code.

#### 2. Infrastructure boundary

**File**: `context/foundation/infrastructure.md`

**Intent**: The approval boundary at lines 208-212 reserves applying migrations to a human. That is no
longer true, and leaving it would make the document contradict the pipeline.

**Contract**: Amend the agent/human split so migration application is automated on push to `master`,
naming the workflow. Keep reverting migrations human-only — nothing in this change automates that, and
rollback remains code-only.

#### 3. Contributor docs

**File**: `README.md`

**Contract**: Replace the "No database tables or migrations are required" claim, document the test
commands and the local admin seed credentials, and note the one-time cloud hook configuration.

### Success Criteria:

#### Automated Verification:

- Markdown formatting passes the pre-commit path: `npm run format`
- Full CI reproduction passes: `npm run lint && npx astro check && npm run build`

#### Manual Verification:

- `AGENTS.md` no longer contains a statement contradicted by the code, checked by reading the Tripwires and Commands sections end to end
- The roadmap F-01 status flip has been mirrored to GitHub with `node scripts/roadmap-to-github.mjs --apply` under the `Mr1008` account

---

## Testing Strategy

### Unit Tests:

- Claim resolution: valid roles, absent claim, unknown string, wrong type — everything invalid resolves to `null`
- Route gate predicate: no user, correct role, wrong role, no role, unprotected path

### Integration Tests:

- Electrician A cannot read electrician B's profile row (zero rows, not an error)
- An electrician cannot change their own `role`
- The seeded admin can read every profile
- A signed-in user's JWT actually contains `user_role` — the only direct proof the hook is live
- Deleting an `auth.users` row cascades the profile away

### Manual Testing Steps:

1. `npx supabase db reset`, then sign in as the seeded admin and confirm `/admin` renders and `/dashboard` redirects to it
2. Register a new user through the UI and confirm they land on `/`, reach `/dashboard`, and are refused at `/admin`
3. Inspect a cloud-issued JWT after sign-in and confirm `user_role` is present — this is what proves the dashboard hook configuration took
4. Attempt to update `profiles.role` as a signed-in electrician through the Supabase client and confirm the trigger rejects it

## Performance Considerations

`infrastructure.md:128` records that Cloudflare's 10ms CPU ceiling excludes time awaiting I/O, so a
Supabase round-trip costs nothing against the budget. The claim approach was chosen partly to avoid a
per-request profile query, but that benefit is conditional: with the legacy symmetric signing secret
(`config.toml:162`) `getClaims()` cannot verify locally and calls the Auth server, making its cost
comparable to the `getUser()` call already there. Treat the request cost as unchanged rather than
improved unless asymmetric signing keys are enabled.

## Migration Notes

The backfill assigns `elektryk` to every pre-existing user, which is why deleting the production
`smoke-*` accounts is a phase 1 manual gate rather than a cleanup afterthought. Every statement in the
migration is written to be re-runnable, because `wrangler rollback` reverts code only — if this change
has to be undone, the schema stays and a forward migration removes it.

## References

- Roadmap item: `context/foundation/roadmap.md` → `F-01: Role i izolacja danych elektryka`, issue #1
- Change identity: `context/changes/roles-and-rls-baseline/change.md`
- Key constraint on the Supabase key choice: `context/changes/deployment/deployment-plan.md:138-143`
- Rollback and approval boundary: `context/foundation/infrastructure.md:205-212`
- Existing request path: `src/middleware.ts:7-24`, `src/lib/supabase.ts:5-21`
- Error-code pattern to follow: `src/lib/auth-errors.ts:17-32`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Database foundation and migration pipeline

#### Automated

- [x] 1.1 Local stack rebuilds from scratch with the migration and seed applied
- [x] 1.2 The seeded admin's profile carries the admin role
- [x] 1.3 Repo checks still pass unchanged
- [x] 1.4 The existing auth flow is unbroken by the trigger

#### Manual

- [x] 1.5 The two leftover smoke-\* users are deleted from the production project before the backfill reaches it
- [x] 1.6 SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD are set as repository secrets
- [ ] 1.7 The access-token hook is enabled by hand in the cloud dashboard
- [ ] 1.8 A fresh cloud sign-in yields a JWT containing user_role
- [ ] 1.9 The db-migrate workflow run is green and the cloud project shows the profiles table

### Phase 2: Test harness and RLS integration tests

#### Automated

- [ ] 2.1 Unit config runs with no database available
- [ ] 2.2 Integration tests pass against a freshly reset local stack
- [ ] 2.3 Both new configs and the test files lint clean
- [ ] 2.4 Type checking still passes

#### Manual

- [ ] 2.5 Deliberately disabling one policy locally makes the corresponding test fail

### Phase 3: Claim plumbing

#### Automated

- [ ] 3.1 Unit tests pass
- [ ] 3.2 No unsafe-any lint violations from reading the claim
- [ ] 3.3 Type checking passes
- [ ] 3.4 Production build succeeds with no Supabase env vars set
- [ ] 3.5 Existing auth flow still passes end to end

#### Manual

- [ ] 3.6 Signing in as the seeded admin and as a self-registered user yields the expected role on each request

### Phase 4: Role gating and admin surface

#### Automated

- [ ] 4.1 Unit tests pass
- [ ] 4.2 Integration tests still pass
- [ ] 4.3 Extended smoke script passes against a local production preview
- [ ] 4.4 Lint, type check and build pass

#### Manual

- [ ] 4.5 Signed in as the seeded admin: /admin renders and /dashboard redirects to /admin
- [ ] 4.6 Signed in as a self-registered electrician: /dashboard renders and /admin redirects away
- [ ] 4.7 Signed out: both routes redirect to /auth/signin
- [ ] 4.8 All new strings render in Polish, including the roleless message
- [ ] 4.9 The same three role checks pass against the deployed Worker

### Phase 5: Documentation sync

#### Automated

- [ ] 5.1 Markdown formatting passes the pre-commit path
- [ ] 5.2 Full CI reproduction passes

#### Manual

- [ ] 5.3 AGENTS.md no longer contains a statement contradicted by the code
- [ ] 5.4 The roadmap F-01 status flip has been mirrored to GitHub
