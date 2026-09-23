# Admin Device Catalog Implementation Plan

## Overview

Roadmap slice **S-01** (FR-001): the admin keeps a catalog of the six MVP device kinds —
switch-disconnectors ("FR"), RCD, RCBO, type-B MCBs, PE bars and N bars — each with manufacturer
data, dimensions, a catalog price and the electrical parameters S-04 will match circuits against.
The load-bearing part is the parameter model, because S-04's guardrail ("never propose an
under-rated device") can only check what this slice stores. The CRUD around it copies the cabinet
catalog (S-02).

## Current State Analysis

- The cabinet catalog is a complete template: migration with revoke-then-grant, per-operation
  policies, archive instead of delete (`supabase/migrations/20260923085112_cabinets_catalog.sql`);
  list/new/edit pages (`src/pages/admin/cabinets/`); create/update/archive/restore endpoints
  (`src/pages/api/admin/cabinets/`); error-code mapping (`src/lib/cabinet-errors.ts:47`); the RLS
  harness (`tests/integration/support.ts`, `tests/integration/rls-cabinets.test.ts`).
- `public.touch_updated_at()` already exists (cabinets migration, section 1) — reuse, do not
  redefine.
- Route gating needs no change: `/admin` and `/api/admin` prefixes (`src/lib/route-access.ts:18-23`)
  already cover `/admin/devices` and `/api/admin/devices`; `src/lib/route-access.test.ts:40` already
  asserts an electrician is bounced from `/admin/devices`.
- Generic helpers live in cabinet-named files: `isUuid`, `sortForCatalogList`
  (`src/lib/cabinet-catalog.ts:49-54`), `parsePriceGrosze`, `formatPriceInput`
  (`src/lib/cabinet-form.ts:45-55`), `numberFromField` / `fieldFromNumber` / `newDraftKey`
  (`src/lib/cabinet-draft.ts:18,90-96`), and the editor's `TextField`, `NumberField`, `SelectField`,
  `FieldError`, `Section` plus sessionStorage helpers inlined in
  `src/components/cabinets/CabinetEditor.tsx:71-256`.
- `terminalGroupSchema` (count × mm² range) is private in `src/lib/cabinet-geometry.ts:66`; PE/N
  bars in the device catalog need exactly that shape.
- The admin hub has a placeholder comment for the device link (`src/pages/admin/index.astro:7-8`).
- Only `button.tsx` exists from shadcn; the cabinet editor uses native inputs with Tailwind.
- The PRD and AGENTS.md call FRy "fuse switch-disconnectors" (`rozłączniki bezpiecznikowe`); the user
  clarified during planning that the catalog FR is a plain switch-disconnector with a rated current
  and no fuse links.

## Desired End State

An admin opens `/admin`, follows "Katalog aparatów" to `/admin/devices`, and sees every device grouped
by kind (in a fixed order), archived ones marked, each row showing manufacturer/model, key parameters
(e.g. "B16 1P, 6 kA"), width as "1 TE (17,5 mm)" and price. They create a device by choosing its kind,
after which only that kind's parameter fields appear; width defaults to DIN-module input with a
switch to millimetres. Missing or invalid parameters are refused in Polish in the browser, again by
the server parser, and finally by a per-kind database CHECK. They edit (kind is locked), archive and
restore devices; nothing is hard-deleted. An electrician reads active devices through RLS but cannot
write or see archived ones. Locally, `supabase db reset` yields ~20 sample devices with two price
tiers at one rating and a deliberate catalog gap (no B40).

Verify with: `npm run lint && npx astro check && npm run test:unit && npm run build`,
`npm run test:integration` against a local stack, and the manual admin walkthrough in Phase 4.

### Key Discoveries:

- Updates blocked by RLS return zero rows and no error — write endpoints check the affected row
  (pattern: `src/pages/api/admin/cabinets/[id]/index.ts:31`).
- The local stack auto-grants ALL on new `public` tables while the cloud project does not; the
  explicit `revoke all … grant select, insert, update` is required, not stylistic (cabinets
  migration, section 3).
- `numeric(p,1)` **rounds silently** on insert (`17.55` → `17.6`), so the TS parser, not the column,
  must reject a second decimal place.
- Unmapped SQLSTATEs pass through to `?error=` so they stay diagnosable (S-02 impl-review F2,
  `src/lib/cabinet-errors.ts:47`) — the device error mapper keeps that behaviour.
- Page-load failures log `error.code` only and answer 500 (S-02 impl-review F3,
  `src/pages/admin/cabinets/index.astro:32-37`).

## What We're NOT Doing

- Fuse links (wkładki) and fused switch-disconnectors — FR is a plain disconnector; fuse links stay
  outside the closed MVP type list.
- MCB characteristics other than B, distribution blocks, or any seventh device kind.
- Rated voltage, per-terminal conductor ranges on devices, product series or a preferred-manufacturer
  filter (post-MVP, FR-007 note).
- A device drawing/preview in the editor — devices render inside cabinets from S-05 on.
- Changing a device's kind after creation (archive it and create a new one).
- Hard delete, row versioning, bulk/CSV import of manufacturer catalogs.
- The matching algorithm itself (S-04) and any project-side snapshot table (S-04/S-08).
- Draft cleanup after a successful save (S-02 impl-review F5 was deliberately skipped; same here).

## Implementation Approach

One `devices` table: common columns (kind, name, manufacturer, model, price, dimensions) plus
nullable, typed parameter columns, with a per-kind CHECK that each kind carries exactly its
parameters and only its allowed pole configurations. The database is the last line of defence for
the guardrail; a pure TS module mirrors the same rules so the island and the server reject the same
inputs with Polish messages. Build order matches S-02: pure → database → read UI → write UI.

**Parameter matrix** (✓ required, — must be null):

| kind                  | Polish label                         | poles                      | rated_current_a | residual_current_ma | rcd_type | breaking_capacity_ka | terminal_groups |
| --------------------- | ------------------------------------ | -------------------------- | --------------- | ------------------- | -------- | -------------------- | --------------- |
| `switch_disconnector` | Rozłącznik izolacyjny (FR)           | 1P, 2P, 3P, 4P             | ✓               | —                   | —        | —                    | —               |
| `rcd`                 | Wyłącznik różnicowoprądowy (RCD)     | 2P, 4P                     | ✓               | ✓                   | ✓        | —                    | —               |
| `rcbo`                | Wyłącznik różnicowonadprądowy (RCBO) | 1P+N, 2P, 3P+N, 4P         | ✓               | ✓                   | ✓        | ✓                    | —               |
| `mcb_b`               | Wyłącznik nadprądowy B (MCB)         | 1P, 1P+N, 2P, 3P, 3P+N, 4P | ✓               | —                   | —        | ✓                    | —               |
| `pe_bar`              | Szyna PE                             | —                          | —               | —                   | —        | —                    | ✓               |
| `n_bar`               | Szyna N                              | —                          | —               | —                   | —        | —                    | ✓               |

All kinds require `width_mm`, `height_mm`, `depth_mm` (mm, 0.1 precision, > 0). Units:
`rated_current_a` integer A; `residual_current_ma` integer mA; `rcd_type` ∈ AC/A/F/B;
`breaking_capacity_ka` kA with one decimal (4.5, 6, 10); `terminal_groups` = the cabinet bar shape
`[{ count, minMm2, maxMm2 }]`, ≥ 1 group.

**Width in the UI:** stored in mm; the editor defaults to DIN modules (1 TE = 17.5 mm, steps of 0.5
TE) with a toggle to mm. A stored width that is not a multiple of 8.75 mm opens in mm mode. Height and
depth are always entered in mm.

**Contracts this change fixes for later slices** (also in `change.md`):

- **S-04:** matching reads only the typed parameter columns; archived devices are never proposed; FR
  provides no overcurrent protection and must never be treated as protection.
- **S-04/S-08:** a project copies the chosen device (price, dimensions, parameters) at selection
  time, so later admin edits never shift an existing quote or layout.
- **S-05:** device width is mm with 0.1 precision; cabinet geometry stays integer mm.

## Critical Implementation Details

- **The per-kind CHECK and the TS schema must agree exactly.** Integration tests insert one invalid
  row per kind through the service client (bypassing TS) to prove the database refuses it, and every
  seeded row is re-parsed by the TS schema — the two layers are tested against each other, not only
  each on its own.
- **Decimal inputs accept `,` or `.`, at most one decimal place,** and are rejected — never rounded —
  beyond that, because the `numeric(…,1)` columns would round silently.

## Phase 1: Device model and shared helpers

### Overview

The pure domain module for devices, DIN-module conversion, extraction of the helpers both catalogs
share, Polish labels and messages, and unit tests. No database, no UI.

### Changes Required:

#### 1. Shared catalog helpers

**Files**: `src/lib/catalog.ts` (new), `src/lib/catalog.test.ts` (new), `src/lib/price-input.ts`
(new), `src/lib/price-input.test.ts` (new), `src/lib/cabinet-catalog.ts`, `src/lib/cabinet-form.ts`
and their tests, `src/lib/cabinet-geometry.ts`

**Intent**: Move the genuinely generic helpers out of cabinet-named files so the device catalog
imports them instead of copying; cabinet behaviour is unchanged.

**Contract**: `catalog.ts` exports `isUuid` and `sortForCatalogList` (moved, tests moved with them);
`price-input.ts` exports `parsePriceGrosze` and `formatPriceInput` (moved, tests moved);
`cabinet-*` modules import from the new locations — no re-export shims. Export the existing
`terminalGroupSchema` (and its inferred `TerminalGroup` type) from `cabinet-geometry.ts` so devices
reuse the exact bar-terminal shape.

#### 2. DIN module conversion

**Files**: `src/lib/din-module.ts` (new), `src/lib/din-module.test.ts` (new)

**Intent**: One place that converts between DIN modules and millimetres for the editor and the list.

**Contract**: `DIN_MODULE_MM = 17.5`; `mmFromModules(modules: number): number`;
`modulesFromMm(mm: number): number | null` returning a count in 0.5 steps, or `null` when `mm` is not
a multiple of 8.75. Tests: 17.5 ↔ 1, 52.5 ↔ 3, 26.25 ↔ 1.5, 18 → null.

#### 3. Device spec

**Files**: `src/lib/device-spec.ts` (new), `src/lib/device-spec.test.ts` (new)

**Intent**: The device domain model and every per-kind rule, mirroring the DB CHECK, returning coded
issues per field so the island and the server reject the same things.

**Contract**: Exports `DEVICE_KINDS` (fixed display order: switch_disconnector, rcd, rcbo, mcb_b,
pe_bar, n_bar), `POLE_CONFIGS`, `RCD_TYPES`, `POLES_BY_KIND`, `PARAMETERS_BY_KIND` (the matrix
above), `deviceSpecSchema` (zod discriminated union on `kind`), `DeviceSpec` type, and
`parseDeviceSpec(input: unknown): { ok: true; spec: DeviceSpec } | { ok: false; issues: DeviceIssue[] }`
where `DeviceIssue = { field: DeviceField; code: DeviceIssueCode }`. Rules: common text fields
trimmed and non-empty; price via `parsePriceGrosze`; dimensions > 0 with ≤ 1 decimal; poles in the
kind's allowed set; currents positive integers; `breaking_capacity_ka` > 0 with ≤ 1 decimal;
terminal groups via `terminalGroupSchema`, ≥ 1; a non-null parameter outside the kind's column
set is rejected (`foreign_parameter`), never silently dropped. Tests: one valid fixture per kind, one failing fixture per issue code, a pole
outside the kind's set, a second decimal place, a parameter from another kind.

#### 4. Polish labels and messages

**File**: `src/lib/i18n/pl.ts`

**Intent**: Add a `devices` section (kind labels from the matrix, field labels, pole/RCD-type
labels, width-unit toggle labels "Moduły (TE)" / "Milimetry", list/editor strings mirroring
`cabinets.catalog` / `cabinets.editor`), `deviceIssues` keyed by issue code, and an
`admin.deviceCatalogLink` / `deviceCatalogDescription` pair.

**Contract**: New keys only. A `deviceIssueMessage(issue: DeviceIssue): string` helper beside
`device-spec.ts`, unit-tested so every code has a message. Width display uses a function such as
`devices.catalog.width(modules: number | null, mm: number)` → "2 TE (35 mm)" or "36 mm", with
`formatNumber` for decimals.

### Success Criteria:

#### Automated Verification:

- Unit tests pass, including moved cabinet tests: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- Reviewer reads `PARAMETERS_BY_KIND` and `POLES_BY_KIND` and confirms they match the plan's parameter matrix (nothing missing, nothing invented)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 2: Database, types and sample devices

### Overview

The `devices` table with enums, per-kind CHECK and RLS; regenerated types; ~20 seeded sample
devices; integration tests that prove the role boundary, every CHECK branch and seed validity.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260923HHmmss_devices_catalog.sql`

**Intent**: Create the catalog table and its enums, reuse the existing touch trigger function, and
add per-operation policies. Re-runnable, like the cabinets migration.

**Contract**: Enums `public.device_kind` (`switch_disconnector`, `rcd`, `rcbo`, `mcb_b`, `pe_bar`,
`n_bar`), `public.pole_config` (`1P`, `1P+N`, `2P`, `3P`, `3P+N`, `4P`), `public.rcd_type` (`AC`,
`A`, `F`, `B`), each created only if absent. `public.devices(id uuid pk default gen_random_uuid(),
kind device_kind not null, name/manufacturer/model text not null check (length(trim(x)) > 0),
price_grosze integer not null check (> 0), width_mm/height_mm/depth_mm numeric(6,1) not null check
(> 0), poles pole_config, rated_current_a integer check (> 0), residual_current_ma integer check
(> 0), rcd_type rcd_type, breaking_capacity_ka numeric(4,1) check (> 0), terminal_groups jsonb check
(jsonb_typeof = 'array' and jsonb_array_length >= 1), archived_at timestamptz, created_at,
updated_at timestamptz not null default now())`. A named CHECK `devices_parameters_match_kind`
encoding the matrix (required columns not null, others null, poles in the kind's set). Unique index
on `(lower(manufacturer), lower(model))`; an index on `kind`. `BEFORE UPDATE` trigger calling the
existing `public.touch_updated_at()`. RLS enabled; policies `devices_select_active` (authenticated,
`archived_at is null`), `devices_select_admin`, `devices_insert_admin`, `devices_update_admin` (all
`public.is_admin()`); no delete policy. `revoke all` from anon and authenticated, then
`grant select, insert, update … to authenticated`, plus the explicit `revoke delete` kept greppable.

#### 2. Generated types

**File**: `src/lib/database.types.ts` (generated via `npm run db:types`)

**Intent**: The generated `Database` type gains `devices` and the three enums; `device-spec.ts`
aligns its unions with `Enums<…>` so drift fails `astro check`.

**Contract**: File regenerated and committed; no hand edits.

#### 3. Sample devices

**File**: `supabase/seed.sql`

**Intent**: A realistic local/CI catalog so S-04 can be developed against cheapest-match and
catalog-gap paths immediately. Manufacturer `Przykładowy producent` (plus a second sample
manufacturer for the price-tier pair); clearly not real products.

**Contract**: Idempotent insert `on conflict ((lower(manufacturer)), (lower(model))) do nothing`,
~20 rows covering: MCB B6, B10, B13, B16, B20, B25, B32 in 1P and a 3P subset (B16, B20, B25), 6 kA;
the same MCB B16 1P from two manufacturers at different prices; RCD 2P and 4P 40 A 30 mA in types A
and AC; RCBO B10 and B16 1P+N 30 mA type A, 6 kA; switch-disconnectors 1P and 3P (e.g. 40 A, 63 A);
one PE bar and one N bar with terminal groups. Deliberately **no B40** in any pole configuration.
Widths are real module multiples (17.5, 35, 52.5, 70 mm).

#### 4. RLS and CHECK integration tests

**File**: `tests/integration/rls-devices.test.ts` (new)

**Intent**: Prove the admin boundary and the per-kind CHECK in the database, and that the seed and
the TS schema agree.

**Contract**: Reuses `tests/integration/support.ts`, mirrors `rls-cabinets.test.ts` (including the
S-02 F6 fixes: only truthy ids tracked, cleanup error asserted). Asserts: electrician reads active
devices, does not see an archived one, insert/update refused or 0 rows; anon select `42501`; admin
inserts, updates, archives, restores; admin delete `42501`; `updated_at` advances; case-insensitive
duplicate manufacturer + model `23505`; per kind, one row missing a required parameter and one row
carrying a foreign parameter yield `23514`; a pole outside the kind's set (e.g. RCD `1P`) yields
`23514`; every seeded device passes `parseDeviceSpec`; the seed contains all six kinds, both
MCB B16 1P price tiers, and no B40.

### Success Criteria:

#### Automated Verification:

- Migration and seed apply cleanly on a fresh stack: `npx supabase db reset`
- Generated types are current: `npm run db:types` produces no diff
- RLS and CHECK integration tests pass: `npm run test:integration`
- Unit tests, lint, type check and build pass: `npm run lint && npx astro check && npm run test:unit && npm run build`

#### Manual Verification:

- In local Studio, `public.devices` shows the seeded rows with RLS enabled and no delete policy

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 3: Read-only surface — list, lifecycle, hub

### Overview

The device list grouped by kind, archive/restore endpoints, device error codes, and the hub link.

### Changes Required:

#### 1. Paths and error codes

**Files**: `src/lib/device-catalog.ts` (new) + test, `src/lib/device-errors.ts` (new) + test,
`src/lib/i18n/pl.ts`

**Intent**: Route builders and `?error=` codes for devices, mirroring the cabinet modules.

**Contract**: `DEVICES_PATH = "/admin/devices"`, `NEW_DEVICE_PATH`, `deviceEditPath(id)`,
`DEVICES_API_PATH`, `deviceApiPath(id)`, `deviceArchivePath(id)`, `deviceRestorePath(id)`,
`devicesErrorPath(code)`, `deviceFormErrorPath(id | null, code)`. `DEVICE_ERROR` codes
`not_configured`, `forbidden`, `not_found`, `duplicate_model`, `invalid_input`, `unknown`;
`deviceErrorFromPostgrest` maps 23505 → `duplicate_model`, 42501 → `forbidden`, passes other codes
through, missing code → `unknown`; `deviceErrorMessage` maps to a new `deviceErrors` section of
`pl.ts` with a generic fallback.

#### 2. Device list

**File**: `src/pages/admin/devices/index.astro`

**Intent**: One section per kind in `DEVICE_KINDS` order, each with a table of that kind's relevant
columns (manufacturer/model, name, parameter summary, width in TE + mm, price via
`formatMoney(price_grosze / 100)`, archived badge, edit link, archive/restore form), plus a "new
device" link. Empty kinds show a short Polish "no devices of this kind" line, which makes catalog
gaps visible to the admin.

**Contract**: Selects all columns needed for the summary; sorts with `sortForCatalogList` within each
kind. Handles `createClient() === null` with the not-configured message, `?error=` via
`deviceErrorMessage`, and a failed load by logging `error.code` only and answering 500.

#### 3. Archive / restore endpoints

**Files**: `src/pages/api/admin/devices/[id]/archive.ts`, `src/pages/api/admin/devices/[id]/restore.ts`

**Intent**: Set or clear `archived_at`, redirect back to the list.

**Contract**: Same shape as the cabinet endpoints: `POST`, UUID check first, null client →
`not_configured`, `.select("id")` with 0 rows → `not_found`, errors via `deviceErrorFromPostgrest`.

#### 4. Admin hub

**File**: `src/pages/admin/index.astro`

**Intent**: Replace the S-01 placeholder comment with a "Katalog aparatów" card next to the cabinet
card.

**Contract**: Strings from `t.admin.deviceCatalogLink` / `deviceCatalogDescription`.

### Success Criteria:

#### Automated Verification:

- Path and error-mapping unit tests pass: `npm run test:unit`
- Lint, type check and build pass: `npm run lint && npx astro check && npm run build`
- RLS integration tests still pass: `npm run test:integration`

#### Manual Verification:

- As the seeded admin, `/admin/devices` lists the seed grouped into six kind sections with Polish parameter summaries and widths shown as TE + mm
- Archive then restore a device from the list; the badge follows
- As an electrician, `/admin/devices` and a POST to `/api/admin/devices/<id>/archive` redirect away and change nothing

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 4: Editor, write path and documentation

### Overview

Create and edit devices through a React island driven by kind, with the modules/mm width toggle,
server-side validation, and documentation sync.

### Changes Required:

#### 1. Shared form components

**Files**: `src/components/forms/` (new: field components and a draft-storage helper),
`src/components/cabinets/CabinetEditor.tsx`

**Intent**: Move `TextField`, `NumberField`, `SelectField`, `FieldError`, `Section` and the
sessionStorage draft read/write/clear helpers out of the cabinet editor so both editors share them;
the cabinet editor's behaviour is unchanged.

**Contract**: Draft helpers take the storage key and a zod schema as parameters (the cabinet editor
keeps `cabinet-draft:<id|new>`); storage access stays wrapped in try/catch. `numberFromField` /
`fieldFromNumber` / `newDraftKey` move to a shared lib module if the device editor needs them.

#### 2. Form parsing

**Files**: `src/lib/device-form.ts` (new), `src/lib/device-form.test.ts` (new)

**Intent**: Turn submitted `FormData` into a validated insert/update payload via `parseDeviceSpec`.

**Contract**: `parseDeviceForm(form: FormData, mode: "create" | "update"): { ok: true; value: DeviceInput } | { ok: false; code: string }`.
Width always arrives in mm (the island converts modules before submit). `kind` is read on create and
ignored on update (the update payload never contains `kind`). Scalars are plain named inputs;
`terminal_groups` arrives as a hidden JSON field. Also exports `formatDecimalInput(value: number)`
for pre-filling decimals with a comma. Tests: each kind round-trips, comma decimals, second decimal
rejected, fields of other kinds in the FormData ignored (the parser reads only the chosen kind's
fields), malformed terminal-groups JSON, update ignores `kind`.

#### 3. Editor island

**File**: `src/components/devices/DeviceEditor.tsx` (new)

**Intent**: Kind select (create) or read-only kind label (edit); common fields; only the parameter
fields for the chosen kind (poles offered from `POLES_BY_KIND`); a width field with a "Moduły (TE) /
Milimetry" toggle defaulting to modules (or mm when the stored width is not a half-module multiple);
a terminal-group list for bars. Issues from `parseDeviceSpec` show inline in Polish and block
submit. Native `<form method="POST">` keeps the FormData convention.

**Contract**: Props `{ initial?: DeviceRow; action: string; error?: string }`, mounted with
`client:only="react"` like the cabinet editor. Switching kind on create clears the other kinds'
fields. Draft under `device-draft:<id|new>`, restored only when `error` is present. All text from
`t`.

#### 4. Pages and endpoints

**Files**: `src/pages/admin/devices/new.astro`, `src/pages/admin/devices/[id].astro`,
`src/pages/api/admin/devices/index.ts` (create), `src/pages/api/admin/devices/[id]/index.ts` (update)

**Intent**: Pages mount the island with the row (edit) or empty defaults (new); endpoints run
`parseDeviceForm`, insert/update, redirect to `/admin/devices` on success or back to the form with
`?error=<code>`.

**Contract**: Mirrors the cabinet pages/endpoints: UUID check before querying, 404 on a missing row,
500 + logged `error.code` on a failed load, `23505` → `duplicate_model`, 0 rows → `not_found`,
invalid form → `invalid_input`; Supabase `error.message` is never surfaced. Edit heading via an i18n
function (`devices.editor.editTitleFor(name)`), not inline composition.

#### 5. Documentation sync

**Files**: `AGENTS.md`, `README.md`, `context/foundation/prd.md`

**Intent**: Make the repo's instructions true: product code includes the device catalog
(`src/pages/admin/devices/`, `src/components/devices/`); tripwire that device parameters are
guarded by the `devices_parameters_match_kind` CHECK and `parseDeviceSpec`, which must change
together, and that FR is a plain switch-disconnector with no protection; domain rule wording "fuse
switch-disconnectors" → "switch-disconnectors (FR), no fuse links"; `/admin/devices` in the README
route table; the PRD `## Non-Goals` device list and its 2026-09-16 resolution line reworded the same
way, with a dated note that this was clarified during S-01 planning.

**Contract**: Edits to existing sections only.

### Success Criteria:

#### Automated Verification:

- Form-parsing and shared-component unit tests pass: `npm run test:unit`
- Lint, type check and build pass: `npm run lint && npx astro check && npm run build`
- RLS integration tests still pass: `npm run test:integration`
- Smoke script still passes against the dev server: `npm run smoke`

#### Manual Verification:

- As admin, create one device of each kind; each appears in its section with the right parameter summary
- Width entered as 3 TE is saved as 52,5 mm and shown as "3 TE (52,5 mm)"; switching to mm and entering 36 is shown as "36 mm" and reopens in mm mode
- Leaving a required parameter empty, choosing a pole configuration not offered for the kind, or typing a second decimal place shows a Polish message and blocks submit
- Creating a device with an existing manufacturer + model shows the Polish duplicate error and the typed values are still there
- Editing a seeded device's price and rated current persists after reload; the kind cannot be changed
- The cabinet editor still creates and edits a cabinet exactly as before
- After merge and deploy, `/admin/devices` works on the production Worker (migration applied by `db-migrate.yml`)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Testing Strategy

### Unit Tests:

- `device-spec.test.ts`: valid fixture per kind; every issue code; poles outside the kind's set;
  second decimal; foreign parameter; every code has a Polish message.
- `din-module.test.ts`: module ↔ mm conversion including half modules and non-multiples.
- `device-form.test.ts`: FormData → payload per kind, comma decimals, update ignores `kind`,
  malformed terminal-group JSON.
- `device-catalog.test.ts`, `device-errors.test.ts`: paths, SQLSTATE mapping, pass-through.
- Moved `catalog.test.ts` and `price-input.test.ts` keep their existing cases.

### Integration Tests:

- `rls-devices.test.ts`: role matrix (admin / electrician / anon) × (select active, select archived,
  insert, update, archive, delete); per-kind CHECK both directions; pole sets; unique constraint;
  touch trigger; seed ↔ TS schema agreement and the deliberate B40 gap.

### Manual Testing Steps:

1. `npx supabase db reset`, `npm run dev`, sign in as `admin@example.com`.
2. Open `/admin/devices`; check the six sections and TE + mm widths.
3. Create one device per kind, break and fix each form, trigger a duplicate-model error.
4. Archive and restore; sign in as an electrician and try `/admin/devices`.
5. Re-check the cabinet editor after the component extraction.

## Performance Considerations

Catalog scale is tens of rows; the list loads all of them in one query and groups in memory.
Validation is constant-time per device.

## Migration Notes

Forward-compatible: new enums, a new table and a trigger reusing an existing function; nothing
existing changes, so the `db-migrate.yml` / Cloudflare deploy race is safe in either order. The
production catalog starts empty; the admin enters devices through the UI.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-01 (`admin-device-catalog`, issue #2)
- PRD: FR-001, FR-007, `## Non-Goals` (closed device list), `## Business Logic`
- Prior change and its contracts: `context/archive/2026-09-23-admin-cabinet-catalog/` (plan,
  `change.md` "S-01: width in mm", `reviews/impl-review.md` F2/F3/F6)
- Pattern — migration and policies: `supabase/migrations/20260923085112_cabinets_catalog.sql`
- Pattern — endpoints: `src/pages/api/admin/cabinets/`
- Pattern — editor island: `src/components/cabinets/CabinetEditor.tsx`
- Pattern — RLS harness: `tests/integration/support.ts`, `tests/integration/rls-cabinets.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Device model and shared helpers

#### Automated

- [x] 1.1 Unit tests pass, including moved cabinet tests: `npm run test:unit`
- [x] 1.2 Lint passes: `npm run lint`
- [x] 1.3 Type check passes: `npx astro check`

#### Manual

- [x] 1.4 Reviewer reads `PARAMETERS_BY_KIND` and `POLES_BY_KIND` and confirms they match the plan's parameter matrix (nothing missing, nothing invented)

### Phase 2: Database, types and sample devices

#### Automated

- [ ] 2.1 Migration and seed apply cleanly on a fresh stack: `npx supabase db reset`
- [ ] 2.2 Generated types are current: `npm run db:types` produces no diff
- [ ] 2.3 RLS and CHECK integration tests pass: `npm run test:integration`
- [ ] 2.4 Unit tests, lint, type check and build pass: `npm run lint && npx astro check && npm run test:unit && npm run build`

#### Manual

- [ ] 2.5 In local Studio, `public.devices` shows the seeded rows with RLS enabled and no delete policy

### Phase 3: Read-only surface — list, lifecycle, hub

#### Automated

- [ ] 3.1 Path and error-mapping unit tests pass: `npm run test:unit`
- [ ] 3.2 Lint, type check and build pass: `npm run lint && npx astro check && npm run build`
- [ ] 3.3 RLS integration tests still pass: `npm run test:integration`

#### Manual

- [ ] 3.4 As the seeded admin, `/admin/devices` lists the seed grouped into six kind sections with Polish parameter summaries and widths shown as TE + mm
- [ ] 3.5 Archive then restore a device from the list; the badge follows
- [ ] 3.6 As an electrician, `/admin/devices` and a POST to `/api/admin/devices/<id>/archive` redirect away and change nothing

### Phase 4: Editor, write path and documentation

#### Automated

- [ ] 4.1 Form-parsing and shared-component unit tests pass: `npm run test:unit`
- [ ] 4.2 Lint, type check and build pass: `npm run lint && npx astro check && npm run build`
- [ ] 4.3 RLS integration tests still pass: `npm run test:integration`
- [ ] 4.4 Smoke script still passes against the dev server: `npm run smoke`

#### Manual

- [ ] 4.5 As admin, create one device of each kind; each appears in its section with the right parameter summary
- [ ] 4.6 Width entered as 3 TE is saved as 52,5 mm and shown as "3 TE (52,5 mm)"; switching to mm and entering 36 is shown as "36 mm" and reopens in mm mode
- [ ] 4.7 Leaving a required parameter empty, choosing a pole configuration not offered for the kind, or typing a second decimal place shows a Polish message and blocks submit
- [ ] 4.8 Creating a device with an existing manufacturer + model shows the Polish duplicate error and the typed values are still there
- [ ] 4.9 Editing a seeded device's price and rated current persists after reload; the kind cannot be changed
- [ ] 4.10 The cabinet editor still creates and edits a cabinet exactly as before
- [ ] 4.11 After merge and deploy, `/admin/devices` works on the production Worker (migration applied by `db-migrate.yml`)
