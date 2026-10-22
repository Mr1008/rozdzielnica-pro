# Production Eaton + Legrand Device Catalog Seed — Plan Brief

> Full plan: `context/changes/production-catalog-seed/plan.md`
> Research: `context/changes/production-catalog-seed/research.md`

## What & Why

Production has only the devices an admin typed in by hand. This change loads ~360 real Eaton and
Legrand modular devices (MCB B, RCD, RCBO, FR, comb busbars, PE/N bars) taken from the manufacturers'
PDF catalogs, with generated PLN prices (the PDFs list none), so electricians' projects match real
devices instead of hitting catalog gaps.

## Starting Point

Both PDFs are already extracted (1253 rows, `extract/`). The `devices` table, its CHECK and the mirroring
`parseDeviceSpec` exist; deploy carries only migrations, and `seed.sql` holds 32 local/CI sample devices
that tests depend on (no B40, `PRZ-*` winners).

## Desired End State

A generated, idempotent `supabase/catalog/eaton-legrand.sql`, pinned by a unit test, proven on a local
database, and applied once to production. Local and CI databases and every existing test stay unchanged.

## Key Decisions Made

| Decision             | Choice                                                                                                        | Why (1 sentence)                                                                                             | Source          |
| -------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------- |
| Delivery             | Prod-only SQL file applied by hand                                                                            | No test impact (the no-B40 gap survives) and no pipeline change; `on conflict do nothing` makes re-runs safe | Plan            |
| Size                 | Residential series, ~360 rows                                                                                 | Stays far below the unpaginated matcher's `max_rows = 1000`                                                  | Research + Plan |
| Series               | Eaton PL6/PF6(+FRCmM F/B/10 mA)/PFL6/FRBm6/IS/EVG; Legrand DX3 S301–S304, S301N, P302/P304, P312, FR 300, HX3 | Typical single-family stock; budget, 15 kA and exotic series left to the admin                               | Plan            |
| Excluded variants    | S, G, Hpi, B+, Bfq RCDs; non-B; 27 mm pitch                                                                   | The schema cannot express them; a wrong mapping would mislead the matcher                                    | Research        |
| Missing height/depth | Series web value → sibling series → 85 × 70 mm                                                                | Plausible drawings without inventing per-device data                                                         | Plan            |
| N terminal side      | `left` everywhere                                                                                             | Matches the existing backfill; the layout throws without a value                                             | Plan            |
| PE/N bars            | Enclosure-accessory bars with completed `minMm2`/width                                                        | Real models; avoids a catalog gap for cabinets without built-in bars                                         | Plan            |
| Prices               | Deterministic tiered net list prices; Legrand ≈ 8% above Eaton                                                | Plausible and reproducible; Eaton wins ties of equivalent devices                                            | Plan            |
| Generation           | Pure `src/lib/catalog-seed.ts` + Vitest `toMatchFileSnapshot`                                                 | Reuses `parseDeviceSpec` and `@/` aliases with no new runner; stale SQL fails `test:unit`                    | Plan            |
| Model naming         | Eaton type designation, Legrand order number                                                                  | Each brand's ordering identifier; unique under the case-insensitive key                                      | Plan            |
| Verification         | Unit test + 2× local apply + browser check                                                                    | Proves validity, idempotency and that matching and drawings work                                             | Plan            |

## Scope

**In scope:** curated source JSON, generator module and test, generated SQL, runbook, deploy-tooling
tripwire, local verification, one production apply.

**Out of scope:** migrations, `seed.sql`, CI/deploy changes, any import feature (PRD Non-Goal stays parked),
cabinets, matcher pagination, per-device N-side research.

## Architecture / Approach

`extract/*.json` → (curation script) → `supabase/catalog/source/{eaton,legrand}.json` →
`src/lib/catalog-seed.ts` (defaults, names via `pl.ts`, prices, `parseDeviceSpec`) →
`supabase/catalog/eaton-legrand.sql` (file snapshot) → applied by hand: local twice, then production.

## Phases at a Glance

| Phase                             | What it delivers                                   | Key risk                                                 |
| --------------------------------- | -------------------------------------------------- | -------------------------------------------------------- |
| 1. Curated source data            | Committed, audited source rows                     | Extraction misreads (spot-check)                         |
| 2. Generator and tests            | Validated, priced, pinned SQL                      | Implausible prices or wrong defaults                     |
| 3. Local verification and runbook | Idempotency proof, browser check, README, tripwire | Needs Docker for the local stack                         |
| 4. Production apply               | Catalog live in prod                               | Irreversible-ish (archive only), needs explicit approval |

**Prerequisites:** local Supabase on Docker; production DB access (dashboard SQL editor or connection string).
**Estimated effort:** ~2 sessions across 4 phases (phase 4 is minutes).

## Open Risks & Assumptions

- N `left` is assumed for all devices; drawings may mirror the real N terminal on some devices.
- Generated prices decide the brand mix; Eaton will win most matches.
- Cloud `max_rows` is assumed ≥ 1000 until checked in phase 3.

## Success Criteria (Summary)

- Production projects with ordinary circuits get real Eaton/Legrand devices and render layouts.
- The SQL is reproducible from code, validated like the editor, and safe to re-run.
- No existing test or local workflow changes.
