---
date: 2026-10-27T15:58:06+01:00
researcher: Claude (Opus 5.5) for Jakub Michałek
git_commit: 7aba64c
branch: master
repository: 10x (RozdzielnicaPro)
topic: "Critical-path e2e — cheapest layer for risks #2 and #6 and the S-08 quote candidates (test-plan Phase 3)"
tags: [research, e2e, playwright, ci, idor, device-matching, quote]
status: complete
last_updated: 2026-10-27
last_updated_by: Claude (Opus 5.5)
---

# Research: Critical-path e2e (test-plan §3 Phase 3)

**Date**: 2026-10-27T15:58:06+01:00
**Git Commit**: 7aba64c (master, clean)

## Research Question

For rollout Phase 3 of `context/foundation/test-plan.md` (risks #2 and #6), which flows does the
browser actually have to prove, where does each §6.3 quote candidate belong (unit / integration /
HTTP-through-Playwright), and how can the e2e suite run in CI with the electrician users it needs
and without repository secrets?

## Summary

1. **#2 — stale-match marker.** Inspecting every caller of `save_project_circuits`, no browser path
   leaves the match `stale` from a circuit change: `POST /api/projects/[id]/circuits` re-matches and
   stores the snapshot in the same RPC call. A supply change that changes a supply column deletes the
   snapshot (`projects_clear_device_snapshot`), and the page then shows state `cleared`: a
   `role="status"` alert with the "Dobierz ponownie" button and the unsaved preview. `stale` itself
   comes only from catalog drift (an admin's in-place edit). That is already unit-tested
   (`src/lib/device-matching-server.test.ts:257,261`), and the page renders it through the same alert
   as `cleared`. So the one e2e flow is: save circuits → `current` → change the supply → `cleared`
   marker → "Dobierz ponownie" → `current` again.
2. **#2 — saved circuits come back without loss.** Every circuit and group field survives each hop
   (island → `circuits_payload` JSON in a form field → `parseCircuitsPayload` → `save_project_circuits`
   → reload through `payloadToDraft`); no field was found missing at any hop. A round-trip assertion
   on non-default values of every field after `page.reload()` belongs to the same flow, not a
   separate spec.
3. **#2 — catalog gap.** Already covered by `tests/e2e/seed.spec.ts`; nothing to add.
4. **#6 — IDOR.** For another electrician's id, both project pages answer HTTP 404 with the
   "not found" text. All 9 handlers under `src/pages/api/projects/[id]/` redirect 302 to
   `/dashboard/projects?error=not_found`, given a valid body and the same-origin `Origin` header.
   No endpoint returns a success-looking redirect to B (the four direct UPDATE endpoints and `delete`
   check `data.length === 0`; the RPC-backed ones raise `project_not_found`). One e2e that walks every
   id-taking route as B (page GETs, plus each endpoint POST with a valid body), then re-reads A's
   project as A to prove nothing changed, answers "there is RLS, so the endpoint is secure".
5. **§6.3 quote candidates.** The refusal logic is pure and already unit-tested
   (`src/lib/quote.test.ts`), but the wiring is not. Each candidate is tested over HTTP against the
   preview, inside Playwright, with a throwaway electrician whose pricing-profile state the test owns:
   - no profile → `?error=quote_pricing_not_configured`;
   - a non-current match → `?error=quote_match_not_current`;
   - a forged `labour_override_base_minutes` is ignored;
   - `intent=clear` succeeds while the match is not current.

   B → `not_found` folds into the IDOR spec. Calling the Astro handler directly from Vitest would be
   a first in the repo and would mock exactly the RLS behaviour the test should prove, so it is
   rejected.

6. **CI.** Only the admin is seeded. The local `E2E_USERNAME` was created by hand, and nothing creates
   one in CI. `tests/integration/support.ts` already provisions confirmed electricians through the
   local stack's admin API, reading the keys from `npx supabase status -o env`, so it needs no
   repository secrets. The e2e setup can use it to provision electrician B always, and electrician A
   when `E2E_USERNAME` is unset. The `smoke` job already has the stack, the build and a preview; e2e
   joins it after the smoke script.

## Detailed Findings

### Project page — what each match state renders

- `src/pages/dashboard/projects/[id].astro:137-139` loads the context and calls `computeMatchView`.
  The result renders through `src/components/projects/MatchResult.astro` (mounted at `[id].astro:495`),
  next to the `client:only` `CircuitEditor` island (479-490).
- `computeMatchView` (`src/lib/device-matching-server.ts:250-266`) returns `blocked` | `gaps` |
  `cleared` (fresh match ok, snapshot empty) | `current` | `stale` (snapshot ≠ fresh). There is no
  separate "not matched" state; `cleared` is that state.
- Per state, in `MatchResult.astro`:
  - `current`: heading "Dobrane aparaty" plus the stored table.
  - `stale` and `cleared`: one `<Alert role="status">` (lines 255-267) with a `<form>` posting to
    `/api/projects/{id}/rematch` and the button "Dobierz ponownie". The texts are
    `circuitSection.stale` / `.cleared` (`src/lib/i18n/pl.ts:911-915`). `cleared` also shows the
    preview "Podgląd nowego doboru (niezapisany)".
  - `gaps`: the `role="status"` block "Luki w katalogu aparatów".
  - `blocked`: "Nie można dobrać aparatów".
- Aside badge (`[id].astro:212-230`): "Nieaktualny" for `stale` and `cleared`.
- **Locator trap:** the page has several `role="status"` regions (supply warnings, "Kontrola
  obwodów", the editor's alert). The stale/cleared alert has no heading, so locate it by the button
  name "Dobierz ponownie" or `filter({ hasText })`.

### What produces the marker

- Supply: `src/pages/api/projects/[id]/supply.ts` updates the seven supply columns. The AFTER UPDATE
  trigger `projects_clear_device_snapshot`
  (`supabase/migrations/20260929120000_circuits_and_device_matching.sql:228-253`) deletes
  `project_devices` only `when` one of those columns is distinct. **Re-saving identical values does
  not clear the snapshot**, so the test must change a value.
- Which change to use: changing only "Długość WLZ (m)" keeps the circuits matchable, giving
  `cleared`, not `gaps`/`blocked`. Phase or earthing changes can block (for example 3F circuits on a
  1F supply, or TN-C with groups). Untraced: whether the WLZ length feeds any warning that would
  surface as an extra `role="status"`. This does not affect the button locator.
- Circuits: `circuits.ts` → `matchDevices` → `save_project_circuits` in one call. On gaps or blocked
  it stores an empty snapshot, but the circuits themselves are still stored (seed.spec relies on
  this).
- Rematch: `rematch.ts` takes no fields and redirects to `?saved=rematch#circuits`; the banner is
  `t.projects.page.savedRematch`.

### Circuit round-trip

- The island (`src/components/circuits/CircuitEditor.tsx:396-397`) is a native form with one hidden
  field, `circuits_payload` = `JSON.stringify(draftToPayload(draft))`.
- Group fields:
  - `id`
  - `label` ("Nazwa grupy")
  - `residual_current_ma` ("Prąd różnicowy IΔn")
  - `min_rcd_type` ("Minimalny typ RCD")
  - `rcd_margin_percent` ("Zapas prądu RCD")
- Circuit fields:
  - `id`
  - `rcd_group_id` ("Grupa")
  - `name` ("Nazwa obwodu")
  - `rated_current_a` ("Prąd znamionowy In")
  - `phase_count` ("Liczba faz")
  - `cross_section_mm2` ("Przekrój przewodu")
  - `installation` ("Sposób ułożenia")
  - `entry_side` ("Wprowadzenie przewodów")
- Both sets are present in all of these: `parseCircuitsPayload` (`src/lib/circuit-params.ts:102-103`),
  the RPC (`supabase/migrations/20261009120200_project_device_busbars.sql:59-197`, upsert by client
  id), and `payloadToDraft` (`src/lib/circuit-draft.ts:296`).
- Group cards and circuit rows are `<li aria-label="Grupa RCD „…”">` / `<li aria-label="Obwód „…”">`.
  Selects hold option _values_ (for example `2.5`), so read back with `toHaveValue("<value>")`.
- Defaults:
  - group: "RCD n", 30 mA, type A, 15 %;
  - circuit: "Obwód n", 16 A, 1 faza, 2,5 mm², "W rurce podtynkowo", entry top.

  A loss-detecting test must set non-default values.

- A clean reload restores from the database. The sessionStorage draft is restored only with
  `?error=` present, so after `page.reload()` + `waitForIslands` the values come from the stored rows.

### Seed catalog and a fully matching set

- `supabase/seed.sql:95-180`:
  - MCB B 1P: 6/10/13/16/20/25/32 A, plus a cheaper "Inny" B16.
  - RCD 40 A 30 mA: 2P/4P, types A and AC.
  - RCBO B10/B16.
  - FR 1P–4P, 40/63 A.
  - Comb busbars 1F/3F.
  - PE/N bars.
  - **No B40.**
- Cabinet "Szafka natynkowa średnia, 3 rzędy": 3 × 320 mm rails, top and bottom entries, built-in
  PE and N bars.
- On the seed.spec supply (63 A, TN-S, 1F, Cu 16 mm²), one group with two 16 A circuits should match
  fully: Σ32 A × 1.15 = 36.8 ≤ 40 A RCD. With the margin raised to 20 %, 32 × 1.2 = 38.4 ≤ 40 A still
  matches. Unverified by running: the exact device count, which may include comb busbar pieces. So
  assert headings and states, not "Dobrano N aparatów".

### IDOR — pages and endpoints

- Pages:
  - `[id].astro:80` treats a non-uuid as missing. The RLS-filtered `maybeSingle` returns null for
    B's id. Line 121 sets status 404, and the page renders `t.projects.page.notFound`.
  - All other loaders are gated on `project` (123, 137).
  - `[id]/print.astro` has the same shape (404).
- Endpoints (all 9): `notFound()` = 302 to `/dashboard/projects?error=not_found`.
  - `index`, `supply`, `cabinet`, `quote` and `delete` check `data.length === 0` after
    `.select("id")`.
  - `circuits`, `rematch`, `layout` and `placements` go through `loadMatchBase` /
    `loadLayoutContext` (`not_found`), backed by the RPCs' `project_not_found` (P0002). P0002 is
    already integration-tested at `tests/integration/rls-layout.test.ts:399`.
- **Order trap:** `circuits`, `placements` and `quote` (`set`) parse the body before the ownership
  check. An invalid body yields `?error=circuits_invalid`/`invalid_input` on A's project URL, not
  `not_found`. Not a leak, but the test must send a valid body to reach the ownership branch.
- Origin: Astro's default `checkOrigin` (`node_modules/astro/dist/core/app/origin-check.js:8-35`)
  answers 403 to a form POST without a same-origin `Origin`. Every e2e POST sends
  `Origin: new URL(baseURL).origin`, as seed.spec does.
- Middleware (`src/middleware.ts:13-45`, `src/lib/route-access.ts:18-30`) gates on role only.
  Ownership is RLS plus the id handling above. Nothing reaches a handler before that.

### Quote endpoint (`src/pages/api/projects/[id]/quote.ts`)

- Form fields: `intent`, `labour_hours`, `labour_minutes` (`QUOTE_FIELDS`, `src/lib/quote.ts:181-185`).
- `intent=clear` → `patch` nulls (lines 47-48). It reads neither profile nor match, then
  updates + checks 0 rows.
- `intent=set`:
  - loads the project + the caller's pricing profile; `project.data === null` → `notFound()` (68);
  - `computeQuoteView`: `no_profile` → `quote_pricing_not_configured` (79), checked before
    `not_current` → `quote_match_not_current` (80);
  - stores `labour_override_base_minutes: view.estimateMinutes` (87), recomputed server-side. Any
    posted base field is never read.
- "Przywróć estymację" (`QuoteSection.astro` ~202-215) posts `intent=clear` with `formNoValidate`.
  The form renders only when the quote state is `ready`, so "clear works while the match is not
  current" holds at the endpoint but has no UI path. Test it with a direct POST.
- Existing unit coverage: `src/lib/quote.test.ts` (override bounds 54, outdated base 190, falls back
  once cleared 199, `parseLabourOverrideForm` 210). No test imports anything from `src/pages`; the
  only `src/pages` reference in a test is the text scan in `src/lib/rls-premise.test.ts`.

### Users, auth setup and CI

- Seeding:
  - `supabase/seed.sql` seeds only `admin@example.com`.
  - `handle_new_user` gives `elektryk` by default
    (`supabase/migrations/20260922083135_roles_and_profiles.sql:29,92-109`).
  - `supabase/config.toml:209` `enable_confirmations = false`.
- `tests/integration/support.ts` exports:
  - `readStackEnv` (65: `npx supabase status -o env`);
  - `createServiceClient` (96);
  - `createElectrician(service, label)` (125: `auth.admin.createUser` with `email_confirm: true`);
  - `signIn` (137).

  It imports `@/lib/database.types` (5), and Playwright resolves tsconfig `paths` (`@/*` →
  `./src/*`, `tsconfig.json:8-10`). Unverified by running.

- `tests/e2e/auth.setup.ts` requires `E2E_USERNAME`/`E2E_PASSWORD` and throws without them. It signs
  in through the UI (retrying until hydrated) and saves `playwright/.auth/user.json`. No second user,
  no second storageState.
- Spec duplication: `seed.spec.ts` and `layout-manual-edit.spec.ts` both repeat the ~15-line "new
  project + supply" bootstrap and the asserted delete cleanup. The new specs need the same, so a
  shared helper module is warranted.
- `playwright.config.ts` in CI: `retries: 2`, `workers: 1`, `reporter: "html"`, and
  `webServer.reuseExistingServer: !CI`. In the `smoke` job a preview already runs in the background
  on 4321 when the smoke script finishes. With `reuseExistingServer` false, Playwright's own
  `webServer` would rebuild and fail on the busy port. Either stop the background preview first or
  let CI reuse it.
- `.github/workflows/ci.yml` `smoke`:
  1. starts the stack (studio, mailpit, realtime, storage and others excluded);
  2. writes `.env` / `.dev.vars` from `supabase status`;
  3. runs `test:integration`, build, the preview in the background, `npm run smoke`;
  4. `supabase stop` (`if: always()`).

  Playwright browsers are not on `ubuntu-latest`: `npx playwright install --with-deps chromium` is
  required.

- `.gitignore` covers `playwright/.auth/`, `test-results/`, `playwright-report/`.
- Hooks:
  - the Stop hook (`.claude/hooks/end-of-turn.mjs`) and lint-staged run lint, unit and astro check,
    never e2e;
  - `tests/**/*.ts` is linted (`eslint.config.js:86-87`);
  - `tsconfig.json` includes everything except `dist`, so new e2e files are type-checked.

## Code References

- `src/lib/device-matching-server.ts:250-266` — `computeMatchView` states
- `src/components/projects/MatchResult.astro:255-267` — the stale/cleared alert with "Dobierz ponownie"
- `supabase/migrations/20260929120000_circuits_and_device_matching.sql:228-253` — snapshot-clearing trigger
- `src/components/circuits/CircuitEditor.tsx:396-397` — `circuits_payload` form field
- `src/pages/dashboard/projects/[id].astro:80,121` — non-uuid / not-found → 404
- `src/pages/api/projects/[id]/quote.ts:47-98` — clear branch, not_found, refusals, server-side base
- `src/lib/quote.ts:181-233` — quote form fields and parser
- `tests/integration/support.ts:65,96,125,137` — stack env and user provisioning
- `tests/e2e/auth.setup.ts`, `tests/e2e/seed.spec.ts`, `tests/e2e/hydration.ts` — current e2e pattern
- `.github/workflows/ci.yml` — `smoke` job
- `playwright.config.ts` — `reuseExistingServer: !CI`, html reporter

## Architecture Insights

- The project page recomputes the match on every render and compares it with the stored snapshot.
  "What the electrician sees" therefore depends on the snapshot _and_ the live catalog, which is why
  the stale marker can only be proven end to end by changing stored state, not by rendering a
  fixture.
- Ownership is never checked in TypeScript. RLS makes another electrician's row invisible, and each
  handler turns "invisible" into `not_found` (an empty read, 0 rows updated, or P0002 from an RPC).
  The handler-level conversion is exactly what RLS integration tests cannot see, so it is the e2e's
  target.

## Historical Context (from prior changes)

- `context/foundation/test-plan.md` §6.6 Phase 3 note: the bootstrap, `seed.spec.ts` and `test:e2e`
  were delivered 2026-10-20. Still open: stale match, IDOR, CI.
- §6.3 lists the S-08 impl-review F7 quote candidates (`quote-cost-estimate` archive).
- `context/changes/testing-data-integrity-isolation/` (Phase 2): integration-level RLS denial for
  every table and `test:integration` in the `smoke` job. Phase 3 does not repeat the RLS cases.
- Memory/notes: email confirmation stays disabled (issue #30 closed 2026-10-27), so provisioned and
  signed-up users can sign in at once.

## Related Research

- `context/archive/2026-09-29-testing-matching-oracle/research.md` — Phase 1 (unit oracle for matching)

## Open Questions

- Exact device count for the matching set. Avoided by asserting states, not counts.
- Whether `astro preview` started by the smoke step can be reused by Playwright in CI, or whether the
  plan should stop it and let `webServer` rebuild. Decided in the plan; both work.
