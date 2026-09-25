# Project Setup and Supply Parameters Implementation Plan

## Overview

Roadmap S-03 (FR-003, FR-004, FR-005, US-01). An `elektryk` creates a project with a name, an
optional client and site address, and a cabinet picked from the admin catalog. The cabinet is
**snapshotted** into the project by a database trigger. On the project page they then enter the OSD
parameters (pre-meter protection, earthing system, phase count) and the WLZ parameters (length,
cross-section, material, installation method). The page shows non-blocking warnings about the supply:
WLZ ampacity below the pre-meter protection, minimum cross-sections, and WLZ voltage drop. A project
belongs to its electrician only. The admin never sees it.

## Current State Analysis

- There is no `projects` table and no project UI. `src/pages/dashboard.astro` is a greeting, a
  pricing-not-configured notice (`:45-52`) and a `<nav>` with one card (`:54-62`).
- Cabinets: `supabase/migrations/20260923085112_cabinets_catalog.sql:29-43`. The geometry CHECK only
  asserts an object at `version: 1` (`:38`). Every authenticated user reads non-archived rows through
  `cabinets_select_active` (`:75-78`). **Once a cabinet is archived, the electrician can no longer read
  it**, so a join from a project would return null. That's why the name, manufacturer, model and price
  are snapshotted along with the geometry.
- The snapshot rule was decided in S-02 (`context/archive/2026-09-23-admin-cabinet-catalog/plan.md:82-83`).
  Picking a cabinet copies its geometry into the project. Admin edits never shift a project, and
  archiving only hides the cabinet from the picker.
- The owner-only table pattern is `supabase/migrations/20260924120000_pricing_profiles.sql`. It uses
  `touch_updated_at` (`:47-50`) and revoke-all-then-grant (`:56-65`). Its select policy checks `uid`
  only (`:71-74`). Its insert and update policies also require the inline
  `coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'` (`:79-97`). It has no admin policy.
- The double-guard pattern is the `devices_parameters_match_kind` CHECK plus `parseDeviceSpec`. It
  includes the enum type-equality assertions in `src/lib/device-spec.ts` (`_DeviceKindInSync` and the
  others).
- The endpoint pattern (FormData → parser → write → redirect with `?error=`) comes from
  `src/pages/api/profile/pricing.ts` and `src/pages/api/admin/cabinets/[id]/index.ts`. The second one
  treats a zero-row update as `not_found`. The error-map pattern is `src/lib/cabinet-errors.ts` /
  `src/lib/pricing-errors.ts`. The id guard is `isUuid` (`src/lib/catalog.ts:11`).
- `CabinetDrawing` (`src/components/cabinets/CabinetDrawing.tsx:61`) is pure and renders server-side
  from a parsed `CabinetGeometry` (`src/pages/admin/cabinets/index.astro:41, :93`).
- Route gates (`src/lib/route-access.ts:18-27`): `/dashboard` already covers `/dashboard/projects/*`
  (asserted at `route-access.test.ts:37`). **`/api/projects` needs its own entry.**
- RLS test harness: `tests/integration/support.ts` (`createElectrician`, `signIn`, `SEEDED_ADMIN`,
  `createServiceClient`). The models are `rls-pricing-profiles.test.ts` and `rls-cabinets.test.ts`.

## Desired End State

- `/dashboard` links to `/dashboard/projects`. That list shows the electrician's projects with
  name, client, cabinet name, last update date, and a "przyłącze nieuzupełnione" badge where
  applicable.
- `/dashboard/projects/new` asks for a name, an optional client and address, and a cabinet. The
  cabinets are a radio list of active catalog cabinets, each with a server-rendered drawing. Saving
  lands on `/dashboard/projects/<id>`.
- The project page shows:
  - the details form
  - the snapshotted cabinet (name, model, drawing)
  - a cabinet-change form
  - the OSD/WLZ form (empty the first time)
  - the warnings computed from the saved supply parameters
  - a delete form behind a required confirmation checkbox
- The admin gets zero project rows and cannot write one. Neither can another electrician.
- Admin edits to a cabinet never change an existing project. Once a cabinet is archived, it stops
  appearing in the picker, but the projects that use it keep their snapshot.

### Key Discoveries:

- Archived cabinets are invisible to electricians under RLS (`cabinets_catalog.sql:75-78`). A
  snapshot that keeps only `cabinet_id` and the geometry would lose the cabinet's name and price.
- The electrician can write to `projects` directly through PostgREST with their own token.
  Snapshot columns the client could write are therefore untrusted. Only a trigger makes the snapshot
  a guarantee rather than a convention.
- An upsert or insert refused by RLS raises `42501`, while a refused update matches zero rows
  (`src/pages/api/profile/pricing.ts:27`, `src/pages/api/admin/cabinets/[id]/index.ts`).

## What We're NOT Doing

- No circuits, RCD groups, device matching, layout or quote. Those are S-04 to S-09.
- No blocking validation between fields and no full standards calculation. The warnings are
  informational and simplified: no temperature or grouping correction factors (PRD `## Non-Goals`).
- No checks that need circuits (TN-C vs RCD, switch-disconnector rating). Those belong to S-04.
- No decision about what a cabinet change does to a layout, because S-03 has no layout. S-05
  decides that.
- No "refresh snapshot from the catalog" action. Re-selecting the same cabinet is not a change.
- No custom or off-catalog cabinet (parked at FR-004), no project templates or copying, no notes field.
- No React island and no draft storage. The forms are plain server-rendered forms. After a
  server-side rejection, the create form starts empty again, while the project-page forms re-fill
  from the stored row, as the pricing profile does.
- No admin view of projects and no soft delete. Deleting is a hard `DELETE` behind a confirmation.

## Implementation Approach

The database is the boundary. The trigger owns the snapshot, the CHECKs own the value lists and the
all-or-nothing supply rule, and RLS owns isolation. The TS parsers mirror the CHECKs exactly, so the
form and the database reject the same things. The warnings are pure functions over the stored supply
parameters, computed on render and never stored.

Supply parameters (decided in planning):

| Column                  | Type                      | Allowed values                                                                                                                                                        |
| ----------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `premeter_protection_a` | integer                   | 16, 20, 25, 32, 40, 50, 63                                                                                                                                            |
| `earthing_system`       | enum `earthing_system`    | `TN-C`, `TN-S`, `TN-C-S`, `TT`                                                                                                                                        |
| `phase_count`           | smallint                  | 1, 3                                                                                                                                                                  |
| `wlz_length_m`          | numeric(4,1)              | 0 < L ≤ 500.0, at most one decimal place                                                                                                                              |
| `wlz_cross_section_mm2` | numeric(3,1)              | 2.5, 4, 6, 10, 16, 25, 35                                                                                                                                             |
| `wlz_material`          | enum `conductor_material` | `Cu`, `Al`                                                                                                                                                            |
| `wlz_installation`      | enum `wlz_installation`   | `surface` (natynkowo), `conduit_surface` (w rurce natynkowo), `conduit_flush` (w rurce podtynkowo), `in_wall` (bezpośrednio w ścianie/tynku), `in_ground` (w gruncie) |

Warnings (decided in planning; all non-blocking):

| Code                            | Fires when                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `wlz_ampacity_below_protection` | Tabulated ampacity (material × cross-section × reference method × loaded conductors) < `premeter_protection_a` |
| `aluminium_below_minimum`       | `wlz_material = Al` and cross-section < 16 mm²                                                                 |
| `pen_below_minimum`             | `earthing_system = TN-C` and cross-section < 10 mm² Cu / < 16 mm² Al                                           |
| `voltage_drop_high`             | ΔU% > 0.5 (N SEP-E-002, WLZ up to 100 kVA), computed at the full pre-meter protection current                  |

## Critical Implementation Details

- **The snapshot trigger is the only writer of the snapshot columns.** `projects_snapshot_cabinet`
  (BEFORE INSERT OR UPDATE, security invoker, `set search_path = ''`) behaves as follows:
  - **On INSERT, or when `cabinet_id` differs from `old.cabinet_id`**, it overwrites
    `cabinet_geometry`, `cabinet_name`, `cabinet_manufacturer`, `cabinet_model` and
    `cabinet_price_grosze` from `public.cabinets where id = new.cabinet_id and archived_at is null`.
    If no row matches (archived, missing, or invisible), it raises SQLSTATE `P0002`.
  - **On any other UPDATE**, it resets those five columns to their `old` values.

  Client-sent snapshot values are therefore ignored, never rejected. The copied geometry has already
  passed `parseCabinetGeometry` on its way into `cabinets`, which satisfies the AGENTS.md rule. Add
  `projects.cabinet_geometry` to that tripwire as "written only by the trigger".

- **Two guards, one list.** The value lists above live in the migration CHECKs/enums and in
  `src/lib/supply-params.ts`. The enum unions get the same `Equals<…, Enums<…>>` assertions as
  `device-spec.ts`, and the integer and decimal lists are exported constants that the migration
  comment names. Add the pair to the AGENTS.md tripwires.
- **The ampacity table is transcribed data, and an electrician must check it.** Source: PN-HD
  60364-5-52:2011, tables B.52.2–B.52.5. Use PVC insulation at 70 °C, 30 °C air / 20 °C ground, and
  no correction factors. The loaded-conductor count is 2 for single-phase and 3 for three-phase.
  Map installation methods to reference methods as follows: `surface` → C, `conduit_surface` → B2,
  `conduit_flush` → B2, `in_wall` → C, `in_ground` → D1. Put the source and the mapping in a comment
  above the constant. A unit test asserts that every material × cross-section × method × loaded-count
  combination has an entry, so a gap can never silently suppress the warning. The values themselves
  are checked by hand (Phase 3 manual criteria).
- **Voltage-drop formula.** Use γ Cu = 56 and γ Al = 34 m/(Ω·mm²), cos φ = 1, and I = `premeter_protection_a`.
  - Single-phase: ΔU% = 200·L·I / (γ·S·230).
  - Three-phase: ΔU% = 100·√3·L·I / (γ·S·400).

  Reference cases for the tests: 25 A, 15 m, Cu 10 mm² gives ≈ 0.58 % single-phase (warns) and
  ≈ 0.29 % three-phase (no warning). The warning text must say it is computed at the full protection
  current, so it errs on the high side.

## Phase 1: Data and validation

### Overview

The table, enums, trigger, CHECKs and RLS, plus the parsers that mirror them. All of it is proven by
unit and RLS integration tests before any UI exists.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_projects.sql`

**Intent**: Create the owner-only projects table with the trigger-owned cabinet snapshot and the
supply columns, re-runnable like the earlier migrations.

**Contract**:

- **Enums**: `public.earthing_system`, `public.conductor_material` and `public.wlz_installation`,
  with the values from the table above.
- **Table `public.projects`**:
  - `id uuid pk default gen_random_uuid()`
  - `user_id uuid not null references public.profiles(id) on delete cascade`
  - `name text not null`, `client_name text null`, `site_address text null`
  - `cabinet_id uuid not null references public.cabinets(id)`
  - the snapshot columns `cabinet_geometry jsonb not null`, `cabinet_name`, `cabinet_manufacturer`,
    `cabinet_model text not null`, `cabinet_price_grosze integer not null`
  - the seven supply columns, nullable
  - `created_at` and `updated_at timestamptz not null default now()`
- **Named CHECKs**:
  - `projects_name_valid`: trimmed, 1–200 chars
  - `projects_client_name_valid`, `projects_site_address_valid`: null, or trimmed with 1–200 / 1–300
    chars
  - one CHECK per supply column's list or range
  - `projects_supply_all_or_nothing`: all seven null or all seven set
- **Index**: on `user_id`.
- **Triggers**: `projects_touch_updated_at` (reuses `public.touch_updated_at()`) and
  `projects_snapshot_cabinet` (see Critical Implementation Details).
- **RLS**: enabled. `revoke all` from `anon` and `authenticated`, then
  `grant select, insert, update, delete` to `authenticated`.
- **Policies**:
  - `projects_select_own`: `user_id = (select auth.uid())`
  - `projects_insert_own`, `projects_update_own` (using + with check) and `projects_delete_own`: own
    `uid` **and** the `elektryk` claim, inline as in `pricing_profiles`
  - no admin policy, with a comment explaining why

#### 2. Database types

**File**: `src/lib/database.types.ts`

**Intent**: Regenerate so the table and the three enums are typed.

**Contract**: `npm run db:types` output committed.

#### 3. Supply parameters: lists and parser

**File**: `src/lib/supply-params.ts` (+ `src/lib/supply-params.test.ts`)

**Intent**: The single TS source of the supply value lists. It turns the supply form into the column
shape, rejecting exactly what the CHECKs reject, and pre-fills the form from a stored row.

**Contract**:

- **Value lists**: exports `PREMETER_PROTECTIONS_A`, `EARTHING_SYSTEMS`, `PHASE_COUNTS`,
  `WLZ_CROSS_SECTIONS_MM2`, `CONDUCTOR_MATERIALS`, `WLZ_INSTALLATIONS`, `MAX_WLZ_LENGTH_M` (500) and
  `SUPPLY_FIELDS` (form names). The enum lists carry type-equality assertions against
  `Enums<"earthing_system">` and the other enums.
- **Types**: `SupplyParams` (the seven columns, non-null) and `supplyFromRow(row): SupplyParams | null`
  (null when the columns are unset).
- **`parseSupplyForm(form)`**: returns `{ ok: true; value: SupplyParams } | { ok: false; code: "invalid_input" }`.
  The length accepts a comma or a dot and at most one decimal place.
- **`supplyFormDefaults(row)`**: returns strings, or empty strings when unset, and round-trips
  through the parser.
- **Tests**: every list boundary (a value just outside each list), length `0`, `0,1`, `500`, `500,1`,
  `12,34` and `-1`, a missing field, and the pre-fill round trip.

#### 4. Project details and cabinet choice parser

**File**: `src/lib/project.ts` (+ `src/lib/project.test.ts`)

**Intent**: Paths and form parsing for the project's own fields.

**Contract**:

- **Paths**: `PROJECTS_PATH` (`/dashboard/projects`), `projectPath(id)`, `NEW_PROJECT_PATH`, and the
  API path builders under `/api/projects`.
- **Fields**: `PROJECT_FIELDS`.
- **`parseProjectDetailsForm(form)`**: name required, trimmed, ≤ 200. Client and address are optional,
  a blank value becomes `null`, and the limits are ≤ 200 / ≤ 300.
- **`parseCabinetChoice(form)`**: returns a uuid via `isUuid`, or `invalid_input`.
- **`parseNewProjectForm(form)`**: details plus the cabinet choice.
- **`parseDeleteConfirmation(form)`**: the checkbox is required.
- **Tests**: each limit, whitespace-only values, and a non-uuid cabinet.

#### 5. RLS and trigger integration test

**File**: `tests/integration/rls-projects.test.ts`

**Intent**: Prove isolation and snapshot integrity against the live stack.

**Contract**:

- **Isolation**:
  - Electrician A can insert, read, update and delete their own project.
  - Electrician B reads zero of A's rows, and B's update or delete of A's project matches zero rows.
  - The admin reads zero rows, and the admin's insert is refused with `42501`.
  - Anon is refused.
- **Snapshot**:
  - A client-sent `cabinet_geometry` and `cabinet_name` on insert are replaced by the cabinet's values.
  - An insert with an archived cabinet is refused with `P0002`.
  - An update of `cabinet_geometry` alone leaves it unchanged.
  - Changing `cabinet_id` re-snapshots from the new cabinet.
  - After the admin edits and archives the original cabinet (via service client), the project's
    snapshot is unchanged and the project still reads.
- **CHECKs**: a partial supply (some columns null) is refused with `23514`, and so is an off-list value
  (e.g. `premeter_protection_a = 30`).
- **Cleanup**: follows `rls-pricing-profiles.test.ts`.

### Success Criteria:

#### Automated Verification:

- Migration applies on a clean stack: `npx supabase db reset`
- Regenerated types are committed and `npx astro check` passes
- Parser unit tests pass: `npm run test:unit`
- RLS and trigger assertions pass against the local stack: `npm run test:integration`
- Lint passes: `npm run lint`

#### Manual Verification:

- In local Studio, `projects` shows RLS enabled with exactly four policies, none for the admin

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to
the next phase.

---

## Phase 2: Projects — list, creation, project page

### Overview

The electrician-facing project list, the create form, and the project page with its details, cabinet
change and delete write paths. The supply form arrives in Phase 3.

### Changes Required:

#### 1. Route gate

**File**: `src/lib/route-access.ts` (+ `src/lib/route-access.test.ts`)

**Intent**: Gate the project endpoints to electricians.

**Contract**: a new entry `{ prefix: "/api/projects", roles: ["elektryk"] }` with a comment. Tests
confirm an admin and an anonymous POST to `/api/projects` and `/api/projects/<id>/delete` are
redirected, and an electrician is allowed.

#### 2. Error codes

**File**: `src/lib/project-errors.ts` (+ `src/lib/project-errors.test.ts`)

**Intent**: The code-not-message mapping for the project endpoints.

**Contract**:

- **`PROJECT_ERROR`** codes: `not_configured`, `forbidden`, `not_found`, `invalid_input`,
  `cabinet_unavailable` and `unknown`.
- **`projectErrorMessage(code)`** returns the Polish text; an unknown code gets the generic message.
- **`projectErrorFromPostgrest(error)`** maps `42501` → forbidden, `23514` → invalid_input and
  `P0002`/`23503` → cabinet_unavailable. Other codes pass through.

#### 3. Endpoints

**Files**: `src/pages/api/projects/index.ts`, `src/pages/api/projects/[id]/index.ts`,
`src/pages/api/projects/[id]/cabinet.ts`, `src/pages/api/projects/[id]/delete.ts`

**Intent**: Create a project, update its details, change its cabinet, and delete it. Every endpoint
follows the FormData → parser → write → redirect shape.

**Contract**: all are `POST`.

- **Create** inserts `{ user_id: locals.user.id, ...details, cabinet_id }` and redirects to
  `projectPath(id)?created=1`. On failure it redirects to `NEW_PROJECT_PATH?error=<code>`.
- **Details / cabinet** do `.update(...).eq("id", id).select("id")`. Zero rows means `not_found`.
  They redirect to `projectPath(id)?saved=details|cabinet` or `?error=`.
- **Delete** requires the confirmation checkbox and redirects to `PROJECTS_PATH?deleted=1`.
  Zero rows means `not_found`.
- **Shared rules**:
  - `isUuid` guards the `[id]` segment.
  - A null `createClient()` gives `not_configured`.
  - A null `locals.user` redirects to sign-in.
  - Supabase's message is never forwarded.

#### 4. Pages

**Files**: `src/pages/dashboard/projects/index.astro`, `src/pages/dashboard/projects/new.astro`,
`src/pages/dashboard/projects/[id].astro`

**Intent**: The list, the create form, and the project page (the hub later slices extend).

**Contract**:

- **List**:
  - Loads the electrician's own projects ordered by `updated_at desc`.
  - Shows the name, client, `cabinet_name` and `formatDate(updated_at)`.
  - Shows a "przyłącze nieuzupełnione" badge when `supplyFromRow` returns null.
  - Has an empty state, a "Nowy projekt" button, and a `?deleted` banner.
- **New**:
  - Loads active cabinets (RLS already hides archived ones), sorted by name.
  - Shows a radio list, each option with `CabinetDrawing` from `parseCabinetGeometry`. A cabinet that
    fails to parse is listed without a drawing.
  - When there are no cabinets, it shows a Polish "katalog szafek jest pusty — skontaktuj się z
    administratorem" and no form.
- **Project**:
  - `isUuid` guard, then `.maybeSingle()`; a missing row returns 404.
  - Sections: the details form (pre-filled), and the cabinet section with the snapshot's name,
    manufacturer, model and drawing. The cabinet section's change form lists active cabinets with the
    current one preselected when still active.
  - A delete form with a required "Potwierdzam usunięcie projektu" checkbox.
  - `Banner` for `?created`, `?saved` and `?error`.
- **All pages**: a load failure logs only the SQLSTATE. No role check in the pages.

#### 5. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Make projects reachable.

**Contract**: a "Projekty" card in the existing `<nav>`, placed before the pricing card.

#### 6. Messages

**File**: `src/lib/i18n/pl.ts`

**Intent**: Every new string is Polish and lives in the catalog.

**Contract**: a `projects` group (list, new, project page, fields, cabinet section, delete
confirmation, banners, empty states, supply-missing badge) and a `projectErrors` group (one entry per
`PROJECT_ERROR` code). Counts go through `plural()` and dates through `formatDate`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests pass, including the route-gate and error-map cases: `npm run test:unit`
- Build passes: `npm run build`
- RLS suite still passes: `npm run test:integration`
- Smoke script still passes against the dev server: `npm run smoke`

#### Manual Verification:

- As a fresh electrician: dashboard → Projekty (empty state) → Nowy projekt → pick a cabinet → the
  project page shows its drawing, and the list shows the project with the supply-missing badge
- Editing the details and changing the cabinet both persist. After a cabinet change, the page shows the
  new cabinet's drawing
- As the seeded admin, editing that cabinet's geometry leaves the project's drawing unchanged. After
  the admin archives it, the cabinet disappears from the electrician's picker, while the project still
  shows its snapshot
- Deleting without ticking the checkbox is blocked. With it ticked, the project is gone from the list
- A second electrician gets 404 on the first electrician's project URL; the admin is redirected to `/admin`
- All visible text is Polish

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to
the next phase.

---

## Phase 3: OSD/WLZ parameters and warnings

### Overview

The supply form and endpoint, the warning rules, their display on the project page, and the
documentation.

### Changes Required:

#### 1. Warning rules

**File**: `src/lib/supply-warnings.ts` (+ `src/lib/supply-warnings.test.ts`)

**Intent**: Pure, informational checks over saved supply parameters, as decided in planning.

**Contract**:

- **Warning shape**: `SupplyWarning` is a discriminated union of
  - `wlz_ampacity_below_protection` (`ampacityA`, `protectionA`)
  - `aluminium_below_minimum`
  - `pen_below_minimum` (`minimumMm2`)
  - `voltage_drop_high` (`percent`, rounded to 2 decimals, and `limitPercent` 0.5)
- **Exports**:
  - `supplyWarnings(params: SupplyParams): SupplyWarning[]`, in a stable order
  - `AMPACITY_A`, the table described in Critical Implementation Details
  - `REFERENCE_METHOD_BY_INSTALLATION`
  - `voltageDropPercent(params)`
  - `supplyWarningMessage(warning)`, which returns Polish text via `t`
- **Tests**:
  - Table completeness over every combination.
  - Each warning fires and does not fire at its boundary: protection equal to ampacity gives no
    warning; Al 16 gives none, Al 10 warns; TN-C Cu 10 gives none, Cu 6 warns; TN-S Cu 6 gives no
    PEN warning.
  - The two voltage-drop reference cases (0.58 % and 0.29 %).
  - A fully compliant supply returns `[]`.

#### 2. Supply endpoint

**File**: `src/pages/api/projects/[id]/supply.ts`

**Intent**: Validate and save the project's supply parameters.

**Contract**: `POST`. It runs `parseSupplyForm`, then `.update(value).eq("id", id).select("id")`.
Zero rows means `not_found`. It redirects to `projectPath(id)?saved=supply` or `?error=<code>`. The
other rules are the same as the Phase 2 endpoints. Warnings never block the save.

#### 3. Project page: supply section

**File**: `src/pages/dashboard/projects/[id].astro`

**Intent**: The OSD/WLZ form and the warnings.

**Contract**:

- **Form**: `<select>`s for protection, earthing system, phases, cross-section, material and
  installation, with Polish labels from `pl.ts`. The length is a text input with
  `inputmode="decimal"` and a `pattern` matching the parser. Every field is `required` and pre-filled
  via `supplyFormDefaults`.
- **Warnings**: when `supplyFromRow` is non-null, a `role="status"` list shows one Polish message per
  warning. It also carries the note that the checks are simplified and informational (no correction
  factors, ΔU at the full protection current). When the list is empty, the page says the supply
  raised no warnings. When the supply is unset, a notice says it has to be filled in before circuits
  (S-04).

#### 4. Messages

**File**: `src/lib/i18n/pl.ts`

**Intent**: Every Polish string for supply and warnings.

**Contract**: a `supply` group (section title, field labels, option labels for every enum value and
installation method, hints with units, save, saved, not-configured notice) and a `supplyWarnings`
group (one message per code with its parameters, formatted through `formatNumber`, plus the
simplification note and the no-warnings text).

#### 5. Docs

**Files**: `README.md`, `AGENTS.md`

**Intent**: Keep the route tables and tripwires accurate.

**Contract**:

- **README**: the routes table gains `/dashboard/projects`, `/dashboard/projects/new` and
  `/dashboard/projects/[id]`.
- **AGENTS.md**:
  - The product-code list gains the new paths.
  - The "project must snapshot" tripwire is updated to say the snapshot is written only by the
    `projects_snapshot_cabinet` trigger.
  - A new tripwire says the supply CHECKs/enums and `supply-params.ts` change together, and that a
    null supply means "not configured", which is the S-04 contract.
  - The cabinet-geometry tripwire notes that `projects.cabinet_geometry` is trigger-written.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests pass, including the warning boundaries and table completeness: `npm run test:unit`
- Build passes: `npm run build`
- RLS suite still passes: `npm run test:integration`
- Smoke script still passes against the dev server: `npm run smoke`

#### Manual Verification:

- An electrician checks the transcribed `AMPACITY_A` values and the installation → reference-method
  mapping against PN-HD 60364-5-52 tables B.52.2–B.52.5
- Saving 25 A / TN-C-S / 1 phase / 15 m / 10 mm² / Cu / w rurce podtynkowo shows exactly the
  voltage-drop warning (≈ 0,58 %). Switching to 3 phases removes it
- 63 A with Cu 10 mm² in a conduit shows the ampacity warning. Al 10 mm² shows the aluminium warning,
  and TN-C with Cu 6 mm² shows the PEN warning
- After the first save, the list's supply-missing badge is gone. Reload shows the values pre-filled,
  with the length shown using a comma
- A tampered POST (e.g. `premeter_protection_a=30`) lands on `?error=invalid_input` with Polish text
- All visible text is Polish

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `supply-params.test.ts`: every list and range boundary, decimal-comma handling, all-or-nothing
  parsing, and the pre-fill round trip.
- `project.test.ts`: name, client and address limits, whitespace, the cabinet uuid guard, and the
  delete confirmation.
- `supply-warnings.test.ts`: table completeness, every warning's boundary, and the voltage-drop
  reference cases.
- `project-errors.test.ts`: every code maps to Polish, and an unknown code gets the generic text.
- `route-access.test.ts`: the `/api/projects` gate for all three caller states.

### Integration Tests:

- `rls-projects.test.ts`: owner CRUD, cross-electrician isolation, an admin who sees and writes
  nothing, trigger-owned snapshot integrity through admin edits and archiving, and CHECK refusals.

### Manual Testing Steps:

1. `npx supabase db reset`, `npm run dev`, sign up a new electrician.
2. Walk the Phase 2 create → edit → cabinet change → delete loop.
3. As `admin@example.com`, edit and archive the cabinet used by a project, then confirm the project is
   unchanged.
4. Walk the Phase 3 supply and warning cases, and check the ampacity table against the standard.

## Performance Considerations

None. There are a few rows per electrician, primary-key and `user_id`-indexed reads, and the warnings
are computed in memory.

## Migration Notes

The migration is additive: new enums, a new table and a new trigger, with no change to existing tables.
That keeps it forward-compatible under the `db-migrate.yml` / Cloudflare deploy race. There is no
backfill. `cabinets` rows are never deleted (archive only), so the plain FK from `projects.cabinet_id`
cannot block an admin action.

## References

- Roadmap item: `context/foundation/roadmap.md` S-03 (issue #4)
- PRD: FR-003, FR-004, FR-005, US-01, `## Non-Goals` (no full standards calculations)
- Snapshot decision: `context/archive/2026-09-23-admin-cabinet-catalog/plan.md:82-83`
- Owner-table and policy pattern: `supabase/migrations/20260924120000_pricing_profiles.sql`
- Cabinet visibility: `supabase/migrations/20260923085112_cabinets_catalog.sql:75-78`
- Double-guard and enum-sync pattern: `src/lib/device-spec.ts`
- Endpoint pattern: `src/pages/api/profile/pricing.ts`, `src/pages/api/admin/cabinets/[id]/index.ts`
- Error-map pattern: `src/lib/cabinet-errors.ts`, `src/lib/pricing-errors.ts`
- Server-rendered drawing: `src/pages/admin/cabinets/index.astro:41, :93`
- RLS test pattern: `tests/integration/rls-pricing-profiles.test.ts`, `tests/integration/rls-cabinets.test.ts`
- Downstream contracts: `context/changes/project-setup-and-supply-params/change.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data and validation

#### Automated

- [x] 1.1 Migration applies on a clean stack: `npx supabase db reset`
- [x] 1.2 Regenerated types are committed and `npx astro check` passes
- [x] 1.3 Parser unit tests pass: `npm run test:unit`
- [x] 1.4 RLS and trigger assertions pass against the local stack: `npm run test:integration`
- [x] 1.5 Lint passes: `npm run lint`

#### Manual

- [x] 1.6 In local Studio, `projects` shows RLS enabled with exactly four policies, none for the admin

### Phase 2: Projects — list, creation, project page

#### Automated

- [ ] 2.1 Lint passes: `npm run lint`
- [ ] 2.2 Type check passes: `npx astro check`
- [ ] 2.3 Unit tests pass, including the route-gate and error-map cases: `npm run test:unit`
- [ ] 2.4 Build passes: `npm run build`
- [ ] 2.5 RLS suite still passes: `npm run test:integration`
- [ ] 2.6 Smoke script still passes against the dev server: `npm run smoke`

#### Manual

- [ ] 2.7 As a fresh electrician: dashboard → Projekty (empty state) → Nowy projekt → pick a cabinet → the project page shows its drawing, and the list shows the project with the supply-missing badge
- [ ] 2.8 Editing the details and changing the cabinet both persist. After a cabinet change, the page shows the new cabinet's drawing
- [ ] 2.9 As the seeded admin, editing that cabinet's geometry leaves the project's drawing unchanged. After the admin archives it, the cabinet disappears from the electrician's picker, while the project still shows its snapshot
- [ ] 2.10 Deleting without ticking the checkbox is blocked. With it ticked, the project is gone from the list
- [ ] 2.11 A second electrician gets 404 on the first electrician's project URL; the admin is redirected to `/admin`
- [ ] 2.12 All visible text is Polish

### Phase 3: OSD/WLZ parameters and warnings

#### Automated

- [ ] 3.1 Lint passes: `npm run lint`
- [ ] 3.2 Type check passes: `npx astro check`
- [ ] 3.3 Unit tests pass, including the warning boundaries and table completeness: `npm run test:unit`
- [ ] 3.4 Build passes: `npm run build`
- [ ] 3.5 RLS suite still passes: `npm run test:integration`
- [ ] 3.6 Smoke script still passes against the dev server: `npm run smoke`

#### Manual

- [ ] 3.7 An electrician checks the transcribed `AMPACITY_A` values and the installation → reference-method mapping against PN-HD 60364-5-52 tables B.52.2–B.52.5
- [ ] 3.8 Saving 25 A / TN-C-S / 1 phase / 15 m / 10 mm² / Cu / w rurce podtynkowo shows exactly the voltage-drop warning (≈ 0,58 %). Switching to 3 phases removes it
- [ ] 3.9 63 A with Cu 10 mm² in a conduit shows the ampacity warning. Al 10 mm² shows the aluminium warning, and TN-C with Cu 6 mm² shows the PEN warning
- [ ] 3.10 After the first save, the list's supply-missing badge is gone. Reload shows the values pre-filled, with the length shown using a comma
- [ ] 3.11 A tampered POST (e.g. `premeter_protection_a=30`) lands on `?error=invalid_input` with Polish text
- [ ] 3.12 All visible text is Polish
