<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Admin Cabinet Catalog

- **Plan**: context/changes/admin-cabinet-catalog/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-09-23
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 7 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Success criteria re-run for this review: `npx supabase db reset` ✅, `npm run db:types` no diff ✅, `npm run test:unit` 117/117 ✅, `npm run lint` ✅, `npx astro check` 0 errors ✅, `npm run build` ✅, `npm run test:integration` 21/21 ✅, `npm run smoke` (against `npm run preview`) all steps ✅. All manual rows 1.4–4.9 carry observable evidence (browser walkthrough, Studio screenshot, production CI + DB migrate on 8287f37).

Plan drift: every planned contract is MATCH — geometry reaches the DB only through `parseCabinetForm` → `parseCabinetGeometry` (five whitelisted columns, zod strips unknown keys), draft restores only with `?error=`, UUID checked before every query, no `error.message` surfaced, docs synced. Minor drifts: seed cabinet (b) rails are 320 mm, not full width (room for the side bars); see F7 for the inline path.

## Findings

### F1 — `public.profiles` still grants everything, including TRUNCATE, to anon and authenticated

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260922083135_roles_and_profiles.sql:40 (pre-existing, outside this diff)
- **Detail**: Live local grants: `profiles | anon | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE`, same for authenticated. This change's own migration documents why that matters (TRUNCATE ignores RLS; the local stack auto-grants while the cloud project does not) and fixes it for `cabinets` only. PostgREST exposes no TRUNCATE verb, so it is not exploitable over REST today — a defence-in-depth gap and a local/cloud behaviour drift on the F-01 table.
- **Fix**: A new forward-compatible migration applying revoke-all-then-grant to `public.profiles` (authenticated: the operations its policies actually use; anon: nothing), plus an RLS test asserting anon is refused.
  - Strength: Same pattern already proven in `20260923085112_cabinets_catalog.sql`; closes the drift before S-03 adds more tables.
  - Tradeoff: Touches an archived change's table from a new change; needs its own small change folder.
  - Confidence: HIGH — grants verified live; the needed operations are visible in the F-01 policies.
  - Blind spot: Cloud grants not inspected (Supabase MCP targets the cloud project; not checked here).
- **Decision**: FIXED — migration `20260923105613_profiles_explicit_grants.sql` + `refuses anon a select with 42501` in `rls-profiles.test.ts` (red before, green after)

### F2 — Unmapped SQLSTATEs collapse to `unknown`, contradicting the module's own docstring

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/cabinet-errors.ts:46-55
- **Detail**: The docstring (lines 4-8) promises "an unrecognised code still reaches the URL (so it stays diagnosable)", and `src/pages/api/auth/signup.ts:19` does exactly that with `error.code ?? "unknown"`. `cabinetErrorFromPostgrest` instead returns `unknown` for everything but 23505/42501, so a 23514 or `PGRST*` failure is undiagnosable from the URL. AGENTS.md states the same diagnosability rule.
- **Fix**: Default branch returns `error.code ?? CABINET_ERROR.unknown` (widen the return type to `string`); `cabinetErrorMessage` already falls back to generic Polish text; add a test.
- **Decision**: FIXED — default branch returns `error.code ?? "unknown"`; tests cover pass-through (23514, PGRST204) and the no-code fallback

### F3 — Page-load errors are discarded; `[id]` returns 200 on a failed load

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/admin/cabinets/index.astro:26, src/pages/admin/cabinets/[id].astro:30
- **Detail**: On a Supabase error both pages render a generic `loadFailed` banner with neither the code nor a log line surviving — nothing appears in `wrangler tail`, the only observability the project has. `[id].astro` also answers HTTP 200 for a failed load (only a missing row is 404).
- **Fix**: Log `error.code` (not the message) via `console.error` with an eslint-disable for `no-console`, and set `Astro.response.status = 500` on the load-failure branch.
- **Decision**: FIXED — both pages log the SQLSTATE (never the message) and set status 500 on a failed load; not exercised at runtime (needs a failing stack)

### F4 — Editor lists keyed by index, and terminal-group add/remove read render-time state

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/cabinets/CabinetEditor.tsx:574-577, 631, 691, 774-778, 812, 820
- **Detail**: Removable rows use the array index as `key`, so after "Usuń" focus stays on a node that now shows the next element (values stay correct — inputs are controlled). The terminal-group add/remove handlers build from the render-time `bar` instead of the previous state, unlike `setTerminalGroup` (line 426); harmless for discrete clicks today. S-06 will build drag-and-drop on this component.
- **Fix**: Give draft elements a stable client-side id for `key`, and route the two handlers through the functional updater.
- **Decision**: FIXED — draft elements carry a stable `key` (`newDraftKey()`, re-keyed on restore, never emitted into geometry); lists key by it; terminal-group add/remove go through a functional `setTerminalGroups`. Unit-tested; removal focus not re-checked in a browser

### F5 — Draft stays in sessionStorage after a successful save

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/cabinets/CabinetEditor.tsx:354-357, 448-455
- **Detail**: The draft is written on every submit, but cleared only on a later editor visit without `?error=`. After a successful save the admin lands on the list, which never clears it. Behaviour is still correct (a stale draft is never restored without `?error=`); only the leftover storage is untidy. Admin catalog data only.
- **Fix**: Clear `cabinet-draft:*` keys on the list page (tiny inline island or script), or accept as is.
- **Decision**: SKIPPED — deferred; revisit if time is left at the end

### F6 — Integration-test cleanup can silently leak every row

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: tests/integration/rls-cabinets.test.ts:84-90, 143-145, 230
- **Detail**: A failed insert pushes `""` into `createdCabinetIds`; `afterAll`'s `.in("id", [..., ""])` then fails with 22P02, and its error is not checked, so all test rows leak into the local DB. Separately, the seed test expects exactly 3 rows with manufacturer "Przykładowy producent" and breaks if one is created locally through the UI.
- **Fix**: Push only truthy ids, assert the cleanup error is null, and key the seed test on the three seeded models rather than the manufacturer.
- **Decision**: FIXED — only truthy ids recorded, cleanup error now throws, seed test keyed on PRZ-S1/M3/L4; 22/22 pass and the DB ends with the 3 seeded rows

### F7 — Two small i18n / path-helper slips in pages

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/admin/cabinets/[id].astro:49, src/pages/admin/cabinets/index.astro:127
- **Detail**: `[id].astro` composes a user-facing heading inline (`` `${title}: ${row.name}` ``) instead of an i18n function (as `dimensions()` already is). The list builds the archive/restore action URL by hand while every other route uses the `cabinet-catalog.ts` helpers.
- **Fix**: Add `t.cabinets.editor.editTitleFor(name)` and `cabinetArchivePath` / `cabinetRestorePath` helpers (with tests).
- **Decision**: FIXED — `t.cabinets.editor.editTitleFor(name)`; `cabinetArchivePath` / `cabinetRestorePath` helpers (tested) used by the list

### F8 — Drawing: overlapping bar labels, and the error banner is not announced

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/cabinets/CabinetDrawing.tsx (bar labels), server error banner in CabinetEditor.tsx / cabinets/index.astro
- **Detail**: Seen in the browser walkthrough: two bars starting at the same x print their labels on top of each other ("N" over "PE" reads "NE"). The server-error banner has no `role="alert"`, so screen readers do not announce a duplicate-model rejection.
- **Fix**: Offset the label of the bar behind (e.g. place it at the far end), and add `role="alert"` to the banner; or defer both to S-06, which reworks the drawing.
- **Decision**: FIXED (differently) — `role="alert"` added to the shared `ServerError` (editor + sign-in/up forms; page banners already had it via `Banner`). Overlapping bar labels deferred to S-06

### F9 — Out-of-scope changes bundled into the phase commits

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .nvmrc, .github/workflows/ci.yml, AGENTS.md/README.md Node lines (d897831); supabase/config.toml (ffb81e0); .claude/launch.json (6399c36)
- **Detail**: The Node 22 → 24 bump, the `[inbucket]` → `[local_smtp]` rename and the browser-pane preview config landed in feature commits by explicit "Stage all" choices; each is benign and named in its commit body. `.claude/launch.json`'s `preview` entry runs `npm run preview` without a build, so it serves a stale `dist/` or fails when none exists.
- **Fix**: No history rewrite; add a `dev` configuration to `.claude/launch.json` (or a note that it needs `npm run build` first).
- **Decision**: FIXED — `.claude/launch.json` gains a `dev` entry, and `preview` now runs a new `preview:fresh` script (`astro build && astro preview`); verified it starts in the browser pane. Bundled commits accepted as-is (no history rewrite)

### F10 — CI installs the latest Supabase CLI while local uses the locked 2.117.0

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: .github/workflows/ci.yml (setup-cli `version: latest`), supabase/config.toml
- **Detail**: The version skew predates this change, but the `[local_smtp]` key now depends on a recent CLI: an older one would reject it, and a future one could deprecate something else, with no pin to reproduce locally.
- **Fix**: Pin `setup-cli` to the same version as `package-lock.json` (2.117.0) and bump both together.
- **Decision**: FIXED via Fix A — `supabase/setup-cli` pinned to `2.117.0` in `ci.yml` and `db-migrate.yml`, with a comment to keep it in step with `package-lock.json`. Takes effect on the next push
