# Produkcyjny seed szaf Karwasz — Plan Brief

> Full plan: `context/changes/production-cabinet-seed/plan.md`

## What & Why

The cloud catalog has no cabinets, because `seed.sql` never leaves the local stack. This change adds
33 real Karwasz cabinets (RN, RP, RNH, UNI SYSTEM M) through a re-runnable data migration. They come
with the manufacturer's net list prices and a geometry the layout heuristic can work with, so an
electrician in production can start a project on a real product.

## Starting Point

`public.cabinets` checks only the geometry envelope; `parseCabinetGeometry` enforces everything
else. No migration has carried catalog data so far. The 2022 Karwasz catalog gives the outer sizes,
rails × modules and the N/PE bars as text. Neither it nor the website gives internal coordinates, but
the official price list covers every model.

## Desired End State

After deploy, the production picker offers 33 Karwasz cabinets with valid geometry, list prices and,
where the catalog lists them, built-in N/PE bars. Layout, wiring and quote work on them. Locally
they appear after `supabase db reset`. CI fails if the migration and the data module disagree.

## Key Decisions Made

| Decision     | Choice                                                                                                               | Why (1 sentence)                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Delivery     | Data migration, `INSERT … ON CONFLICT DO NOTHING`                                                                    | Reaches the cloud through the existing deploy with no manual step, and replay is harmless.                                       |
| Scope        | RN (incl. BIS), RP, RNH, UNI SYSTEM M — 33 models                                                                    | Only DIN-rail cabinets model faithfully; meter boards (RW/RU/LM/L) can't be represented.                                         |
| Prices       | Net list prices from the Karwasz price list (sheet 28.08.2025); "Z" price where no plain variant                     | Found on the manufacturer's site (per your note), so no invented numbers.                                                        |
| Naming       | One row per catalog symbol; Polish name with rails × modules                                                         | Door, lock and flange variants don't change the geometry, and the unique index stays clean.                                      |
| Geometry     | Rule-based: rails 125 mm apart, length ⌈modules × 17.5⌉, top and bottom entries, built-in N/PE bars from the catalog | Nothing gives coordinates; built-in bars stop the quote from double-charging them. UNI M lists no bars, so it uses catalog bars. |
| Verification | TS module + unit test; migration pinned with `toMatchFileSnapshot`; integration test on the database                 | Every geometry passes the parser in CI without a database, from one source of truth.                                             |

## Scope

**In scope:** `src/lib/karwasz-cabinets.ts` and its test; the migration
`20261021120000_karwasz_cabinets.sql`; an integration test; a `data-guards.md` bullet and a README
note; manual checks in the browser.

**Out of scope:** meter and mounting-plate lines; RN-80/100/120 and UNI heights above 1450; door and
lock variants; schema, editor and `seed.sql` changes; a generic importer (Parked #20); the Eaton and
Legrand devices (sibling `production-catalog-seed`).

## Architecture / Approach

```
karwasz-cabinets.ts (data + karwaszGeometry rules)
   ├─ karwasz-cabinets.test.ts ── parseCabinetGeometry on every row
   │                          └─ render INSERT → toMatchFileSnapshot → supabase/migrations/…_karwasz_cabinets.sql
   └─ tests/integration/karwasz-cabinets.test.ts ── DB rows deep-equal the module
deploy.yml: supabase db push → production cabinets
```

## Phases at a Glance

| Phase                    | What it delivers                                                           | Key risk                                                                                        |
| ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. Data module and rules | 33 typed rows + geometry builder, unit-tested                              | Bars don't fit the smallest 150 mm cabinets — the rules fall back to stacking or a depth offset |
| 2. Generated migration   | Migration file pinned to the module, proven on the local stack             | A hand edit or later regeneration of a deployed migration                                       |
| 3. App check and docs    | Admin preview, RN-48 and UNI layout/quote checked; rule and README updated | Synthesised positions give an odd-looking layout                                                |

**Prerequisites:** Docker running for `supabase db reset` (not wslc).
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Rail, entry and bar positions are an approximation; the admin can correct any cabinet in the
  editor later.
- The price list's date is ambiguous (2025 sheet title, 2026 filename), and prices go stale. They're
  admin-editable, and the migration comment records the source date.
- A deployed data migration is immutable: later data fixes need a new migration and a restructured
  snapshot test.
- RN-48 bars: the website says 20 holes and the catalog says 16; the plan takes the catalog.

## Success Criteria (Summary)

- Production offers 33 Karwasz cabinets that an electrician can use to lay out and quote.
- CI proves every geometry is valid and the migration matches the data module.
- The quote charges the Karwasz list price without double-counting built-in bars.
