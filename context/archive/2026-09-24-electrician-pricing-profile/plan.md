# Electrician Pricing Profile Implementation Plan

## Overview

Roadmap S-07 (FR-010): an `elektryk` saves three quote parameters in their profile: hourly rate,
average mount time per device, and a fixed per-project time overhead. They live in a new
owner-only table, so the admin can neither read nor edit them. S-08 reads them later. A missing
row means "not configured", and S-08 blocks instead of inventing defaults.

## Current State Analysis

- `public.profiles` exists with one row per account, created by `handle_new_user`
  (`supabase/migrations/20260922083135_roles_and_profiles.sql:26-40, 93-110`). Its policies include
  `profiles_select_admin` / `profiles_update_admin` (`:68-80`), so **any column on `profiles` is
  visible to and editable by the admin**. That is why the pricing data gets its own table.
- The table pattern to copy is `supabase/migrations/20260923130628_devices_catalog.sql`: `touch_updated_at`
  trigger (`:139-142`, function defined in `20260923085112_cabinets_catalog.sql:14`), revoke-all-then-grant
  (`:150-157`), and granular per-operation policies (`:164-184`).
- The form write path to copy is `src/pages/api/admin/devices/[id]/index.ts`: FormData → parser →
  Supabase write → redirect with `?error=<code>`. Code-to-Polish maps follow `src/lib/device-errors.ts`
  (`*_ERROR` constant, `*ErrorMessage`, `*ErrorFromPostgrest` by SQLSTATE).
- Money is integer grosze, typed with `parsePriceGrosze` and pre-filled with `formatPriceInput`
  (`src/lib/price-input.ts`).
- Route gates live in `PROTECTED_ROUTES` (`src/lib/route-access.ts:18-24`). `/dashboard` is `elektryk`-only,
  so `/dashboard/profile` is covered already. **No `/api/profile` prefix exists**, so the endpoint needs
  its own entry.
- `src/pages/dashboard.astro` is a single greeting card with no links.
- The RLS integration harness is `tests/integration/support.ts` (`createElectrician`, `signIn`,
  `SEEDED_ADMIN`, `createServiceClient`), with `rls-profiles.test.ts` as the model.

## Desired End State

- An electrician opens `/dashboard/profile` (linked from `/dashboard`). The page shows three fields
  pre-filled with their saved values, or empty the first time. They save, and land back on the page
  with a Polish confirmation. The stored values survive a reload.
- The dashboard shows a notice with a link while pricing is not configured.
- The admin gets no rows from `pricing_profiles` and cannot write one. Neither can another electrician.
- Out-of-range values are refused both by the parser and by the database CHECKs, with identical bounds.

### Key Discoveries:

- Admin policies on `profiles` make it the wrong home for electrician business data
  (`20260922083135_roles_and_profiles.sql:68-80`).
- An upsert refused by an RLS `with check` raises `42501`. It does not silently match zero rows the way
  an `update` does (see the comment in `src/pages/api/admin/devices/[id]/index.ts`), so the error map
  must handle `42501`.
- `src/pages/dashboard.astro` and `src/pages/dashboard/profile.astro` can coexist in Astro routing.

## What We're NOT Doing

- No quote calculation, formula helper or estimate display. That is S-08.
- No default values, whether seeded or in the schema. "No row" is the only unconfigured state.
- No admin view or edit of pricing, and no user-management UI.
- No `full_name` or other profile fields. This page edits pricing only.
- No React island or draft storage. Three fields need none of it (AGENTS.md: React only where
  interactivity is required).
- No per-device-kind mount times. The PRD fixes one averaged value.
- No delete: a pricing profile is overwritten, never removed. The FK cascade handles account deletion.

## Implementation Approach

The database is the boundary, and the parser mirrors it. That's the same double guard as
`parseDeviceSpec` and the `devices` CHECK. Units are integers everywhere: grosze and whole minutes,
so there's no float rounding. The page is a plain server-rendered form. Native HTML constraints
(`required`, `min`, `max`, `step`, `pattern`) stop almost every bad value before submit. A server
rejection redirects with `?error=`, and the page re-renders the stored values with the Polish message.

Bounds (decided in planning):

| Column                     | Type    | Valid range            | Input as                   |
| -------------------------- | ------- | ---------------------- | -------------------------- |
| `hourly_rate_grosze`       | integer | 1 … `MAX_PRICE_GROSZE` | PLN, e.g. `120` / `120,50` |
| `mount_minutes_per_device` | integer | 1 … 600                | whole minutes              |
| `project_overhead_minutes` | integer | 0 … 6000               | whole minutes              |

## Critical Implementation Details

- **Bounds live in two places that must change together**: the migration's CHECKs and the exported
  constants in `src/lib/pricing-profile.ts`. Say so in a comment on both sides, like the
  `devices_parameters_match_kind` note in AGENTS.md. Add the pair to the AGENTS.md tripwire list.
- **Role predicate on writes**: the insert and update policies require
  `auth.jwt() ->> 'user_role' = 'elektryk'` as well as `user_id = auth.uid()`. The route gate already
  blocks the admin, but RLS is the real boundary. Like `is_admin()`, this reads the token claim, so the
  existing "role change waits for the next token" tripwire applies unchanged.

## Phase 1: Data and validation

### Overview

The table, its guards and the parser, all proven by unit and RLS integration tests before any UI
exists.

### Changes Required:

#### 1. Migration

**File**: `supabase/migrations/<YYYYMMDDHHmmss>_pricing_profiles.sql`

**Intent**: Create the owner-only pricing table, re-runnable like the earlier migrations.

**Contract**: `public.pricing_profiles(user_id uuid primary key references public.profiles(id) on delete cascade,
hourly_rate_grosze integer not null, mount_minutes_per_device integer not null, project_overhead_minutes integer not null,
created_at timestamptz not null default now(), updated_at timestamptz not null default now())`. It has
named CHECKs for the bounds table above and a `pricing_profiles_touch_updated_at` trigger that reuses
`public.touch_updated_at()`. RLS is enabled. It runs `revoke all` from `anon` and `authenticated`, then
`grant select, insert, update` to `authenticated`, with delete explicitly revoked. There are three policies:
`pricing_profiles_select_own` (using `user_id = (select auth.uid())`), `pricing_profiles_insert_own`, and
`pricing_profiles_update_own` (using/with check `user_id = (select auth.uid())` and the `elektryk` claim).
There is no admin policy and no delete policy, and a comment says why.

#### 2. Database types

**File**: `src/lib/database.types.ts`

**Intent**: Regenerate so the new table is typed.

**Contract**: `npm run db:types` output committed.

#### 3. Parser and bounds

**File**: `src/lib/pricing-profile.ts` (+ `src/lib/pricing-profile.test.ts`)

**Intent**: Turn the three form strings into the row shape, rejecting exactly what the CHECKs reject.
Also give the page a way to pre-fill from a stored row.

**Contract**: exports `MIN_/MAX_MOUNT_MINUTES` (1/600), `MIN_/MAX_OVERHEAD_MINUTES` (0/6000),
`PricingProfile` = `{ hourly_rate_grosze, mount_minutes_per_device, project_overhead_minutes }`, and
`parsePricingForm(form: FormData): { ok: true; value: PricingProfile } | { ok: false; code: "invalid_input" }`.
The rate goes through `parsePriceGrosze`. Minutes must match `^\d+$` after trim, then pass the range
check. It also exports `pricingFormDefaults(row | null)`, which returns the three strings for the inputs
(rate via `formatPriceInput`, and empty strings for no row). Tests cover each bound (0/1/600/601 for mount
time, 0/6000/6001 for overhead), decimals and signs in minutes (`"7,5"`, `"-1"`, `"+5"`), a missing field,
comma/dot rates, and the pre-fill round trip.

#### 4. RLS integration test

**File**: `tests/integration/rls-pricing-profiles.test.ts`

**Intent**: Prove the isolation the PRD requires against the live stack.

**Contract**: electrician A upserts and reads their own row. B reads zero rows of A's data, and an insert
or update of a row with `user_id = A` is refused. The seeded admin reads zero rows and cannot insert one
for themselves (role predicate). A CHECK violation (e.g. mount time 0) is refused with `23514`. Delete
is refused. Cleanup follows `rls-profiles.test.ts` (ids recorded as created and deleted in `afterAll`).

### Success Criteria:

#### Automated Verification:

- Migration applies on a clean stack: `npx supabase db reset`
- Regenerated types are committed and `npx astro check` passes
- Parser unit tests pass: `npm run test:unit`
- RLS assertions pass against the local stack: `npm run test:integration`
- Lint passes: `npm run lint`

#### Manual Verification:

- In local Studio, `pricing_profiles` shows RLS enabled with exactly three policies and no admin policy

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to
the next phase.

---

## Phase 2: Profile page and write path

### Overview

The electrician-facing form, its endpoint, the route gate, the dashboard entry point and the docs.

### Changes Required:

#### 1. Route gate

**File**: `src/lib/route-access.ts` (+ `src/lib/route-access.test.ts`)

**Intent**: Gate the new endpoint prefix to electricians, as `/api/admin` is gated to admins.

**Contract**: new `PROTECTED_ROUTES` entry `{ prefix: "/api/profile", roles: ["elektryk"] }` with a comment.
Tests show that an admin and an anonymous POST to `/api/profile/pricing` are redirected and an electrician
is allowed. The existing `ROLE_HOME` invariant test still passes.

#### 2. Error codes

**File**: `src/lib/pricing-errors.ts` (+ `src/lib/pricing-errors.test.ts`)

**Intent**: The code-not-message mapping for this endpoint, the same shape as `device-errors.ts`.

**Contract**: `PRICING_ERROR` (`not_configured` via `NOT_CONFIGURED`, `forbidden`, `invalid_input`,
`unknown`), `pricingErrorMessage(code)` and `pricingErrorFromPostgrest(error)` (`42501` → forbidden,
`23514` → invalid_input, others pass through).

#### 3. Endpoint

**File**: `src/pages/api/profile/pricing.ts`

**Intent**: Validate and upsert the signed-in electrician's pricing, then redirect back.

**Contract**: `POST`. Unreadable FormData is treated as an empty form. `parsePricingForm` runs first. A null
`createClient()` gives `not_configured`. It upserts `{ user_id: locals.user.id, ...value }` with
`onConflict: "user_id"`. Success redirects to `/dashboard/profile?saved=1`, and any failure redirects to
`/dashboard/profile?error=<code>`. It never forwards Supabase's message. A null `locals.user` redirects
to sign-in (defensive, since the gate already handles it).

#### 4. Profile page

**File**: `src/pages/dashboard/profile.astro`

**Intent**: Server-rendered form pre-filled from the stored row, with a success or error banner.

**Contract**: loads its own row (`maybeSingle`). A load failure logs the SQLSTATE only and shows a Polish
error, following `src/pages/admin/devices/[id].astro`. The inputs are `hourly_rate` (text, `inputmode="decimal"`,
`pattern` matching `parsePriceGrosze`), `mount_minutes_per_device` and `project_overhead_minutes`
(`type="number"`, `step="1"`, min/max from the exported constants), all `required`, with Polish hints
giving the units. It uses `Banner` for `?saved` / `?error`, `Topbar`, and a back link to `/dashboard`.
No role check in the page.

#### 5. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Make the profile reachable, and flag the unconfigured state early (it blocks S-08).

**Contract**: a link to `/dashboard/profile`. When the user has no `pricing_profiles` row, a short
notice asks them to fill it in. If the load fails, it degrades to just the link, never an error page.

#### 6. Messages

**File**: `src/lib/i18n/pl.ts`

**Intent**: Every new string is Polish and lives in the catalog.

**Contract**: a `pricingProfile` group (title, description, three labels, unit hints, save, saved,
back link, dashboard link and not-configured notice, load failed) and a `pricingErrors` group
(`notConfigured`, `forbidden`, `invalidInput`, `unknown`).

#### 7. Docs

**File**: `README.md`, `AGENTS.md`

**Intent**: Keep route tables and tripwires accurate.

**Contract**: README auth-routes table gains `/dashboard/profile`. AGENTS.md's product-code list gains
the new paths. A tripwire says the `pricing_profiles` CHECKs and `pricing-profile.ts` bounds change
together, and that "no row = not configured" is the S-08 contract.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Type check passes: `npx astro check`
- Unit tests pass, including the new route-gate and error-map cases: `npm run test:unit`
- Build passes: `npm run build`
- RLS suite still passes: `npm run test:integration`
- Smoke script still passes against the dev server: `npm run smoke`

#### Manual Verification:

- As a fresh electrician: the dashboard shows the not-configured notice, the form starts empty, saving
  `120,50` / `15` / `0` shows the confirmation and the notice disappears
- Reload shows the saved values pre-filled (rate as `120,50`)
- Browser blocks `0` minutes per device and `7,5` minutes before submit; a tampered POST (e.g. via
  devtools removing `min`) lands on `?error=invalid_input` with Polish text
- As the seeded admin, `/dashboard/profile` redirects to `/admin`
- All visible text is Polish

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests:

- `pricing-profile.test.ts`: every bound on both sides, minute format strictness, rate parsing via
  `parsePriceGrosze`, the pre-fill round trip.
- `pricing-errors.test.ts`: every code maps to Polish, and an unknown code gets the generic text.
- `route-access.test.ts`: the `/api/profile` gate for all three caller states.

### Integration Tests:

- `rls-pricing-profiles.test.ts`: owner read and write, cross-electrician isolation, admin sees and
  writes nothing, CHECK and delete refusals.

### Manual Testing Steps:

1. `npx supabase db reset`, `npm run dev`, sign up a new electrician.
2. Walk the dashboard → profile → save → reload loop from Phase 2's manual criteria.
3. Sign in as `admin@example.com` and confirm `/dashboard/profile` is unreachable.

## Performance Considerations

None. It's a single-row primary-key read and write per request.

## Migration Notes

Additive and forward-compatible: a new table only, no change to existing tables. It's safe under the
`db-migrate.yml` / Cloudflare deploy race. There's no backfill, because existing electricians simply have
no row, which is the "not configured" state.

## References

- Roadmap item: `context/foundation/roadmap.md` S-07
- PRD: FR-010, FR-011, `## Business Logic`
- Table and policy pattern: `supabase/migrations/20260923130628_devices_catalog.sql:139-184`
- Endpoint pattern: `src/pages/api/admin/devices/[id]/index.ts`
- Error-map pattern: `src/lib/device-errors.ts`
- Page load pattern: `src/pages/admin/devices/[id].astro`
- RLS test pattern: `tests/integration/rls-profiles.test.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data and validation

#### Automated

- [x] 1.1 Migration applies on a clean stack: `npx supabase db reset` — 9585cac
- [x] 1.2 Regenerated types are committed and `npx astro check` passes — 9585cac
- [x] 1.3 Parser unit tests pass: `npm run test:unit` — 9585cac
- [x] 1.4 RLS assertions pass against the local stack: `npm run test:integration` — 9585cac
- [x] 1.5 Lint passes: `npm run lint` — 9585cac

#### Manual

- [x] 1.6 In local Studio, `pricing_profiles` shows RLS enabled with exactly three policies and no admin policy — 9585cac

### Phase 2: Profile page and write path

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 9b3e6cf
- [x] 2.2 Type check passes: `npx astro check` — 9b3e6cf
- [x] 2.3 Unit tests pass, including the new route-gate and error-map cases: `npm run test:unit` — 9b3e6cf
- [x] 2.4 Build passes: `npm run build` — 9b3e6cf
- [x] 2.5 RLS suite still passes: `npm run test:integration` — 9b3e6cf
- [x] 2.6 Smoke script still passes against the dev server: `npm run smoke` — 9b3e6cf

#### Manual

- [x] 2.7 As a fresh electrician: the dashboard shows the not-configured notice, the form starts empty, saving `120,50` / `15` / `0` shows the confirmation and the notice disappears — 9b3e6cf
- [x] 2.8 Reload shows the saved values pre-filled (rate as `120,50`) — 9b3e6cf
- [x] 2.9 Browser blocks `0` minutes per device and `7,5` minutes before submit; a tampered POST (e.g. via devtools removing `min`) lands on `?error=invalid_input` with Polish text — 9b3e6cf
- [x] 2.10 As the seeded admin, `/dashboard/profile` redirects to `/admin` — 9b3e6cf
- [x] 2.11 All visible text is Polish — 9b3e6cf
