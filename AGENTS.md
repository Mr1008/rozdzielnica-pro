# Repository Guidelines

**RozdzielnicaPro** — a switchboard (rozdzielnica) planning and labour-quoting tool for a solo
electrician. Scaffolded from `10x-astro-starter`. Product code so far is auth, i18n, the role/RLS
baseline, the admin cabinet and device catalogs, the electrician pricing profile and projects (cabinet
snapshot, OSD/WLZ supply and its warnings) — `src/pages/auth/*`, `src/pages/admin/` (including
`src/pages/admin/devices/`), `src/pages/api/admin/`, `src/pages/dashboard.astro`,
`src/pages/dashboard/profile.astro`, `src/pages/dashboard/projects/`, `src/pages/api/profile/`,
`src/pages/api/projects/`, `src/components/cabinets/`, `src/components/devices/`,
`src/components/forms/`, `src/components/projects/`, most of `src/lib/`, and all of `supabase/`. The rest is still starter code.

Product spec: @context/foundation/prd.md · Stack rationale: @context/foundation/tech-stack.md ·
Setup/deploy: @README.md

## Domain rules (from the PRD)

These are correctness requirements, not preferences.

- **Two roles.** `admin` maintains the device and cabinet catalogs and must never see projects or
  client data. `elektryk` sees only their own projects.
- **Never propose a device that fails the circuit's parameters.** Pick the cheapest device that
  _does_ satisfy them. If nothing in the catalog matches, raise an error telling the user to contact
  the admin — a catalog gap. Silently downgrading to an under-rated device is the single worst
  failure this product can have.
- **Layout heuristic, three rules applied together:** (1) a group's MCBs sit next to its RCD — and a
  single-circuit RCD group becomes one RCBO instead of two devices; (2) place the group near the
  cabinet side its cables enter from; (3) account for distance to the PE and N bars. This is a
  deliberate heuristic, not an optimiser. Their precedence when they conflict is an open question in
  the PRD — if you have to pick one, say so explicitly rather than burying the choice.
- **MVP device types are closed:** switch-disconnectors ("FR", no fuse links), RCD, RCBO, type-B
  MCBs, PE bars, N bars. Nothing else.
- **One project = one cabinet.** Single-phase and three-phase installations are both in scope.
- **Quote:** (device count × average mount time per device) + fixed per-project overhead = hours;
  hours × hourly rate = labour cost; catalog prices = material cost. Mount time, rate and overhead
  are electrician _profile_ fields, not catalog or global constants.

## Tripwires

- **The test suite is unit + RLS-integration only — it covers no HTTP.** `npm run test:unit`
  (Vitest, `src/**/*.test.ts`) needs no infrastructure and runs in CI; `npm run test:integration`
  (`tests/integration/**`) asserts the RLS policies against a **live local Supabase** and is
  local-only. `npm test` runs both, so it fails on any machine with no stack running — never wire it
  into a git hook or a database-less CI job; use `test:unit` there. Neither suite exercises the
  Cloudflare adapter or the real auth flow: `scripts/smoke.mjs` remains the separate,
  dependency-free script that does. Never report a bare "tests pass" — say which of lint /
  `astro check` / `test:unit` / `test:integration` / build / smoke you actually ran.
- **`npm run smoke` needs a running server AND a reachable Supabase with email confirmation
  disabled.** It signs a user up for real, and its role-gate steps sign in as the admin seeded by
  `supabase/seed.sql`. It fails against an unconfigured or unseeded instance. **Turning
  `enable_confirmations` on breaks it** — the script signs a user up and immediately signs them in,
  which a confirmation requirement refuses. Enabling confirmation therefore means reworking
  `smoke.mjs` first: sign in as the seeded admin (already `email_confirmed_at`-stamped) or confirm
  the new account through the local Mailpit API. Deliberately parked until the end of the MVP — see
  `## Parked` in @context/foundation/roadmap.md.
- **The role claim is `user_role`, never `role`.** Supabase's own `role` claim is required and holds
  `authenticated`/`anon` — PostgREST switches database roles on it, so overwriting or reading it
  instead resolves every signed-in user to "no recognised role". The claim is minted by
  `public.custom_access_token_hook` and narrowed in exactly one place, @src/lib/roles.ts.
- **A role change does not take effect until the user's next token.** `is_admin()` and the
  role-change trigger both read the `user_role` claim baked into the access token, never the live
  `profiles.role`. So a demoted admin keeps admin power — including the ability to set their own
  role back — until their token expires (`jwt_expiry`, 3600s). Accepted for now because nothing in
  the app demotes anyone: there is no user-management UI, and role changes happen by direct SQL.
  **Whoever builds one must invalidate the session** (`supabase.auth.admin.signOut(userId, 'global')`
  or equivalent) as part of the demotion, or the guard is decorative for an hour.
- **A profile's `role` is guarded by a database trigger, not by application code.**
  `public.enforce_role_change_is_admin()` (BEFORE UPDATE on `public.profiles`) raises SQLSTATE
  `42501` on any non-admin role change, because RLS grants row access but not column access. Do not
  answer a 42501 by loosening something in TypeScript.
- **Cabinet `geometry` is validated only by `parseCabinetGeometry`** in
  @src/lib/cabinet-geometry.ts. The database CHECK asserts nothing but an object at `version: 1`, so
  every write of `cabinets.geometry` — endpoint, seed, migration — must go through it (the editor's
  endpoints do, via `parseCabinetForm`); never write the column around it.
  `projects.cabinet_geometry` has no TypeScript writer at all: only the `projects_snapshot_cabinet`
  trigger writes it, copying a `cabinets.geometry` that has already passed the parser.
- **Device parameters are guarded twice, and the two guards must change together.** The
  `devices_parameters_match_kind` CHECK in `supabase/migrations/20260923130628_devices_catalog.sql`
  and `parseDeviceSpec` in @src/lib/device-spec.ts (`POLES_BY_KIND`, `PARAMETERS_BY_KIND`, the
  decimal scales) encode the same per-kind rules; a migration that changes one without the other
  lets the editor accept rows the database refuses, or the reverse. `parseDeviceSpec` also rejects
  extra decimal places because `numeric` columns would round them silently. An FR is a plain
  switch-disconnector — a rated current and poles, no protection — so the matcher must never treat
  it as overcurrent or residual-current protection.
- **Pricing bounds are guarded twice, and the two guards must change together.** The named CHECKs
  in `supabase/migrations/20260924120000_pricing_profiles.sql` and the `MIN_`/`MAX_` constants in
  @src/lib/pricing-profile.ts (plus `MAX_PRICE_GROSZE` for the rate) encode the same ranges. The
  table is `pricing_profiles`, not a column on `profiles`, because `profiles` has admin policies.
  **No row means "not configured"** — that is the contract S-08 reads: it must block and send the
  electrician to `/dashboard/profile`, never fall back to invented defaults.
- **A project must snapshot its cabinet's `geometry`, not reference it live** (S-03). Admin edits to
  a cabinet must never shift an existing project's layout or quote; archiving only hides the cabinet
  from the picker. The snapshot (`cabinet_geometry`, `cabinet_name`, `cabinet_manufacturer`,
  `cabinet_model`, `cabinet_price_grosze`) is written **only** by the `projects_snapshot_cabinet`
  trigger in `supabase/migrations/20260924150000_projects.sql`: it re-snapshots when `cabinet_id`
  changes and otherwise resets those columns, so client-sent values are ignored. Send `cabinet_id`
  alone; never write the snapshot columns from TypeScript. Downstream slices read the snapshot, never
  `cabinets.geometry`.
- **Supply value lists are guarded twice, and the two guards must change together.** The CHECKs and
  enums on the seven supply columns in `supabase/migrations/20260924150000_projects.sql` and the lists
  in @src/lib/supply-params.ts encode the same values (the enum unions are asserted against
  `database.types.ts`; the numeric lists are not). **A null supply means "not configured"** — the
  seven columns are all set or all null (`projects_supply_all_or_nothing`), and that is the contract
  S-04 reads: it must block and send the electrician to the project page, never fall back to
  invented defaults. The warnings in @src/lib/supply-warnings.ts are informational and never block a
  save; `AMPACITY_A` is transcribed from PN-HD 60364-5-52 and its completeness test must keep every
  combination present.
- **Never run `supabase config push`.** `supabase/config.toml` carries
  `site_url = "http://127.0.0.1:3000"`, which would break production auth redirects. Migrations reach
  the cloud project through `.github/workflows/db-migrate.yml`; config does not go up at all, and the
  cloud access-token hook is a one-time manual dashboard step (Authentication → Hooks → Customize
  Access Token (JWT) Claims → `public.custom_access_token_hook`).
- **`supabase db reset` does not re-read `config.toml`** — it restarts the containers with their
  existing environment. After any `config.toml` edit, a full `npx supabase stop` then
  `npx supabase start` is required, or GoTrue comes up without the
  `[auth.hook.custom_access_token]` hook and the `user_role` claim is silently absent — which looks
  exactly like a broken SQL function.
- **`supabase link` needs a much wider access-token scope than `db push`** — it reads a bundle of
  project-config endpoints, and the failure is an opaque
  `Authorization failed for the access token and project ref pair` that names no endpoint. The
  `SUPABASE_ACCESS_TOKEN` secret behind `.github/workflows/db-migrate.yml` must cover those config
  reads, not just Migrations and Database.
- **`createClient()` returns `null` when Supabase env vars are unset** — they are declared
  `optional: true` in `astro.config.mjs`, so the app boots and builds without them. Every call site
  must handle the null branch (see @src/middleware.ts and @src/pages/api/auth/signin.ts). Do not
  "simplify" it away with a non-null assertion; CI builds with no secrets and relies on this.
- **No server-side PDF rendering.** The Cloudflare edge runtime cannot do it, so the printable quote
  must use browser print or client-side PDF generation. This constraint drove the stack choice.
- **The Worker `rozdzielnica-pro` is deployed — renaming it now creates a _second_ Worker.**
  `package.json` and `wrangler.jsonc` both carry `name: "rozdzielnica-pro"`, live at
  `rozdzielnica-pro.rozdzielnica-pro.workers.dev`. Changing the `wrangler.jsonc` name orphans the
  existing Worker and its `SESSION` KV namespace rather than renaming them. See
  @context/changes/deployment/deployment-plan.md.
- **Do not unwrap `fixupPluginRules(pluginReact)` in `eslint.config.js`, or drop the `overrides`
  block in `package.json`.** Both exist because `eslint-plugin-react` / `eslint-plugin-jsx-a11y` do
  not yet support ESLint 10. Removing either breaks `npm run lint`.
- **UI is Polish, code is English.** Every user-facing string — labels, validation and error
  messages, the printed quote — is Polish, as is domain vocabulary (obwód, rozdzielnica,
  wyłącznik różnicowoprądowy, szyna PE/N). Identifiers, comments, commit messages and
  translation keys stay English. **Never inline user-facing text in a component** — add a key to
  @src/lib/i18n/pl.ts and read it via `import { t } from "@/lib/i18n"`, which works unchanged in
  `.astro` frontmatter and in React islands (no provider, no context). MVP ships one locale, `pl`;
  the requirement is that nothing _blocks_ a second one, not that a second one exists — `pl.ts` is
  deliberately not `as const` so a future `en.ts` typed `Messages` fails `astro check` if a key is
  missing. Use `plural()` for counts (Polish has three integer forms: 1 aparat / 2 aparaty /
  5 aparatów) and `formatMoney` / `formatDate` from the same module rather than hand-rolled
  formats. Full wording: @context/foundation/prd.md `## Non-Functional Requirements`.
- **Never surface a third-party error message to the user.** Supabase returns English prose in
  `error.message`. The auth API routes redirect with `error.code` instead, and the page maps it to
  Polish via `authErrorMessage` in @src/lib/auth-errors.ts; an unmapped code still reaches the URL
  so it stays diagnosable, while the user sees a generic message. Follow that shape for any new
  third-party failure.
- **Every change to @context/foundation/roadmap.md must be mirrored to GitHub** with
  `node scripts/roadmap-to-github.mjs --apply` — a regenerated milestone, a status flip, a new
  slice, anything. The roadmap file stays the contract the `/10x-plan` → `/10x-implement` →
  `/10x-archive` chain reads by `Change ID`; the issues, milestone and Projects board at
  `users/Mr1008/projects/1` are where the work is actually tracked. Skip the sync and the board
  silently disagrees with the plan. The script is idempotent, reconciles labels in both directions
  and plans by default (no `--apply` = no writes). It needs the **`Mr1008`** gh account — the
  `jakubmichalek-cambridge` account has read-only access and the script refuses to run under it;
  use `gh auth switch --user Mr1008` or a one-shot
  `GH_TOKEN=$(gh auth token --user Mr1008)` prefix.

## Architecture

Astro 7 SSR (`output: "server"`) + React 19 islands + Tailwind 4 + Supabase auth, on Cloudflare
Workers.

**Request path:** `src/middleware.ts` runs on every request → builds a Supabase SSR client from the
request headers and `AstroCookies` → resolves `context.locals.user` and `context.locals.role` (both
typed in `src/env.d.ts`) → applies the verdict of `resolveRouteAccess`. Which roles may reach which
paths lives in @src/lib/route-access.ts, not in the middleware: gate a new page by adding an entry
to `PROTECTED_ROUTES` there, never by checking auth or the role inside the page. The redirect
targets in `ROLE_HOME` must each be reachable by their own role, or two gated routes bounce forever
— `route-access.test.ts` asserts that invariant.

**Secrets** are declared in the `astro.config.mjs` `env.schema` as `context: "server", access:
"secret"` and imported from `astro:env/server` — never `import.meta.env`, and never in client code.

**Auth API routes** (`src/pages/api/auth/*.ts`) take `FormData`, not JSON, and report errors by
redirecting back with an `?error=` query param — they do not return JSON error bodies. Follow that
shape for new form endpoints so the existing forms keep working.

## Conventions

- Path alias `@/*` → `./src/*`.
- `.astro` for static content and layout; React only where interactivity is required. No Next.js
  directives (`"use client"`).
- Compose Tailwind classes with `cn()` from `@/lib/utils` — never string concatenation.
- shadcn/ui ("new-york") lives in `src/components/ui/`; add with `npx shadcn@latest add <name>`.
- ESLint is `strictTypeChecked` + `stylisticTypeChecked`: no floating promises, no unsafe `any`,
  `no-console` warns, `astro/no-set-html-directive` errors. Prefix intentionally unused bindings
  with `_`.
- Feature helpers go in `src/lib/`. A **new** one should ship with its unit test beside it
  (`roles.ts` / `roles.test.ts` is the pattern to copy) — this is forward guidance, not a
  description: the helpers that predate the test suite have none. `tests/integration/` is reserved
  for the suite that needs a live database. `src/types.ts` and `src/components/hooks/` do **not**
  exist yet — create them under those names if you need them.
- New Supabase tables: migration named `YYYYMMDDHHmmss_short_description.sql`, RLS enabled, with
  granular per-operation, per-role policies. Per-electrician isolation is a stated requirement, so
  RLS is the enforcement point, not application code.
- All datetimes should be stored and processed in UTC. Local timezone should be applied only to end-user.

## Commands

| Command                              | Notes                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npm run dev`                        | Dev server on the Cloudflare `workerd` runtime, not plain Node                                |
| `npm run build`                      | SSR build via `@astrojs/cloudflare`                                                           |
| `npm run preview`                    | Serves the production build                                                                   |
| `npm run lint` / `lint:fix`          | ESLint, type-checked. Prettier runs _as an ESLint rule_ — lint failures include formatting    |
| `npm run format`                     | Prettier over the whole repo. `.prettierignore` keeps `.claude/` and `.agents/` out           |
| `npm run test:unit`                  | Vitest over `src/**/*.test.ts`. No infrastructure; CI runs it                                 |
| `npm run test:integration`           | Vitest over `tests/integration/**`. Needs a running local Supabase                            |
| `npm test`                           | Both suites — fails with no local Supabase running. See Tripwires                             |
| `npm run smoke`                      | Auth-flow script; `BASE_URL` defaults to `http://localhost:4321`                              |
| `npx astro check`                    | Type-checks `.astro` files — CI runs it, `npm run lint` does not                              |
| `npm run db:types`                   | Regenerates the committed `src/lib/database.types.ts` from the local stack after a migration  |
| `node scripts/roadmap-to-github.mjs` | Mirrors the roadmap to GitHub issues/board. Plans by default; `--apply` writes. See Tripwires |

To reproduce the CI `ci` job locally:
`npm run lint && npx astro check && npm run test:unit && npm run build`. The RLS assertions in
`npm run test:integration` are not in CI and have to be run by hand against a local stack.

Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on
`*.{json,css,md}`. Hooks install via the `prepare` script on `npm ci`.

## Environment

Node 24.21.0 (`.nvmrc`). `SUPABASE_URL` and `SUPABASE_KEY` go in **both** `.env` (Node tooling) and
`.dev.vars` (Cloudflare local dev) — both gitignored. Local stack: `npx supabase start` (Docker,
~7 GB), which applies `supabase/migrations/` and `supabase/seed.sql`. The seed is **local and CI
only** — `supabase db push` carries migrations, never seeds. Deploy: `npx wrangler deploy`, with
secrets set via `npx wrangler secret put`.

CI (on `master`): `.github/workflows/ci.yml` job `ci` = lint + `astro check` + `test:unit` + build;
job `smoke` spins up a local Supabase and runs the smoke script against the production preview.
Both pass with no repository secrets configured. `.github/workflows/db-migrate.yml` applies pending
migrations to the cloud project on the same push and **does** need secrets —
`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`. It races the Cloudflare
deploy with no ordering between them, which is only safe while every migration stays
forward-compatible.
