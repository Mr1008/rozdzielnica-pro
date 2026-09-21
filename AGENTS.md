# Repository Guidelines

**RozdzielnicaPro** — a switchboard (rozdzielnica) planning and labour-quoting tool for a solo
electrician. Scaffolded from `10x-astro-starter`; everything outside `src/pages/auth/*` and
`src/lib/supabase.ts` is still starter code, not product code.

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
- **MVP device types are closed:** fuse switch-disconnectors ("FRy"), RCD, RCBO, type-B MCBs, PE
  bars, N bars. Nothing else.
- **One project = one cabinet.** Single-phase and three-phase installations are both in scope.
- **Quote:** (device count × average mount time per device) + fixed per-project overhead = hours;
  hours × hourly rate = labour cost; catalog prices = material cost. Mount time, rate and overhead
  are electrician _profile_ fields, not catalog or global constants.

## Tripwires

- **There is no test suite.** `npm run smoke` is the only end-to-end check and it is a starter
  sanity script, not tests. Never report "tests pass" — say which of lint / `astro check` / build /
  smoke you actually ran.
- **`npm run smoke` needs a running server AND a reachable Supabase with email confirmation
  disabled.** It signs a user up for real. It fails against an unconfigured instance.
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
  translation keys stay English. **Do not inline user-facing text in components** — it comes from
  a dedicated translation module, so adding a locale is a data change rather than a rewrite. MVP
  ships one locale, `pl`; the requirement is that nothing _blocks_ a second one, not that a second
  one exists. Format dates, numbers and PLN amounts through the locale, never a hand-rolled format
  string. `src/lib/config-status.ts` predates this rule and still inlines its Polish — migrate it,
  do not copy it. Full wording: @context/foundation/prd.md `## Non-Functional Requirements`.

## Architecture

Astro 7 SSR (`output: "server"`) + React 19 islands + Tailwind 4 + Supabase auth, on Cloudflare
Workers.

**Request path:** `src/middleware.ts` runs on every request → builds a Supabase SSR client from the
request headers and `AstroCookies` → resolves the user into `context.locals.user` (typed in
`src/env.d.ts`) → redirects to `/auth/signin` if the path matches `PROTECTED_ROUTES`. Gate a new
page by adding its path to that array, not by checking auth inside the page.

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
- Feature helpers go in `src/lib/`. `src/types.ts`, `src/components/hooks/`, `supabase/migrations/`
  and `zod` do **not** exist yet — create them following these names if you need them, and add
  `zod` to `package.json` before importing it.
- New Supabase tables: migration named `YYYYMMDDHHmmss_short_description.sql`, RLS enabled, with
  granular per-operation, per-role policies. Per-electrician isolation is a stated requirement, so
  RLS is the enforcement point, not application code.
- All datetimes should be stored and processed in UTC. Local timezone should be applied only to end-user.

## Commands

| Command                     | Notes                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run dev`               | Dev server on the Cloudflare `workerd` runtime, not plain Node                             |
| `npm run build`             | SSR build via `@astrojs/cloudflare`                                                        |
| `npm run preview`           | Serves the production build                                                                |
| `npm run lint` / `lint:fix` | ESLint, type-checked. Prettier runs _as an ESLint rule_ — lint failures include formatting |
| `npm run format`            | Prettier directly (astro + tailwind plugins)                                               |
| `npm run smoke`             | Auth-flow script; `BASE_URL` defaults to `http://localhost:4321`                           |
| `npx astro check`           | Type-checks `.astro` files — CI runs it, `npm run lint` does not                           |

There is no single-test runner because there are no tests. To reproduce CI locally:
`npm run lint && npx astro check && npm run build`.

Pre-commit (husky + lint-staged) runs `eslint --fix` on `*.{ts,tsx,astro}` and `prettier --write` on
`*.{json,css,md}`. Hooks install via the `prepare` script on `npm ci`.

## Environment

Node 22.14.0 (`.nvmrc`). `SUPABASE_URL` and `SUPABASE_KEY` go in **both** `.env` (Node tooling) and
`.dev.vars` (Cloudflare local dev) — both gitignored. Local stack: `npx supabase start` (Docker,
~7 GB). Deploy: `npx wrangler deploy`, with secrets set via `npx wrangler secret put`.

CI (`.github/workflows/ci.yml`, on `master`): job `ci` = lint + `astro check` + build; job `smoke`
spins up a local Supabase and runs the smoke script against the production preview. Both currently
pass with no repository secrets configured.
