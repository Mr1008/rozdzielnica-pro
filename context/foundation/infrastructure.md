---
project: rozdzielnica-pro
researched_at: 2026-09-21
recommended_platform: Cloudflare Workers
runner_up: Netlify
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 7 (SSR, output "server") + React 19 islands
  runtime: Cloudflare workerd (nodejs_compat)
---

> **Status (2026-09-21): deployed.** Live at `https://rozdzielnica-pro.rozdzielnica-pro.workers.dev`,
> with Cloudflare Workers Builds auto-deploying `master`. Several entries below were corrected
> against live evidence during that deploy; each is marked **CORRECTED** or **RESOLVED** inline.
> The execution record is @context/changes/deployment/deployment-plan.md.

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare is the only candidate that scores Pass on all five agent-friendly criteria while clearing
the hard free-tier gate with no strings attached: 100k requests/day, no commercial-use restriction,
and no degradation of the free tier for this project's usage pattern. It is also already wired into
the repository — `@astrojs/cloudflare` v14, `wrangler.jsonc`, and a CI smoke job that builds and
runs against `workerd` with a live Supabase and passes today. That is working evidence, not a
prediction, and it makes the migration cost of choosing Cloudflare exactly zero.

The decisive factor against the runners-up was not cost — all three are €0 at MVP and €5–7/month to
escape their free tiers — but operational fit with an idle-dominated, single-user workload. Render's
free tier spins down after 15 minutes and takes ~50s to wake, which at this project's traffic means
essentially _every_ session starts with a cold start. Netlify's credit-based free plan is consumed
by deploy frequency rather than traffic (~20 production deploys/month), which collides with this
repo's auto-deploy-on-merge CI during a three-week build sprint.

## Platform Comparison

Scored against `references/agent-friendly-criteria.md`. Hard gates applied first: the interview
established that **no persistent connections are required** (so no platform was dropped on that
axis) and that the deployment **must cost €0/month at MVP** (which the user elevated from a
weighting to a gate).

| Platform               | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Free-tier gate | Total                          |
| ---------------------- | --------- | ------------------ | ------------------- | ----------------- | ----------------- | -------------- | ------------------------------ |
| **Cloudflare Workers** | Pass      | Pass               | Pass                | Pass              | Pass              | **Pass**       | **5 Pass**                     |
| **Netlify**            | Partial   | Pass               | Pass                | Pass              | Pass              | Pass           | 4 Pass / 1 Partial             |
| **Render**             | Partial   | Pass               | Pass                | Partial           | Pass              | Pass           | 3 Pass / 2 Partial             |
| Railway                | Pass      | Pass               | Pass                | Pass              | Pass              | **Partial**    | 5 Pass, gate fails             |
| Vercel                 | Pass      | Pass               | Pass                | Pass              | Partial           | **Fail (ToS)** | 4 Pass / 1 Partial, gate fails |
| Fly.io                 | Partial   | Partial            | Pass                | Pass              | Partial           | **Fail**       | 2 Pass / 3 Partial, gate fails |

**Cloudflare Workers** — Full operational loop is CLI-native: `wrangler deploy`, `wrangler rollback`,
`wrangler tail`, `wrangler secret put`, `wrangler deployments list`. Docs published as `llms.txt` /
`llms-full.txt` plus per-page `/index.md`. 17 MCP servers under `*.mcp.cloudflare.com` (Cloudflare
does not stamp per-server GA/beta labels — treat as actively shipping). Free tier is 100k requests
**per day** with a 10ms CPU ceiling per invocation.

**Netlify** — Mature `@astrojs/netlify` v8 adapter; `netlify deploy` is draft-by-default with
`--prod` required to publish, a genuinely safe default. Scored Partial on CLI-first for one reason:
**there is no rollback command** — reverting means republishing a prior atomic deploy through the
dashboard or raw `netlify api`. Official MCP server ships and is actively marketed. Free plan for
accounts created after 2025-09-04 is credit-based (300 credits/month, hard stop that _pauses the
site_ rather than billing). Commercial use is permitted. (Credit unit costs come from a third-party
tracker, not Netlify's own pricing page — verify before relying on them.)

**Render** — Real Node runtime, GA MCP server (since 2025-08-21) with a broad tool surface. Scored
Partial on CLI-first (env vars are dashboard/blueprint-driven, no clean CLI verb) and Partial on
deploy API (rollback exists via REST endpoint, not a named CLI subcommand). Free web service is
0.1 vCPU / 512MB with a 15-minute idle spin-down and ~50s cold start. **Preview environments are
Pro-plan-only.**

**Railway** — Strong on every agent criterion, including a GA MCP server and full `llms-full.txt`.
Dropped on the free-tier gate: the free plan reinstated in Aug 2025 grants only **$1/month of
non-rollover credit**, viable solely with scale-to-zero — and scale-to-zero is triggered by absence
of _outbound_ traffic, which an external Supabase client's keepalive can defeat. PR environments are
Pro-only. Railpack's Astro detection also explicitly excludes `output: "server"`, so build and start
commands must be set by hand.

**Vercel** — Technically excellent and GA across the board. Dropped because **Hobby explicitly
prohibits commercial use**: the Fair Use Guidelines bar any deployment "used for financial gain of
anyone involved in any part of production of the project." RozdzielnicaPro is a working tool for a
one-person electrical business, which meets that definition. Pro is $20/user/month. This is a terms
conflict, not a capability gap — and it is arguable for a project that is also coursework, so it is
recorded rather than dismissed.

**Fly.io** — Dropped on the free-tier gate. Fly retired free allowances in 2024; new accounts get a
trial capped at 2 VM-hours or 7 days, a card is required afterwards, and a `shared-cpu-1x-256mb`
machine runs ~$2.02/month continuously (less with scale-to-zero, but never $0). Also the least
managed option — the generated Dockerfile becomes yours to maintain — and `fly mcp server` is
explicitly experimental.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins on operational fit rather than raw capability. Sub-millisecond isolate startup means no cold
start on an idle-dominated workload; a 100k-requests-**per-day** allowance is roughly three orders of
magnitude of headroom at this project's volume and cannot be consumed by deploy frequency;
`wrangler rollback` is a first-class CLI verb, which neither runner-up matches. Migration cost is
zero because the repository is already configured for it and CI proves the `workerd` +
`@supabase/ssr` path works today.

#### 2. Netlify

The strongest fallback and the recommended exit if Cloudflare becomes a blocker. Node-based
functions avoid both Cloudflare's 10ms CPU ceiling and Render's cold-start cliff, the Astro adapter
is mature, deploy previews are free, and the official MCP server is well supported. Two real gaps:
no CLI rollback, and a credit model where overage pauses the whole site and is consumed by builds
and deploys as much as by traffic.

#### 3. Render

The only shortlisted platform with a real Node runtime capable of server-side PDF rendering — the
one requirement (FR-012) Cloudflare structurally cannot satisfy. Held back by a free tier that is
actively hostile to this usage pattern: 0.1 vCPU, 15-minute spin-down, ~50s cold start, and preview
environments locked behind the Pro plan. Note that server-side Chromium is not realistically viable
within the free tier's 512MB either, so the PDF advantage effectively costs $7/month.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **The 10ms CPU ceiling is a hard failure, not a slowdown.** Exceeding it terminates the
   invocation with **Error 1102 "Worker exceeded resource limits"**. There is no burst tolerance, no
   rolling average, no grace. The failure lands per-request, which means large projects (many
   circuits) break while small ones work — the worst possible correlation, since the large ones are
   the real ones. Mitigating fact: CPU time **excludes** time awaiting I/O, so Supabase round-trips
   cost nothing against the budget; only synchronous JavaScript counts.
2. **`wrangler.jsonc` does not set `disable_nodejs_process_v2`.** Newer `nodejs_compat` enables
   "process v2", which causes Astro to mis-detect Node and return `[object Object]` for every
   non-prerendered route (withastro/astro#14511). The current `compatibility_date` of `2026-05-08`
   predates the 2026-08-04 default-on change, so this is latent rather than active — but any
   compatibility-date bump can silently break all SSR routes.
3. **No server-side PDF is a platform consequence, not a fact of nature.** FR-012 requires a
   printable quote containing a legible cabinet-layout visualisation. `AGENTS.md` records the
   constraint as settled, but it is settled _because of this platform choice_. Render, Railway and
   Fly could all run Puppeteer. If browser print cannot produce acceptable output, the platform —
   not the requirement — is the blocker.
4. **The first deploy permanently names the Worker `10x-astro-starter`.** Both `package.json` and
   `wrangler.jsonc` still carry the starter's name, and `AGENTS.md` warns that renaming the wrangler
   name creates a _new_ Worker. Deploying before renaming locks production to a misleading URL and
   makes the correction a migration.
5. **`tech-stack.md` records `deployment_target: cloudflare-pages`, which is now wrong.**
   `@astrojs/cloudflare` v14 dropped Pages support entirely, and Cloudflare steers all new projects
   to Workers + Static Assets. `wrangler deploy` and `wrangler pages deploy` are **not**
   interchangeable. Any agent trusting that frontmatter field will reach for the wrong command.

### Pre-Mortem — How This Could Fail

The MVP ships in three weeks and deploys clean. The trap springs slowly. First, the layout heuristic
grows from "place MCBs next to their RCD" into a scoring pass over every rail position for every
group — comfortably sub-second in wall-clock terms locally, but 40ms of CPU on workerd. Free-tier
invocations begin returning 1102 errors on exactly the projects with the most circuits: the real
ones. Debugging is miserable because the wall-clock timing looks fine and `wrangler tail` reports
success right up until it doesn't.

Meanwhile the printable quote never looks right. Browser print breaks the SVG cabinet diagram across
page boundaries, and every fix is another `@media print` CSS fight. The obvious answer — render it
server-side — is unavailable, so a client-side PDF library lands in the bundle instead, and the
bundle grows.

Then a compatibility-date bump, made for an unrelated Supabase fix, flips `nodejs_compat` to
process v2, and every SSR route starts returning `[object Object]`.

Three symptoms, one root cause: the platform's constraints were treated as free because the starter
came pre-wired for it, and nobody priced them against a specific requirement.

### Unknown Unknowns

- **Preview URLs are public by default**, and every branch gets one. This application holds an
  electrician's client data — names, addresses, installation details. A guessable `*.workers.dev`
  preview serving real Supabase data is a GDPR exposure, and the fix (Cloudflare Access) is a
  separate product requiring deliberate configuration. This is the most under-weighted risk here.
- **The free limit is 100k requests _per day_, not per month.** It resets daily and returns HTTP
  1015 rather than generating a bill. The failure mode is "the app goes down", not "the app gets
  expensive" — a different operational shape than a bandwidth cap.
- **CI already proves more than it appears to.** The `smoke` job builds and runs `npm run preview` on
  the Cloudflare runtime against a live Supabase and passes. The known `@supabase/ssr` + `workerd`
  dynamic-`require("stream")` issue (supabase/supabase#37592) is therefore **not currently biting
  this project** — it is a regression to watch, not a blocker. Without checking, this risk would
  have been scored far higher than it deserves.
- **Absent build-time secrets are load-bearing.** `optional: true` on both env fields in
  `astro.config.mjs` is what keeps CI green with no repository secrets configured;
  `wrangler secret put` populates them at runtime only. Flipping `optional` to `false` would break CI
  rather than fix anything.
- **Portability is a property to defend, not a given.** No application code currently touches
  `locals.runtime.env`, `platform.env`, `waitUntil`, or any KV/D1/R2 binding — verified by grep. That
  is the only reason the exit to Netlify is a half-day config swap. Adopting any Cloudflare binding
  converts it into a rewrite.

## Operational Story

- **Preview deploys** _(CORRECTED 2026-09-21)_: preview URLs are generated **per version, on every
  `wrangler deploy` and `wrangler versions upload`** — not per branch, and not only for branch
  deploys. They are **public by default** whenever `workers_dev` is enabled, so the exposure is
  wider than first described here. **Resolved:** `preview_urls: false` is set in `wrangler.jsonc`
  and verified against `wrangler versions list`. Re-enable only behind Cloudflare Access, or after
  pointing non-production deploys at a Supabase project holding only synthetic data.
- **Secrets**: `SUPABASE_URL` and `SUPABASE_KEY` are set with `npx wrangler secret put <NAME>`, which
  stores them in Workers Secrets and deploys a new version. Locally they live in `.env` (Node
  tooling) and `.dev.vars` (Cloudflare local dev), both gitignored. They are declared
  `optional: true` in `astro.config.mjs` so builds succeed without them; CI relies on this. Rotation
  is a re-run of `wrangler secret put` followed by a redeploy.
- **Rollback**: `npx wrangler rollback [<version-id>]` reverts to the previous or a named version;
  `npx wrangler deployments list` shows what is available. Time-to-revert is under a minute. Caveat:
  this rolls back _code only_ — any Supabase migration applied in the interim does not roll back with
  it, so forward-compatible migrations are the safer discipline.
- **Migrations** _(AMENDED 2026-09-22)_: applying them is no longer a human step.
  `.github/workflows/db-migrate.yml` runs `supabase link` + `supabase db push` against the cloud
  project on every push to `master`, using the `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` and
  `SUPABASE_DB_PASSWORD` repository secrets. It fires in parallel with the Cloudflare deploy with no
  ordering between the two, so forward-compatible migrations are a requirement, not a preference.
  One thing it deliberately does not do: `supabase config push`, which would carry `config.toml`'s
  local `site_url` to production — the cloud access-token hook is enabled by hand in the dashboard
  instead.
- **Approval**: an agent may deploy, tail logs, list deployments, roll back, and land a
  forward-compatible migration through the pipeline above. A human performs: renaming the Worker,
  rotating Supabase keys, **reverting** a database migration, changing Cloudflare Access policy, and
  deleting the Worker or project. Reverting stays human because nothing here automates it and
  rollback remains code-only — a migration applied in the interim does not come back with the
  Worker version. API tokens should be scoped to Workers for this project only — no DNS, no billing,
  no unrelated projects — and live in env vars, never in a committed config file.
- **Logs**: `npx wrangler tail` streams live structured invocation logs. `observability.enabled` is
  already `true` in `wrangler.jsonc`, so historical logs are queryable in the dashboard under
  Workers & Pages → the Worker → Logs. Per-request CPU time is charted under the **Metrics** tab
  ("CPU Time per execution") — this is the instrument for the profiling task in the risk register.

## Risk Register

| Risk                                                                                                         | Source           | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ---------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout heuristic exceeds 10ms CPU → Error 1102 on large projects                                             | Devil's advocate | L          | H      | Profile the layout pass with a realistic 30-circuit project via Metrics → "CPU Time per execution" before trusting the free tier. If it approaches 10ms, either move the scoring pass into the React island that already must be editable, or enable Workers Paid ($5/mo → 30s default, up to 5 min via `limits.cpu_ms`).                                                                                                                                                                                                                             |
| Public preview URLs expose real client PII **CORRECTED — MITIGATED**                                         | Unknown unknowns | M          | H      | Scope was wider than described: preview URLs are per-_version_, generated on every deploy. **Closed** by `preview_urls: false` in `wrangler.jsonc` (verified). Reopens the moment previews are re-enabled without Cloudflare Access or a synthetic-data Supabase project.                                                                                                                                                                                                                                                                             |
| ~~Compatibility-date bump enables process v2 → all SSR routes return `[object Object]`~~ **CORRECTED**       | Devil's advocate | L          | H      | **Do NOT add `disable_nodejs_process_v2`.** Two facts retire the original mitigation: `compatibility_date` `2026-05-08` predates the `2026-08-04` process-v2 default, and it is _after_ `2026-02-19`, from which `fetch_iterable_type_support` is default-on — per withastro/astro#14511 that flag is the preferred fix for this exact symptom. Verified live: every route returns real HTML, no `[object Object]`. Residual action unchanged: treat any `compatibility_date` bump as requiring a full smoke run.                                     |
| Browser print cannot produce an acceptable cabinet-layout printout (FR-012)                                  | Pre-mortem       | M          | H      | Prototype the printed quote early — before other UI polish — against a real multi-group cabinet. If print fidelity fails, the decision reopens in favour of Render/Fly ($7/mo tier, not free).                                                                                                                                                                                                                                                                                                                                                        |
| ~~First deploy locks production to the name `10x-astro-starter`~~ **RESOLVED**                               | Devil's advocate | H          | M      | Renamed to `rozdzielnica-pro` in both `wrangler.jsonc` and `package.json` before the first deploy. The risk is now inverted: renaming would orphan the live Worker and its `SESSION` KV namespace.                                                                                                                                                                                                                                                                                                                                                    |
| ~~`tech-stack.md` says `cloudflare-pages`; adapter v14 dropped Pages~~ **RESOLVED**                          | Devil's advocate | H          | M      | Frontmatter corrected to `cloudflare-workers`. Standing rule: never run `wrangler pages deploy` — it is not interchangeable with `wrangler deploy`.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Adopting a Cloudflare binding (KV/D1/R2/DO/`waitUntil`) destroys portability **CORRECTED — PARTLY REALISED** | Unknown unknowns | **H**      | M      | The premise "no application code touches a binding" held, but `@astrojs/cloudflare` v14 adopts bindings on its own: the first deploy auto-provisioned a `SESSION` KV namespace (`rozdzielnica-pro-session`) and bound `IMAGES`. The Netlify exit still holds — its adapter ships an equivalent session driver — but "no Cloudflare bindings" is no longer literally true. Opt out with `session: false` and an explicit `imageService` in `astro.config.mjs` to defend portability strictly. Application code remains binding-free; keep it that way. |
| `@supabase/ssr` dynamic `require("stream")` rejected by workerd (supabase#37592)                             | Research finding | L          | H      | Already exercised and passing in the CI `smoke` job against `workerd` + live Supabase. Keep that job green — it is the regression detector for this class of failure.                                                                                                                                                                                                                                                                                                                                                                                 |
| Free tier is 100k req/**day**; overage returns HTTP 1015, not a bill                                         | Unknown unknowns | L          | M      | At one user this is ~1000× headroom. Watch it only if the app is ever opened to multiple electricians.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A future platform reconsideration hits a commercial-use terms conflict                                       | Research finding | L          | M      | Cloudflare's free tier carries no commercial-use restriction; re-check this clause explicitly (as Vercel's Hobby plan required) if the platform is ever reconsidered.                                                                                                                                                                                                                                                                                                                                                                                 |
| Supabase free project pauses after ~7 days of inactivity                                                     | Research finding | **H**      | M      | For a single-user MVP used in bursts this is a real "the app is down on Monday" shape, not a theoretical limit. Unpausing is a dashboard action. The fix if it becomes routine is the paid tier or a scheduled keepalive request.                                                                                                                                                                                                                                                                                                                     |
| A red GitHub Actions CI run does not block a Cloudflare auto-deploy                                          | Research finding | M          | M      | CI (`lint` + `astro check` + `build`) and Workers Builds run in **parallel** on the same push to `master`, so a failing check cannot stop the deploy. Accepted for MVP. Closing it means PR-only merges with required checks, or moving the deploy into the CI job.                                                                                                                                                                                                                                                                                   |
| `wrangler secret put` silently stores an empty value without a TTY                                           | Research finding | M          | H      | Run non-interactively (an agent session, some CI shells) it reports `Success` but stores nothing, and `wrangler secret list` shows only names, so it cannot be detected there. Symptom is the app staying on its unconfigured branch. Set secrets from a real terminal, or pipe the value — and verify by asserting on live app behaviour, never on the command's exit code.                                                                                                                                                                          |

## Exit Path — Cost of Moving to Netlify

Recorded because the runner-up only matters if switching is actually affordable. Verified by grep
against the current tree: **no application code touches Cloudflare-specific APIs.**

Files that change (6): `astro.config.mjs` (one import + one line), `package.json` (swap
`@astrojs/cloudflare` → `@astrojs/netlify`, drop `wrangler`), `wrangler.jsonc` (delete, add
`netlify.toml`), `.github/workflows/ci.yml` (preview step + secrets), `AGENTS.md` / `README.md`
(commands), `.dev.vars` (no longer needed — Netlify CLI reads `.env`).

Files that do **not** change: all of `src/`. `src/lib/supabase.ts` imports from `astro:env/server`,
Astro's platform-agnostic typed layer; `src/middleware.ts` is standard Astro middleware. Estimated
effort: half a day including re-verification.

This stays true only while the "no Cloudflare bindings" rule in the risk register holds.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup (the repo's existing GitHub Actions workflow was read as evidence, not designed)
- Production-scale architecture (multi-region, HA, DR)
- Custom domain and DNS configuration
- Cloudflare Access policy design beyond noting that it is the required fix for preview exposure
