---
bootstrapped_at: 2026-09-16T08:15:34Z
starter_id: 10x-astro-starter
starter_name: 10x Astro Starter (Astro + Supabase + Cloudflare)
project_name: rozdzielnica-pro
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: npm audit --json
---

## Hand-off

Verbatim copy of the frontmatter from `context/foundation/tech-stack.md`:

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: rozdzielnica-pro
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
```

### Why this stack

A solo electrician-developer shipping a switchboard-planning MVP in three after-hours weeks, under a hard free-tier constraint for hosting, database and deployment. Astro plus Supabase plus Cloudflare is the recommended default for a JS/TS web app and clears all four agent-friendly gates: TypeScript contracts end to end, conventional layout and routing, heavy presence in training data, and current pinned docs. It also answers the PRD directly — Supabase covers email-and-password auth, the two-role model and the per-electrician data isolation required by the non-functional requirements, without a bespoke auth build; React islands carry the editable cabinet-layout view while the rest of the app stays static and cheap. Cloudflare Pages and the Supabase free tier keep running costs at zero for the MVP, which .NET on Azure F1 could not match. Payments, realtime, AI and background jobs are all out of scope per the PRD non-goals, so nothing in the stack is provisioned for them. CI runs on GitHub Actions with auto-deploy on merge, the shape the starter ships with. One known constraint: the edge runtime cannot render server-side PDFs, so the printable quote uses browser-side print or client-side PDF generation.

## Pre-scaffold verification

| Signal      | Value                                                     | Severity | Notes                                                                                    |
| ----------- | --------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| npm package | not run                                                   | n/a      | `cmd_template` starts with `git clone`; no `create-*` CLI to resolve a package name from |
| GitHub repo | przeprogramowani/10x-astro-starter last pushed 2026-09-12 | fresh    | from `card.docs_url`; 4 days before the run                                              |

No stale signal. Proceeded without a heads-up.

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`
**Strategy**: git-clone
**Exit code**: 0
**Files moved**: 30731 (51 excluding `node_modules/`); 21 top-level entries
**Conflicts (.scaffold siblings)**: CLAUDE.md → `CLAUDE.md.scaffold`
**.gitignore handling**: moved silently (absent in cwd before the run)
**.bootstrap-scaffold cleanup**: deleted
**Upstream `.git/` handling**: `.bootstrap-scaffold/.git/` deleted before move-up; no upstream history leaked into the project

Top-level entries moved into the working directory: `.env.example`, `.github/`, `.gitignore`, `.husky/`, `.nvmrc`, `.prettierrc.json`, `.vscode/`, `AGENTS.md`, `README.md`, `astro.config.mjs`, `components.json`, `eslint.config.js`, `node_modules/`, `package-lock.json`, `package.json`, `public/`, `scripts/`, `src/`, `supabase/`, `tsconfig.json`, `wrangler.jsonc`.

Pre-existing entries left untouched: `.10x-cli.json`, `.agents/`, `.claude/`, `CLAUDE.md`, `context/`, `skills-lock.json`.

The scaffold shipped no `context/**` paths, so the drop rule was not exercised this run; `context/` is intact and `context/foundation/tech-stack.md` verified present after the move.

Install note: `npm install` reported 3 packages with install scripts not yet approved (`esbuild@0.28.2`, `workerd@1.20260911.1`, `esbuild@0.28.1`). Run `npm approve-scripts --allow-scripts-pending` to review them if the build needs their postinstall steps.

## Post-scaffold audit

**Tool**: `npm audit --json`
**Exit code**: 0
**Summary**: 0 CRITICAL, 0 HIGH, 0 MODERATE, 0 LOW (0 INFO; 0 total)
**Dependencies scanned**: 804 total — 377 prod, 269 dev, 167 optional, 0 peer
**Direct vs transitive**: not applicable — no findings to split

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

None.

#### LOW / INFO findings

None.

Clean tree at scaffold time. Advisory state drifts as upstream publishes; re-run `npm audit` before shipping.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | false                |
| has_background_jobs     | false                |

v1 records these for the audit trail only. Notably: `has_auth: true` did not change the scaffold (the starter ships Supabase auth regardless), and no CI/CD files were generated from `ci_provider` / `ci_default_flow` — the starter's own `.github/` came through the scaffold as-is. `bootstrapper_confidence: first-class` and `quality_override: false` required no compensating action.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:

- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep. This run created one: `diff CLAUDE.md CLAUDE.md.scaffold`.
- Copy `.env.example` to `.env` and fill in your Supabase and Cloudflare credentials before the first run.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log (clean this run).
