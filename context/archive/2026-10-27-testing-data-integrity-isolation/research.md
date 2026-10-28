---
date: 2026-10-27T14:52:22+01:00
researcher: Claude (Opus 5.5) for Jakub Michałek
git_commit: d46d3ee11dd5e2f076e24779cabfc3e0ca09db94
branch: master
repository: rozdzielnica-pro (10x)
topic: "Test rollout phase 2 — data integrity and isolation (risks #6, #7): what exists, what is missing"
tags: [research, testing, rls, check-constraints, parsers, snapshots, ci]
status: complete
last_updated: 2026-10-27
last_updated_by: Claude (Opus 5.5)
---

# Research: Test rollout phase 2 — data integrity and isolation

**Date**: 2026-10-27T14:52:22+01:00
**Git Commit**: d46d3ee
**Branch**: master

## Research Question

For `context/foundation/test-plan.md` §3 Phase 2 (risks #6 and #7): inventory the existing RLS
integration suites (tables covered, cross-electrician, admin and anon cases); list every
CHECK↔parser pair and whether any test feeds one fixture to both sides; establish snapshot
immutability coverage (cabinet edit, device edit); and find how CI can run `test:integration`
reusing the `smoke` job's local Supabase.

## Summary

- **RLS (#6):** all 10 tables in `public` have `relrowsecurity = true` on the local stack
  (queried 2026-10-27 with `npx supabase db query --local`). 8 RLS suites cover every one of them
  with owner / second-electrician / admin / anon cases, and both write RPCs are refused to a second
  electrician, the admin and anon. The gaps are narrow: no test asserts "every public table has
  RLS" (a new table without a test file escapes), `profiles` has no case of B updating or deleting
  A's row, and `projects` has no B-specific insert-as-A case (only the owner's
  "insert for another user", `rls-projects.test.ts:213`).
- **Endpoints:** every `[id]` endpoint under `src/pages/api/projects/` builds its client with
  `createClient(request.headers, cookies)` (anon key + the user's cookie token), and a grep of `src/`
  for `SERVICE_ROLE` / `serviceRole` / `createServiceClient` finds nothing. So "there is RLS, so the
  endpoint is secure" holds **only while** no server code holds a service-role key — nothing pins
  that today. The HTTP IDOR e2e is Phase 3.
- **CHECK↔parser parity (#7):** no pair has a test that feeds one fixture to both the parser and the
  database. Every integration CHECK test is DB-only; unit tests are parser-only; the boundaries
  match by hand. Enum unions are pinned at compile time (`AssertTrue<Equals<…>>`), numeric lists and
  ranges are not.
- **Snapshot immutability (#7):** the cabinet side is covered
  (`rls-projects.test.ts:389`, edit + archive, snapshot unchanged). The device side is **not**: no
  test edits or archives a catalog device after it is in `project_devices` and re-reads the row.
- **CI:** the `smoke` job already starts a local Supabase with the custom access-token hook and the
  seeded admin. `npx supabase` resolves to the lock-pinned CLI 2.117.0 (same as `setup-cli`), so
  `support.ts` works unchanged. Adding `npm run test:integration` to that job needs no secrets.

## Detailed Findings

### 1. Tables, policies and RLS tests (risk #6)

RLS enabled on all 10 public tables: `business_profiles, cabinets, circuits, devices,
pricing_profiles, profiles, project_device_placements, project_devices, projects, rcd_groups`
(live query on the local stack; matches the migrations).

| Table / RPC               | Data                              | Policies (migration)                                             | Suite                                         | B-sel  | B-upd                 | B-del          | B-ins into A's parent | B-RPC        | admin               | anon   |
| ------------------------- | --------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- | ------ | --------------------- | -------------- | --------------------- | ------------ | ------------------- | ------ |
| projects                  | electrician                       | `_own` ×4, writes need `user_role='elektryk'` (`20260924150000`) | `rls-projects.test.ts`                        | ✓ :232 | ✓ :239                | ✓ :254         | n/a (owner case :213) | n/a          | ✓ :264              | ✓ :300 |
| rcd_groups, circuits      | electrician                       | `_own` via `exists` on projects (`20260929120000`)               | `rls-circuits.test.ts`                        | ✓ :684 | ✓ :705                | ✓ :705         | ✓ :692                | ✓ :722, :731 | ✓ :743              | ✓ :767 |
| project_devices           | electrician                       | select/insert/delete `_own`, no UPDATE grant                     | `rls-circuits.test.ts`                        | ✓      | n/a (no grant, :419)  | ✓              | ✓                     | ✓            | ✓                   | ✓      |
| project_device_placements | electrician                       | select/insert/delete `_own`, no UPDATE grant (`20261006130000`)  | `rls-layout.test.ts`                          | ✓ :421 | n/a (:343)            | ✓ :435         | ✓ :427, :413          | ✓ :399       | ✓ :448              | ✓ :462 |
| pricing_profiles          | electrician                       | select/insert/update `_own`, no admin policy                     | `rls-pricing-profiles.test.ts`                | ✓ :148 | ✓ :175                | n/a (no grant) | ✓ :155, :168          | n/a          | ✓ :191              | ✓ :231 |
| business_profiles         | electrician                       | same shape (`20261008130000`)                                    | `rls-business-profiles.test.ts`               | ✓ :160 | ✓                     | n/a            | ✓                     | n/a          | ✓ :204              | ✓ :244 |
| profiles                  | per user, admin-visible by design | own + admin (`20260922083135`)                                   | `rls-profiles.test.ts`                        | ✓ :68  | ✗                     | ✗              | n/a                   | n/a          | admin reads all :95 | ✓ :114 |
| cabinets, devices         | catalog                           | active rows to electricians, admin writes, no DELETE             | `rls-cabinets.test.ts`, `rls-devices.test.ts` | n/a    | ✓ electrician refused | n/a            | n/a                   | n/a          | admin cannot delete | ✓      |

Functions: `save_project_circuits` and `save_project_layout` are `security invoker` with EXECUTE
for `authenticated` only. The one `security definer` found is `handle_new_user`
(`20260922083135:95`); `custom_access_token_hook` was not re-checked by the worker.

**Harness reach for a catalog query:** PostgREST does not expose `pg_catalog`, and the repo has no
`pg` driver. `npx supabase db query --local -o json "<sql>"` works with CLI 2.117.0 (verified
2026-10-27) and returns `{ rows: [...] }` — a test can shell out to it the way `support.ts` already
shells out to `supabase status`. It needs no schema change.

### 2. CHECK↔parser pairs (risk #7)

The parsed value already uses DB column names for devices, supply, pricing, business and circuits
(`src/pages/api/profile/pricing.ts:32` upserts `...parsed.value`). Form parsers take `FormData`, so a
shared fixture needs a row → FormData builder (rates in zł, comma decimals for lengths).

| Pair              | DB guard                                                                                            | TS entry point                                             | Existing tests                                                                                                    | Verdict                           |
| ----------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Device parameters | `devices_parameters_match_kind`, latest `20261009120100_comb_busbar_parameters.sql:17`              | `parseDeviceSpec(input)` `device-spec.ts:399` (row-shaped) | DB-only `rls-devices.test.ts:281-382` (cases generated from `PARAMETERS_BY_KIND`), parser over seeded rows `:391` | partial                           |
| Supply            | `projects_*_valid`, `_all_or_nothing` `20260924150000_projects.sql:103-120`                         | `parseSupplyForm(FormData)` `supply-params.ts:143`         | DB-only `rls-projects.test.ts:424, :437`; enums compile-time `supply-params.ts:48-50`                             | one-sided                         |
| Circuits / groups | `rcd_groups_*`, `circuits_*` `20260929120000:56-109`, `rcd_groups_margin_valid` `20260930120000:13` | `parseCircuitsPayload(raw)` `circuit-params.ts:224`        | one DB 23514 case (margin) `rls-circuits.test.ts:~380`                                                            | one-sided                         |
| Pricing           | `pricing_profiles_*` `20260924120000:36-44`                                                         | `parsePricingForm(FormData)` `pricing-profile.ts:65`       | DB-only `rls-pricing-profiles.test.ts:95-105`                                                                     | one-sided                         |
| Business          | `business_profiles_*_valid` `20261008130000:35-54`                                                  | `parseBusinessForm(FormData)` `business-profile.ts:101`    | DB-only `rls-business-profiles.test.ts:102-118`                                                                   | one-sided                         |
| Labour override   | `projects_labour_override_*` `20261008090000:27-36`                                                 | `parseLabourOverrideForm(FormData)` `quote.ts:219`         | DB-only `rls-projects.test.ts:551, :566`                                                                          | one-sided                         |
| Project details   | `projects_name/client_name/site_address_valid` `20260924150000:88-97`                               | `parseProjectDetailsForm(FormData)` `project.ts:140`       | DB-only `rls-projects.test.ts:473`                                                                                | one-sided (not in data-guards.md) |
| busbar_piece      | `project_devices_busbar_piece_valid` `20261009120200:34`                                            | none — a mapping in `device-matching-server.ts:212, :306`  | DB-only `rls-circuits.test.ts:572-598`                                                                            | no parser to compare              |
| Cabinet geometry  | CHECK asserts only `version: 1`                                                                     | `parseCabinetGeometry` `cabinet-geometry.ts:120`           | DB rows through parser `rls-cabinets.test.ts:244`, `karwasz-cabinets.test.ts:29`                                  | deliberately one-directional      |

Known deliberate asymmetries (parser stricter, the safe direction): NIP checksum
(`business-profile.ts:63`), WLZ length decimal places (`supply-params.ts`), device decimal places
(`device-spec.ts`), cabinet geometry. A parity test must record these as "parser rejects, DB
accepts", never as a disagreement to fix.

### 3. Snapshot immutability (risk #7)

- `projects_snapshot_cabinet` (`20260924150000_projects.sql:152-183`): BEFORE INSERT OR UPDATE; on
  insert or a `cabinet_id` change it copies from an active cabinet, otherwise it restores the OLD
  values. Tested: client-sent snapshot ignored (`rls-projects.test.ts:319, :355`), re-snapshot on
  cabinet change (`:376`), admin edit + archive leaves the snapshot (`:389`).
- `project_devices_snapshot_device` (latest `20261006140000_project_device_bars.sql:32-60`): BEFORE
  INSERT only; no UPDATE grant on `project_devices`. Tested: client-sent snapshot ignored
  (`rls-circuits.test.ts:426, :453`), archived device refused (`:606`). **Not tested:** an admin
  edit/archive of a device already snapshotted.
- No cascade from catalog to project rows: `projects.cabinet_id` and `project_devices.device_id`
  FKs have no ON UPDATE/DELETE action; triggers on `cabinets`/`devices` are only `touch_updated_at`
  and `devices_guard_kind_change`.
- `computeMatchView` (`src/lib/device-matching-server.ts:250-266`) re-matches against the live
  catalog and compares selections by role, deviceId, groupId, circuitId, busbarPiece, notes —
  not by price or parameters. "Snapshot unchanged" is a DB property; "match reports stale" is
  TypeScript and belongs in unit tests (out of scope here).

### 4. CI

- `.github/workflows/ci.yml` job `smoke` runs `supabase/setup-cli@v3` (2.117.0), `npm ci`,
  `supabase start -x studio,imgproxy,mailpit,edge-runtime,logflare,vector,realtime,storage-api,postgres-meta,supavisor`.
  No integration test uses storage, realtime or mail.
- `package-lock.json:10490` pins `node_modules/supabase` at 2.117.0, so `npx supabase status` and
  `npx supabase db query` in `support.ts` resolve to the same CLI as `setup-cli`.
- `supabase/config.toml:267-269` enables the custom access-token hook; `supabase/seed.sql:38` seeds
  `admin@example.com`, which `support.ts` `SEEDED_ADMIN` uses.
- `vitest.integration.config.ts` runs files serially (`fileParallelism: false`); users are unique
  per run (`Date.now()` in `createElectrician`). Running the suite before the smoke signup in the
  same job avoids interleaving.

## Architecture Insights

- RLS is the single enforcement point for isolation; endpoints carry no ownership checks of their
  own. That is sound exactly as long as server code never holds the service-role key — worth a
  cheap static guard in `test:unit` so it runs in the `ci` job too.
- The parsers already produce row-shaped values, so one fixture table per pair can drive both
  sides with a thin adapter per pair.

## Historical Context (from prior changes)

- `context/archive/2026-09-29-testing-matching-oracle/` — Phase 1; established the "oracle from
  requirements, not from code" rule this phase follows (fixture verdicts are literals, not computed
  from the parser constants).

## Related Research

- `context/archive/2026-09-29-testing-matching-oracle/research.md`

## Open Questions

None blocking. Decisions for the plan: (1) where the parity fixtures live and how each pair's
adapter maps a row to the parser input; (2) whether the RLS meta-test also asserts that every
electrician-data table has a suite (a maintained classification list) — recommended.
