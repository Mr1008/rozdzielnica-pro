---
project: rozdzielnica-pro
plan_type: deployment
platform: Cloudflare Workers
worker_name: rozdzielnica-pro
planned_at: 2026-09-21
status: complete
sources:
  - context/foundation/infrastructure.md
  - context/foundation/tech-stack.md
---

# First production deployment — RozdzielnicaPro on Cloudflare Workers

Audit trail for the first deploy: what was supposed to happen, what actually happened, and what a
human must still do by hand. Checkboxes are updated as phases complete.

## Context

`context/foundation/infrastructure.md` selected **Cloudflare Workers** as the MVP platform and
`context/foundation/tech-stack.md` fixes the stack (Astro 7 SSR + React 19 islands + Supabase on
`workerd`). Nothing had ever been deployed: `wrangler whoami` reported _not authenticated_ and no
Worker existed in any Cloudflare account.

This plan executes the first deployment and wires Cloudflare-native auto-deploy on `master`. It
also clears three pre-deploy landmines the risk register flagged at likelihood **H/M**, each of
which becomes expensive _after_ the first deploy rather than before it.

**Blocking prerequisite found during planning:** `.env` and `.dev.vars` both pointed at
`SUPABASE_URL=http://127.0.0.1:55321`, and `supabase/` held only `config.toml` — there was no cloud
Supabase project. A Worker cannot reach `127.0.0.1`, so a hosted Supabase project is a hard
prerequisite for the deployed app to authenticate anyone.

### Decisions taken

| Decision            | Choice                                                                       |
| ------------------- | ---------------------------------------------------------------------------- |
| Production Supabase | Create a free cloud project first; the first deploy is a working app         |
| Worker name         | Rename to `rozdzielnica-pro` in **both** `wrangler.jsonc` and `package.json` |
| Preview URLs        | `preview_urls: false` until Cloudflare Access exists                         |
| Scope               | CLI first deploy **plus** Cloudflare Workers Builds auto-deploy on `master`  |

### Deployment facts

| Field              | Value                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Cloudflare account | Kubamichalek@gmail.com's Account                                                                                       |
| Account ID         | `bd28aa2a5114669748380febec591cdc`                                                                                     |
| Worker name        | `rozdzielnica-pro`                                                                                                     |
| First version ID   | `01dedf8d-4350-4141-87cb-a162dbea5e2b` (2026-09-21T12:33:23Z)                                                          |
| Bindings           | `SESSION` KV `b82d672e388546cb80da1cf52a86bb3f` (auto-provisioned as `rozdzielnica-pro-session`) · `IMAGES` · `ASSETS` |
| Production URL     | https://rozdzielnica-pro.rozdzielnica-pro.workers.dev                                                                  |
| Runtime secrets    | `SUPABASE_URL`, `SUPABASE_KEY` (Supabase **publishable** key) — both verified live                                     |
| Rollback           | `npx wrangler rollback [<VERSION_ID>]` · inventory: `npx wrangler deployments list`                                    |
| Logs               | `npx wrangler tail` · dashboard history via `observability.enabled: true`                                              |

### Corrections to `infrastructure.md` (verified against Cloudflare docs, 2026-09-21)

Three findings the research artifact got wrong or missed. None changes the platform choice; all are
folded back into `infrastructure.md` in Phase 6.

1. **`disable_nodejs_process_v2` must _not_ be added pre-emptively.** The register recommends
   adding it and dates the process-v2 default at `2026-08-04`. Two independent facts make the flag
   unnecessary and potentially harmful: (a) `compatibility_date` is `2026-05-08`, which predates
   the `2026-08-04` process-v2 default; (b) `2026-05-08` is _after_ `2026-02-19`, from which
   `fetch_iterable_type_support` is on by default — and per withastro/astro#14511 that flag is the
   _alternative, preferred_ fix for the `[object Object]` symptom. Adding
   `disable_nodejs_process_v2` blind would change runtime behaviour to work around a bug the
   default flag set already handles. Replaced by an explicit body-content assertion in Phase 4.
2. **Preview URLs are not "per-branch, generated automatically".** They are generated per
   _version_, on every `wrangler deploy` and `wrangler versions upload`, and are public by default
   whenever `workers_dev` is enabled. The exposure is broader than the register describes — hence
   `preview_urls: false` in Phase 1 rather than "before the first branch deploy".
3. **The adapter adopts two Cloudflare bindings on its own.** `@astrojs/cloudflare` v14 enables
   sessions via a `SESSION` KV binding and image processing via an `IMAGES` binding by default;
   wrangler auto-provisions the KV namespace on first deploy. The register's "adopting a binding
   destroys portability" rule is therefore already partly breached by the adapter, not by
   application code. The exit to Netlify still holds (its adapter ships an equivalent session
   driver), but the claim "no Cloudflare bindings" is no longer literally true. Opt-out if wanted:
   `session: false` and an explicit `imageService` in `astro.config.mjs`.

### Out of scope

Custom domain / DNS, Cloudflare Access policy design, database migrations (none exist), and the
existing GitHub Actions workflow, which stays a **check-only** quality gate (lint + `astro check` +
build + smoke) and deliberately gets no deploy step — that would race Workers Builds.

---

## Phase 0 — Tooling prerequisites ✅

`wrangler` was already a devDependency (`^4.131.1`); nothing to install.

- [x] Cloudflare account exists (free plan).
- [x] **Human gate** — `npx wrangler login` run by the user (browser OAuth).
- [x] Verified: `npx wrangler whoami` returns account ID `bd28aa2a5114669748380febec591cdc`, with
      `workers_scripts:write`, `workers_kv:write`, `secrets_store:write` and `workers_tail:read`
      among the granted scopes.
- [x] Noted: local Node is `v24.18.0`, `.nvmrc` pins `22.14.0`. Harmless locally; Phase 5 checks
      which major Workers Builds selects.

## Phase 1 — Pre-deploy repo changes ✅

All completed _before_ the first `wrangler deploy`. The renames are irreversible-by-convenience:
after a deploy, renaming creates a _second_ Worker.

- [x] `wrangler.jsonc` — `name`: `10x-astro-starter` → `rozdzielnica-pro`. Matches the GitHub repo
      (`Mr1008/rozdzielnica-pro`) and `project_name` in `tech-stack.md`.
- [x] `wrangler.jsonc` — added `"preview_urls": false`. Production `workers.dev` route stays on;
      public per-version preview URLs are off.
- [x] `package.json` — `name` → `rozdzielnica-pro`.
- [x] `context/foundation/tech-stack.md` — frontmatter `deployment_target: cloudflare-pages` →
      `cloudflare-workers`. `@astrojs/cloudflare` v14 dropped Pages support entirely;
      `wrangler pages deploy` and `wrangler deploy` are **not** interchangeable.
- [x] Left `compatibility_date`, `compatibility_flags`, `main` and `assets` untouched — those
      values are what the green CI `smoke` job exercises.
- [x] Local CI-equivalent gate green: `npm run lint` clean · `npx astro check` 0 errors / 0
      warnings / 0 hints across 29 files · `npm run build` complete in 4.45s.

## Phase 2 — Cloud Supabase project ✅

Account creation, key retrieval and auth settings are panel-by-hand operations per the
production-access boundary in `infrastructure.md`. **The agent never sees the anon key.**

- [x] **Human:** free Supabase project created.
- [x] Nothing else is configured deliberately: no tables, no migrations, no RLS policies. The app
      currently uses only Auth's built-in `auth.users` (see `README.md`). The `elektryk`/`admin`
      roles, the catalogs and their RLS policies are product work, not deployment work.
- [x] Email **signups** left enabled — the PRD allows self-registration alongside admin-created
      accounts.
- [x] **Human:** Authentication → Email → **Confirm email** _off_. Proven by the smoke test:
      sign-in succeeded immediately after sign-up.
      Original rationale — Required twice over: the
      PRD specifies "w MVP bez weryfikacji adresu email", and `scripts/smoke.mjs` asserts sign-in
      succeeds immediately after sign-up.
- [x] **Human:** Project URL and **publishable key** (`sb_publishable_...`) supplied
      (Settings → API Keys). Never `sb_secret_...` or `service_role`.
      Supabase's docs say server-side apps should use the _secret_ key — **that guidance does not
      apply here.** `src/lib/supabase.ts:9` calls `createServerClient` with cookie handlers, so the
      client acts _as the signed-in user_ whose JWT arrives in the cookie, and RLS is the
      enforcement point. A secret key bypasses RLS entirely and would silently destroy the
      per-electrician isolation the PRD requires (`Projekty i dane klientów należące do danego
elektryka są widoczne wyłącznie dla niego`).
      Fallback to verify, not assume: the legacy `anon` JWT is deprecated end-of-2026 but still
      issued on the same page. If sign-in fails in Phase 4, swap to it — `@supabase/ssr` 0.12.7 may
      not handle the new key format. The smoke test settles it.
- [x] **Human:** project region confirmed **EU**.
- [x] `.env` and `.dev.vars` stay pointed at local Supabase. Local dev keeps using
      `npx supabase start`; only production talks to the cloud project.
- [x] Risk recorded: Supabase free projects pause after ~7 days of inactivity — a real "app is
      down on Monday" shape for a single-user MVP.

## Phase 3 — First deploy ✅

- [x] `npm run build` — server built in 4.97s.
- [x] `npx wrangler deploy` — 8 static assets uploaded (2065.69 KiB / 455.48 KiB gzip), Worker
      startup time **18 ms**, deployed to
      **https://rozdzielnica-pro.rozdzielnica-pro.workers.dev**.
      As predicted, wrangler auto-provisioned the `SESSION` KV namespace
      (`rozdzielnica-pro-session`, id `b82d672e388546cb80da1cf52a86bb3f`) without prompting.
- [x] **Unplanned — first-deploy TLS delay.** The URL was unreachable for ~30–60s after deploy:
      both curl/schannel and Node/OpenSSL got `tls alert 40 (handshake_failure)` _from the server_.
      Cause: `wrangler deploy` created the account subdomain `rozdzielnica-pro.workers.dev` in the
      same run, and its certificate had not been issued yet. It resolved on the second poll. Worth
      knowing so a future first deploy on a new account is not misdiagnosed as a broken deploy or a
      corporate TLS-interception problem.
- [x] Interim state confirmed by design, not failure: with no secrets yet, `createClient()`
      returns `null` (`src/lib/supabase.ts:6`) and the live page renders the Polish banner
      _"Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone."_
- [x] **Human gate — runtime secrets** set by the user; the values never entered the agent
      conversation.
      `npx wrangler secret put SUPABASE_URL` · `npx wrangler secret put SUPABASE_KEY`
- [x] **Unplanned — `wrangler secret put` needs a real TTY.** Run through Claude Code's `!` prefix
      it does **not** prompt: stdin hits EOF immediately, wrangler still reports
      `✨ Success! Uploaded secret`, and an empty value is stored. `wrangler secret list` returns
      only names, so it cannot detect this. Re-running from a normal terminal overwrites the bad
      value. Detection is indirect — the "Supabase nie jest skonfigurowany" banner staying up is
      the signal. Alternative inside an agent session: pipe the value
      (`echo "<value>" | npx wrangler secret put NAME`), acceptable **only** for the publishable
      key and Project URL, which are not secrets in the load-bearing sense, and never for
      `sb_secret_` / `service_role`.
- [x] Verified: `npx wrangler secret list` returns `SUPABASE_KEY` and `SUPABASE_URL`, both
      `secret_text`.
- [x] Confirmed no build-time secrets are needed: both fields are `optional: true` in
      `astro.config.mjs:19-20` and `astro:env/server` resolves server secrets at _runtime_ from the
      Worker environment. Flipping `optional` to `false` would break the build, CI and Workers
      Builds — it is load-bearing.

## Phase 4 — Verification ✅

- [x] **`[object Object]` check: CLEAN.** Every route returns real HTML; no route contains the
      string. This confirms correction #1 — the pre-emptive `disable_nodejs_process_v2` flag was
      correctly _not_ added, and `fetch_iterable_type_support` (default-on at
      `compatibility_date: 2026-05-08`) handles it. Measured live, not assumed.
- [x] Edge routing verified against the live Worker:

      | Route | Status | Location | Body | `[object Object]` |
                          | --- | --- | --- | --- | --- |
                          | `/` | 200 | — | 5010 B | no |
                          | `/dashboard` | **302** | **`/auth/signin`** | 0 B | no |
                          | `/auth/signin` | 200 | — | 9452 B | no |
                          | `/auth/signup` | 200 | — | 10952 B | no |
                          | `/nope-404` | 404 | — | 4302 B | no |

                          The `/dashboard` redirect proves `src/middleware.ts` `PROTECTED_ROUTES` executes at the edge;
                          the 404 proves `assets.not_found_handling: "404-page"` is wired correctly.

- [x] Supabase banner **gone** from `/` (body shrank 5010 B → 4623 B) — live proof both secrets
      resolved at runtime and are non-empty.
- [x] **`npm run smoke` against production: all 8 steps passed.** Not "tests passed" — this repo
      has no test suite; this is the single end-to-end auth script.

      | Step | Result |
                          | --- | --- |
                          | home renders | 200 |
                          | dashboard redirects anonymous user | 302 → `/auth/signin` |
                          | signup creates account | 302 → `/auth/confirm-email` |
                          | signin rejects wrong password | 302 → `/auth/signin?error=Invalid%20login%20credentials` |
                          | signin accepts correct password | 302 → `/` |
                          | dashboard renders for signed-in user | 200 |
                          | signout clears session | 302 → `/` |
                          | dashboard redirects after signout | 302 → `/auth/signin` |

                          Two open questions settled as a side effect: **Confirm email is off** (sign-in worked
                          immediately after sign-up), and the **new `sb_publishable_` key format works with
                          `@supabase/ssr` 0.12.7** — the legacy `anon` JWT fallback is not needed.

- [x] **Human:** first `smoke-<timestamp>@example.com` user deleted.
- [ ] **Human — still open:** the Phase 5 re-run created a _second_ `smoke-*@example.com` user
      in production Supabase. Delete it too (Authentication → Users).
- [x] Confirmed no preview URL published. `npx wrangler versions list` shows 4 versions (initial
      deploy + three secret-put redeploys) and reports no preview URL for any of them, consistent
      with `preview_urls: false`.
- [x] Rollback inventory proven: `npx wrangler deployments list` returns the deployment, author
      and version ID. Did not actually roll back.
- [x] `npx wrangler tail` streams live: `GET /`, `GET /dashboard` and `GET /auth/signin` all
      logged `Ok` in real time.
- [x] **Human:** Supabase Site URL set to the production `workers.dev` URL.

## Phase 5 — Cloudflare-native auto-deploy on `master` ✅

Ordering matters: Workers Builds attaches to an **existing** Worker, and the dashboard Worker name
must match `wrangler.jsonc` `name` exactly or every build fails. Phases 1 and 3 guarantee that.

- [x] **Human gate — Git connected.** Cloudflare GitHub App authorized against
      `Mr1008/rozdzielnica-pro`, scoped to that repository only.
- [x] Build settings confirmed in the dashboard: build command `npm run build` · deploy command
      `npx wrangler deploy` · root directory `/` · no build variables.
- [x] Branch control → production branch `master`; "Builds for non-production branches"
      left **off**.
- [x] Verified with commit `bee3a29` pushed to `master`. Workers Builds ran unattended and
      produced version `e607bee3-243b-41f7-ab28-16e5b25d3fbe`, deployed 2026-09-21T13:06:28Z.
- [x] Re-verified after the automated deploy: `/` 200 with no banner, `/dashboard` 302 →
      `/auth/signin`, `/auth/signin` 200, no `[object Object]` anywhere, and **all 8 smoke steps
      passed again**. Runtime secrets survived the redeploy — confirmed, not assumed.
- [x] `.github/workflows/ci.yml` left **unchanged**. It gates quality on push/PR to `master`
      with no deploy step, so it cannot race Workers Builds. Known gap, stated rather than
      hidden: CI and the Cloudflare build run in parallel on the same push, so a **red CI does
      not block the deploy**. Now also logged in the `infrastructure.md` risk register.

## Phase 6 — Record and reconcile ✅

- [x] `context/foundation/infrastructure.md` reconciled: deployed-status banner added, the
      preview-URL operational story corrected, four register rows marked **CORRECTED** or
      **RESOLVED** (process v2, preview URLs, Worker name, Pages target), the binding row
      re-scored **M → H** as partly realised, and three new rows added (Supabase inactivity
      pause, red-CI-does-not-block-deploy, `wrangler secret put` without a TTY).
- [x] `AGENTS.md` updated: the false starter-name tripwire replaced with the live fact (renaming
      now orphans the Worker and its `SESSION` KV namespace), and the language rule rewritten to
      "UI is Polish, code is English" with the no-inline-strings / localization-ready constraint.
- [x] `context/foundation/prd.md` — three new non-functional requirements added covering Polish
      UI, a localization-ready text layer (MVP ships `pl` only), and locale-aware date/number/PLN
      formatting.
- [x] `README.md` Deployment section rewritten: live URL, auto-deploy path, manual fallback,
      the publishable-key rule, the TTY caveat, and the operations commands.
- [x] Committed as `bee3a29` plus a docs follow-up. Nothing secret entered the tree: `.env`,
      `.dev.vars` and `.wrangler/` are gitignored, and no key left the `wrangler secret put`
      prompts.

---

## Files touched

| File                                            | Change                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| `wrangler.jsonc`                                | `name` → `rozdzielnica-pro`; added `preview_urls: false`           |
| `package.json`                                  | `name` → `rozdzielnica-pro`                                        |
| `context/foundation/tech-stack.md`              | frontmatter `deployment_target` → `cloudflare-workers`             |
| `context/foundation/infrastructure.md`          | three corrected/added risk rows                                    |
| `context/changes/deployment/deployment-plan.md` | this file                                                          |
| `AGENTS.md`, `README.md`                        | replace the stale starter-name tripwire; document deploy reality   |
| `.github/workflows/ci.yml`                      | **unchanged, deliberately**                                        |
| `src/**`                                        | **unchanged** — no application code is involved in this deployment |

## Human-only steps, collected

Per the production-access boundary in `infrastructure.md`, the agent does not perform these:
`wrangler login` · Supabase project creation, region and the Confirm-email toggle ·
`wrangler secret put` (both) · Cloudflare GitHub App authorization · deleting the smoke-test user.

## Stop conditions

Abort and report rather than improvise if: `wrangler whoami` still shows unauthenticated after
login; `wrangler deploy` reports a name conflict (an unexpected Worker already owns
`rozdzielnica-pro`); the deployed `/` contains `[object Object]`; or `npm run smoke` fails against
production after secrets are confirmed present.

---

## What the run taught (candidates for `context/foundation/lessons.md`)

1. **A green status code is not a green render.** The CI smoke job asserts only status codes, so the
   `[object Object]` class of failure would have sailed through it. Verifying an SSR deploy means
   asserting on body content, not just on `2xx`.
2. **`wrangler secret put` without a TTY reports success and stores nothing.** `wrangler secret list`
   shows only names, so it cannot detect the empty value. Any "did the secret land?" check has to
   observe the running app.
3. **A first deploy on a fresh Cloudflare account fails TLS for ~30–60s** while the account
   subdomain's certificate is issued — indistinguishable at first glance from a broken deploy or
   corporate TLS interception.
4. **Writing files from Python text mode on Windows silently converts LF to CRLF.** It turned five
   one-line edits into whole-file diffs. Caught only because a diffstat looked implausible; write
   bytes, and read `git diff --stat` before staging.
5. **A research artifact ages between being written and being executed.** Several register entries
   were wrong by deploy time — not carelessly written, just overtaken by platform changes. Verify a
   risk's premise before acting on its mitigation: the pre-emptive `disable_nodejs_process_v2`
   change would have been a real edit made for no reason.
