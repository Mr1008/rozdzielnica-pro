# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v7 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v6 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication, Postgres and row-level security
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime
- [Vitest](https://vitest.dev/) - Unit and integration test runner

## Prerequisites

- Node.js v24.21.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run test:unit` - Vitest unit tests (`src/**/*.test.ts`); no database or network required
- `npm run test:integration` - Vitest RLS integration tests (`tests/integration/`); needs a running local Supabase
- `npm test` - Both suites; fails without a local Supabase stack
- `npm run smoke` - Smoke test the auth flow against a running server (`BASE_URL`, defaults to `http://localhost:4321`)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ ├── lib/ # Feature helpers, each with its unit test beside it
│ └── assets/ # Static assets
├── supabase/ # config.toml, migrations/, seed.sql
├── tests/integration/ # Vitest suite that needs a live Supabase stack
├── scripts/ # smoke.mjs and other repo tooling
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. The `supabase/` folder is committed — config, migrations and seed data are all in the repository,
   so there is nothing to initialize.

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:55321
SUPABASE_KEY=<anon key from CLI output>
```

> This project overrides the Supabase CLI's default ports in `supabase/config.toml` — the API is on
> **55321**, not the usual 54321. Take the values from the CLI's own output (or
> `npx supabase status -o env`) rather than from memory.

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:55323`.

### Database, seed data and the local admin account

`supabase start` applies everything in `supabase/migrations/` and then runs `supabase/seed.sql`. `npx supabase db reset` replays both from scratch.

The migrations add a `public.user_role` enum (`admin`, `elektryk`), a `public.profiles` table with row-level security, a signup trigger that gives every new account a profile, and `public.custom_access_token_hook`, which mints the role into each JWT as the `user_role` claim.

The seed creates one working admin account so that admin-gated routes can be exercised without dashboard setup:

```
email:    admin@example.com
password: admin123456
```

The seed is **local and CI only**. `supabase db push` applies migrations, never seeds, so these credentials never reach a cloud project.

> Two traps worth knowing before you touch `supabase/config.toml`:
>
> - `npx supabase db reset` does **not** re-read `config.toml` — it restarts the containers with their existing environment. Any config change (the `[auth.hook.custom_access_token]` block above all) needs a full `npx supabase stop` followed by `npx supabase start`, or the `user_role` claim silently goes missing.
> - `[analytics]` is disabled on purpose. The `supabase_vector` container cannot reach the Docker socket on Windows and restarts in a loop; nothing local uses it, and CI already excludes `logflare,vector` from `supabase start`.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

Migrations reach the cloud project through the `DB migrate` GitHub Actions workflow — see [CI](#ci) below.

#### One-time cloud setup: the access-token hook

The `user_role` JWT claim only exists if the cloud project is told to call the hook function. This is a manual, one-time step in the Supabase dashboard:

**Authentication → Hooks → Customize Access Token (JWT) Claims → enable, Postgres function `public.custom_access_token_hook`**

> Do **not** do this with `supabase config push`. That command would also push `config.toml`'s local `site_url` (`http://127.0.0.1:3000`) to the cloud project and break production auth redirects. Local config stays local.

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                     |
| --------------------- | ----------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                     |
| `/auth/signup`        | Email/password sign-up form                     |
| `/auth/confirm-email` | Post-signup "check your inbox" page             |
| `/dashboard`          | Electrician page — requires the `elektryk` role |
| `/admin`              | Admin panel — requires the `admin` role         |

Route protection is applied in `src/middleware.ts`, but the rules live in `src/lib/route-access.ts`. Add an entry to the `PROTECTED_ROUTES` array there — a path prefix plus the roles allowed to reach it — rather than checking the role inside a page.

## Deployment

Deployed to [Cloudflare Workers](https://workers.cloudflare.com/) as the Worker **`rozdzielnica-pro`**:

**https://rozdzielnica-pro.rozdzielnica-pro.workers.dev**

### Auto-deploy (the normal path)

Pushing to `master` deploys. Cloudflare Workers Builds is connected to the GitHub repository and runs
`npm run build` then `npx wrangler deploy` on every push to the production branch. Builds for
non-production branches are off.

> GitHub Actions CI and the Cloudflare build run **in parallel** on the same push, so a red CI run
> does **not** block the deploy. Check CI before pushing something you care about.

### Manual deploy (fallback)

```bash
npm run build
npx wrangler deploy
```

Never `wrangler pages deploy` — `@astrojs/cloudflare` v14 dropped Pages support and the two commands
are not interchangeable.

### Secrets

`SUPABASE_URL` and `SUPABASE_KEY` are runtime Workers Secrets, not build-time variables:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Use the Supabase **publishable** key (`sb_publishable_...`). Never a `sb_secret_...` or
`service_role` key — `src/lib/supabase.ts` builds a cookie-scoped SSR client that acts as the
signed-in user, and a secret key there would bypass Row Level Security.

> `wrangler secret put` prompts on a TTY. Run without one (some CI shells, an agent session) it
> reports `Success` but stores an **empty** value, and `wrangler secret list` shows only names, so it
> cannot be detected there. Verify by checking the running app, not the command's exit code.

### Operations

```bash
npx wrangler deployments list     # what is deployed
npx wrangler versions list        # version history
npx wrangler rollback             # revert to the previous version
npx wrangler tail                 # live logs
```

Rollback reverts **code only** — any Supabase migration applied in the interim does not roll back
with it.

Platform rationale and risk register: [`context/foundation/infrastructure.md`](context/foundation/infrastructure.md).
Deployment record: [`context/changes/deployment/deployment-plan.md`](context/changes/deployment/deployment-plan.md).

## Tests

Two Vitest suites, kept in separate configs because their requirements differ:

| Suite       | Command                    | Files                  | Needs                          |
| ----------- | -------------------------- | ---------------------- | ------------------------------ |
| Unit        | `npm run test:unit`        | `src/**/*.test.ts`     | Nothing — runs in CI           |
| Integration | `npm run test:integration` | `tests/integration/**` | A running local Supabase stack |
| Both        | `npm test`                 | —                      | A running local Supabase stack |

The integration suite reads the stack's URL and keys from `supabase status -o env` and asserts the row-level security policies by creating real users and rows. Because of that, `npm test` fails on any machine with no stack running — use `npm run test:unit` for the no-infrastructure path.

Neither suite exercises HTTP, the Cloudflare adapter or the real auth flow. The smoke script below does.

## Smoke test

`scripts/smoke.mjs` is a dependency-free Node script that walks the whole auth flow (sign-up, sign-in, protected pages, the role gate, sign-out) over HTTP. Run it against the dev server or the production preview after dependency upgrades:

```bash
npm run dev            # or: npm run build && npm run preview
BASE_URL=http://localhost:4321 npm run smoke
```

It needs a reachable Supabase instance (local or cloud) with email confirmation disabled, and its role-gate steps sign in as the seeded `admin@example.com`, so the instance must be seeded too.

> **Note:** this script guards what Vitest cannot reach — that the build, the Cloudflare adapter and the real HTTP auth flow still work end to end. It complements the test suites above; neither one replaces the other.

## CI

`.github/workflows/ci.yml` runs two jobs on every push and PR to `master`:

- **ci** — lint, `astro check`, `npm run test:unit` and build. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets for the build step.
- **smoke** — starts a local Supabase via the Supabase CLI, builds, serves the production preview on the Cloudflare runtime and runs `npm run smoke` against it. No secrets required.

`.github/workflows/db-migrate.yml` runs on pushes to `master` only and applies pending migrations to the cloud project with `supabase link` + `supabase db push`. It requires three repository secrets:

| Secret                  | Description                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Personal access token. `supabase link` reads several project-config endpoints, so a token scoped only to Migrations and Database fails with an opaque authorization error |
| `SUPABASE_PROJECT_REF`  | The cloud project ref                                                                                                                                                     |
| `SUPABASE_DB_PASSWORD`  | The cloud database password                                                                                                                                               |

This workflow and the Cloudflare deploy fire on the same push with no ordering between them, so every migration must be forward-compatible with the currently deployed code.

## License

MIT
