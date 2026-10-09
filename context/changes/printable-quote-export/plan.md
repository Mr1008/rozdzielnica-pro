# Printable Quote Export (S-09) Implementation Plan

## Overview

The electrician opens `/dashboard/projects/[id]/print` and prints the quote, or saves it as PDF with the
browser's own "Save as PDF". The document is in Polish and has three parts:

- a letterhead with the electrician's company details;
- the client data, an itemised material list and the labour cost, with every total taken from
  `computeQuoteView`;
- the cabinet drawing with its wires and legends, on its own A4 page.

It closes FR-012 and the last acceptance criterion of US-01. No server-side PDF (edge runtime).

## Current State Analysis

- **The quote.** `computeQuoteView` (`src/lib/quote.ts:118`) returns `no_profile | not_current | ready`.
  `ReadyQuote` (`quote.ts:86-105`) has only aggregates: the cabinet line, `deviceCount` + `devicesGrosze`,
  labour and totals. It also carries `mountMinutesPerDevice` / `overheadMinutes` for the formula.
- **The layout.** `computeLayoutView` (`src/lib/layout-server.ts:62`) returns
  `placed | missing | does_not_fit | outdated`, and null when the match is not `current`. The project
  page assembles the drawing at `src/pages/dashboard/projects/[id].astro:129-148`:
  `loadLayoutContext` → `computeMatchView` → `computeLayoutView` → `buildDrawnDevices` →
  `computeWiring` → `buildDrawnWires` / `buildDrawnCables`.
- **The drawing.** `src/components/cabinets/CabinetDrawing.tsx` is a hook-free React component
  rendered on the server without hydration (l.310). It is one mm-`viewBox` SVG coloured only through
  tokens (`src/styles/global.css:66-93`). Wire roles are also told apart by dash, stripe and weight,
  which is built for greyscale. Hover `<title>`s do nothing on paper. The device and wire legends are
  inline markup in `src/components/projects/LayoutSection.astro:108-188`.
- **No print CSS exists anywhere in `src/`.** The project page is mostly forms, plus a Topbar
  (`AppLayout.astro:20-36`) and a sticky `<aside>` (`[id].astro:583-662`).
- **Identity.** `profiles` has only `full_name` (nullable) and has admin read policies
  (`supabase/migrations/20260922083135_roles_and_profiles.sql:56-84`). There is no company data.
  `pricing_profiles` is the owner-only pattern to copy
  (`supabase/migrations/20260924120000_pricing_profiles.sql:21-101`; endpoint
  `src/pages/api/profile/pricing.ts`; errors `src/lib/pricing-errors.ts`; RLS test
  `tests/integration/rls-pricing-profiles.test.ts`).
- **Routing.** `/dashboard` is elektryk-gated by prefix (`src/lib/route-access.ts:15-25`), so
  `/dashboard/projects/[id]/print` needs no new entry. `/api/profile` is gated too.
- **Rules this slice must keep** (`AGENTS.md` tripwires):
  - Print `computeQuoteView` only in `ready`, and never re-derive a sum.
  - Print only when `computeMatchView(...).state === "current"`.
  - Draw only a `placed` layout.
  - Dates use `formatDate(x, Astro.locals.timeZone)`.
  - No inline user-facing text: use `t` from `@/lib/i18n`.
  - Token classes only; every new UI state goes on `/dev/kitchen-sink` first.

## Desired End State

- **When printing is possible.** On a project whose quote is `ready` and whose layout is `placed`, the
  quote section shows a "Drukuj wycenę" link to the print page. The print page shows an A4-sized
  document preview, and a screen-only toolbar with "Wróć do projektu" and
  "Drukuj / zapisz jako PDF" (`window.print()`).
- **Printed page 1.** The letterhead, the "Wycena" title, the issue date (today, viewer timezone), the
  project, client and site address, and the cabinet. A material table: the cabinet line plus one row
  per catalog device (kind, name, manufacturer + model, quantity, unit price, line total), with the
  material subtotal. A labour table: time, hourly rate and labour cost. Then the grand total, and a note
  that this is an informational document, not an invoice.
- **Printed page 2.** The cabinet drawing with wires, fitted to the page, plus the device and wire
  legends. The drawing never splits across pages, and wire colours print (`print-color-adjust: exact`).
- **When printing is blocked.** If either gate fails, the print page shows a blocking notice listing
  each reason, with a link to fix it (profile / device matching / layout). No amounts and no drawing.
- **Screen-only notices** (never printed): an outdated time override, missing company details, a rate
  above the warning threshold.
- **Company details.** The electrician edits them in a second card on `/dashboard/profile`: company
  name, NIP, address, phone, email, all optional. They are stored in the new owner-only
  `business_profiles` table, which the admin cannot read.
- **Kitchen sink.** `/dev/kitchen-sink` shows the business-profile form states and the document states
  (ready, blocked, greyscale preview).

### Key Discoveries:

- `ReadyQuote` already exposes everything the cost tables need. Per-device rows come from
  `matchView.snapshot` (`SnapshotRow = Tables<"project_devices">`,
  `src/lib/device-matching-server.ts:34`; columns `device_id`, `kind`, `role`, `name`, `manufacturer`,
  `model`, `price_grosze`, `position`).
- `CabinetDrawing` is already server-rendered SVG. The print reuses it as is; nothing waits for
  hydration.
- `pricing_profiles` shows the exact RLS shape the new table needs: revoke-all then grant, select-own,
  insert/update-own with the `user_role = 'elektryk'` claim, no admin policy, no delete. The
  touch trigger is `public.touch_updated_at()`.
- Tailwind 4 ships the `print:` variant and the `break-before-page` / `break-inside-avoid` utilities.
  No config is needed.

## What We're NOT Doing

- A client-side PDF library (jsPDF / svg2pdf) or a server-side PDF.
- A document number, VAT, a validity period, a signature block.
- The wire-lengths table on the printout. It stays on the project page.
- Estimate/override markers or the labour formula on paper (internal pricing detail).
- Blocking the print on an outdated override, or on missing company details.
- Making company details required, or adding a logo upload.
- S-06 manual layout editing. The print reads whatever `computeLayoutView` returns.
- Realistic wiring render (S-11). The print stays schematic.
- Changes to `computeQuoteView`, `computeLayoutView`, the matcher or the wiring router.
- A print-only stylesheet on `[id].astro`.

## Implementation Approach

Five phases. Each is narrow, with fixed contracts, and sized for a **Sonnet** implementer. The
constrained work copies an existing in-repo pattern: the migration and RLS copy `pricing_profiles`, the
endpoint copies `api/profile/pricing.ts`, the pure helper copies `quote.ts` + test. The main context
runs the full gate stack after each phase. Subagents run only scoped checks (own test files,
`npx eslint <touched files>`, `db reset` / `db:types` when writing a migration).

The document is **one Astro component, `QuoteDocument.astro`**, styled as an A4 sheet
(`w-[210mm]`, 12 mm padding, each page a `.quote-page` block). The print route renders it, and the
kitchen sink renders the same component (plus a `grayscale` variant). That lets the layout be checked
on screen without a print dialog. `@media print` only hides screen chrome, removes sheet decoration and
sets `@page`.

## Critical Implementation Details

- **Colour on paper:** browsers drop background and print colours unless the document sets
  `print-color-adjust: exact` (`-webkit-print-color-adjust: exact`). Set it on the document root, or
  wire colours, PE stripes and token fills disappear in the print preview.
- **Drawing fit:** the SVG scales by width (`h-auto w-full`), so a tall cabinet would overflow the page.
  The drawing page caps the drawing's height (about `max-h-[190mm]`, `w-auto`, centred) so that the
  drawing plus both legends fit one A4 page at 12 mm margins. The drawing page uses
  `break-before-page` + `break-inside-avoid`.
- **Invariant, not a second price source:** the itemised lines must sum exactly to
  `ReadyQuote.devicesGrosze`. A mismatch is a bug: `computePrintView` throws, like
  `deviceTerminals` does for an impossible state. It is never shown as a state.

## Phase 1: Company details — data layer

**Implementer: Sonnet.** This is constrained: copy the `pricing_profiles` migration, parser and RLS
test structure.

### Overview

A new owner-only `business_profiles` table and its TypeScript parser. The bounds are guarded twice:
by CHECKs in the migration and by constants in the parser.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/20261008120000_business_profiles.sql`

**Intent**: Store the electrician's company details for the printout, isolated from the admin. The
admin can read `profiles`, so the data cannot live there.

**Contract**:

- **Columns.** Table `public.business_profiles`:
  - `user_id uuid primary key references public.profiles(id) on delete cascade`
  - `company_name text`, `nip text`, `address text`, `phone text`, `email text`, all nullable
  - `created_at` / `updated_at timestamptz not null default now()`
  - the `business_profiles_touch_updated_at` trigger on `public.touch_updated_at()`
- **Named CHECKs.** Each column is null or a trimmed non-empty value within its bound:
  - `business_profiles_company_name_valid`: `char_length` 1–200, equals its `btrim`;
  - `business_profiles_nip_valid`: `nip ~ '^[0-9]{10}$'`;
  - `business_profiles_address_valid`: 1–300, newlines allowed;
  - `business_profiles_phone_valid`: 1–30 and `~ '^[0-9 +()-]+$'`;
  - `business_profiles_email_valid`: 1–254 and `~ '^[^@[:space:]]+@[^@[:space:]]+$'`.
- **Grants and RLS.** RLS enabled, then the grants and policies copied from `pricing_profiles` with the
  names changed:
  - revoke all from anon/authenticated, grant select/insert/update to authenticated, explicit
    revoke delete;
  - `business_profiles_select_own`, plus `_insert_own` / `_update_own` requiring `user_role = 'elektryk'`;
  - no admin policy and no delete policy, with the same explanatory comment.
- **Compatibility.** The table is new, so the migration is backward-compatible with deployed code.

#### 2. Parser

**File**: `src/lib/business-profile.ts` (+ `src/lib/business-profile.test.ts`)

**Intent**: Turn the profile form into the row shape, rejecting what the CHECKs reject. Also validate
the NIP checksum, which TypeScript does stricter than SQL. That is the safe direction, and it is
documented in the header comment.

**Contract**:

- Constants mirror the CHECKs and must be changed together with them: `MAX_COMPANY_NAME_LENGTH = 200`,
  `MAX_ADDRESS_LENGTH = 300`, `MAX_PHONE_LENGTH = 30`, `MAX_EMAIL_LENGTH = 254`.
- `BUSINESS_FIELDS = { companyName: "company_name", nip: "nip", address: "address", phone: "phone", email: "email" }`.
- `BUSINESS_PROFILE_PATH = "/dashboard/profile"` and `BUSINESS_API_PATH = "/api/profile/business"`.
- `interface BusinessProfile { company_name, nip, address, phone, email: string | null }`.
- `parseBusinessForm(form: FormData): { ok: true; value: BusinessProfile } | { ok: false; code: "invalid_input" }`.
  It never throws. Each value is trimmed, and empty becomes null. Lengths count code points.
- NIP input accepts digits with optional spaces or dashes and stores the 10 digits. Checksum weights
  `[6,5,7,2,3,4,5,6,7]`, `sum mod 11` must equal the 10th digit (`10` is never valid).
- `isValidNip(digits: string): boolean` is exported.
- `businessFormDefaults(row | null)` returns the form's input strings, `""` for null.
- `hasCompanyDetails(row | null): boolean` is true when `company_name !== null`.
- Tests cover: all empty → all null; each bound at max and max+1; a valid NIP (`5260250995`) with and
  without dashes; a bad checksum; 9 or 11 digits; a phone with letters; an email without `@`;
  whitespace-only → null; a stored row through `businessFormDefaults` → `parseBusinessForm` round-trip.

#### 3. Types and RLS test

**Files**: `src/lib/database.types.ts` (regenerated), `tests/integration/rls-business-profiles.test.ts`

**Intent**: Regenerate the committed types, and assert the isolation the way the pricing test does.

**Contract**:

- Regenerate with `npm run db:types` after `npx supabase db reset`.
- The test mirrors `rls-pricing-profiles.test.ts`:
  - the owner can insert, update and select their own row;
  - another elektryk sees no row and cannot update it;
  - the admin sees no rows and cannot insert;
  - delete is refused;
  - a CHECK violation (an 11-digit NIP) returns `23514`.

### Success Criteria:

#### Automated Verification:

- Migration applies on a fresh stack: `npx supabase db reset`
- Regenerated types are committed and `git diff` shows only the new table: `npm run db:types`
- Parser tests pass: `npx vitest run --config vitest.config.ts src/lib/business-profile.test.ts`
- RLS test passes against the local stack: `npm run test:integration`
- `npm run lint`, `npx astro check` and `npm run test:unit` pass

#### Manual Verification:

- In local Studio, an admin session cannot select `business_profiles` rows

**Implementation Note**: After automated verification passes, pause for manual confirmation before
Phase 2.

---

## Phase 2: Company details — profile form

**Implementer: Sonnet.** This is constrained: copy `api/profile/pricing.ts`, `pricing-errors.ts` and the
pricing card on `profile.astro`.

### Overview

A second card, "Dane firmy do wyceny", on `/dashboard/profile`, posting to a new endpoint.

### Changes Required:

#### 1. Errors

**File**: `src/lib/business-errors.ts` (+ `business-errors.test.ts`)

**Intent**: Map `?businessError=` codes to Polish text, exactly the shape of `pricing-errors.ts`.

**Contract**:

- `BUSINESS_ERROR = { notConfigured, forbidden, invalidInput, unknown }`.
- `businessErrorMessage(code)`.
- `businessErrorFromPostgrest(error)`: `42501` → forbidden, `23514` → invalid_input, else unknown.

#### 2. Endpoint

**File**: `src/pages/api/profile/business.ts`

**Intent**: Upsert the signed-in user's row from FormData, like `pricing.ts`.

**Contract**:

- `POST` takes FormData and calls `parseBusinessForm`.
- It upserts `{ user_id, ...value }` with `onConflict: "user_id"`.
- Success redirects to `/dashboard/profile?businessSaved=1`. Errors redirect to
  `/dashboard/profile?businessError=<code>`. These are separate params from the pricing card's
  `saved` / `error`, so the two cards report independently.
- The null-client branch is kept.

#### 3. Profile page card

**File**: `src/pages/dashboard/profile.astro`

**Intent**: Load the own `business_profiles` row (`maybeSingle`) alongside the pricing row. Render a
second Card with five fields:

- company name: input;
- NIP: input, `inputmode="numeric"`, hint "10 cyfr, z kreskami lub bez";
- address: textarea, 3 rows;
- phone: input type `tel`;
- email: input type `email`.

Native `maxlength` comes from the constants. Show the saved/error banners per card.

**Contract**:

- Field names from `BUSINESS_FIELDS`, defaults from `businessFormDefaults`, a11y via `fieldControlProps`
  / `fieldHintId`, as in the pricing card.
- A load error shows an Alert in this card only.

#### 4. Strings and kitchen sink

**Files**: `src/lib/i18n/pl.ts`, `src/pages/dev/kitchen-sink.astro`

**Intent**: Every label, hint and message under `t.businessProfile.*` and `t.businessErrors.*`. Show
the card in the kitchen sink in three states: empty, filled, and invalid (an error banner).

**Contract**: The new keys hold no inline text in components. The kitchen sink adds one figure per
state.

### Success Criteria:

#### Automated Verification:

- Error-mapping tests pass: `npx vitest run --config vitest.config.ts src/lib/business-errors.test.ts`
- `npm run lint`, `npx astro check`, `npm run test:unit` and `npm run build` pass

#### Manual Verification:

- In the browser as an electrician:
  - saving all five fields persists them, and they pre-fill on reload;
  - clearing them all saves nulls;
  - a bad NIP shows the Polish invalid-input banner on this card only;
  - the pricing card still saves independently.
- The kitchen sink shows the three card states

**Implementation Note**: Pause for manual confirmation before Phase 3.

---

## Phase 3: Print view model

**Implementer: Sonnet.** This is constrained: a pure function with a fully specified input/output and
test list. Copy the `quote.ts` / `quote.test.ts` style.

### Overview

`computePrintView` is the only thing the print page reads. It applies the gates, itemises material
under the sum invariant, and builds the letterhead and the screen-only notices.

### Changes Required:

#### 1. Pure helper

**File**: `src/lib/quote-print.ts` (+ `src/lib/quote-print.test.ts`)

**Intent**: One deterministic verdict for the print page, so the page renders and never decides.

**Contract**:

```ts
export type PrintBlockReason = "no_profile" | "match_not_current" | "layout_not_placed";
export interface MaterialLine {
  deviceId: string;
  kind: DeviceKind;
  name: string;
  manufacturer: string;
  model: string;
  quantity: number;
  unitGrosze: number;
  totalGrosze: number;
}
export interface Letterhead {
  title: string | null;
  nip: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}
export type PrintNotice =
  { code: "override_outdated"; estimateMinutes: number } | { code: "business_missing" } | { code: "rate_warning" };
export type PrintView =
  | { state: "blocked"; reasons: PrintBlockReason[] }
  | { state: "ready"; quote: ReadyQuote; lines: MaterialLine[]; letterhead: Letterhead; notices: PrintNotice[] };
export function computePrintView(input: {
  quote: QuoteView;
  matchCurrent: boolean;
  layout: LayoutView | null;
  snapshot: readonly SnapshotRow[];
  business: BusinessProfile | null;
  fullName: string | null;
  userEmail: string | null;
}): PrintView;
```

**Rules:**

- **Gate reasons, in this order.** `matchCurrent` is `computeMatchView(...).state === "current"`; it is
  passed in because `computeQuoteView` hides a non-current match behind `no_profile`.
  - Quote `no_profile` → `no_profile`.
  - `!matchCurrent` → `match_not_current`.
  - `matchCurrent` and the layout null or `state !== "placed"` → `layout_not_placed`.
  - Any reason → `blocked`.
- **Lines.** Group the snapshot by `(device_id, price_grosze)`, in order of the first `position`.
  `quantity` = the row count, `totalGrosze = quantity × unitGrosze`. If `Σ totalGrosze !== quote.devicesGrosze`,
  throw an `Error`.
- **Letterhead.**
  - `title` = `business.company_name ?? fullName ?? userEmail ?? null`.
  - `email` = `business.email ?? userEmail`.
  - The other fields come from `business`, or null.
- **Notices, in this order.**
  - `override_outdated`, when `quote.override?.outdated`, carrying `quote.estimateMinutes`.
  - `business_missing`, when `!hasCompanyDetails(business)`.
  - `rate_warning`, when `quote.rateWarning`.
- `printNoticeMessage(notice)` and `printBlockMessage(reason)` return Polish text. Each is exhaustive
  through a `Record`.

**Tests:**

- each gate alone;
- no profile and a non-current match → exactly `["no_profile", "match_not_current"]`;
- a non-current match never adds `layout_not_placed`;
- a ready + placed fixture → `ready`;
- two identical MCBs → one line with quantity 2;
- the same `device_id` at two prices → two lines;
- catalog PE/N bars are itemised;
- the sum equals `devicesGrosze` on the kitchen-sink fixtures (`kitchenSinkQuoteStates`);
- a doctored `devicesGrosze` throws;
- the letterhead falls back through company → full name → email → null;
- notice combinations and their order.

**Fixtures**: build quotes with the real `computeQuoteView`, as `quote.test.ts` does, and layout views
as `{ state: "placed", ... }` literals per the `LayoutView` type.

#### 2. Strings

**File**: `src/lib/i18n/pl.ts`

**Intent**: Add `t.quotePrint.*`: block reasons and their link labels, notice texts (the outdated text
reuses `t.quote.duration`), the document labels and column headers, the informational note, the toolbar
labels, and the page title `(projectName) => "Wycena — …"`.

**Contract**: Keys only. They are consumed in Phases 3–4.

### Success Criteria:

#### Automated Verification:

- Helper tests pass: `npx vitest run --config vitest.config.ts src/lib/quote-print.test.ts`
- `npm run lint`, `npx astro check` and `npm run test:unit` pass

**Implementation Note**: No manual step. Proceed to Phase 4 after the gate stack is green.

---

## Phase 4: Print page and document

**Implementer: Sonnet.** This is constrained to the listed files, but it is the visual phase. If print
fidelity fails twice (the drawing splits, colours drop), escalate the layout fix to Opus.

### Overview

Extract the shared drawing assembly and the legend, build `QuoteDocument.astro`, add the route, the
print CSS and the entry link, and put the document states on the kitchen sink.

### Changes Required:

#### 1. Shared drawing assembly

**File**: `src/lib/layout-server.ts`, `src/pages/dashboard/projects/[id].astro`

**Intent**: Move the drawing-building lines `[id].astro:137-148` (placed devices, conductors, wires,
cables, wire lengths) into one exported function. Both pages then build the identical drawing. This is
a pure move with no behaviour change.

**Contract**:

```ts
buildLayoutDrawing(layoutView: LayoutView | null, matchView: MatchView, ctx: MatchContext):
  { devices: DrawnDevice[]; wires: DrawnWire[]; cables: DrawnCable[]; lengths: WireLengthRow[] }
```

It returns empty arrays unless the layout is `placed` and the geometry is set. `[id].astro` calls it,
and its rendered output is unchanged.

#### 2. Shared legend

**File**: `src/components/projects/DrawingLegend.astro`, `src/components/projects/LayoutSection.astro`

**Intent**: Extract the device and wire legend markup (`LayoutSection.astro:108-188`) into one
component used by `LayoutSection` and the document. This is a pure move.

**Contract**: Props are `{ earthing?: EarthingSystem | null }`, or whatever the current markup already
reads. The output is identical in `LayoutSection`.

> **Addendum (impl review 2026-10-09):** not needed and not created. The legends were already one
> shared island, `src/components/projects/LayoutLegend.tsx`, used by `LayoutSection.astro`;
> `QuoteDocument.astro` renders the same component. The print page also gained two presentational
> extractions not listed here, `PrintBlocked.astro` and `PrintNotices.astro`, and `projectPrintPath`
> in `src/lib/project.ts`.

#### 3. Document component

**File**: `src/components/projects/QuoteDocument.astro`

**Intent**: Render a `PrintView` of state `ready` as A4 pages, from tokens only.

**Contract**:

- **Props:** `view` (ready), `project: { name, client_name, site_address, cabinet_name, cabinet_manufacturer, cabinet_model }`,
  `issuedAt: Date`, `timeZone: string`, `geometry: CabinetGeometry`, `drawing` (from
  `buildLayoutDrawing`), `earthing`.
- **Root.** `.quote-document` with `print-color-adjust: exact`.
- **Page 1** (`.quote-page`):
  - the letterhead (title bold; NIP, address with `whitespace-pre-line`, phone, email);
  - `t.quotePrint.title` and `formatDate(issuedAt, timeZone)`;
  - the client block;
  - the material table: the cabinet row, then the `lines` rows, with a subtotal of
    `view.quote.materialGrosze`;
  - the labour table: `t.quote.duration` of `labourMinutes`, `t.quote.perHour(rate)`, `labourGrosze`;
  - the total `totalGrosze`;
  - the informational note.
- **Page 2** (`.quote-page break-before-page break-inside-avoid`): the cabinet name, `CabinetDrawing`
  with the drawing props, height-capped (see Critical Implementation Details), then `DrawingLegend`.
- **Formatting.** Money via `formatMoney(grosze / 100)`, tabular numerals. No palette classes.

#### 4. Print route

**File**: `src/pages/dashboard/projects/[id]/print.astro`

**Intent**: Load exactly what the project page loads for the quote and the layout. The loaders are:

- the project row (the fields above, plus `cabinet_geometry`, the supply columns and the override
  columns);
- `pricing_profiles`;
- the own `business_profiles` row;
- `profiles.full_name`;
- `loadLayoutContext`.

Then call `computeMatchView` → `computeLayoutView` → `computeQuoteView` → `computePrintView`, and
render.

**Contract**:

- **Layout.** `Layout.astro` directly, without the AppLayout Topbar. `<title>` is
  `t.quotePrint.pageTitle(name)`.
- **Errors.** Invalid id / not found → 404 with the project-page not-found text and a back link. Load
  errors → 500 with a Polish message, never Supabase text.
- **Toolbar** (`print:hidden`, screen only): "Wróć do projektu" → `/dashboard/projects/[id]`, and a
  "Drukuj / zapisz jako PDF" button wired by an inline `<script>` to `window.print()`. The script
  follows the inline-script pattern of `QuoteSection.astro:255`. The notices render as Alerts.
- **Blocked.** A blocking Alert listing `printBlockMessage(reason)`, each with its link:
  `no_profile` → `/dashboard/profile`, `match_not_current` → `/dashboard/projects/[id]#circuits`, `layout_not_placed` →
  `/dashboard/projects/[id]#layout` (the page's `h2` ids). No print button, no document.
- **Screen.** The sheet sits on a muted background with a page shadow. `@media print` removes the
  shadow, background and padding outside the sheet.

#### 5. Print CSS

**File**: `src/styles/global.css`

**Intent**: The minimal print rules.

**Contract**:

- `@page { size: A4 portrait; margin: 12mm; }`;
- in `@media print`, `body` uses the background token, and `.quote-page` drops its screen-only sheet
  shadow and padding;
- nothing else global. Everything else is `print:` utilities in the components.

#### 6. Entry link

**File**: `src/components/projects/QuoteSection.astro`

**Intent**: In state `ready`, add an outline Button-styled link `t.quotePrint.open` →
`/dashboard/projects/[id]/print`.

**Contract**: Shown regardless of layout state. The print page itself explains a missing layout. The
component needs the project id prop; add it if it is absent.

#### 7. Kitchen sink

**File**: `src/pages/dev/kitchen-sink.astro`, `src/lib/kitchen-sink-circuits.ts`

**Intent**: Add a "Wydruk wyceny" section that renders the real `QuoteDocument` from the existing
ready-quote and placed-layout fixtures. Three figures:

- ready, with a full letterhead;
- ready, with the letterhead fallback and the screen notices;
- the same document wrapped in `grayscale`.

Also add the blocked notice with all three reasons.

**Contract**: Fixtures go through the real `computePrintView`. Captions live in
`t.devTools.kitchenSink.printStates`.

### Success Criteria:

#### Automated Verification:

- `npm run lint`, `npx astro check`, `npm run test:unit` and `npm run build` pass
- The existing `layout-server.test.ts` still passes after the extraction (part of `test:unit`)

#### Manual Verification:

- Kitchen sink: the document reads as two A4 sheets. The drawing fits page 2 together with both
  legends. The greyscale figure still tells L, N, PE and PEN apart, and PE from N.
- On a real local project (quote ready, layout placed):
  - "Drukuj wycenę" opens the print page;
  - the browser print preview shows exactly 2 pages, with no toolbar or notices;
  - wire colours are visible, and the drawing is not split;
  - "Zapisz jako PDF" produces the same file.
- The itemised material lines add up to the material subtotal shown on the project page's quote
  section.
- Blocking:
  - a project without a layout shows the blocked notice with a working link to the layout section;
  - a stale match shows the match reason;
  - deleting the pricing row shows the profile reason.
- An outdated override shows its warning on screen only, and the printed time equals the override.
- The project page renders unchanged after the extraction (drawing, legends, wire lengths).

**Implementation Note**: Pause for manual confirmation before Phase 5.

---

## Phase 5: Landing page, docs and contracts

**Implementer: Sonnet.** Docs and copy only.

### Overview

Keep the landing page, the README and `AGENTS.md` in step with the new capability and contracts.

### Changes Required:

#### 1. Landing copy

**File**: `src/lib/i18n/pl.ts` (`t.landing.steps.quote.description`), `src/components/Landing.astro`
only if the copy needs no layout change

**Intent**: Mention that the quote prints or saves as PDF with the cabinet drawing (memory: the landing
grows with the product). The `DraftingSheet` hero stays as is.

#### 2. AGENTS.md

**File**: `AGENTS.md`

**Intent**: Add two tripwires.

**Contract**:

- `business_profiles`: owner-only, no admin policy. Its bounds are guarded twice, by the
  `business_profiles_*_valid` CHECKs and the `MAX_*` constants in `business-profile.ts`. The NIP
  checksum is TypeScript-only, by design.
- The printout reads only `computePrintView` (`src/lib/quote-print.ts`). Its material lines must sum to
  `devicesGrosze`, and it prints only a `ready` quote over a `placed` layout.

Also update the product-code inventory line, adding the printable quote, `src/pages/dashboard/projects/[id]/print.astro`
and `src/pages/api/profile/business.ts`.

#### 3. README

**File**: `README.md`

**Intent**: Add a row to the auth-routes table for `/dashboard/projects/[id]/print`, and extend the
`/dashboard/profile` row with "company details".

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes (Prettier covers the markdown via lint-staged on commit)
- `npm run build` passes

#### Manual Verification:

- The landing page shows the updated quote step copy

---

## Testing Strategy

### Unit Tests:

- `business-profile.test.ts`: bounds, NIP checksum and normalisation, empty → null, round-trip.
- `business-errors.test.ts`: SQLSTATE mapping, unknown codes.
- `quote-print.test.ts`: gate order, itemisation grouping, the sum invariant (including that it
  throws), letterhead fallbacks, notice order.

### Integration Tests:

- `rls-business-profiles.test.ts`: owner-only access, admin excluded, no delete, CHECK → `23514`.

### Manual Testing Steps:

1. Fill the company details on `/dashboard/profile`, then reload and check they persist.
2. On a ready + placed project: click "Drukuj wycenę", open the print preview, and check 2 pages,
   colours, and the drawing unsplit. Save as PDF.
3. Remove the layout (re-match the circuits): the print page shows `layout_not_placed` with a link.
4. Set a time override, then change the mount time in the profile: the screen warning appears, and the
   printed time is the override.
5. Kitchen sink, greyscale figure: PE, N and PEN are distinguishable.

## Performance Considerations

The print page does the same work as the project page, minus the cabinet picker. It needs no extra
budget. The SVG is reused, not re-rendered differently.

## Migration Notes

One new table, additive and backward-compatible with the deployed code. No data backfill. No row means
"no company details", which falls back by design.

## References

- Roadmap S-09: `context/foundation/roadmap.md` (FR-012, US-01)
- Quote view: `src/lib/quote.ts:86-140`; previous slice `context/archive/2026-10-07-quote-cost-estimate/plan.md`
- Layout view: `src/lib/layout-server.ts:46-67`; page assembly `src/pages/dashboard/projects/[id].astro:129-183`
- RLS pattern: `supabase/migrations/20260924120000_pricing_profiles.sql:56-101`
- Endpoint pattern: `src/pages/api/profile/pricing.ts`; errors `src/lib/pricing-errors.ts`
- Print risk: `context/foundation/infrastructure.md` (pre-mortem "browser print breaks the SVG")
- Greyscale decisions: `context/archive/2026-09-25-ui-layout-theme/plan.md`, `src/lib/cabinet-drawing.ts:358-377`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Company details — data layer

#### Automated

- [x] 1.1 Migration applies on a fresh stack: `npx supabase db reset` — 250583b
- [x] 1.2 Regenerated types are committed and `git diff` shows only the new table: `npm run db:types` — 250583b
- [x] 1.3 Parser tests pass: `npx vitest run --config vitest.config.ts src/lib/business-profile.test.ts` — 250583b
- [x] 1.4 RLS test passes against the local stack: `npm run test:integration` — 250583b
- [x] 1.5 `npm run lint`, `npx astro check` and `npm run test:unit` pass — 250583b

#### Manual

- [x] 1.6 In local Studio, an admin session cannot select `business_profiles` rows — 250583b

### Phase 2: Company details — profile form

#### Automated

- [x] 2.1 Error-mapping tests pass: `npx vitest run --config vitest.config.ts src/lib/business-errors.test.ts` — 93a633b
- [x] 2.2 `npm run lint`, `npx astro check`, `npm run test:unit` and `npm run build` pass — 93a633b

#### Manual

- [x] 2.3 Company details save, pre-fill, clear to nulls; a bad NIP errors on this card only; the pricing card still saves independently — 93a633b
- [x] 2.4 The kitchen sink shows the three card states — 93a633b

### Phase 3: Print view model

#### Automated

- [x] 3.1 Helper tests pass: `npx vitest run --config vitest.config.ts src/lib/quote-print.test.ts` — 14177e5
- [x] 3.2 `npm run lint`, `npx astro check` and `npm run test:unit` pass — 14177e5

### Phase 4: Print page and document

#### Automated

- [x] 4.1 `npm run lint`, `npx astro check`, `npm run test:unit` and `npm run build` pass — 37092c8
- [x] 4.2 The existing `layout-server.test.ts` still passes after the extraction — 37092c8

#### Manual

- [x] 4.3 Kitchen sink: two A4 sheets, the drawing fits page 2 with the legends, greyscale keeps L/N/PE/PEN distinguishable — 37092c8
- [x] 4.4 Real project: print preview shows exactly 2 pages, no chrome, colours visible, drawing unsplit; Save as PDF matches — 37092c8
- [x] 4.5 Itemised material lines add up to the project page's material subtotal — 37092c8
- [x] 4.6 Blocked states (no layout, stale match, no pricing profile) show their reasons and working links — 37092c8
- [x] 4.7 Outdated override warns on screen only; the printed time equals the override — 37092c8
- [x] 4.8 The project page renders unchanged after the extraction — 37092c8

### Phase 5: Landing page, docs and contracts

#### Automated

- [x] 5.1 `npm run lint` passes — ea464d3
- [x] 5.2 `npm run build` passes — ea464d3

#### Manual

- [x] 5.3 The landing page shows the updated quote step copy — ea464d3
