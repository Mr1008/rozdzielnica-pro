---
date: 2026-10-21T12:04:33+02:00
researcher: Jakub Michałek (with Claude Code)
git_commit: 5ae96c484525b04fa67a6acee09d890808211def
branch: master
repository: rozdzielnica-pro
topic: "Production seed of the device catalog with Eaton and Legrand modular devices from the manufacturers' catalogs"
tags: [research, devices, catalog, seed, supabase, eaton, legrand]
status: complete
last_updated: 2026-10-21
last_updated_by: Jakub Michałek (with Claude Code)
---

# Research: production seed of the Eaton + Legrand device catalog

**Date**: 2026-10-21T12:04:33+02:00
**Researcher**: Jakub Michałek (with Claude Code)
**Git Commit**: 5ae96c484525b04fa67a6acee09d890808211def
**Branch**: master
**Repository**: rozdzielnica-pro

## Research Question

Prepare a production seed of the `devices` catalog with real Eaton and Legrand modular devices, taken
from two PDFs (Eaton "Low voltage power distribution" PL catalog, 370 pages; Legrand "Minikatalog –
aparatura modułowa i rozdzielnice izolacyjne", 108 pages). Where a price is missing, generate a sensible
PLN value (MVP). Research covers: what the `devices` schema accepts, how a seed can reach production,
what the catalogs actually contain, and what has to be decided before planning. Per the user (mid-research),
missing details may be looked up on the manufacturers' websites.

## Summary

- **Neither PDF contains a single price** (`grep` for `zł|PLN|cena` on both `pdftotext` dumps: 0 hits). Every
  `price_grosze` has to be generated.
- **Extraction is done and saved** in `extract/` next to this file: 1253 raw rows (Eaton 825, Legrand 428),
  produced by the scripts in `extract/scripts/` (PyMuPDF word coordinates; they read scratchpad paths and
  need repointing to re-run). Every in-scope MVP kind was found in at least one brand, but **PE/N bars are
  only enclosure accessories** (Eaton KL/SK/BFZ, Legrand 0048xx/4048 39) and **Legrand comb busbars come
  only from the web** (HX3 sheet F04448EN).
- **The catalog is too big for the matcher as-is.** The matcher loads all active devices with no
  pagination (`src/lib/device-matching-server.ts:107`) and PostgREST caps responses at `max_rows = 1000`
  (`supabase/config.toml:18`, local; the cloud value is unverified). Filtering the raw rows to values the
  matcher can ever pick still leaves **929 rows** — so the seed needs deliberate curation, not just
  filtering.
- **The production path is not `seed.sql`.** `supabase db push` carries migrations, never seeds
  (`AGENTS.md` Environment; `context/foundation/agent-rules/deploy-tooling.md`). The two candidate paths
  (a data migration vs. a one-off SQL/script applied to prod) both collide with test assumptions if the
  real rows also land in the local DB: the e2e and RLS tests assert the local catalog has **no B40**
  (`tests/e2e/seed.spec.ts:4`, `tests/integration/rls-devices.test.ts:421`), and the extracted data has
  B40 MCBs.
- **The PRD and roadmap park "mass/automatic manufacturer catalog import"** (`context/foundation/prd.md:132`,
  `context/foundation/roadmap.md:298`, GH #20). A one-off curated seed is not an import feature, but the plan
  should say so explicitly so the Non-Goal isn't silently eroded.
- **Data holes the schema does not tolerate:** `height_mm`/`depth_mm`/`width_mm` are NOT NULL, and
  `n_terminal_side` is required for every N-carrying pole set. In the 929 curated rows, 390 have no
  height/depth and 21 have no width; **no row has an N-terminal side** (neither PDF nor the web pages
  consulted state it for these ranges). The plan must choose default values.

## Detailed Findings

### 1. The `devices` row contract

- Table: `supabase/migrations/20260923130628_devices_catalog.sql:47-75`. NOT NULL: `kind`, `name`,
  `manufacturer`, `model` (each non-blank), `price_grosze` (int > 0), `width_mm numeric(6,2)`,
  `height_mm`/`depth_mm numeric(6,1)`. No owner/`created_by` column.
- Uniqueness: `devices_manufacturer_model_key` on `(lower(manufacturer), lower(model))` (`:133`) — an
  idempotent insert is `ON CONFLICT ((lower(manufacturer)), (lower(model))) DO NOTHING`, the same form
  `supabase/seed.sql` uses.
- Per-kind rules (final form `supabase/migrations/20261009120100_comb_busbar_parameters.sql:4-64`, mirrored
  by `src/lib/device-spec.ts` `POLES_BY_KIND` / `PARAMETERS_BY_KIND`): switch_disconnector 1P/2P/3P/4P + In;
  rcd 2P/4P + In + IΔn + type; rcbo 1P+N/2P/3P+N/4P + In + IΔn + type + Icn; mcb_b any of six pole sets +
  In + Icn; comb_busbar 1P (=1F) / 3P (=3F) + In; pe_bar/n_bar `terminal_groups` `[{count,minMm2,maxMm2}]`
  only. `n_terminal_side` is required exactly for poles 1P+N, 2P, 3P+N, 4P
  (`supabase/migrations/20261006120000_device_n_terminal_side.sql:19-72`, `src/lib/device-spec.ts`
  `POLES_WITH_N`). Width allows 2 decimals, height/depth/Icn 1 decimal; extra decimals are refused, not
  rounded (`device-spec.ts` header).
- `rcd_type` enum is exactly AC, A, F, B. There is **no tripping-characteristic column**: `mcb_b` means
  "type B", and an RCBO row is implicitly B too (`device-spec.ts`). No column can express selective (S) or
  short-delay (G) RCDs, Hpi, B+ or Bfq.
- Insert triggers: none (the two `devices` triggers are BEFORE UPDATE). RLS: insert/update for `is_admin()`
  only; no DELETE grant at all (`20260923130628_devices_catalog.sql:148-184`). A prod load therefore runs as
  the migration role / service role, or through the admin UI.

### 2. What the matcher can actually pick (so what is worth seeding)

- Circuit In: 6, 10, 13, 16, 20, 25, 32, 40, 50, 63 A; IΔn 10/30/100/300 mA; min RCD type AC/A/F/B
  (`src/lib/circuit-params.ts:19`, `:29`).
- MCB and RCBO need **exact In**; RCD needs `In ≥ ΣIn × (100+margin)/100` and exact IΔn; FR needs
  `In ≥` the pre-meter protection (`src/lib/device-matching.ts`, `context/foundation/agent-rules/matching-quote.md`).
- Poles accepted (`src/lib/device-matching.ts:214-229`): main switch 1P/2P (1-phase) or 4P (3-phase); MCB
  1P/1P+N/2P or 3P/3P+N/4P; RCD 2P/4P; RCBO 1P+N/2P or 3P+N/4P.
- `manufacturer` is not a selection criterion — only a tie-break after price (`device-matching.ts:191-203`:
  price, manufacturer, model, id). There is no brand preference per project/profile. Consequence: with both
  brands seeded, **the generated prices alone decide which brand every project gets**.
- `breaking_capacity_ka` is stored and snapshotted but not filtered on by the matcher.
- Comb busbars: chosen by phases (1P/3P), `rated_current_a ≥` group RCD In, and pins
  `= floor(width_mm / 17.5)` (`src/lib/busbar-cutting.ts:66`, `:102-118`, `busbarPins` in `device-spec.ts`).
  A pitch other than 17.5 mm (Eaton Z-SV-16/3P, Z-SV-35: 27 mm; AZ MCBs: 27 mm/pole) does not fit this model.
- PE/N bars: the cheapest bar whose `terminal_groups` take all conductors (`bar-conductors.ts`), conductor
  sizes 1.5–16 mm².

### 3. What the catalogs contain (extracted, `extract/*.json`)

Counts are rows in the saved files (`page` = PDF page index; for Eaton the printed page = PDF − 2).

| File                           | Kind / series (rows)                                                                                                                                                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eaton-rcd-rcbo.json` (452)    | RCD: FRCmM 192, PF6 47, PFIM 34, FRCdM 33, HNC 12. RCBO, char. B only: PKNM 78 (10 kA), PFL6 32, HNB 12, FRBm6 12 (6 kA)                                                                                                                                                           |
| `eaton-mcb-fr-bars.json` (373) | MCB B: FAZ 84 (15 kA), PL6 69 (6 kA), HN 50 (6 kA), AZ 45. FR: IS 36, HIS 32, ZP-A 8. Comb busbar: EVG 16, Z-SV 10, Z-GV 6. PE bar 14 (KL, BFZ-TS-KL, SK-KLV), N bar 3 (SK-KLV)                                                                                                    |
| `legrand.json` (428)           | MCB B 227 (RX3, TX3 S301–S304/S311–S314, DX3 S301–S304/S301N/S311–S314). RCD 119 (RX3, TX3, DX3 P302/P304). RCBO 32 (P312 DX3; 18 rows are exact duplicates from PDF p21 and p40 — same order no, to be dropped). FR: FR 300 26, FRX 10. Comb busbar 10 (HX3, web only). PE 2, N 2 |

Mapping decisions the workers made (each carried in the row's `notes`):

- Eaton RCD time-delayed types map to their base sensitivity (G, S → AC; G/A, S/A → A; …; B+, Bfq → B),
  raw string kept in `rcd_type_raw`. Legrand "AS" (selective) → A, "Hpi" → A. These are **candidates to
  drop**, not to seed — the schema can't tell them apart from plain types, and a selective RCD as a final-
  circuit group RCD is a behaviour change nobody asked for.
- Eaton `residual_current_ma` comes from the model code (`/003` = 30 mA, …) because the PDF's In/IΔn
  column has typos (e.g. PFL6 "20/03").
- 4 Eaton PFIM rows have no order number (the PDF column repeats the model; p29).
- Legrand Icn: "6000/10 kA" → 6 kA, "10000/16 kA" → 10 kA (EN 60898 value; raw in `breaking_raw`). Eaton AZ is
  rated to EN 60947-2 (25 kA); the 125 A rows were set to 15 kA from a search summary of eaton.com — uncertain,
  and 125 A is outside the circuit list anyway.
- Legrand P312 "Dwubiegunowe 230 V" (2 modules) → 1P+N; S301N → 1P+N in 1 module; S304 → 4P.
- Legrand FR 300 (p70) was read from the rendered page because the text layer is scrambled.

Dimensions and N side (both catalogs give only photos, no drawings):

- Height/depth were filled from manufacturer web pages only for some series: Eaton PF6, FRCmM (≤100 A),
  FRBm6, HNB, PFL6, PKNM, PL6, FAZ, HN, AZ, IS; Legrand DX3 MCB (applied from one SKU, 407435). The web
  sources disagree with each other (e.g. PL6 height 73 vs 80 mm; PFL6 75 vs 80 mm) — the URL is in `notes`.
  Missing: Eaton HNC, PFIM, FRCdM, HIS, ZP-A, all bars; Legrand TX3, RX3, all RCD/RCBO/FR/bars.
- Module counts are mostly inferred from poles and confirmed by web lookups for the series listed above;
  Legrand states "17,5 mm" modules but its datasheets give 17.7–17.8 mm per pole.
- `n_terminal_side`: null on all 1253 rows. The only hint found is a Legrand sheet saying "neutral on left"
  for a different RCBO range (F01310, refs 4107xx/4108xx). The existing local seed and the migration
  backfill used `'left'` (`20261006120000_device_n_terminal_side.sql:15-17`).
- PE/N bars: Eaton KL rows have no `minMm2` and no width; Legrand 0048 40 / 0048 30 (4 × 1.5–16 mm², 47 mm),
  4048 39 PE (1 × 6–25 + 26 × 1.5–16 mm², 227 mm), 0048 15 N (2 × 6–35 + 4 × 6–16 mm², 62 mm).

### 4. Sizing against the 1000-row cap

Filter applied (scratchpad check, not saved): MCB/RCBO In in the circuit list; RCD/RCBO IΔn in
{10,30,100,300} and no S/G/B+/Bfq; comb busbars with width and In; everything else kept. Result **929 rows**:
Eaton MCB 197, RCD 131, RCBO 122, FR 76, busbar 28, PE 14, N 3; Legrand MCB 175, RCD 104, FR 36, RCBO 32,
busbar 7, N 2, PE 2. That is before dropping the 18 Legrand duplicates and before choosing series. It is still
inside 1000 but leaves no headroom for admin additions, and the admin list (`src/pages/admin/devices/`)
also loads everything without pagination. A curated set (e.g. one residential series per brand per kind:
Eaton PL6 / PF6 / PFL6 or PKNM / IS; Legrand DX3 S301–S304 / P302–P304 / P312 / FR 300) would land in the
low hundreds.

### 5. Getting the rows to production

- `supabase/seed.sql` runs only on local `supabase start` / `db reset` and in CI (`supabase/config.toml:60-65`);
  deploy runs `supabase db push` (`.github/workflows/deploy.yml`), which never seeds.
- No migration so far inserts catalog rows; the only migration DML is an UPDATE backfill
  (`20261006120000_device_n_terminal_side.sql:15-17`) and a profiles backfill in
  `20260922083135_roles_and_profiles.sql`.
- **Option A — data migration** (`YYYYMMDDHHmmss_seed_eaton_legrand_devices.sql`, `ON CONFLICT DO NOTHING`):
  ships automatically through the existing deploy, is additive (backward-compatible per `AGENTS.md`), but also
  runs locally and in CI before `seed.sql`, so the real catalog joins the sample one in every test DB. That
  breaks the "no B40" catalog-gap tests (`tests/e2e/seed.spec.ts:4,66`, `rls-devices.test.ts:421`), changes
  the `≥ 20 rows` / two-B16-prices assertions' context (`rls-devices.test.ts:393,406-412`), and can change
  which device the matcher picks in `rls-circuits.test.ts` / `rls-layout.test.ts` if a real device is cheaper
  than the `PRZ-*` sample (tie-break is price first). Mitigations exist (exclude B40 — but then the prod
  catalog has a hole; or make tests filter by sample manufacturer), each a design choice.
- **Option B — a separate prod-only SQL file/script** (e.g. `supabase/catalog/eaton-legrand.sql` applied once
  with `psql`/`supabase db execute` against prod, or a Node script with the service role): no test impact, but
  a manual step outside the deploy pipeline, and re-runs depend on someone remembering it.
- Either way the file should be **generated** from the curated JSON by a script, so prices/defaults are
  reproducible and the SQL is not hand-edited.

### 6. Prices

No source price exists. The matcher's "cheapest compliant" rule plus the brand tie-break mean price
generation is a product decision, not filler: it decides the brand mix in every quote. A deterministic rule
(base price per kind × pole multiplier × In step × series tier, e.g. Eaton HN/Legrand RX3 budget < PL6/TX3 <
FAZ/DX3) keeps prices plausible and reproducible; values must be integer grosze in `(0, MAX_PRICE_GROSZE]`
(`src/lib/price-input.ts`).

## Code References

- `supabase/migrations/20260923130628_devices_catalog.sql:47-75,133,148-184` — table, unique key, RLS/grants
- `supabase/migrations/20261009120100_comb_busbar_parameters.sql:4-64` — current per-kind CHECK
- `supabase/migrations/20261006120000_device_n_terminal_side.sql:15-72` — N-side backfill and CHECK
- `src/lib/device-spec.ts` — `POLES_BY_KIND`, `PARAMETERS_BY_KIND`, `POLES_WITH_N`, decimals, `busbarPins`
- `src/lib/cabinet-geometry.ts:71-75` — `terminalGroupSchema` `{count, minMm2, maxMm2}`
- `src/lib/circuit-params.ts:19,29` — requestable In / IΔn
- `src/lib/device-matching.ts:191-203,214-229` — tie-break, accepted poles
- `src/lib/device-matching-server.ts:107` — unpaginated catalog load
- `src/lib/busbar-cutting.ts:66,102-118` — busbar phases/pins/In
- `supabase/config.toml:18,60-65` — `max_rows = 1000`, seed wiring
- `supabase/seed.sql:137-181` — 32 sample devices, `ON CONFLICT … DO NOTHING`
- `tests/e2e/seed.spec.ts:4,66`, `tests/integration/rls-devices.test.ts:26,393,406-412,421`,
  `tests/integration/rls-circuits.test.ts:37-43`, `tests/integration/rls-layout.test.ts:33-35` — tests tied to the sample catalog
- `context/changes/production-catalog-seed/extract/` — extracted rows and generator scripts

## Architecture Insights

- The catalog is guarded twice (CHECK + `parseDeviceSpec`); a generated seed should be validated by
  `parseDeviceSpec` before SQL is emitted, so the generator and the database refuse the same rows.
- Snapshots (`project_devices`) mean seeding never changes existing projects; archiving is the only removal
  path (no DELETE grant).
- With no brand preference, a two-brand catalog is effectively one catalog where the cheapest row wins.

## Historical Context (from prior changes)

- `context/archive/2026-09-23-admin-device-catalog/` — S-01 built the catalog and the admin editor; admins add
  devices by hand (the PRD Non-Goal above).
- `context/archive/2026-10-09-rcd-group-busbars/` — added `comb_busbar`; a busbar miss is never a catalog gap.
- `context/changes/production-cabinet-seed/change.md` — sibling change (Karwasz cabinets, created 2026-10-21);
  cabinets are out of scope here. The Legrand enclosures (Practibox, RWN, Nedbox, Drivia, XL3 125, RN 65 …)
  give only outer dimensions, no interior/rail geometry, so they could not feed `parseCabinetGeometry` without
  invented data.

## Related Research

Not applicable — no other research on catalog seeding.

## Open Questions

1. **Delivery path:** data migration (automatic, but touches every test DB) or a prod-only script/SQL (manual,
   isolated)? If migration — how do the "no B40" catalog-gap tests keep their gap?
2. **Curation:** all 929 matcher-usable rows, or one (or two) series per brand per kind? Keep FR variants
   above 125 A, 10 mA RCDs, 1P+N MCBs?
3. **Excluded variants:** confirm dropping selective (S), short-delay (G), Hpi, B+, Bfq RCDs and the 27 mm-pitch
   AZ MCBs / Z-SV busbars.
4. **Defaults for missing data:** height/depth per series (e.g. the web value of a sibling series, or a generic
   85 × 70 mm), and `n_terminal_side` (`left` like the existing backfill, or per-brand). The N side drives the
   layout rule for N-outward RCD orientation, so a wrong default is visible in drawings.
5. **PE/N bars:** accept enclosure-accessory bars as the catalog bars (with generated `minMm2` and widths), or
   add generic DIN PE/N bars?
6. **Price model:** relative tiers between Eaton and Legrand series, and whether one brand should be cheaper
   overall (it will then win every match).
7. **Cloud `max_rows`:** verify the hosted project's PostgREST `max_rows` before sizing the seed.
