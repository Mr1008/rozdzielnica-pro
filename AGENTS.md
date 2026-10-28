# Repository Guidelines

**RozdzielnicaPro** — a switchboard (rozdzielnica) planning and labour-quoting tool for a solo
electrician, on Astro + React + Supabase + Cloudflare Workers. Product spec:
`context/foundation/prd.md` · Stack rationale: `context/foundation/tech-stack.md` · Setup, routes,
module map and deploy: `README.md`.

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
  deliberate heuristic, not an optimiser. Precedence when they conflict is decided (2026-10-06): 1 > 2 > 3,
  recorded in the header of `src/lib/cabinet-layout.ts` — change it there, explicitly, never by tuning a score.
- **MVP device types are closed:** switch-disconnectors ("FR", no fuse links), RCD, RCBO, type-B
  MCBs, 1F/3F comb busbars ("listwy zasilające", added 2026-10-09 to feed an RCD group's MCBs; `comb_busbar`, 1P = 1F, 3P = 3F, length in pins = width / 17.5 mm), PE bars, N bars. Nothing else.
- **One project = one cabinet.** Single-phase and three-phase installations are both in scope.
- **Quote:** (device count × average mount time per device) + fixed per-project overhead = hours;
  hours × hourly rate = labour cost; catalog prices = material cost. Mount time, rate and overhead
  are electrician _profile_ fields, not catalog or global constants.

## Tripwires

- **The test suite is unit + RLS-integration only — it covers no HTTP.** `npm run test:unit`
  (Vitest, `src/**/*.test.ts`) needs no infrastructure and runs in CI; `npm run test:integration`
  (`tests/integration/**`) asserts the RLS policies and CHECK↔parser parity against a **live local
  Supabase**, so CI runs it only in the `smoke` job, which starts one. `npm test` runs both, so it
  fails on any machine with no stack running — never wire it into a git hook or a database-less CI
  job; use `test:unit` there. A new public table fails `tests/integration/rls-coverage.test.ts` until
  it is classified there and has its RLS suite. Neither suite exercises the
  Cloudflare adapter or the real auth flow: `scripts/smoke.mjs` remains the separate,
  dependency-free script that does. Never report a bare "tests pass" — say which of lint /
  `astro check` / `test:unit` / `test:integration` / build / smoke you actually ran.
- **UI is Polish, code is English.** Every user-facing string — labels, validation and error
  messages, the printed quote — is Polish, as is domain vocabulary (obwód, rozdzielnica,
  wyłącznik różnicowoprądowy, szyna PE/N). Identifiers, comments, commit messages,
  translation keys and **project documents** (`context/**`, `README.md`, rule files) stay English
  (decided 2026-10-27; Polish domain terms may appear in them as vocabulary). Docs still in Polish
  (`prd.md`, parts of `test-plan.md`) are translated when next edited — never add Polish prose. **Never inline user-facing text in a component** — add a key to
  `src/lib/i18n/pl.ts` and read it via `import { t } from "@/lib/i18n"`, which works unchanged in
  `.astro` frontmatter and in React islands (no provider, no context). MVP ships one locale, `pl`;
  the requirement is that nothing _blocks_ a second one, not that a second one exists — `pl.ts` is
  deliberately not `as const` so a future `en.ts` typed `Messages` fails `astro check` if a key is
  missing. Use `plural()` for counts (Polish has three integer forms: 1 aparat / 2 aparaty /
  5 aparatów) and `formatMoney` / `formatDate` from the same module rather than hand-rolled
  formats. Full wording: `context/foundation/prd.md` `## Non-Functional Requirements`.
- **Never surface a third-party error message to the user.** Supabase returns English prose in
  `error.message`. The auth API routes redirect with `error.code` instead, and the page maps it to
  Polish via `authErrorMessage` in `src/lib/auth-errors.ts`; an unmapped code still reaches the URL
  so it stays diagnosable, while the user sees a generic message. Follow that shape for any new
  third-party failure.
- **Every failure gets a log record, through one module.** Server code logs with `logServerError` /
  `logServerWarn` / `logServerInfo` from `src/lib/server-log.ts` (one flat record with `projectId` /
  `userId`, never `details`, never an email) — not a bare `console.*`. Browser code reports with
  `reportClientError` (`src/lib/client-error-reporter.ts`) to the signed-in `POST /api/client-errors`.
  Workers Logs is the only sink; there is no third-party tracker.
- **`createClient()` returns `null` when Supabase env vars are unset** — they are declared
  `optional: true` in `astro.config.mjs`, so the app boots and builds without them. Every call site
  must handle the null branch (see `src/middleware.ts` and `src/pages/api/auth/signin.ts`). Do not
  "simplify" it away with a non-null assertion; CI builds with no secrets and relies on this.
- **No server-side PDF rendering.** The Cloudflare edge runtime cannot do it, so the printable quote
  must use browser print or client-side PDF generation. This constraint drove the stack choice.

### Area tripwires

The rest of the tripwires live in `context/foundation/agent-rules/`, one file per area — the single
copy of each rule. **Before reading or editing a file that matches an area's patterns, read that
area's rule file.** Claude Code does this by itself: each `.claude/rules/<area>.md` carries the same
patterns as `paths:` and imports the rule file. The patterns below mirror those `paths:` lists —
change both together.

- **`data-guards.md`** — "guarded twice" CHECK/parser pairs, trigger-written snapshots, the cabinet
  geometry parser. Patterns: `supabase/migrations/**`, `supabase/seed.sql`,
  `src/lib/database.types.ts`, `src/lib/cabinet-geometry.ts`, `src/lib/cabinet-form.ts`,
  `src/lib/device-spec.ts`, `src/lib/supply-*.ts`, `src/lib/circuit-params.ts`,
  `src/lib/pricing-profile.ts`, `src/lib/business-profile.ts`, `src/lib/quote.ts`,
  `src/lib/device-matching-server.ts`, `src/pages/api/**`, `tests/integration/**`.
- **`matching-quote.md`** — device matching, the quote, the printout, the labour override. Patterns:
  `src/lib/device-matching*.ts`, `src/lib/busbar-cutting.ts`, `src/lib/circuit-*.ts`,
  `src/lib/quote*.ts`, `src/lib/pricing-*.ts`, `src/lib/business-*.ts`,
  `src/pages/dashboard/projects/**`, `src/pages/dashboard/profile.astro`, `src/pages/api/projects/**`,
  `src/pages/api/profile/**`, `src/components/projects/**`, `src/components/circuits/**`,
  `supabase/migrations/*labour_override*.sql`.
- **`layout-wiring.md`** — layout placements and manual edits, catalog PE/N bars, the wiring drawing,
  comb busbars. Patterns: `src/lib/cabinet-*.ts`, `src/lib/layout-*.ts`, `src/lib/wiring-*.ts`,
  `src/lib/wire-dimensions.ts`, `src/lib/busbar-cutting.ts`, `src/lib/din-module.ts`,
  `src/components/projects/**`, `src/components/cabinets/**`, `src/pages/api/projects/**`,
  `scripts/wiring-bench/**`.
- **`auth-roles.md`** — the `user_role` claim, role changes, the role-change trigger. Patterns:
  `src/middleware.ts`, `src/lib/roles.ts`, `src/lib/route-access.ts`, `src/lib/supabase.ts`,
  `src/lib/auth-errors.ts`, `src/pages/auth/**`, `src/pages/api/auth/**`, `src/pages/api/admin/**`,
  `src/pages/admin/**`, `supabase/migrations/**`, `tests/integration/**`.
- **`deploy-tooling.md`** — the smoke script, local Supabase config, CI/deploy, the Worker name,
  ESLint plugin workarounds, the generated production device catalog. Patterns: `wrangler.jsonc`,
  `package.json`, `eslint.config.js`, `astro.config.mjs`, `.github/workflows/**`,
  `supabase/config.toml`, `supabase/seed.sql`, `scripts/smoke.mjs`, `context/changes/deployment/**`,
  `supabase/catalog/**`, `src/lib/catalog-seed.ts`.
- **`roadmap-sync.md`** — every roadmap edit is mirrored to GitHub. Patterns:
  `context/foundation/roadmap.md`, `scripts/roadmap-to-github.mjs`.

## Architecture

**Request path:** `src/middleware.ts` runs on every request → builds a Supabase SSR client from the
request headers and `AstroCookies` → resolves `context.locals.user` and `context.locals.role` (both
typed in `src/env.d.ts`) → applies the verdict of `resolveRouteAccess`. Which roles may reach which
paths lives in `src/lib/route-access.ts`, not in the middleware: gate a new page by adding an entry
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
  RLS is the enforcement point, not application code. Pushing to `master` runs migrations before the
  new code deploys, so every migration must stay **backward-compatible with the deployed code**.
- All datetimes should be stored and processed in UTC. Local timezone should be applied only to end-user:
  `formatDate`/`formatDateTime` require a zone — pass `Astro.locals.timeZone`, which the middleware
  resolves from Cloudflare's `request.cf.timezone` (fallback `Europe/Warsaw`). The Workers runtime
  itself runs in UTC, so an `Intl` formatter without a zone shows the wrong day after 22:00.

## UI

- Tokeny: src/styles/global.css (:root, @theme inline). Nowy kolor = nowy token, nigdy literał.
- Komponenty: src/components/ui. Zanim napiszesz nowy, sprawdź ten katalog; brakujący dodaj z rejestru shadcn.
- Żadnych klas z palety Tailwinda (`text-white`, `bg-blue-500` …), hexów ani `rgba()` w komponentach i stronach — tylko klasy tokenów.
- Każdy nowy stan UI (wariant, komponent, stan pola) najpierw trafia na `/dev/kitchen-sink`.

## Commands

The full script list is in `README.md` `## Scripts`. What it does not say:

- `npm run dev` runs on the Cloudflare `workerd` runtime, not plain Node.
- Prettier runs _as an ESLint rule_ — `npm run lint` failures include formatting. `.prettierignore`
  keeps `.claude/` and `.agents/` out of `npm run format`.
- `npx astro check` type-checks `.astro` files; CI runs it, `npm run lint` does not.
- After a migration, `npm run db:types` regenerates the committed `src/lib/database.types.ts`.
- CI's `ci` job locally: `npm run lint && npx astro check && npm run test:unit && npm run build`.
  `npm run test:integration` runs in the `smoke` job instead; locally, run it against a started stack.

## Environment

Node 24, any 24.x (`.nvmrc` pins the major only). `SUPABASE_URL` and `SUPABASE_KEY` go in **both** `.env` (Node tooling) and
`.dev.vars` (Cloudflare local dev) — both gitignored. Local stack: `npx supabase start` (Docker,
~7 GB), which applies `supabase/migrations/` and `supabase/seed.sql`. The seed is **local and CI
only** — `supabase db push` carries migrations, never seeds. CI and deploy: see
`.claude/rules/deploy-tooling.md`.
