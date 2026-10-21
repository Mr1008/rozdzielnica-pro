# Production Eaton + Legrand Device Catalog Seed Implementation Plan

## Overview

Load a curated catalog of real Eaton and Legrand modular devices (~360 rows) into the production
`devices` table. The rows come from the two manufacturer PDFs (already extracted in
`context/changes/production-catalog-seed/extract/`), are completed with deterministic defaults and
generated PLN prices, validated by the same `parseDeviceSpec` the admin editor uses, and rendered into
one idempotent SQL file that is applied to production once, by hand — outside migrations and
`supabase/seed.sql`.

## Current State Analysis

- The production catalog is filled by hand through the admin editor; the only seeded devices are 32
  local/CI samples in `supabase/seed.sql:137-181` ("Przykładowy producent", `PRZ-*`).
- Deploy applies migrations only (`.github/workflows/deploy.yml` job `migrate`: `supabase db push`); no
  path carries data rows to production today, and no migration has ever inserted catalog rows.
- Neither PDF lists a price; 140 of the selected rows lack height/depth and none has an N-terminal
  side (`research.md` §3–4).
- Tests rely on the sample catalog's shape: no B40 anywhere (`tests/e2e/seed.spec.ts:4,66`,
  `tests/integration/rls-devices.test.ts:421`) and `PRZ-*` devices winning matches
  (`tests/integration/rls-circuits.test.ts:37-43`, `rls-layout.test.ts:33-35`).

## Desired End State

- `supabase/catalog/eaton-legrand.sql` exists, is generated (never hand-edited), and a unit test fails
  when it is stale.
- Applying it to a database inserts the curated rows once; applying it again inserts nothing.
- Production holds the Eaton + Legrand catalog; an electrician's project with ordinary circuits
  (B6–B63, 30 mA type A group RCDs, 1-phase and 3-phase) matches real devices instead of hitting a
  catalog gap, and the layout and wiring drawings render.
- Local and CI databases are unchanged: the sample catalog and every existing test stay as they are.

### Key Discoveries:

- Unique key `devices_manufacturer_model_key` on `(lower(manufacturer), lower(model))`
  (`supabase/migrations/20260923130628_devices_catalog.sql:133`) makes
  `on conflict ((lower(manufacturer)), (lower(model))) do nothing` the idempotency mechanism — same as
  `supabase/seed.sql`.
- `parseDeviceSpec` / `deviceSpecSchema` in `src/lib/device-spec.ts` mirror the
  `devices_parameters_match_kind` CHECK; validating every generated row with it means the generator and
  the database refuse the same rows (`context/foundation/agent-rules/data-guards.md`).
- `n_terminal_side` is load-bearing: the layout throws for an N-carrying device without it
  (`src/lib/cabinet-layout.ts:240-241`) and it places the N pole and the N-outward RCD rule
  (`:243`, `:497`).
- The matcher loads the whole active catalog unpaginated (`src/lib/device-matching-server.ts:107`) under
  `max_rows = 1000` (`supabase/config.toml:18`); ties break on price, then manufacturer
  (`src/lib/device-matching.ts:191-203`) — prices decide the brand.
- `@/` aliases are resolved only by Vite/Vitest (`vitest.config.ts`); there is no TS script runner in the
  repo, so generation runs inside Vitest via `toMatchFileSnapshot` (Vitest `^5.0.1`).

## What We're NOT Doing

- No migration and no change to `supabase/seed.sql`, CI or `.github/workflows/deploy.yml`.
- No catalog-import feature, admin bulk-upload UI or recurring sync — this is a one-off curated seed;
  the PRD Non-Goal "masowy/automatyczny import katalogu" (`context/foundation/prd.md:132`, GH #20)
  stays parked.
- No cabinets (Legrand enclosures give no interior/rail geometry; Karwasz cabinets are the separate
  `production-cabinet-seed` change).
- No series outside the residential selection (Eaton HN, FAZ, AZ, HIS, ZP-A, PKNM, HNB, HNC, PFIM,
  FRCdM, Z-GV, Z-SV; Legrand RX3, TX3, DX3 S311–S314, FRX, PR 300); no selective (S), short-delay (G),
  Hpi, B+ or Bfq RCDs; no non-B characteristics.
- No pagination fix for the matcher or the admin list (headroom under `max_rows` is kept instead).
- No per-device N-side research — `left` is the documented default.

## Implementation Approach

Three layers, each reviewable on its own: (1) a committed, normalized source dataset selected from the
raw extraction by explicit rules; (2) a pure TypeScript module that turns source rows into `devices`
rows (defaults, prices, names), validates them with `parseDeviceSpec`, and renders SQL — pinned by a
Vitest file snapshot so the committed SQL can never drift from the code; (3) a manual apply, proven
idempotent locally before it touches production.

## Critical Implementation Details

- **Generation runs in Vitest.** `expect(renderCatalogSql()).toMatchFileSnapshot("../../supabase/catalog/eaton-legrand.sql")`
  is both the staleness check (plain `npm run test:unit`) and the generator
  (`npx vitest run --config vitest.config.ts src/lib/catalog-seed.test.ts -u`). Do not add a separate
  runner dependency.
- **Production apply is outward-facing and irreversible in practice** (no DELETE grant on `devices`;
  removal means archiving). Phase 4 runs only after Jakub explicitly approves it in chat for that run.

## Phase 1: Curated source data

### Overview

Produce the normalized, committed input dataset from the raw extraction, applying the residential-series
selection and exclusion rules, so later phases never read `context/changes/**`.

### Changes Required:

#### 1. Source dataset

**File**: `supabase/catalog/source/eaton.json`, `supabase/catalog/source/legrand.json`

**Intent**: Hold exactly the selected rows with catalog facts only (no prices, no invented defaults),
each traceable to its source, so a reviewer can audit the selection against the PDFs.

**Contract**: JSON array of
`{kind, manufacturer, series, model, order_no, poles, rated_current_a, residual_current_ma, rcd_type, breaking_capacity_ka, modules, width_mm, height_mm, depth_mm, terminal_groups, source}`
— `null` where the catalog/web gave nothing; `source` = `"pdf p<N>"` or the URL from the extraction
`notes`. Selection rules (from `research.md` and the planning interview):

- **Eaton**: MCB PL6; RCD PF6 (all usable) plus FRCmM only where it adds type F, type B or 10 mA;
  RCBO PFL6 (1P+N) and FRBm6 (3P+N); FR IS; comb busbar EVG (17.5 mm pitch, non-`/HI`); PE/N bars KL,
  SK-KLV, BFZ-TS-KL (deduplicate the two repeated SK models).
- **Legrand**: MCB DX3 S301, S302, S303, S304, S301N; RCD DX3 P302/P304 (including the type B rows on
  p39); RCBO P312 DX3 (drop the 16 p21/p40 duplicates by order number); FR 300 without the signalling
  `S` variants; HX3 comb busbars except the auxiliary 4049 33 and any row without a rated current;
  bars 0048 30, 0048 40, 4048 39, 0048 15.
- **Everywhere**: MCB/RCBO `rated_current_a` ∈ {6, 10, 13, 16, 20, 25, 32, 40, 50, 63}
  (`src/lib/circuit-params.ts:19`); `residual_current_ma` ∈ {10, 30, 100, 300} (`:29`); drop any row whose
  `rcd_type_raw` carries S, G, Hpi, B+, Bfq or "selective"; Legrand `model` = order number as printed
  (e.g. `4074 16`), Eaton `model` = type designation (e.g. `PL6-B16/1`).

#### 2. Curation script provenance

**File**: `context/changes/production-catalog-seed/extract/scripts/curate.py` (or `.mjs`)

**Intent**: Keep the one-off selection reproducible next to the extraction scripts; it reads
`extract/*.json` and writes the two source files. It is not part of the app.

**Contract**: Re-running it reproduces `supabase/catalog/source/*.json` byte-for-byte.

### Success Criteria:

#### Automated Verification:

- Both source files parse as JSON and the curation script reproduces them unchanged
- Row count across both files is between 300 and 450, with no duplicate `(lower(manufacturer), lower(model))`

#### Manual Verification:

- Spot-check 10 random rows (at least 2 per kind) against the PDF page or URL in `source`

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 2: Generator and tests

### Overview

A pure module that completes, prices, names, validates and renders the source rows into the committed
SQL file, with a unit test that pins the file and the catalog invariants.

### Changes Required:

#### 1. Generator module

**File**: `src/lib/catalog-seed.ts`

**Intent**: Turn source rows into `DeviceSpec` rows and SQL deterministically; every rule that invents
data lives here, named and commented, so nothing is hand-edited in the SQL.

**Contract**: exports `buildCatalogDevices(): DeviceSpec[]` (imports the two source JSON files, applies
the rules below, throws with the offending model if `parseDeviceSpec` rejects a row) and
`renderCatalogSql(): string`. Rules:

- **Dimensions**: `width_mm` = source width, else `modules × DIN_MODULE_MM`. Missing `height_mm`/`depth_mm`
  take a per-series default table: the series' own web value; else a sibling series of the same brand
  (Legrand RCD/RCBO/FR 300 ← DX3 MCB 94.8 × 77.8; Eaton FRCmM >100 A ← FRCmM ≤100 A); else generic
  85 × 70 mm. One decimal place.
- **N side**: `n_terminal_side = "left"` for every N-carrying pole set (`polesCarryN`), `null` otherwise —
  the same default the `20261006120000_device_n_terminal_side.sql:15-17` backfill used.
- **PE/N bars**: a missing `minMm2` becomes 1.5 when `maxMm2 ≤ 16`, else 6; a missing width becomes
  `terminal count × 6 + 10` mm; missing height/depth 30 × 25 mm.
- **Name**: a Polish name built from kind, series, In, poles, IΔn and type (e.g.
  `Wyłącznik nadprądowy PL6 B16 1P`, `Wyłącznik różnicowoprądowy P302 DX3 40A 2P 30mA typ A`); every
  name string comes from `src/lib/i18n/pl.ts` (new keys), not literals.
- **Price** (integer grosze, whole PLN, net list level): base per kind × pole multiplier × current step ×
  type/sensitivity factor × brand tier. Anchors: Eaton PL6 1P B16 ≈ 28 PLN; PF6 2P 40 A 30 mA AC ≈ 120 PLN;
  PFL6 1P+N B16 30 mA AC ≈ 135 PLN; IS 2P 40 A ≈ 55 PLN; comb busbar ≈ 1.2 PLN/pin (1F) and 3.2 PLN/pin (3F),
  minimum 12 PLN; PE/N bar ≈ 8 PLN + 2.5 PLN/terminal. Type factor AC < A < F < B; 10 mA dearer than
  30 mA; 100/300 mA slightly cheaper; Legrand DX3 tier ≈ 1.08 × Eaton. Within one series and pole set,
  price must not decrease as `rated_current_a` rises; within one series and current, more poles must not
  be cheaper.

#### 2. Unit test and generated file

**File**: `src/lib/catalog-seed.test.ts`, `supabase/catalog/eaton-legrand.sql`

**Intent**: Prove every row is valid and the catalog has the agreed shape, and pin the SQL file.

**Contract**: asserts — every row passes `parseDeviceSpec`; `(lower(manufacturer), lower(model))` unique;
row count in 300–450 (well under `max_rows`); only `Eaton`/`Legrand`; no excluded series or RCD variants;
every kind of `DEVICE_KINDS` present for both brands except where the source has none; price
monotonicity rules above; every N-carrying row has `n_terminal_side`; and
`expect(renderCatalogSql()).toMatchFileSnapshot(...)`. The SQL is a header comment ("generated by
src/lib/catalog-seed.ts — do not edit; regenerate with … -u"), `begin;`, one multi-row
`insert into public.devices (...) values ...` listing only `DEVICE_FIELDS` columns,
`on conflict ((lower(manufacturer)), (lower(model))) do nothing;`, `commit;`. Rows sorted by
manufacturer, kind (`DEVICE_KINDS` order), model, so diffs stay stable.

### Success Criteria:

#### Automated Verification:

- `npm run test:unit` passes, including `src/lib/catalog-seed.test.ts` against the committed SQL file
- `npm run lint` passes
- `npx astro check` passes

#### Manual Verification:

- Read the generated SQL's price list for one series per kind and confirm the prices look plausible for the Polish market

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 3: Local verification and runbook

### Overview

Prove the SQL applies cleanly and idempotently on a real Postgres with the production schema, prove the
app works with the catalog, and document how to apply it.

### Changes Required:

#### 1. Runbook

**File**: `supabase/catalog/README.md`

**Intent**: Say what the file is, that it is production-only and never run by deploy or `db reset`, how
to regenerate it, how to apply it (local: `psql` against `postgresql://postgres:postgres@127.0.0.1:55322/postgres`
or the equivalent `docker exec … psql`; production: the Supabase dashboard SQL editor or `psql` with the
project's connection string), and how to verify (row counts per manufacturer).

**Contract**: prose only; the commands it names are the ones actually used in this phase.

#### 2. Tripwire rule

**File**: `context/foundation/agent-rules/deploy-tooling.md`, `.claude/rules/deploy-tooling.md`, `AGENTS.md`

**Intent**: Record the trap for future agents: `supabase/catalog/*.sql` is generated and production-only —
never edit it by hand, never move it into `migrations/` or `seed.sql` (it would break the no-B40
catalog-gap tests), and keep the catalog under the `max_rows` headroom.

**Contract**: one bullet in the rule file; `supabase/catalog/**` and `src/lib/catalog-seed.ts` added to the
shim's `paths:` and to the `deploy-tooling.md` patterns in the `AGENTS.md` "Area tripwires" index —
identical in both.

### Success Criteria:

#### Automated Verification:

- On a local stack after `npx supabase db reset`, the first apply of `supabase/catalog/eaton-legrand.sql` exits 0 and inserts exactly the generated row count
- A second apply exits 0 and inserts 0 rows (count per manufacturer unchanged)
- `npm run test:unit`, `npm run lint` and `npx astro check` still pass

#### Manual Verification:

- In the browser on the local stack (catalog applied, sample catalog archived for the check), a 1-phase and a 3-phase project with ordinary circuits match Eaton/Legrand devices and the layout and wiring drawings render
- The admin device list shows the new catalog with Polish names and prices
- The cloud project's PostgREST max rows setting is confirmed ≥ 1000

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human that the manual testing was successful before proceeding to the
next phase.

---

## Phase 4: Production apply

### Overview

Apply the verified SQL to the production database once, with explicit approval, and confirm the result.

### Changes Required:

#### 1. Apply and record

**File**: `supabase/catalog/README.md` (append the applied date and row counts)

**Intent**: Run the committed `eaton-legrand.sql` against production exactly as the runbook says, only after
Jakub approves that run in chat, then record when it was applied and what it inserted.

**Contract**: no code change; the README gains an "Applied to production" line with date and per-manufacturer
counts.

### Success Criteria:

#### Manual Verification:

- Jakub explicitly approves the production apply in chat before it runs
- After the apply, production `devices` holds the generated Eaton and Legrand row counts and the total active catalog is below 1000
- A production project with ordinary circuits matches Eaton/Legrand devices and renders its layout

**Implementation Note**: This phase is entirely manual and outward-facing; do not run it unattended.

---

## Testing Strategy

### Unit Tests:

- `src/lib/catalog-seed.test.ts`: `parseDeviceSpec` on every row, uniqueness, count bounds, exclusions,
  N side, price monotonicity, file snapshot.

### Integration Tests:

- None added: the catalog never enters local/CI databases automatically, so `tests/integration/**` is
  untouched by design.

### Manual Testing Steps:

1. `npx supabase db reset`, then apply the SQL twice and compare counts.
2. Archive the sample `PRZ-*` devices locally, create a 1-phase and a 3-phase project, enter typical
   circuits, match, open the layout and wiring views.
3. After the check, `npx supabase db reset` to restore the sample-only local catalog.

## Performance Considerations

~360 extra active rows keep the unpaginated matcher load (`device-matching-server.ts:107`) well below the
1000-row cap, leaving ~600 rows for admin additions.

## Migration Notes

No schema change. Re-applying the SQL never updates existing rows (`do nothing`); a later price or data
correction means editing the generator and changing rows through the admin editor, or a new targeted SQL
— not re-running this file.

## References

- Research: `context/changes/production-catalog-seed/research.md`
- Extraction: `context/changes/production-catalog-seed/extract/`
- Device rules: `src/lib/device-spec.ts`, `supabase/migrations/20261009120100_comb_busbar_parameters.sql:4-64`
- Idempotent insert pattern: `supabase/seed.sql:137-181`
- N-side use: `src/lib/cabinet-layout.ts:233-243,497`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Curated source data

#### Automated

- [x] 1.1 Both source files parse as JSON and the curation script reproduces them unchanged
- [x] 1.2 Row count across both files is between 300 and 450, with no duplicate `(lower(manufacturer), lower(model))`

#### Manual

- [x] 1.3 Spot-check 10 random rows (at least 2 per kind) against the PDF page or URL in `source`

### Phase 2: Generator and tests

#### Automated

- [ ] 2.1 `npm run test:unit` passes, including `src/lib/catalog-seed.test.ts` against the committed SQL file
- [ ] 2.2 `npm run lint` passes
- [ ] 2.3 `npx astro check` passes

#### Manual

- [ ] 2.4 Read the generated SQL's price list for one series per kind and confirm the prices look plausible for the Polish market

### Phase 3: Local verification and runbook

#### Automated

- [ ] 3.1 On a local stack after `npx supabase db reset`, the first apply of `supabase/catalog/eaton-legrand.sql` exits 0 and inserts exactly the generated row count
- [ ] 3.2 A second apply exits 0 and inserts 0 rows (count per manufacturer unchanged)
- [ ] 3.3 `npm run test:unit`, `npm run lint` and `npx astro check` still pass

#### Manual

- [ ] 3.4 In the browser on the local stack (catalog applied, sample catalog archived for the check), a 1-phase and a 3-phase project with ordinary circuits match Eaton/Legrand devices and the layout and wiring drawings render
- [ ] 3.5 The admin device list shows the new catalog with Polish names and prices
- [ ] 3.6 The cloud project's PostgREST max rows setting is confirmed ≥ 1000

### Phase 4: Production apply

#### Manual

- [ ] 4.1 Jakub explicitly approves the production apply in chat before it runs
- [ ] 4.2 After the apply, production `devices` holds the generated Eaton and Legrand row counts and the total active catalog is below 1000
- [ ] 4.3 A production project with ordinary circuits matches Eaton/Legrand devices and renders its layout
