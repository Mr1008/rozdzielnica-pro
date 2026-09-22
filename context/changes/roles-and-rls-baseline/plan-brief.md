# Roles and RLS Baseline — Plan Brief

> Full plan: `context/changes/roles-and-rls-baseline/plan.md`

## What & Why

RozdzielnicaPro has two roles in its product spec — `admin` maintains the catalogs, `elektryk` owns
projects — but the code knows neither. Every signed-in user is identical, and the PRD's hard
requirement that an electrician's projects are visible only to them has no enforcement point
anywhere. This is roadmap item **F-01**: the foundation that makes the two roles real and puts data
isolation in the database, where it cannot be forgotten by a future query.

## Starting Point

Supabase email/password auth works. `src/middleware.ts` resolves the user once per request into
`context.locals.user`, and exactly three files read it — only ever the `.email` field. Below that
there is nothing at all: no migrations directory, no SQL anywhere in the repo, no RLS, no `zod`, and
no test suite. Production runs against a hand-created cloud Supabase project that this repository has
never been linked to, and two leftover `smoke-*@example.com` accounts still sit in its `auth.users`
table.

## Desired End State

An electrician signs in and lands on `/`; their JWT carries `user_role: "elektryk"`, they can open
`/dashboard`, and `/admin` turns them away. An admin lands on `/admin` and is redirected off
`/dashboard`. In the database, one electrician selecting another's profile row gets nothing back, and
no electrician can change their own role by any route. The cloud database picks the schema up
automatically on push to `master`.

## Key Decisions Made

| Decision         | Choice                                             | Why (1 sentence)                                                                                             |
| ---------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Role storage     | Custom `user_role` JWT claim via access-token hook | RLS policies read the claim directly from `auth.jwt()`, so no policy ever has to query the profile table.    |
| Profile creation | `SECURITY DEFINER` trigger on `auth.users`         | Covers both account paths the PRD allows — self-registration and admin-created — and cannot be bypassed.     |
| Profile columns  | `id`, `role`, `full_name`, timestamps              | Minimal per the roadmap's F-01 warning, plus a display name so the UI can stop printing raw email addresses. |
| Admin bootstrap  | `seed.sql` locally, documented SQL for cloud       | Local dev and CI come up with a working admin; production stays a deliberate human action.                   |
| Missing claim    | Fail closed — no claim means no capability         | An unconfigured hook can never silently grant access; the failure is loud at the first gated route.          |
| Gate scope       | Route gating plus a minimal `/admin` page          | Proves the claim actually gates something inside this change, and gives S-01/S-02 a route to build on.       |
| Profile RLS      | Self-access, plus admin read/write                 | Supports the PRD's admin-creates-accounts path; a trigger separately blocks anyone changing their own role.  |
| Cloud delivery   | Automated `supabase db push` from GitHub Actions   | Keeps production in step with `master` instead of relying on someone remembering to run a migration.         |
| Existing users   | Delete production smoke users, then backfill       | The backfill would otherwise hand the electrician role to two abandoned test accounts.                       |
| Role landing     | Role-specific home with cross-redirects            | Keeps "admin never sees projects" true once `/dashboard` actually shows project data.                        |
| Verification     | Vitest unit and RLS integration tests, split       | HTTP checks cannot observe an RLS denial, so only database-level tests can prove the boundary holds.         |

## Scope

**In scope:** the `profiles` table and its RLS policies; the `user_role` enum; the signup trigger and
role-change guard; the access-token hook and its grants; local admin seeding; automated migration
delivery to the cloud; claim resolution in middleware; role-aware route gating; a minimal `/admin`
page; the repo's first Vitest suite; documentation sync.

**Out of scope:** device, cabinet and project tables (S-01 to S-05); pricing fields on the profile
(S-07); any real admin catalog UI; changes to email confirmation; `supabase config push`; renaming the
stale `project_id` in `config.toml`; replacing `scripts/smoke.mjs`.

## Architecture / Approach

A Postgres hook runs at token issue, reads the user's role from `profiles`, and stamps it into the JWT
as `user_role`. From there the claim is the single source of truth in two directions: middleware reads
it through a `zod` guard to populate `locals.role` for route gating, and RLS policies read it through
an `is_admin()` helper to decide row access. Because policies never query `profiles` to authorise
access to `profiles`, the usual recursive-policy problem does not arise. Migrations reach the local
stack through `supabase start`, and the cloud project through a new GitHub Actions job.

## Phases at a Glance

| Phase                          | What it delivers                                             | Key risk                                                                     |
| ------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1. Database foundation         | Migration, trigger, policies, hook, seed, migration pipeline | A failing signup trigger breaks account creation and the smoke script        |
| 2. Test harness + RLS tests    | Vitest split configs, CI wiring, isolation proven            | Tests that pass vacuously and prove nothing                                  |
| 3. Claim plumbing              | Validated `user_role` on `locals.role`                       | The `any`-typed claim colliding with `strictTypeChecked` lint rules          |
| 4. Role gating + admin surface | Gated routes, `/admin`, role-aware landing, Polish copy      | Fail-closed gating locking users out if the cloud hook is not yet configured |
| 5. Documentation sync          | `AGENTS.md`, `infrastructure.md`, `README.md` made true      | Low — but skipping it leaves instructions that actively mislead              |

**Prerequisites:** Docker for the local Supabase stack; the `Mr1008` GitHub account for the roadmap
mirror; owner access to the cloud Supabase project for the dashboard hook step and the database
password; and permission to add repository secrets.

**Estimated effort:** roughly 3-5 sessions across five phases, with phase 1 the longest because of its
four manual gates.

## Open Risks & Assumptions

- **The hook must be configured by hand in the cloud dashboard.** `supabase config push` would carry
  the local `site_url` (`http://127.0.0.1:3000`) to production and break auth redirects, so it is
  deliberately not automated — which leaves a step nothing in CI can verify.
- **Automating `db push` supersedes a recorded boundary.** `infrastructure.md:208-212` reserves
  applying migrations to a human; phase 5 amends it. Reverting a migration stays human-only.
- **The performance argument for JWT claims is conditional.** With the local stack's legacy symmetric
  signing secret, `getClaims()` still calls the Auth server, so assume request cost is unchanged rather
  than improved.
- **Role changes take up to `jwt_expiry` (3600s) to take effect** — an inherent consequence of putting
  the role in the token. Promoting a user does not affect their current session.
- **PRD Open Question #1 is still open.** Admin acceptance criteria are undefined, so `/admin` is a
  placeholder and the role-to-route map is a plan-level choice, not a product decision.
- **Migration and code deploy race each other** on every push to `master`, because GitHub Actions and
  Workers Builds are independent. Forward-compatible statements and the phase ordering are what make
  that safe.

## Success Criteria (Summary)

- An electrician cannot reach any admin surface, and an admin cannot reach the electrician dashboard —
  verified over HTTP and by hand against the deployed Worker.
- One electrician cannot read another's row, proven mechanically by integration tests against a real
  database rather than asserted in prose.
- A new account gets a profile and a working role automatically, whether it was self-registered or
  created by an admin.
