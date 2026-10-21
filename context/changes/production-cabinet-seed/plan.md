# Produkcyjny seed szaf Karwasz — Implementation Plan

## Overview

Add 33 real Karwasz cabinets (RN, RP, RNH, UNI SYSTEM M) to the production cabinet catalog. They
reach the cloud through a re-runnable data migration. That migration is generated from a TypeScript
module that holds the catalog data, the manufacturer's list prices and the rules that synthesise each
cabinet's geometry. A unit test pins the generated SQL to the module and runs every geometry through
`parseCabinetGeometry`.

## Current State Analysis

- `public.cabinets` (`supabase/migrations/20260923085112_cabinets_catalog.sql`) is unique on
  `(lower(manufacturer), lower(model))` and requires `price_grosze > 0`. Its `geometry` CHECK asserts
  only `version = 1`; every rule inside the document lives in `parseCabinetGeometry`
  (`src/lib/cabinet-geometry.ts`), and every write must go through it (`data-guards.md`).
- `supabase/seed.sql` is local/CI only. `supabase db push` (`.github/workflows/deploy.yml`) carries
  migrations, never the seed. So the cloud has no catalog cabinets at all, and the three
  "Przykładowy producent" cabinets exist only locally.
- No migration inserts catalog data yet: this change sets that precedent. The sibling change
  `production-catalog-seed` (Eaton/Legrand devices, not yet planned) needs the same mechanism.
- **Source data.** The Karwasz 2022 catalog is still the one the manufacturer links as current
  (https://karwasz.com.pl/pages/katalogi-i-cenniki-30). It gives the outer dimensions, the number
  of TH-35 rails × modules per rail, and the N/PE bars as text. It gives no internal coordinates,
  entry positions or bar positions, and neither does the website. The RU/RW drawings show a 125 mm
  rail pitch.
- **Prices.** The official price list
  (https://karwasz.com.pl/upfiles/Karwasz%20cennik%201.09.2026.xlsx; visible sheet titled
  "Cennik wyrobów 28.08.2025") has net PLN prices for every model in scope.
- The E2E specs pick the cabinet by its name "Szafka natynkowa średnia, 3 rzędy"
  (`tests/e2e/seed.spec.ts:33`). The `rls-cabinets` starter test filters by
  `manufacturer = 'Przykładowy producent'` (`tests/integration/rls-cabinets.test.ts:229-240`). Extra
  Karwasz rows break neither.

## Desired End State

After `deploy.yml` runs, the production picker offers 33 Karwasz cabinets, each with a valid
geometry, the manufacturer's net list price and, where the catalog lists them, built-in N/PE bars.
An electrician's project on any of them gets a layout, wiring and a quote. Locally, `supabase db reset`
gives the same rows next to the sample cabinets. CI fails if the migration file and the data module
ever disagree, or if any geometry fails the parser.

### Key Discoveries:

- `parseCabinetGeometry` / `findGeometryIssues` — `src/lib/cabinet-geometry.ts:107-113,165-211`:
  rails must be integer mm, inside the interior and non-overlapping, with no rail overlapping a bar.
  Bars overlapping in the front view need |Δz| ≥ 10 mm (`BAR_Z_CLEARANCE_MM`). There must be ≥ 1 rail
  and ≥ 1 entry.
- `DIN_MODULE_MM = 17.5` — `src/lib/din-module.ts:7`. 25 × 17.5 = 437.5 is not an integer, so the rail
  length must be rounded **up**.
- Bar terminal convention in the sample seed (`supabase/seed.sql:109`): small terminals
  `minMm2: 1.5`, main terminals `minMm2: 6`.
- A cabinet without built-in bars makes the matcher take `pe_bar`/`n_bar` from the device catalog
  (`layout-wiring.md`, "Catalog PE/N bars"). That is correct for UNI SYSTEM M, whose catalog
  equipment lists no N/PE bars.
- Vitest 5 `expect(...).toMatchFileSnapshot(path)` writes the file under `vitest -u` and fails on a
  mismatch otherwise. That is exactly the "generated file stays in sync" check, with no extra
  generator script.

## What We're NOT Doing

- No meter enclosures or rail-free lines: RW, RU, UNI SYSTEM LM/L, RH-1…4, RN-x Płyta, MRP/MRN,
  RU-RBK, RU-PPOŻ, and ventilated G/W. None of them has rails, or each carries a meter board the
  geometry cannot represent.
- No RN-80/100/120, and no UNI SYSTEM heights 1600/1750/1950: they are on the website and in the
  price list but not in the 2022 catalog.
- No door, lock or flange variants: one row per catalog symbol. The "Z" (patent-lock) price is used
  only where the price list has no plain variant.
- No change to the schema, the cabinet editor, `seed.sql` or the sample cabinets.
- No bulk or automatic catalog import (Parked #20). This is a one-off, reviewed data set.
- No shared seeding framework for the sibling `production-catalog-seed`. That change may reuse the
  pattern, but nothing here is generalised for it.

## Implementation Approach

The single source of truth is `src/lib/karwasz-cabinets.ts`: catalog rows as plain data, plus one
function that turns a row into a `CabinetGeometry` by fixed, documented rules. Its unit test checks
every row and renders the INSERT statement. `toMatchFileSnapshot` pins that statement to the
migration file. Faithfulness beats invention: built-in bars appear only where the catalog lists
them; everything else that is unknown (positions) follows one rule per concern, written in the
module header.

### Catalog data (2022 catalog, price list 28.08.2025, net PLN)

Dimensions are W × H × D in mm. For RP, the "bez kołnierza" (body) size is used. Bars column: each
cabinet gets **one N and one PE bar** with these terminal groups; "main" = 1 terminal 6–32 mm²,
"n×16" = n terminals 1.5–16 mm².

| Model                     | Name (PL)                                              | W×H×D        | Rails × modules | Bars (each of N, PE) | Net price       |
| ------------------------- | ------------------------------------------------------ | ------------ | --------------- | -------------------- | --------------- |
| RN-6-P                    | Rozdzielnica natynkowa RN-6-P, 1×6                     | 150×215×115  | 1×6             | 4×16                 | 99.78           |
| RN-12-P                   | Rozdzielnica natynkowa RN-12-P, 1×12                   | 255×215×115  | 1×12            | 7×16                 | 146.96          |
| RN-20                     | Rozdzielnica natynkowa RN-20, 1×20                     | 410×230×185  | 1×20            | main + 16×16         | 219.28          |
| RN-24                     | Rozdzielnica natynkowa RN-24, 2×12                     | 255×350×115  | 2×12            | main + 16×16         | 207.52          |
| RN-36                     | Rozdzielnica natynkowa RN-36, 3×12                     | 255×480×115  | 3×12            | main + 16×16         | 238.62          |
| RN-36 BIS                 | Rozdzielnica natynkowa RN-36 BIS, 3×12                 | 255×560×185  | 3×12            | main + 16×16         | 272.16          |
| RN-48                     | Rozdzielnica natynkowa RN-48, 3×16                     | 345×560×115  | 3×16            | main + 16×16         | 330.25          |
| RN-48 BIS                 | Rozdzielnica natynkowa RN-48 BIS, 3×16                 | 345×560×185  | 3×16            | main + 16×16         | 387.65 (Z only) |
| RN-60                     | Rozdzielnica natynkowa RN-60, 3×20                     | 410×560×115  | 3×20            | main + 16×16         | 364.33          |
| RN-60 BIS                 | Rozdzielnica natynkowa RN-60 BIS, 3×20                 | 410×560×185  | 3×20            | main + 16×16         | 375.65          |
| RP-6-P                    | Rozdzielnica podtynkowa RP-6-P, 1×6                    | 150×215×115  | 1×6             | 4×16                 | 105.02          |
| RP-12-P                   | Rozdzielnica podtynkowa RP-12-P, 1×12                  | 255×215×115  | 1×12            | 7×16                 | 163.95          |
| RP-20                     | Rozdzielnica podtynkowa RP-20, 1×20                    | 410×230×115  | 1×20            | main + 16×16         | 229.06          |
| RP-24                     | Rozdzielnica podtynkowa RP-24, 2×12                    | 255×350×115  | 2×12            | main + 16×16         | 207.67          |
| RP-36                     | Rozdzielnica podtynkowa RP-36, 3×12                    | 255×480×115  | 3×12            | main + 16×16         | 250.17          |
| RP-48                     | Rozdzielnica podtynkowa RP-48, 3×16                    | 340×560×115  | 3×16            | main + 16×16         | 345.90          |
| RP-60                     | Rozdzielnica podtynkowa RP-60, 3×20                    | 410×560×115  | 3×20            | main + 16×16         | 388.52          |
| RP-80                     | Rozdzielnica podtynkowa RP-80, 4×20                    | 410×720×115  | 4×20            | 2× main + 16×16      | 552.59 (Z only) |
| RP-100                    | Rozdzielnica podtynkowa RP-100, 5×20                   | 410×880×115  | 5×20            | 2× main + 16×16      | 681.24 (Z only) |
| RP-120                    | Rozdzielnica podtynkowa RP-120, 6×20                   | 410×1040×115 | 6×20            | 2× main + 16×16      | 818.33 (Z only) |
| RNH-6-P                   | Rozdzielnica hermetyczna RNH-6-P IP54, 1×6             | 150×220×140  | 1×6             | 4×16                 | 152.35          |
| RNH-12-P                  | Rozdzielnica hermetyczna RNH-12-P IP54, 1×12           | 255×220×140  | 1×12            | 7×16                 | 172.77          |
| RNH-24                    | Rozdzielnica hermetyczna RNH-24 IP54, 2×12             | 255×350×140  | 2×12            | main + 16×16         | 278.20          |
| RNH-36                    | Rozdzielnica hermetyczna RNH-36 IP54, 3×12             | 255×480×140  | 3×12            | main + 16×16         | 377.76          |
| RNH-48                    | Rozdzielnica hermetyczna RNH-48 IP54, 3×16             | 345×560×140  | 3×16            | main + 16×16         | 488.21          |
| UNI SYSTEM 550-900-250 M  | Rozdzielnica natynkowa UNI SYSTEM 550-900-250 M, 5×25  | 550×900×250  | 5×25            | none                 | 1494.62         |
| UNI SYSTEM 750-900-250 M  | Rozdzielnica natynkowa UNI SYSTEM 750-900-250 M, 5×36  | 750×900×250  | 5×36            | none                 | 1853.08         |
| UNI SYSTEM 550-1050-250 M | Rozdzielnica natynkowa UNI SYSTEM 550-1050-250 M, 6×25 | 550×1050×250 | 6×25            | none                 | 1712.49         |
| UNI SYSTEM 750-1050-250 M | Rozdzielnica natynkowa UNI SYSTEM 750-1050-250 M, 6×36 | 750×1050×250 | 6×36            | none                 | 2101.42         |
| UNI SYSTEM 550-1200-250 M | Rozdzielnica natynkowa UNI SYSTEM 550-1200-250 M, 7×25 | 550×1200×250 | 7×25            | none                 | 1899.94         |
| UNI SYSTEM 750-1200-250 M | Rozdzielnica natynkowa UNI SYSTEM 750-1200-250 M, 7×36 | 750×1200×250 | 7×36            | none                 | 2335.69         |
| UNI SYSTEM 550-1450-250 M | Rozdzielnica natynkowa UNI SYSTEM 550-1450-250 M, 9×25 | 550×1450×250 | 9×25            | none                 | 2241.97         |
| UNI SYSTEM 750-1450-250 M | Rozdzielnica natynkowa UNI SYSTEM 750-1450-250 M, 9×36 | 750×1450×250 | 9×36            | none                 | 2740.96         |

The website gives RN-48 as "20 otworów", but the catalog image (p. 19) gives 16. The catalog is
the source for every other model, so use 16 for RN-48 too. Manufacturer is `Karwasz` for every row.

## Critical Implementation Details

**The migration is immutable once deployed.** After the first push to `master`, the
`toMatchFileSnapshot` target must never be rewritten: a later data fix (a price, a new model) goes
into a **new** migration, and the test must then be restructured to pin each migration to its own
slice of the data. Say so in the module header and in `data-guards.md`.

**Geometry synthesis rules** (the contract the unit test checks; tune the constants only inside
these rules):

- **Interior** = the catalog W × H × D, used as-is. The catalog says its dimensions are "w świetle
  drzwi" (door opening), which is close enough for layout.
- **Rails**: count and length from the catalog. `lengthMm = ceil(modules × 17.5)`, centred
  horizontally (`xMm = floor((W − length) / 2)`). Rails sit 125 mm apart (top-to-top), and the block
  is centred vertically in the interior minus the bar strip.
- **Entries**: two, `top` and `bottom`, each spanning the middle of the side with a 10 % margin per
  end (`offsetMm = round(W × 0.1)`, `lengthMm = W − 2 × offset`).
- **Bars** (only rows with bars): horizontal N and PE in a strip below the bottom rail. Bar
  `heightMm = 12`, `lengthMm = 10 × terminals + 20` (main terminals count double), at least 10 mm
  from rails and walls. Prefer the two bars side by side. If they don't fit across, stack them
  vertically in the strip. Only if that also fails, overlap them with `zMm` 20 and 35. If no
  placement fits, the function throws — the test then names the model.

## Phase 1: Data module and geometry rules

### Overview

The Karwasz catalog as typed data, plus the deterministic geometry builder, proven by a unit test.

### Changes Required:

#### 1. Data module

**File**: `src/lib/karwasz-cabinets.ts`

**Intent**: Hold the 33 catalog rows from the table above, and build each row's `CabinetGeometry`
by the synthesis rules. The header comment cites the sources (catalog URL, price-list URL and its
sheet date) and states the rules and the immutability note.

**Contract**: exports `KARWASZ_MANUFACTURER = "Karwasz"`, `KARWASZ_CABINETS: readonly KarwaszCabinet[]`
(`model`, `name`, `widthMm`/`heightMm`/`depthMm`, `rails: { count, modules }`,
`bars: { mains: number; small: number } | null` with the small terminals' `maxMm2` fixed at 16 and
the mains' at 32, `priceGrosze: number`), and `karwaszGeometry(cabinet): CabinetGeometry`, which
throws when no placement fits. It uses `DIN_MODULE_MM` from `@/lib/din-module` and `RAIL_HEIGHT_MM`
from `@/lib/cabinet-geometry`. No user-facing strings: `name` is catalog data, not UI text.

#### 2. Unit test

**File**: `src/lib/karwasz-cabinets.test.ts`

**Intent**: Prove the data set is valid before any SQL exists.

**Contract**:

- Every row's geometry passes `parseCabinetGeometry`.
- Rail count and `lengthMm` match `count` / `ceil(modules × 17.5)`.
- There are exactly 33 rows, with unique case-insensitive models.
- `priceGrosze` is a positive integer.
- Rows with bars have exactly one N and one PE bar, with the catalog terminal groups; UNI rows have
  `bars: []`.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm run test:unit`
- Lint passes: `npm run lint`
- Type check passes: `npx astro check`

#### Manual Verification:

- The 33 rows in the module match the catalog pages (RN p. 19, RP p. 18, RNH p. 13, UNI M p. 10) and the price list, spot-checked on at least one model per line.

---

## Phase 2: Generated migration

### Overview

Render the module to a re-runnable INSERT, pin it with a file snapshot, and prove it on the local
stack.

### Changes Required:

#### 1. SQL rendering and file snapshot

**File**: `src/lib/karwasz-cabinets.test.ts`

**Intent**: Render a fixed header comment plus one
`insert into public.cabinets (name, manufacturer, model, price_grosze, geometry) values … on conflict
((lower(manufacturer)), (lower(model))) do nothing;` from the module. Assert it with
`toMatchFileSnapshot` against the migration path, so `npx vitest run -u` writes the file and CI fails
on drift.

**Contract**: the rendering lives in the test (it is not runtime code). Text values are escaped by
doubling `'`. Geometry is emitted as `'<JSON.stringify>'::jsonb`, one row per line, in module order.
The header comment names the sources, the price-list sheet date, that the prices are net list prices
("Z" price where no plain variant exists), and that geometry positions are synthesised by the rules
in `src/lib/karwasz-cabinets.ts`.

#### 2. Migration file

**File**: `supabase/migrations/20261021120000_karwasz_cabinets.sql`

**Intent**: The generated output. It is committed, never hand-edited, and re-runnable: the conflict
clause makes replay and an admin's earlier manual entry of the same model harmless.

**Contract**: data-only. No DDL, no grants; backward-compatible with the deployed code by
construction.

#### 3. Integration test

**File**: `tests/integration/karwasz-cabinets.test.ts`

**Intent**: Prove that what the database actually holds after the migration is what the module says.

**Contract**: using the service client, select the rows with `manufacturer = 'Karwasz'`. Assert
there are 33 of them, every geometry parses, and each row's name, price and geometry deep-equal the
module's.

### Success Criteria:

#### Automated Verification:

- The migration file is produced by `npx vitest run --config vitest.config.ts -u src/lib/karwasz-cabinets.test.ts`, and a plain `npm run test:unit` then passes without `-u`
- Local stack applies it: `npx supabase db reset` completes without errors (Docker, not wslc)
- Integration tests pass: `npm run test:integration`
- Re-running the migration's SQL against the local database inserts 0 rows (idempotence)
- CI parity: `npm run lint && npx astro check && npm run test:unit && npm run build`

#### Manual Verification:

- The migration header comment reads correctly and cites both sources.

---

## Phase 3: Verification in the app and documentation

### Overview

Check the cabinets in the real UI, flow by flow, and record the new convention.

### Changes Required:

#### 1. Agent rule

**File**: `context/foundation/agent-rules/data-guards.md`

**Intent**: Under the cabinet-geometry bullet, add that catalog cabinets shipped by migration are
generated from `src/lib/karwasz-cabinets.ts` (pinned by `toMatchFileSnapshot`). A deployed data
migration is never regenerated; a data fix is a new migration.

**Contract**: one bullet, no duplicated content.

#### 2. README

**File**: `README.md`

**Intent**: In the seed section (around line 73), note that the Karwasz cabinets come from a
migration, so they exist in the cloud too, unlike the local-only sample data.

**Contract**: one or two sentences.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`

#### Manual Verification:

- As the seeded admin, `/admin/cabinets` lists the 33 Karwasz cabinets with prices, and the RN-6-P, RN-48 and UNI SYSTEM 750-1450-250 M previews draw without clipping
- As an electrician, a project on RN-48 with a few circuits gets a placed layout, wiring and a ready quote; the built-in bars are used (no catalog `pe_bar`/`n_bar` in the device list), and the cabinet line shows 330,25 zł
- As an electrician, a project on UNI SYSTEM 750-1450-250 M places devices on its rails and takes PE/N bars from the device catalog
- The E2E seed spec still passes: `npx playwright test tests/e2e/seed.spec.ts`

---

## Testing Strategy

### Unit Tests:

- Every geometry passes the parser.
- The rail capacity equals the catalog figure.
- The bars match the catalog, including the RP-80/100/120 two-mains case and the UNI no-bars case.
- The smallest cabinets (RN-6-P, RP-6-P, RNH-6-P at 150 mm wide) place their bars without throwing.
- The migration file equals the rendered SQL.

### Integration Tests:

- The database rows equal the module after `supabase db reset`.

### Manual Testing Steps:

1. `npx supabase db reset`, then `npm run dev`. Sign in as `admin@example.com` and open
   `/admin/cabinets`.
2. Open RN-6-P, RN-48 and UNI 750-1450 M; check the preview drawing.
3. Sign up an electrician, set the pricing profile, and create a project on RN-48 with 3–4 circuits
   in one RCD group. Match the devices, check the layout and wiring, and open the quote.
4. Repeat step 3 on UNI 750-1450 M.

## Migration Notes

The migration is data-only and idempotent. In production it runs once via `deploy.yml` before the
new code, and the old code reads the new rows with no change. To undo it, archive the rows
(`archived_at`): cabinets are never deleted, and a project may already reference one.

## References

- Catalog: `KATALOG - 2022-wersja skompresowana.pdf` (local copy on the user's desktop;
  https://karwasz.com.pl/upfiles/katalogi/KATALOG%20-%202022-wersja%20skompresowana.pdf)
- Price list: https://karwasz.com.pl/upfiles/Karwasz%20cennik%201.09.2026.xlsx (sheet "Cennik wyrobów 28.08.2025")
- Geometry contract: `src/lib/cabinet-geometry.ts`
- Sample cabinets and their test: `supabase/seed.sql:86-120`, `tests/integration/rls-cabinets.test.ts:228-260`
- Sibling change: `context/changes/production-catalog-seed/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Data module and geometry rules

#### Automated

- [x] 1.1 Unit tests pass: `npm run test:unit` — 69f9a7d
- [x] 1.2 Lint passes: `npm run lint` — 69f9a7d
- [x] 1.3 Type check passes: `npx astro check` — 69f9a7d

#### Manual

- [x] 1.4 The 33 rows in the module match the catalog pages (RN p. 19, RP p. 18, RNH p. 13, UNI M p. 10) and the price list, spot-checked on at least one model per line. — 69f9a7d

### Phase 2: Generated migration

#### Automated

- [x] 2.1 The migration file is produced by `npx vitest run --config vitest.config.ts -u src/lib/karwasz-cabinets.test.ts`, and a plain `npm run test:unit` then passes without `-u` — 6e9f80d
- [x] 2.2 Local stack applies it: `npx supabase db reset` completes without errors (Docker, not wslc) — 6e9f80d
- [x] 2.3 Integration tests pass: `npm run test:integration` — 6e9f80d
- [x] 2.4 Re-running the migration's SQL against the local database inserts 0 rows (idempotence) — 6e9f80d
- [x] 2.5 CI parity: `npm run lint && npx astro check && npm run test:unit && npm run build` — 6e9f80d

#### Manual

- [x] 2.6 The migration header comment reads correctly and cites both sources. — 6e9f80d

### Phase 3: Verification in the app and documentation

#### Automated

- [x] 3.1 Lint passes: `npm run lint`

#### Manual

- [x] 3.2 As the seeded admin, `/admin/cabinets` lists the 33 Karwasz cabinets with prices, and the RN-6-P, RN-48 and UNI SYSTEM 750-1450-250 M previews draw without clipping
- [x] 3.3 As an electrician, a project on RN-48 with a few circuits gets a placed layout, wiring and a ready quote; the built-in bars are used (no catalog `pe_bar`/`n_bar` in the device list), and the cabinet line shows 330,25 zł
- [x] 3.4 As an electrician, a project on UNI SYSTEM 750-1450-250 M places devices on its rails and takes PE/N bars from the device catalog
- [x] 3.5 The E2E seed spec still passes: `npx playwright test tests/e2e/seed.spec.ts`
