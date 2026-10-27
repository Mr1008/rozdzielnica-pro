# RozdzielnicaPro

![RozdzielnicaPro](./public/og-image.png)

Switchboard (_rozdzielnica_) planning and labour quoting for a solo electrician working on simple
installations in single-family homes and flats.

The electrician enters the supply and the circuits; the app picks the cheapest catalog devices that
satisfy every circuit, lays them out on the DIN rails of a real cabinet, draws the wiring, and prints a
quote with material, labour and the cabinet drawing. It is deliberately narrow — a planning assistant
with a few explicit rules, not an electrical CAD tool or an optimiser.

## What it does

| Step                 | What happens                                                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Catalogs** (admin) | The admin maintains the device catalog (FR switch-disconnectors, RCD, RCBO, type-B MCB, 1F/3F comb busbars, PE/N bars) and the cabinet catalog (interior, DIN rails, cable entries, built-in PE/N bars).                     |
| **Project**          | The electrician creates a project, picks a cabinet (the project keeps a snapshot of it) and enters the OSD supply and the WLZ. Simplified, informational checks flag ampacity, PEN size and voltage drop.                    |
| **Circuits**         | Circuits are grouped under RCDs with a drag-and-drop editor. Each group's RCD is sized from the summed circuit currents plus a margin; a single-circuit group gets one RCBO.                                                 |
| **Device matching**  | Only devices that satisfy the circuit are considered, then the cheapest wins. If nothing in the catalog fits, the electrician sees a "catalog gap — contact the admin" error, never a weaker device.                         |
| **Layout**           | A greedy heuristic places the devices on the rails: (1) a group stays together next to its RCD, (2) near the side its cables enter, (3) close to the N and PE bars. The electrician can then drag devices and groups around. |
| **Wiring**           | Conductors are routed in the browser and drawn either realistically (true-scale cores, ferrules, cable ties, comb busbars) or schematically, with a wire-length bill per cross-section.                                      |
| **Quote**            | Material from catalog prices; labour = devices × mount time + project overhead, × hourly rate — all from the electrician's profile. The time estimate can be overridden.                                                     |
| **Printout**         | An A4 quote with the company letterhead, itemised material, labour, total and the cabinet drawing — printed or saved as PDF from the browser.                                                                                |

Two roles: **admin** (catalogs only, never sees projects) and **elektryk** (sees only their own projects).
Isolation is enforced by Postgres row-level security, not by application code.

## Tech stack

- [Astro](https://astro.build/) 7, SSR (`output: "server"`), with [React](https://react.dev/) 19 islands
- [TypeScript](https://www.typescriptlang.org/) 6, [Tailwind CSS](https://tailwindcss.com/) 4, shadcn/ui
- [Supabase](https://supabase.com/) — Postgres, auth, row-level security
- [Cloudflare Workers](https://workers.cloudflare.com/) via `@astrojs/cloudflare`
- [Vitest](https://vitest.dev/) (unit, property-based and RLS integration tests), ESLint + Prettier, husky

## Getting started

Prerequisites: Node.js **24** — any 24.x (`.nvmrc`) and Docker with ~7 GB of RAM for the local Supabase stack.

```bash
git clone git@github.com:Mr1008/rozdzielnica-pro.git
cd rozdzielnica-pro
npm ci
npx supabase start
```

`supabase start` applies `supabase/migrations/` and `supabase/seed.sql`. Copy the API URL and anon key
it prints (or `npx supabase status -o env`) into **both** `.env` (Node tooling, tests) and `.dev.vars`
(the Cloudflare runtime used by `npm run dev`):

```
SUPABASE_URL=http://127.0.0.1:55321
SUPABASE_KEY=<anon key>
```

```bash
npm run dev
```

The app runs at http://localhost:4321. Sign up to get an `elektryk` account, or sign in as the seeded admin.

### Local stack

The ports are moved off the Supabase CLI defaults in `supabase/config.toml`:

| Service | URL                      |
| ------- | ------------------------ |
| API     | `http://127.0.0.1:55321` |
| Studio  | `http://localhost:55323` |
| Mailpit | `http://localhost:55324` |

The seed — **local and CI only**, never pushed to the cloud — creates:

- an admin account: `admin@example.com` / `admin123456`;
- three cabinets that differ in size and rails (small 1-row, medium 3-row with vertical PE/N bars,
  large 4-row with horizontal bars and a split rail), so the layout heuristic visibly adapts;
- a starter device catalog.

The 33 Karwasz cabinets (RN, RP, RNH, UNI SYSTEM M) are not seed data: they come from a migration,
so they exist in the cloud too.

Email confirmation is off locally; sign-up signs you straight in.

> After editing `supabase/config.toml`, run `npx supabase stop` then `npx supabase start`.
> `supabase db reset` does not re-read the config, and without the access-token hook the `user_role`
> JWT claim silently disappears.

The app also boots and builds without Supabase variables (auth is then disabled) — CI relies on that.

## Scripts

| Command                              | What it does                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| `npm run dev`                        | Dev server on the Cloudflare `workerd` runtime                                        |
| `npm run build` / `npm run preview`  | Production build / serve it locally (`preview:fresh` does both)                       |
| `npm run lint` / `lint:fix`          | Type-checked ESLint; Prettier runs as an ESLint rule                                  |
| `npx astro check`                    | Type-checks `.astro` files (not covered by `lint`)                                    |
| `npm run format`                     | Prettier over the repo                                                                |
| `npm run test:unit`                  | Vitest over `src/**/*.test.ts` — no infrastructure needed                             |
| `npm run test:integration`           | RLS assertions in `tests/integration/` against the running local Supabase             |
| `npm test`                           | Both suites — fails if no local stack is running                                      |
| `npm run test:e2e`                   | Playwright over `tests/e2e/` — builds, serves `:4321`, needs local Supabase + `E2E_*` |
| `npm run smoke`                      | End-to-end auth flow over HTTP against a running server (`BASE_URL`, default `:4321`) |
| `npm run db:types`                   | Regenerate `src/lib/database.types.ts` from the local stack after a migration         |
| `npm run brand:assets`               | Re-render favicons and the OG image from `src/assets/brand/`                          |
| `node scripts/roadmap-to-github.mjs` | Mirror `context/foundation/roadmap.md` to GitHub issues and the project board         |

Reproduce the CI `ci` job locally:

```bash
npm run lint && npx astro check && npm run test:unit && npm run build
```

A pre-commit hook (husky + lint-staged) runs `eslint --fix` on staged `*.{ts,tsx,astro}` and
`prettier --write` on `*.{json,css,md}`.

## Testing

| Layer       | Command                    | Covers                                                                          | Needs                            |
| ----------- | -------------------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| Unit        | `npm run test:unit`        | Domain logic in `src/lib/` — matching, layout, wiring, busbars, quote, parsers  | Nothing (runs in CI)             |
| Integration | `npm run test:integration` | Row-level security policies, with real users and rows                           | Local Supabase                   |
| Smoke       | `npm run smoke`            | Build, Cloudflare adapter, sign-up/sign-in, role gates, sign-out over real HTTP | Running server + seeded Supabase |

The Vitest suites never touch HTTP; the smoke script never touches domain logic. Visual states are
checked on the development-only page `/dev/kitchen-sink`, which renders every UI component, drawing
and quote state from real view models.

## Routes

| Route                            | Role     | Purpose                                                             |
| -------------------------------- | -------- | ------------------------------------------------------------------- |
| `/`                              | public   | Landing page                                                        |
| `/auth/signin`, `/auth/signup`   | public   | Email + password auth                                               |
| `/dashboard`                     | elektryk | Home                                                                |
| `/dashboard/profile`             | elektryk | Pricing parameters and company details for the letterhead           |
| `/dashboard/projects`            | elektryk | Project list; `/new` creates one                                    |
| `/dashboard/projects/[id]`       | elektryk | Supply, circuits, matching, layout editor, wiring, quote            |
| `/dashboard/projects/[id]/print` | elektryk | Printable A4 quote                                                  |
| `/admin`                         | admin    | Admin home; `/admin/cabinets` and `/admin/devices` are the catalogs |
| `/dev/kitchen-sink`              | dev only | UI state catalog; not in production builds                          |

Access rules live in `src/lib/route-access.ts` (`PROTECTED_ROUTES`), applied by `src/middleware.ts`.
Gate a new page there, never inside the page.

## Project structure

```
src/
  pages/            Astro pages; api/ holds FormData endpoints that redirect with ?error=<code>
  components/       ui/ (shadcn), brand/, cabinets/, devices/, circuits/, projects/, forms/
  lib/              Domain logic, each module with its *.test.ts beside it
    i18n/           Polish message catalog (pl.ts) and formatters — no inline UI strings
  styles/global.css Design tokens — the only source of colours
  middleware.ts     Session, role and route gate on every request
supabase/           config.toml, migrations/, seed.sql
tests/integration/  RLS suite (needs a live database)
scripts/            smoke.mjs, roadmap-to-github.mjs, brand-assets.mjs, wiring-bench/
context/            Product docs: PRD, roadmap, tech stack, change plans and their archive
```

Key domain modules in `src/lib/`:

| Module                                    | Responsibility                                                     |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `device-spec.ts`, `cabinet-geometry.ts`   | Validate catalog rows (mirroring the database CHECKs)              |
| `supply-params.ts`, `supply-warnings.ts`  | OSD/WLZ input and the informational checks                         |
| `circuit-params.ts`, `device-matching.ts` | Circuits and RCD groups; compliance-first, then cheapest matching  |
| `busbar-cutting.ts`                       | Which comb-busbar piece each RCD group is cut from                 |
| `cabinet-layout.ts`, `layout-editing.ts`  | The layout heuristic, its validator, and the manual editor's model |
| `cabinet-wiring.ts`, `cabinet-drawing.ts` | Conductor routing and its realistic/schematic SVG presentation     |
| `quote.ts`, `quote-print.ts`              | The quote and the printout — the only places money is computed     |

## Design notes

A few decisions shape the whole codebase:

- **Never an under-rated device.** Matching filters for compliance before it sorts by price, and a
  missing device is reported as a catalog gap. A partial match is never stored.
- **Snapshots, not live references.** A project copies its cabinet's geometry and each matched
  device's catalog data at save time (database triggers write those columns). Admin edits never move
  an existing project's layout or quote.
- **Rules guarded twice.** Value lists and bounds live both in a database CHECK and in a TypeScript
  parser, and change together. The database is the enforcement point; the parser gives Polish errors.
- **Wiring runs in the browser.** Routing exceeded the Worker CPU budget, so the server hands a placed
  layout to a client island. Moving it back must be measured on Cloudflare with
  [`scripts/wiring-bench`](scripts/wiring-bench/README.md).
- **No server-side PDF.** The edge runtime cannot render one; the quote prints from the browser.
- **Polish UI, i18n-ready.** Every user-facing string comes from `src/lib/i18n/pl.ts`, typed so a
  second locale fails `astro check` if a key is missing.

The full list of these rules and their traps is in [AGENTS.md](AGENTS.md).

## Deployment

Production is the Cloudflare Worker **`rozdzielnica-pro`** with a cloud Supabase project.

**Pushing to `master` deploys.** `.github/workflows/ci.yml` runs two jobs on every push and PR:

- `ci` — lint, `astro check`, unit tests, build;
- `smoke` — a local Supabase, a production preview and the smoke script.

When CI for a push to `master` is green, `.github/workflows/deploy.yml` runs `supabase db push`
(job `migrate`) and then `npm run build` + `npx wrangler deploy` (job `deploy`). A red CI ships
nothing. Because the old code briefly runs against the new schema, **every migration must stay
backward-compatible with the deployed code**.

Repository secrets for the deploy workflow:

| Secret                  | Notes                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Must cover the project-config reads `supabase link` makes, not just Migrations/Database |
| `SUPABASE_PROJECT_REF`  | Cloud project ref                                                                       |
| `SUPABASE_DB_PASSWORD`  | Cloud database password                                                                 |
| `CLOUDFLARE_API_TOKEN`  | Workers Scripts:Edit on this account                                                    |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id                                                                   |

Runtime secrets live on the Worker:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_KEY
```

Use the **publishable** key (`sb_publishable_…`), never a secret or `service_role` key — that would
bypass RLS. Run `wrangler secret put` on a real TTY: without one it reports success but stores an
empty value.

One-time cloud setup, in the Supabase dashboard: **Authentication → Hooks → Customize Access Token
(JWT) Claims → `public.custom_access_token_hook`**. Do not use `supabase config push` — it would
upload the local `site_url` and break production auth redirects.

Don'ts:

- Don't rename the Worker in `wrangler.jsonc` — that creates a second Worker and orphans the first.
- Don't enable Cloudflare Workers Builds for `master` — it would race the GitHub deploy.
- Don't use `wrangler pages deploy`; the adapter targets Workers only.

Operations:

```bash
npx wrangler deployments list
npx wrangler rollback
npx wrangler tail
```

A rollback reverts code only; migrations stay applied.

## Documentation

| Document                                                                     | Contents                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                                       | Contributor guide: architecture, conventions, domain tripwires |
| [context/foundation/prd.md](context/foundation/prd.md)                       | Product requirements (Polish)                                  |
| [context/foundation/roadmap.md](context/foundation/roadmap.md)               | Milestones and slices (Polish), mirrored to GitHub             |
| [context/foundation/tech-stack.md](context/foundation/tech-stack.md)         | Why this stack                                                 |
| [context/foundation/infrastructure.md](context/foundation/infrastructure.md) | Hosting choice and risk register                               |
| [context/foundation/test-plan.md](context/foundation/test-plan.md)           | Test strategy and quality gates                                |
| [context/archive/](context/archive/)                                         | Plans and records of every completed change                    |

## License

MIT
