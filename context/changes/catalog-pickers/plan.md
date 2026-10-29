# Catalog Lists and Cabinet Picker at Production Scale Implementation Plan

## Overview

The admin device list, the admin cabinet list and the electrician's cabinet picker show the whole
production catalog (355 devices, 33+ cabinets) as one long page, in name order, with no way to narrow
it. This plan gives cabinets a structured mounting type, then gives all three screens one shared
model: a natural, parameter-based order, attribute filters run in the browser, collapsible groups
with counts, and, for cabinets, a large / small / list view switch.

## Current State Analysis

From `context/changes/catalog-pickers/frame.md` (confidence HIGH):

- **Volume is a symptom, not the origin.** Pagination was already ruled out at this catalog size
  (`context/archive/2026-10-21-production-catalog-seed/plan.md:63`), and users find items by
  attribute, not by position.
- **Ordering.** Every list sorts with `sortForCatalogList` (`src/lib/catalog.ts:16-20`): archived
  last, then `name.localeCompare(LOCALE)` without `numeric`, so `B10, B13, B16, B2 … B50, B6` and
  `RN-12-P` before `RN-6-P`. (Correction to the frame: the picker is sorted this way too —
  `src/pages/dashboard/projects/new.astro:39`, `src/pages/dashboard/projects/[id].astro:119` — not
  unordered.)
- **No find affordance** on any of the three screens. Devices already carry every attribute users
  search by as columns; cabinets do not: mounting type exists only inside `name`, module capacity
  only inside `geometry.rails[].lengthMm`.
- **Density.** Cabinet cards carry `h-32` (picker, 2 columns) / `h-40` (admin, 1 column) drawings;
  device sections carry no count. The user also called the current pages unprofessional-looking:
  adding cabinets must not make the page grow without bound.

Narrowing signals: the electrician picks a cabinet by **mounting type** and **needed module count**;
the admin finds a device by **parameters** and **manufacturer**.

## Desired End State

- `cabinets.mounting` holds `surface` (natynkowa) or `flush` (podtynkowa); every Karwasz and seed
  cabinet has it; the cabinet editor requires it.
- All three lists open short: their groups (cabinets by mounting, devices by kind) are collapsed
  `<details>` with a count; the picker opens only the group holding the checked cabinet.
- A filter bar narrows each list instantly without a reload; matching groups open, empty ones hide,
  and "no results" says so in Polish.
- Cabinets switch between large thumbnails, small thumbnails and a list without drawings; the choice
  is remembered per browser. Each cabinet shows its mounting and module capacity (e.g. `3×12 = 36`).
- Devices are ordered by parameters: In numerically, then poles, then the kind's remaining
  parameters, then manufacturer; archived ones last and hidden by default.
- Without JavaScript every list still renders in full and the forms still submit.

### Key Discoveries:

- Inline `<script>` in `.astro` is the established pattern for small progressive behaviour
  (`src/components/projects/QuoteSection.astro:261`); no React island is needed, and the cabinet
  drawings stay static SVG.
- The picker is a `required` radio inside the POST form of `new.astro` / `[id].astro`; a GET-filter
  reload would lose the selection and the typed project name — hence filtering in the browser.
- `modulesFromMm` / `DIN_MODULE_MM` live in `src/lib/din-module.ts`; Karwasz rails are exact module
  multiples (210 mm = 12, 350 mm = 20).
- `src/lib/karwasz-cabinets.ts` is pinned by `toMatchFileSnapshot` to the deployed
  `supabase/migrations/20261021120000_karwasz_cabinets.sql`, which is never regenerated — mounting
  for Karwasz arrives by a new data migration, keyed on `model`.
- Cabinet writes go only through `parseCabinetForm` (`src/lib/cabinet-form.ts:53`), used by
  `src/pages/api/admin/cabinets/index.ts` and `[id]/index.ts`.
- The e2e helper checks the cabinet radio by name (`tests/e2e/support.ts:58`); once groups start
  collapsed, it must open the group first.
- `tests/integration/check-parser-parity.test.ts` drives each guarded-twice pair from one fixture
  table — the new mounting pair joins it.

## What We're NOT Doing

- No pagination, no server-side filtering, no filter state in the URL.
- No sealing / IP rating (dropped explicitly by the user) — hermetic RNH cabinets are `surface`.
- No change to the project's cabinet snapshot: mounting is a picking aid only and is not copied by
  `projects_snapshot_cabinet`.
- No change to device matching, layout or the quote; electricians still never pick devices.
- No regeneration of the deployed Karwasz migration or its generator snapshot.
- No "fits the layout" check in the module filter: `≥ N modules` is total capacity; whether groups
  fit per rail stays the layout's job.
- No NOT NULL on `cabinets.mounting` in this change (see Migration Notes).

## Implementation Approach

Data first (Phase 1), so the lists have something to group and filter by. Then one pure, unit-tested
module (Phase 2) owns capacity, ordering and the filter predicates, so the three screens cannot
drift. The screens (Phases 3–4) render every item server-side with `data-*` attributes describing it,
and a small shared browser script applies the Phase 2 predicates to show / hide items and open /
close groups. Collapsing uses native `<details>`, so nothing depends on JavaScript to be usable.

## Critical Implementation Details

- **Required radio inside a closed `<details>`.** On the new-project page no cabinet is checked and
  every group starts closed; submitting then fails browser validation on a control it cannot focus,
  silently. The script must listen for `invalid` on the radio group and open the groups (and clear
  filters hiding the radios) so the native message shows.
- **The checked cabinet never hides.** A filter must not hide the currently checked radio, and its
  group stays open — otherwise the change-cabinet form would submit a selection the user cannot see.

## Phase 1: Cabinet mounting type

### Overview

Add `cabinets.mounting` as a guarded-twice pair (CHECK + parser), backfill all existing cabinets,
and let the admin set it in the cabinet editor.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261029120000_cabinet_mounting.sql`

**Intent**: Add a nullable `mounting` column with a named CHECK, and backfill it: Karwasz `RN-*`,
`RNH-*` and `UNI SYSTEM *` → `surface`, `RP-*` → `flush`, matched on `manufacturer = 'Karwasz'` and
`model`. Nullable so the deployed code, which never writes it, keeps inserting cabinets during the
deploy window.

**Contract**: `cabinets.mounting text null`, CHECK `cabinets_mounting_valid`:
`mounting is null or mounting in ('surface', 'flush')`. After the backfill, no Karwasz row is null.

#### 2. Seed

**File**: `supabase/seed.sql`

**Intent**: Give the three sample cabinets (`PRZ-S1`, `PRZ-M3`, `PRZ-L4`, all "natynkowa") a
`mounting` of `surface`, so local and CI data look like production.

**Contract**: the seed `insert into public.cabinets` column list gains `mounting`.

#### 3. Types and parser

**File**: `src/lib/database.types.ts` (regenerated with `npm run db:types`), `src/lib/cabinet-form.ts`

**Intent**: `parseCabinetForm` requires a mounting value from a closed list and returns it; the
parser is stricter than the CHECK (never null) — the safe direction.

**Contract**: `CABINET_MOUNTINGS = ["surface", "flush"] as const`, `CabinetMounting` type,
`CABINET_FORM_FIELDS.mounting`, `CabinetInput.mounting: CabinetMounting`, `CabinetRow` picks
`mounting`. A missing or unknown value is `invalid`.

#### 4. Cabinet editor and endpoints

**File**: `src/components/cabinets/CabinetEditor.tsx`, `src/lib/cabinet-draft.ts`,
`src/pages/admin/cabinets/[id].astro`, `src/pages/admin/cabinets/new.astro`,
`src/pages/api/admin/cabinets/index.ts`, `src/pages/api/admin/cabinets/[id]/index.ts`,
`src/lib/i18n/pl.ts`

**Intent**: The editor gets a required mounting field (native select or toggle group from
`src/components/ui`), prefilled from the row; a legacy null row opens with no value and must be set
before saving. Endpoints write the parsed value.

**Contract**: i18n keys `t.cabinets.fields.mounting`, `t.cabinets.mounting.surface` ("Natynkowa"),
`t.cabinets.mounting.flush` ("Podtynkowa"), `t.cabinets.editor.mountingRequired`.

#### 5. Parity test and rule

**File**: `tests/integration/check-parser-parity.test.ts`,
`context/foundation/agent-rules/data-guards.md`

**Intent**: One fixture table (`surface`, `flush`, `""`, `"hermetic"`, null) asserted against both
the CHECK and `parseCabinetForm`, with null as the one documented divergence (database accepts,
parser refuses). Record the new pair in the rule file.

**Contract**: a new `describe("cabinet mounting")` block; a bullet in `data-guards.md` naming
`cabinets_mounting_valid` and `CABINET_MOUNTINGS`.

### Success Criteria:

#### Automated Verification:

- Migration and seed apply on a fresh local stack: `npx supabase db reset`
- Regenerated types are committed and unchanged on re-run: `npm run db:types`
- Parser unit tests cover the mounting field: `npm run test:unit`
- Mounting parity and RLS suites pass: `npm run test:integration`
- Lint and type checks pass: `npm run lint && npx astro check`

#### Manual Verification:

- After `db reset`, every Karwasz cabinet has the expected mounting (spot-check RN-24, RNH-36, RP-80, UNI SYSTEM 750-1200)
- The cabinet editor refuses to save without a mounting and saves each value

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Shared catalog list model

### Overview

One pure module owns everything the three lists must agree on: cabinet capacity, device order,
filter predicates and the cabinet view modes.

### Changes Required:

#### 1. Catalog list model

**File**: `src/lib/catalog-list.ts`, `src/lib/catalog-list.test.ts`

**Intent**: Pure functions, no DOM, so the server renderer and the browser script share them.

**Contract**:

- `cabinetModuleCapacity(geometry)` → `{ rails: { modules }[], total }`, each rail
  `floor(lengthMm / DIN_MODULE_MM)`; a label helper renders `3×12 = 36` when all rails are equal and
  `12 + 12 + 8 = 32` otherwise.
- `compareDevicesForCatalog(a, b)`: archived last; then `rated_current_a` numerically; then poles in
  `POLES` order from `device-spec.ts`; then `residual_current_ma`, `rcd_type` order,
  `breaking_capacity_ka`; then `width_mm` (busbars, bars); then manufacturer; then name with
  `localeCompare(…, { numeric: true })`. Missing parameters sort before present ones.
- `compareCabinetsForCatalog(a, b)`: archived last; then `total` modules ascending; then name
  (numeric collation).
- `matchesDeviceFilter(device, filter)` with `{ query, manufacturer, poles, ratedCurrentA,
showArchived }`; `query` matches name or model, case- and diacritic-insensitive.
- `matchesCabinetFilter(cabinet, filter)` with `{ query, mounting, minModules, showArchived }`;
  `minModules` passes when `total ≥ minModules`; a null mounting matches only "all".
- `CABINET_VIEWS = ["large", "small", "list"] as const`, default `small`.
- `sortForCatalogList` in `catalog.ts` switches to numeric collation for any remaining caller.

### Success Criteria:

#### Automated Verification:

- Unit tests cover ordering (B6 before B10, 1P before 1P+N before 3P, Eaton/Legrand B16 1P adjacent, archived last), capacity (RN-6-P = 6, RN-24 = 2×12, uneven rails), and filters (≥ boundary at exactly N, null mounting, diacritics): `npm run test:unit`
- Lint and type checks pass: `npm run lint && npx astro check`

---

## Phase 3: Cabinet lists (admin and picker)

### Overview

Both cabinet screens become grouped, filterable and switchable between three views, through one
shared component and one shared script.

### Changes Required:

#### 1. Shared cabinet list components

**File**: `src/components/cabinets/CabinetCatalogList.astro` (new), `src/components/catalog/CatalogFilterBar.astro` (new), `src/components/catalog/catalog-filter.ts` (new browser script module)

**Intent**: Render cabinets grouped by mounting (`surface`, `flush`, then "Bez rodzaju montażu"
for null) as `<details>` whose `<summary>` shows the label and count; each item carries `data-*`
for query text, mounting, total modules and archived. The item shows name, manufacturer/model,
mounting badge and capacity label; the drawing size follows the view (`large` ≈ today's `h-32`,
`small` ≈ `h-16` in a denser grid, `list` = no drawing, one row). A slot / prop decides whether the
item is a radio card (picker) or an admin card with edit / archive actions.

**Contract**: the script reads the filter bar, applies `matchesCabinetFilter`, toggles `hidden` on
items and groups, opens groups with matches while a filter is active, shows a "no results" line,
never hides a `:checked` radio, opens groups on the radio group's `invalid` event, and stores the
view in `localStorage` under one key with every read and write in `try/catch`.

#### 2. Picker and admin pages

**File**: `src/components/projects/CabinetPicker.astro`, `src/pages/dashboard/projects/new.astro`,
`src/pages/dashboard/projects/[id].astro`, `src/pages/admin/cabinets/index.astro`

**Intent**: The picker and admin list use the shared component, sorted with
`compareCabinetsForCatalog`; queries select `mounting`. The picker opens only the checked cabinet's
group; the admin list starts with all groups closed and archived cabinets hidden behind "Pokaż
zarchiwizowane".

**Contract**: radio `name`, `value`, `required` and accessible names unchanged.

#### 3. i18n, kitchen-sink and e2e

**File**: `src/lib/i18n/pl.ts`, `src/pages/dev/kitchen-sink.astro`, `tests/e2e/support.ts`,
`tests/e2e/cabinet-picker.spec.ts` (new)

**Intent**: Polish strings for the filter bar, views, group labels, counts (via `plural()`), capacity
and "no results". Kitchen-sink shows the filter bar, the three views and a collapsed / open group.
The e2e helper opens the right group (or filters) before checking the seeded cabinet. A new spec
covers the picker: filter by mounting and min modules narrows the list, the checked cabinet stays
visible under a filter that excludes it, and submitting the new-project form with no cabinet opens
the groups instead of failing silently.

**Contract**: no user-facing literal outside `pl.ts`; only token classes.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint and type checks pass: `npm run lint && npx astro check`
- E2E suite passes, including the new picker spec and the updated helper: `npm run test:e2e`
- Production build succeeds: `npm run build`

#### Manual Verification:

- With the 33 Karwasz cabinets, the new-project page opens short and finding "podtynkowa, at least 24 modules" takes one filter change
- Large / small / list views render cleanly on desktop and at phone width, and the choice survives a reload
- The admin cabinet list looks consistent with the picker and its edit / archive / restore actions still work
- With JavaScript disabled, every cabinet can still be found (groups expand natively) and a project can be created

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Admin device list

### Overview

The device list keeps its per-kind sections, now collapsible with counts, ordered by parameters and
narrowed by a filter bar.

### Changes Required:

#### 1. Device list page

**File**: `src/pages/admin/devices/index.astro`, `src/components/catalog/CatalogFilterBar.astro`,
`src/components/catalog/catalog-filter.ts`

**Intent**: Each kind section becomes a `<details>`, closed by default, whose summary shows the kind
and the count of active devices (an empty kind stays visible with its catalog-gap message). Rows are
sorted with `compareDevicesForCatalog` and carry `data-*` for query text, manufacturer, poles, In and
archived. The filter bar offers search, manufacturer, poles and In (options built from values present
in the catalog) and "Pokaż zarchiwizowane"; the shared script applies `matchesDeviceFilter`, opens
sections with matches and hides the rest.

**Contract**: edit / archive / restore forms and paths unchanged.

#### 2. i18n and kitchen-sink

**File**: `src/lib/i18n/pl.ts`, `src/pages/dev/kitchen-sink.astro`

**Intent**: Polish strings for the device filters and section counts; kitchen-sink shows the device
filter bar and a collapsed section.

**Contract**: counts through `plural()` (1 aparat / 2 aparaty / 5 aparatów).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint and type checks pass: `npm run lint && npx astro check`
- E2E suite passes: `npm run test:e2e`
- Production build succeeds: `npm run build`

#### Manual Verification:

- With the production catalog, finding "B16 1P Legrand" takes one search or two filter choices, and B6 sorts before B10
- Archived devices are hidden by default, appear with "Pokaż zarchiwizowane", and can be restored
- An empty kind still shows its catalog-gap message

---

## Testing Strategy

### Unit Tests:

- `catalog-list.test.ts`: device order (numeric In, poles order, cross-manufacturer adjacency,
  archived last, missing parameters), cabinet capacity and order, filter predicates at their
  boundaries (`total = minModules`, null mounting, Polish diacritics in the query).
- `cabinet-form.test.ts`: mounting required, unknown value refused.

### Integration Tests:

- `check-parser-parity.test.ts`: the mounting fixture table against the CHECK and the parser.

### E2E:

- `cabinet-picker.spec.ts`: filter narrows, checked cabinet stays visible, empty submit opens groups.
- Existing specs keep passing through the updated `createProjectWithSupply` helper.

### Manual Testing Steps:

1. Create a project and pick "RP-48" via the filters; change it to an RNH cabinet on the project page.
2. Switch the three views, reload, confirm the view persisted; repeat at phone width.
3. In the admin device list, search "B16", filter Legrand, toggle archived, restore a device.

## Performance Considerations

All filtering runs over at most a few hundred server-rendered nodes; toggling `hidden` is cheap. The
`small` and `list` views also reduce the SVG drawn per page. No query changes beyond selecting
`mounting`.

## Migration Notes

The column is nullable and backfilled in the same migration, so the deployed code keeps working
during the deploy window; a cabinet created in that window gets null and lands in the "Bez rodzaju
montażu" group until the admin sets it. Making the column NOT NULL is a separate later migration,
once no null rows remain in production.

## References

- Frame brief: `context/changes/catalog-pickers/frame.md`
- Sorting today: `src/lib/catalog.ts:16-20`
- Lists: `src/pages/admin/devices/index.astro`, `src/pages/admin/cabinets/index.astro`, `src/components/projects/CabinetPicker.astro`
- Inline script pattern: `src/components/projects/QuoteSection.astro:261`
- Module conversion: `src/lib/din-module.ts`
- Karwasz data: `src/lib/karwasz-cabinets.ts`, `supabase/migrations/20261021120000_karwasz_cabinets.sql`
- Cabinet writes: `src/lib/cabinet-form.ts:53`
- E2E helper: `tests/e2e/support.ts:58`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Cabinet mounting type

#### Automated

- [x] 1.1 Migration and seed apply on a fresh local stack: `npx supabase db reset` — bd37b50
- [x] 1.2 Regenerated types are committed and unchanged on re-run: `npm run db:types` — bd37b50
- [x] 1.3 Parser unit tests cover the mounting field: `npm run test:unit` — bd37b50
- [x] 1.4 Mounting parity and RLS suites pass: `npm run test:integration` — bd37b50
- [x] 1.5 Lint and type checks pass: `npm run lint && npx astro check` — bd37b50

#### Manual

- [x] 1.6 After `db reset`, every Karwasz cabinet has the expected mounting (spot-check RN-24, RNH-36, RP-80, UNI SYSTEM 750-1200) — bd37b50
- [x] 1.7 The cabinet editor refuses to save without a mounting and saves each value — bd37b50

### Phase 2: Shared catalog list model

#### Automated

- [x] 2.1 Unit tests cover ordering (B6 before B10, 1P before 1P+N before 3P, Eaton/Legrand B16 1P adjacent, archived last), capacity (RN-6-P = 6, RN-24 = 2×12, uneven rails), and filters (≥ boundary at exactly N, null mounting, diacritics): `npm run test:unit` — fd98eb8
- [x] 2.2 Lint and type checks pass: `npm run lint && npx astro check` — fd98eb8

### Phase 3: Cabinet lists (admin and picker)

#### Automated

- [ ] 3.1 Unit tests pass: `npm run test:unit`
- [ ] 3.2 Lint and type checks pass: `npm run lint && npx astro check`
- [ ] 3.3 E2E suite passes, including the new picker spec and the updated helper: `npm run test:e2e`
- [ ] 3.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 3.5 With the 33 Karwasz cabinets, the new-project page opens short and finding "podtynkowa, at least 24 modules" takes one filter change
- [ ] 3.6 Large / small / list views render cleanly on desktop and at phone width, and the choice survives a reload
- [ ] 3.7 The admin cabinet list looks consistent with the picker and its edit / archive / restore actions still work
- [ ] 3.8 With JavaScript disabled, every cabinet can still be found (groups expand natively) and a project can be created

### Phase 4: Admin device list

#### Automated

- [ ] 4.1 Unit tests pass: `npm run test:unit`
- [ ] 4.2 Lint and type checks pass: `npm run lint && npx astro check`
- [ ] 4.3 E2E suite passes: `npm run test:e2e`
- [ ] 4.4 Production build succeeds: `npm run build`

#### Manual

- [ ] 4.5 With the production catalog, finding "B16 1P Legrand" takes one search or two filter choices, and B6 sorts before B10
- [ ] 4.6 Archived devices are hidden by default, appear with "Pokaż zarchiwizowane", and can be restored
- [ ] 4.7 An empty kind still shows its catalog-gap message
