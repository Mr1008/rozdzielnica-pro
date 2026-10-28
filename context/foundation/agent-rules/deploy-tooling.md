# Deploy, local stack and tooling

- **`npm run smoke` needs a running server AND a reachable Supabase with email confirmation
  disabled.** It signs a user up for real, and its role-gate steps sign in as the admin seeded by
  `supabase/seed.sql`. It fails against an unconfigured or unseeded instance. **Turning
  `enable_confirmations` on breaks it** — the script signs a user up and immediately signs them in,
  which a confirmation requirement refuses. Enabling confirmation therefore means reworking
  `smoke.mjs` first: sign in as the seeded admin (already `email_confirmed_at`-stamped) or confirm
  the new account through the local Mailpit API. **Cancelled 2026-10-27** (GitHub #30, closed as not
  planned): the free tier's built-in mailer delivers only to members of the Supabase organisation, so
  real sign-ups would never get the email. Turning it on needs custom SMTP with a sender on a domain
  we own, which does not exist yet. `/auth/confirm-email` therefore always says "account created".
- **Never run `supabase config push`.** `supabase/config.toml` carries
  `site_url = "http://127.0.0.1:3000"`, which would break production auth redirects. Migrations reach
  the cloud project through `.github/workflows/deploy.yml`; config does not go up at all, and the
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
  `SUPABASE_ACCESS_TOKEN` secret behind `.github/workflows/deploy.yml` must cover those config
  reads, not just Migrations and Database.
- **The Worker `rozdzielnica-pro` is deployed — renaming it now creates a _second_ Worker.**
  `package.json` and `wrangler.jsonc` both carry `name: "rozdzielnica-pro"`, live at
  `rozdzielnica-pro.rozdzielnica-pro.workers.dev`. Changing the `wrangler.jsonc` name orphans the
  existing Worker and its `SESSION` KV namespace rather than renaming them. See
  `context/changes/deployment/deployment-plan.md`.
- **Do not unwrap `fixupPluginRules(pluginReact)` in `eslint.config.js`, or drop the `overrides`
  block in `package.json`.** Both exist because `eslint-plugin-react` / `eslint-plugin-jsx-a11y` do
  not yet support ESLint 10. Removing either breaks `npm run lint`.

- **`supabase/catalog/eaton-legrand.sql` is generated and production-only.** It is the output of
  `src/lib/catalog-seed.ts`, pinned by a file snapshot in `catalog-seed.test.ts`: change the generator
  or `supabase/catalog/source/*.json`, then regenerate with `-u` — never edit the SQL by hand. Never
  move it into `supabase/migrations/` or `supabase/seed.sql`: it would reach every local and CI
  database and break the catalog-gap tests that rely on the sample catalog having no B40
  (`tests/e2e/seed.spec.ts`, `tests/integration/rls-devices.test.ts`). The matcher loads the whole
  active catalog with no pagination under PostgREST `max_rows = 1000`, so keep the catalog well below
  that. How to apply it: `supabase/catalog/README.md`.

## CI and deploy

CI (on `master`): `.github/workflows/ci.yml` job `ci` = lint + `astro check` + `test:unit` + build;
job `smoke` spins up a local Supabase, runs `npm run test:integration` against it (before the build,
so its users never interleave with the smoke signups), then `npm run test:e2e` (Playwright builds
and previews on its own and stops before the next step; its electricians are provisioned through the
stack's admin API, never a secret), then runs the smoke script against the production preview. `tests/integration/support.ts` reads the stack through `npx supabase`, so the
`supabase` devDependency in `package-lock.json` must stay at the `setup-cli` version.
Both pass with no repository secrets configured. `.github/workflows/deploy.yml` runs when CI for a
push to `master` finishes green: job `migrate` (`supabase db push`) then job `deploy`
(`npm run build` + `npx wrangler deploy`). It **does** need secrets — `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit),
`CLOUDFLARE_ACCOUNT_ID`. A red CI ships nothing, and new code never runs on the old schema; what
remains is the deploy-length window where the **old** code runs on the **new** schema. Cloudflare
Workers Builds must stay switched off for `master` — a second deployer would race this one again.
Deploy by hand: `npx wrangler deploy`, with secrets set via `npx wrangler secret put`.
