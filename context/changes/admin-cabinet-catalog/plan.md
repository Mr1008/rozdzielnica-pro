# Admin Cabinet Catalog Implementation Plan

## Overview

Roadmap slice **S-02** (FR-002): the admin maintains a catalog of switchboard cabinets — not as a
count of rails, but as the cabinet's full front-view geometry in millimetres: interior size, cable
entry zones, every DIN rail's exact position and length (including two rails in one row separated by
a gap), and the built-in PE/N bars with their terminals and depth. This geometry is the grid the S-05
layout heuristic places devices on and the drawing S-06/S-09 render, so it is the load-bearing
contract of this change; the CRUD around it follows existing patterns.

## Current State Analysis

- The only table is `public.profiles` (`supabase/migrations/20260922083135_roles_and_profiles.sql`).
  That migration sets the conventions to copy: re-runnable statements, one policy per operation and
  role, `public.is_admin()` reading the `user_role` JWT claim (`:48-50`).
- `/admin` is a placeholder page (`src/pages/admin/index.astro`) already gated by
  `PROTECTED_ROUTES` (`src/lib/route-access.ts:18-21`); the prefix match covers `/admin/*`, but
  **`/api/admin/*` is not covered** by any entry.
- Form endpoints take `FormData` and redirect with `?error=<code>` (`src/pages/api/auth/signup.ts`);
  third-party error text is never shown, codes are mapped to Polish.
- `zod` is installed; there is no `src/types.ts` and no generated `Database` type — the RLS test
  hand-writes one (`tests/integration/rls-profiles.test.ts:22-41`).
- `src/lib/supabase.ts` returns an untyped `createServerClient` or `null`.
- Only `src/components/ui/button.tsx` exists from shadcn; no form components, no React islands in
  product code.
- `supabase/seed.sql` is local/CI only; `supabase db push` never carries it.
- `formatMoney` in `src/lib/i18n/format.ts` expects a PLN amount as a number.

## Desired End State

An admin opens `/admin`, follows a link to `/admin/cabinets`, and sees every cabinet (archived ones
marked) with a drawing of its interior. They create a cabinet by typing datasheet values into lists
of rails, entries and bars while an SVG preview redraws live; an element outside the interior, two
overlapping rails, or an entry past its side is refused in Polish — in the browser and again on the
server. They can edit, archive and restore a cabinet; nothing can be hard-deleted. An electrician
can read active cabinets through RLS but cannot write, archive or see archived ones, and cannot open
any `/admin` or `/api/admin` path. Locally, `supabase db reset` yields three starter cabinets that
differ visibly in size and rail layout.

Verify with: `npm run lint && npx astro check && npm run test:unit && npm run build`,
`npm run test:integration` against a local stack, and the manual admin walkthrough in Phase 4.

### Key Discoveries:

- `is_admin()` reads the token claim, so catalog policies can use it without querying `profiles`
  (`supabase/migrations/20260922083135_roles_and_profiles.sql:48-50`).
- `matchesPrefix` makes `/admin` cover `/admin/cabinets/...` but not `/api/admin/...`
  (`src/lib/route-access.ts:66-68`).
- Updates blocked by RLS return **zero rows and no error** through PostgREST — a write endpoint must
  check the affected row, not only `error`.
- `profiles.updated_at` never advances (F-01 follow-up in
  `context/archive/2026-09-21-roles-and-rls-baseline/change.md`); the new table gets a real touch
  trigger instead of inheriting that gap.
- The integration harness reads credentials from `npx supabase status -o env` and signs in as the
  seeded admin (`tests/integration/rls-profiles.test.ts:53-80`) — the cabinet tests reuse it.

## What We're NOT Doing

- Drag-and-drop editing of the cabinet geometry (the admin editor is numeric; drag-and-drop is the
  electrician's editor in S-06 — this change only guarantees the renderer is ready for it).
- Vertical DIN rails, and `z` depth for rails (rails sit on the mounting plate).
- Listing individual terminals — terminals are described as groups (count × mm² range).
- Row versioning of cabinets; S-03 snapshots the geometry instead (contract recorded below).
- Hard delete — no UI and no RLS delete policy.
- Entering starter cabinets in production as an acceptance gate (the admin may do it anytime).
- The device catalog (S-01), projects (S-03), fixing `profiles.updated_at`.
- Half-millimetre precision — every length is an integer number of millimetres.

## Implementation Approach

A cabinet is a row with scalar catalog fields plus one self-contained `geometry` JSONB document.
Storing geometry as a document means a save is one atomic PostgREST write (no multi-table
transaction), and S-03 can snapshot it into a project with a single copy. The document's shape and
rules live in one pure module, `src/lib/cabinet-geometry.ts`, used by the React island, the API
route, and the tests; the database adds only coarse CHECKs. Build order is pure → database → read
UI → write UI, so each phase is verifiable on its own.

**Contracts this change fixes for later slices** (also recorded in `change.md`):

- **S-01:** device widths are in millimetres, matching the geometry.
- **S-03:** choosing a cabinet copies `cabinets.geometry` into the project; later admin edits never
  shift an existing layout or quote. Archived cabinets disappear from the picker only.
- **S-05/S-06/S-09:** the SVG renderer draws in a mm coordinate system (`viewBox` = interior), so
  pointer events map straight to mm and the same component renders the printed quote.

## Critical Implementation Details

- **Geometry is validated only in TypeScript.** The DB CHECK asserts `jsonb_typeof = 'object'` and
  `version = 1`, nothing more. Every code path that writes `geometry` must go through
  `parseCabinetGeometry`; `seed.sql` is covered by an integration test that parses every seeded row.
- **Draft survival across an error redirect.** The endpoint follows the FormData + redirect
  convention, so a server-side rejection (duplicate model) reloads the page. The island writes its
  state to `sessionStorage` on submit and restores it only when the page loads with `?error=`;
  otherwise it discards any stored draft. Wrap storage access in try/catch.

## Phase 1: Geometry model

### Overview

The pure domain module: schema, validation rules, Polish messages, and unit tests. No database, no
UI.

### Changes Required:

#### 1. Geometry schema and validator

**File**: `src/lib/cabinet-geometry.ts`

**Intent**: Define the geometry document and every rule that makes a cabinet physically coherent,
returning coded issues rather than text, so both island and server reject the same things.

**Contract**: Coordinates are integer mm, origin at the interior's top-left corner, y growing
downward. Exports `cabinetGeometrySchema` (zod), the inferred `CabinetGeometry` type,
`RAIL_HEIGHT_MM = 35`, `BAR_Z_CLEARANCE_MM = 10`, and
`parseCabinetGeometry(input: unknown): { ok: true; geometry: CabinetGeometry } | { ok: false; issues: GeometryIssue[] }`
where `GeometryIssue = { code: GeometryIssueCode; element?: { kind: "rail" | "entry" | "bar"; index: number } }`.
Shape (a signature S-03/S-05 depend on):

```ts
type CabinetGeometry = {
  version: 1;
  interior: { widthMm: number; heightMm: number; depthMm: number };
  rails: { xMm: number; yMm: number; lengthMm: number }[]; // horizontal, height RAIL_HEIGHT_MM
  entries: { side: "top" | "bottom" | "left" | "right"; offsetMm: number; lengthMm: number }[];
  bars: {
    kind: "PE" | "N";
    orientation: "horizontal" | "vertical";
    xMm: number;
    yMm: number;
    lengthMm: number;
    heightMm: number; // front-view footprint
    zMm: number; // distance from the back mounting plate
    terminalGroups: { count: number; minMm2: number; maxMm2: number }[];
  }[];
};
```

Rules, each a distinct code: all lengths/sizes positive integers, positions non-negative integers;
≥ 1 rail and ≥ 1 entry (0 bars allowed); every rail and bar footprint inside the interior; `zMm`
within `0..depthMm`; rails do not overlap each other; no rail overlaps a bar in the front view; two
bars may overlap in the front view only when their `zMm` differ by ≥ `BAR_Z_CLEARANCE_MM`; an entry's
`offsetMm + lengthMm` fits its side (top/bottom → width, left/right → height, offset measured from
the left / top); entries on the same side do not overlap; every bar has ≥ 1 terminal group with
integer `count ≥ 1` and `0 < minMm2 ≤ maxMm2`. Touching edges is not an overlap.

#### 2. Unit tests

**File**: `src/lib/cabinet-geometry.test.ts`

**Intent**: One passing fixture per rule boundary and one failing fixture per issue code; include
the split-row case (two rails, same `yMm`, gap between) as valid and edge-touching as valid.

**Contract**: Follows the `roles.test.ts` pattern; covers every `GeometryIssueCode`.

#### 3. Polish messages

**File**: `src/lib/i18n/pl.ts`

**Intent**: Add a `cabinets` section (labels for fields, element kinds, sides, bar kinds,
orientations) and `geometryIssues` messages keyed by issue code, parameterised by element number
("Szyna 2 wychodzi poza wnętrze szafki").

**Contract**: New keys only; message functions take `(elementNumber: number)` where relevant. A
helper `geometryIssueMessage(issue: GeometryIssue): string` lives in `src/lib/cabinet-geometry.ts`
or beside it and reads from `t`; unit-tested so every code has a message.

### Success Criteria:

#### Automated Verification:

- Geometry unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- Reviewer reads the issue-code list and confirms it matches the agreed rules (no rule missing, none invented)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 2: Database, types and starter cabinets

### Overview

The `cabinets` table with RLS, generated types, three starter cabinets in the seed, and RLS
integration tests that also prove the seed is valid geometry.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20260923HHmmss_cabinets_catalog.sql`

**Intent**: Create the catalog table, a reusable `updated_at` touch trigger, and per-operation
policies. Re-runnable, like the F-01 migration.

**Contract**: `public.cabinets(id uuid pk default gen_random_uuid(), name text not null,
manufacturer text not null, model text not null, price_grosze integer not null check (> 0),
geometry jsonb not null check (jsonb_typeof(geometry) = 'object' and geometry->>'version' = '1'),
archived_at timestamptz null, created_at, updated_at timestamptz not null default now())`, a
case-insensitive unique index on `(lower(manufacturer), lower(model))`, text columns
`check (length(trim(x)) > 0)`. `public.touch_updated_at()`
trigger function + `BEFORE UPDATE` trigger on `cabinets`. RLS enabled; policies:
`cabinets_select_active` (authenticated, `archived_at is null`), `cabinets_select_admin`,
`cabinets_insert_admin`, `cabinets_update_admin` (all `public.is_admin()`); **no delete policy**.
`grant select, insert, update on public.cabinets to authenticated`, then explicitly
`revoke all on public.cabinets from anon` and `revoke delete on public.cabinets from authenticated`.
The explicit REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new
`public` tables to anon/authenticated, while the cloud project (created after Supabase dropped that
default on 2026-05-30) does not — without them the same migration behaves differently in the two
environments.

#### 2. Generated database types and typed client

**Files**: `src/lib/database.types.ts` (generated), `package.json`, `src/lib/supabase.ts`

**Intent**: Replace hand-written row types in product code with the CLI-generated `Database` type
so PostgREST responses are not `any` under `strictTypeChecked`.

**Contract**: npm script `db:types` = `supabase gen types typescript --local > src/lib/database.types.ts`;
the file is committed. `createServerClient<Database>(...)`; the null branch is unchanged. In the
same step, add `src/lib/database.types.ts` to the `eslint.config.js` ignores and to
`.prettierignore` — unconditionally, because lint-staged's `eslint --fix` (Prettier runs as an
ESLint rule) would otherwise reformat it at commit and criterion 2.2 could never pass.

#### 3. Starter cabinets

**File**: `supabase/seed.sql`

**Intent**: Three cabinets that differ enough for S-05 to show adaptation (PRD FR-002 note).
Clearly sample data — manufacturer `Przykładowy producent`, not a real product.

**Contract**: Idempotent insert keyed on `(manufacturer, model)` (`on conflict do nothing`).
(a) small surface cabinet, 1 rail, one top entry, no bars; (b) medium, 3 full-width rails, top and
bottom entries, a vertical PE bar and a vertical N bar at the sides; (c) large, 4 rows with the
last row split into two rails separated by a gap, bottom and left entries, PE and N bars overlapping
in the front view at `zMm` differing by ≥ 10. Each has a distinct interior size and a price.

#### 4. RLS integration tests

**Files**: `tests/integration/support.ts` (new), `tests/integration/rls-profiles.test.ts`,
`tests/integration/rls-cabinets.test.ts` (new)

**Intent**: Prove the admin boundary in the database and that the seed is valid, without
copy-pasting the harness.

**Contract**: First move the inline helpers from `rls-profiles.test.ts:19-148` (`readStackEnv`,
user/service clients, `createElectrician`, `signIn`, `decodeClaims`, `SEEDED_ADMIN`) into
`support.ts` and import them in both files; `rls-profiles.test.ts` assertions are unchanged. The
service client may use the generated `Database` type. `rls-cabinets.test.ts` asserts: electrician
reads active cabinets, does not see an archived one, insert/update are refused or affect 0 rows;
anon select fails with `42501`; admin inserts, updates, archives and restores; admin delete fails
with `42501`; `price_grosze <= 0` and a non-object `geometry` are rejected by CHECK; a duplicate
manufacturer + model differing only in letter case yields `23505`;
`updated_at` advances on update; every seeded cabinet passes `parseCabinetGeometry` and the three
have distinct interiors and rail counts.

### Success Criteria:

#### Automated Verification:

- Migration and seed apply cleanly on a fresh stack: `npx supabase db reset`
- Generated types are current: `npm run db:types` produces no diff
- RLS integration tests pass: `npm run test:integration`
- Unit tests, lint, type check and build pass: `npm run lint && npx astro check && npm run test:unit && npm run build`

#### Manual Verification:

- In local Studio, `public.cabinets` shows three seeded rows with RLS enabled and no delete policy

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 3: Read-only surface — drawing, list, lifecycle

### Overview

The reusable SVG drawing, the catalog list with archive/restore, `/admin` as the catalog hub, and
the `/api/admin` gate.

### Changes Required:

#### 1. Cabinet drawing

**File**: `src/components/cabinets/CabinetDrawing.tsx`

**Intent**: Render a `CabinetGeometry` as a front-view SVG: interior outline, rails, entry zones on
the edges, bars with kind labels; bars that overlap a nearer bar are drawn dashed (behind). Usable
server-side without hydration (list, later the print) and inside the island.

**Contract**: Props `{ geometry: CabinetGeometry; highlight?: { kind; index }; className? }`.
`viewBox="0 0 {widthMm} {heightMm}"` so one SVG unit = 1 mm; no pointer handling yet, but no
transform that would break a later mm-mapped drag. Labels via `t`, colours via Tailwind tokens.

#### 2. Route gate for admin API

**Files**: `src/lib/route-access.ts`, `src/lib/route-access.test.ts`

**Intent**: Gate `/api/admin` for the admin role so a non-admin form post is redirected before it
reaches Supabase (RLS stays the real boundary).

**Contract**: New `PROTECTED_ROUTES` entry `{ prefix: "/api/admin", roles: ["admin"] }`; tests for
an electrician and an anonymous request.

#### 3. Catalog list and hub

**Files**: `src/pages/admin/cabinets/index.astro`, `src/pages/admin/index.astro`

**Intent**: The list shows name, manufacturer/model, price (`formatMoney(price_grosze / 100)`), an
archived badge, a small drawing, links to edit, and an archive/restore button per row plus a
"new cabinet" link. `/admin` becomes the hub linking to the cabinet catalog (the device catalog link
lands with S-01). An `?error=` code is shown in Polish.

**Contract**: Handles the `createClient() === null` branch with the existing not-configured
message. Sorted active-first, then by name.

#### 4. Archive / restore endpoints

**Files**: `src/pages/api/admin/cabinets/[id]/archive.ts`, `src/pages/api/admin/cabinets/[id]/restore.ts`

**Intent**: Set or clear `archived_at`, then redirect back to the list.

**Contract**: `POST`, FormData, redirect to `/admin/cabinets` or `?error=<code>`. An update
affecting 0 rows maps to `forbidden`/`notFound`; codes map to Polish in a new `cabinetErrors`
section of `pl.ts` (`notConfigured`, `forbidden`, `notFound`, `duplicateModel`, `invalidInput`,
`unknown`).

### Success Criteria:

#### Automated Verification:

- Route-access tests cover `/api/admin`: `npm run test:unit`
- Lint, type check and build pass: `npm run lint && npx astro check && npm run build`
- RLS integration tests still pass: `npm run test:integration`

#### Manual Verification:

- As the seeded admin, `/admin/cabinets` lists the three starter cabinets with drawings that are visibly different, including the split row and the dashed bar behind another
- Archive then restore a cabinet from the list; the badge follows
- As an electrician, `/admin/cabinets` and a POST to `/api/admin/cabinets/<id>/archive` redirect away and change nothing

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Phase 4: Editor and write path

### Overview

Create and edit cabinets through a React island with a live preview, server-side validation, and
documentation sync.

### Changes Required:

#### 1. Form parsing

**Files**: `src/lib/cabinet-form.ts`, `src/lib/cabinet-form.test.ts`

**Intent**: Turn submitted `FormData` into a validated insert/update payload: trimmed text fields,
PLN price accepting `,` or `.` as decimal separator converted to integer grosze, and the `geometry`
hidden field parsed as JSON then through `parseCabinetGeometry`.

**Contract**: `parseCabinetForm(form: FormData): { ok: true; value: CabinetInput } | { ok: false; code: string }`;
unit-tested for price edge cases (`"12,5"`, `"0"`, `"-1"`, `"abc"`, three decimals) and malformed JSON.
Also exports `formatPriceInput(grosze: number): string`, which gives a plain decimal with a comma
(`123456` → `"1234,56"`), for pre-filling the edit form. Never `formatMoney`, whose output
(`"1 234,56 zł"` with a non-breaking space) the parser rejects. A round-trip test proves
`parseCabinetForm` accepts it.

#### 2. Editor island

**File**: `src/components/cabinets/CabinetEditor.tsx`

**Intent**: Scalar fields plus editable lists for rails, entries and bars (bars with a nested
terminal-group list), each row with add/remove; `CabinetDrawing` beside the form redraws on every
change and highlights the row being edited. Issues from `parseCabinetGeometry` show inline in Polish
and disable submit. A native `<form method="POST">` carries the scalars and a hidden `geometry`
JSON input, so the FormData convention holds.

**Contract**: Props `{ initial?: CabinetRow; action: string; error?: string }`. Draft kept in
`sessionStorage` under `cabinet-draft:<id|new>`, restored only when `error` is present (see Critical
Implementation Details). Uses shadcn inputs if added (`npx shadcn@latest add input label`); all text
from `t`.

#### 3. Pages and endpoints

**Files**: `src/pages/admin/cabinets/new.astro`, `src/pages/admin/cabinets/[id].astro`,
`src/pages/api/admin/cabinets/index.ts` (create), `src/pages/api/admin/cabinets/[id]/index.ts` (update)

**Intent**: Pages mount the island (`client:load`) with the row (edit) or empty defaults (new).
Endpoints run `parseCabinetForm`, insert/update, and redirect to `/admin/cabinets` on success or
back to the form with `?error=<code>`.

**Contract**: Postgres `23505` → `duplicateModel`; update touching 0 rows → `notFound`; invalid form
→ `invalidInput`; anything else → `unknown`. Supabase `error.message` is never surfaced. The `[id]`
page and endpoints validate `id` as a UUID before querying (a non-UUID would otherwise reach
PostgREST as `22P02` and map to `unknown`); a non-UUID or missing row renders 404 / maps to
`notFound`.

#### 4. Documentation sync

**Files**: `AGENTS.md`, `README.md`

**Intent**: Make the repo's instructions true: product code now includes the cabinet catalog;
tripwire that cabinet geometry is validated only by `parseCabinetGeometry` (never write `geometry`
around it) and that S-03 must snapshot geometry rather than reference it live; the `db:types`
command; `/admin/cabinets` in the README route table.

**Contract**: Edits to existing sections only (product-code sentence, Tripwires, Commands table,
README Auth routes table).

### Success Criteria:

#### Automated Verification:

- Form-parsing unit tests pass: `npm run test:unit`
- Lint, type check and build pass: `npm run lint && npx astro check && npm run build`
- RLS integration tests still pass: `npm run test:integration`
- Smoke script still passes against the dev server: `npm run smoke`

#### Manual Verification:

- As admin, create a cabinet with a split rail row and two bars at different depths; it appears in the list with a matching drawing
- Typing a rail that leaves the interior, overlapping two rails, and an entry past its side each shows a Polish message and blocks submit
- Creating a second cabinet with an existing manufacturer + model shows the Polish duplicate error and the typed geometry is still there
- Editing a seeded cabinet's price and a rail position persists after reload
- After merge and deploy, `/admin/cabinets` works on the production Worker (migration applied by `db-migrate.yml`)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before proceeding
to the next phase.

---

## Testing Strategy

### Unit Tests:

- `cabinet-geometry.test.ts`: every issue code, every rule boundary (touching edges valid, split
  row valid, bar overlap at exactly `BAR_Z_CLEARANCE_MM` valid, one below invalid, `zMm = depthMm`
  valid), every code has a Polish message.
- `cabinet-form.test.ts`: price parsing and grosze conversion, text trimming, malformed JSON.
- `route-access.test.ts`: `/api/admin` gated for electrician and anonymous.

### Integration Tests:

- `rls-cabinets.test.ts`: role matrix (admin / electrician / anon) × (select active, select
  archived, insert, update, archive, delete), CHECKs, unique constraint, touch trigger, seed validity.

### Manual Testing Steps:

1. `npx supabase db reset`, `npm run dev`, sign in as `admin@example.com`.
2. Open `/admin/cabinets`; compare the three drawings.
3. Create, break, fix and save a cabinet; trigger a duplicate-model error.
4. Archive and restore; sign in as an electrician and try `/admin/cabinets`.

## Performance Considerations

Catalog scale is a handful of rows; the list loads every row with its geometry (a few kB each).
Validation is O(n²) over elements with n < ~30, negligible even within the Workers CPU ceiling.

## Migration Notes

Forward-compatible: a new table and a new function, nothing existing changes, so the race between
`db-migrate.yml` and the Cloudflare deploy is safe in either order (the code only reads `cabinets`
from pages that did not exist before). The production catalog starts empty; the admin enters
cabinets through the UI.

## References

- Roadmap slice: `context/foundation/roadmap.md` — S-02 (`admin-cabinet-catalog`, issue #3)
- PRD: FR-002, FR-004, FR-008, FR-013, `## Business Logic`, Open Question #1 (admin acceptance —
  answered for S-02 by this plan's Phase 3–4 manual criteria)
- Pattern — migration and policies: `supabase/migrations/20260922083135_roles_and_profiles.sql`
- Pattern — form endpoint: `src/pages/api/auth/signup.ts`
- Pattern — RLS harness: `tests/integration/rls-profiles.test.ts`
- Route gating: `src/lib/route-access.ts`
- Prior change: `context/archive/2026-09-21-roles-and-rls-baseline/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Geometry model

#### Automated

- [x] 1.1 Geometry unit tests pass: `npm run test:unit` — d897831
- [x] 1.2 Lint passes: `npm run lint` — d897831
- [x] 1.3 Type check passes: `npx astro check` — d897831

#### Manual

- [x] 1.4 Reviewer reads the issue-code list and confirms it matches the agreed rules (no rule missing, none invented) — d897831

### Phase 2: Database, types and starter cabinets

#### Automated

- [x] 2.1 Migration and seed apply cleanly on a fresh stack: `npx supabase db reset` — ffb81e0
- [x] 2.2 Generated types are current: `npm run db:types` produces no diff — ffb81e0
- [x] 2.3 RLS integration tests pass: `npm run test:integration` — ffb81e0
- [x] 2.4 Unit tests, lint, type check and build pass: `npm run lint && npx astro check && npm run test:unit && npm run build` — ffb81e0

#### Manual

- [x] 2.5 In local Studio, `public.cabinets` shows three seeded rows with RLS enabled and no delete policy — ffb81e0

### Phase 3: Read-only surface — drawing, list, lifecycle

#### Automated

- [x] 3.1 Route-access tests cover `/api/admin`: `npm run test:unit` — 6399c36
- [x] 3.2 Lint, type check and build pass: `npm run lint && npx astro check && npm run build` — 6399c36
- [x] 3.3 RLS integration tests still pass: `npm run test:integration` — 6399c36

#### Manual

- [x] 3.4 As the seeded admin, `/admin/cabinets` lists the three starter cabinets with drawings that are visibly different, including the split row and the dashed bar behind another — 6399c36
- [x] 3.5 Archive then restore a cabinet from the list; the badge follows — 6399c36
- [x] 3.6 As an electrician, `/admin/cabinets` and a POST to `/api/admin/cabinets/<id>/archive` redirect away and change nothing — 6399c36

### Phase 4: Editor and write path

#### Automated

- [x] 4.1 Form-parsing unit tests pass: `npm run test:unit` — b33cebf
- [x] 4.2 Lint, type check and build pass: `npm run lint && npx astro check && npm run build` — b33cebf
- [x] 4.3 RLS integration tests still pass: `npm run test:integration` — b33cebf
- [x] 4.4 Smoke script still passes against the dev server: `npm run smoke` — b33cebf

#### Manual

- [x] 4.5 As admin, create a cabinet with a split rail row and two bars at different depths; it appears in the list with a matching drawing — b33cebf
- [x] 4.6 Typing a rail that leaves the interior, overlapping two rails, and an entry past its side each shows a Polish message and blocks submit — b33cebf
- [x] 4.7 Creating a second cabinet with an existing manufacturer + model shows the Polish duplicate error and the typed geometry is still there — b33cebf
- [x] 4.8 Editing a seeded cabinet's price and a rail position persists after reload — b33cebf
- [ ] 4.9 After merge and deploy, `/admin/cabinets` works on the production Worker (migration applied by `db-migrate.yml`)
