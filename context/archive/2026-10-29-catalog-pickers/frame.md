# Frame Brief: Catalog lists and the cabinet picker at production scale

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

With many devices and cabinets, the "pickers" — in the admin catalog and for electricians — become
very long and it is hard to find your way around them.

## Initial Framing (preserved)

- **User's stated cause or approach**: the lists are too long.
- **User's proposed direction**: paginate or group them; "propose a better approach".
- **Pre-dispatch narrowing**: all three screens are affected — the admin device list
  (`/admin/devices`), the admin cabinet list (`/admin/cabinets`) and the electrician's cabinet
  picker (`CabinetPicker`). The pain is _finding a specific item_ and _getting an overview_ of what
  is there. Seen on the production catalog (Eaton/Legrand devices, Karwasz cabinets), not predicted.

Note on scope: electricians never pick a device — the matcher does. "Pickers for electricians" is
the cabinet picker only; the device "picker" is the admin's catalog list.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Volume** — one page simply holds too many rows to scan. ← initial framing
2. **Ordering** — rows are in an order that does not match how the user thinks, so even a short
   run of relevant rows is scattered.
3. **Find affordance** — there is no way to narrow the list by the attributes the user knows.
4. **Density and overview** — each item takes a lot of vertical space and sections give no summary,
   so the page is long in pixels and gives no sense of what is in the catalog.

## Hypothesis Investigation

| Hypothesis              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Verdict                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| 1. Volume               | Production catalog: 355 devices (`supabase/catalog/source/eaton.json` 204, `legrand.json` 151) — `mcb_b` 105, `rcd` 89, `rcbo` 60, `switch_disconnector` 60. 33 Karwasz cabinets (`supabase/migrations/20261021120000_karwasz_cabinets.sql`). All rendered on one page each. Real, but not the whole story: the data-volume side was already decided — `context/archive/2026-10-21-production-catalog-seed/plan.md:63` scopes out pagination and keeps headroom under PostgREST `max_rows` instead.                                                             | WEAK (symptom, not origin) |
| 2. Ordering             | Admin lists sort by `name.localeCompare(LOCALE)` without `numeric` (`src/lib/catalog.ts:16-20`), so `B10, B13, B16, B2, B20 … B50, B6` and Eaton/Legrand rows interleave by name text. The electrician's picker uses the same name sort (`src/pages/dashboard/projects/new.astro:39`, `[id].astro:119`), so `RN-12-P` precedes `RN-6-P` and `RP-100` precedes `RP-12-P`. (Corrected during /10x-plan: an earlier draft of this brief said the picker was unordered.)                                                                                            | STRONG                     |
| 3. Find affordance      | None of the three screens has search or filters (`src/pages/admin/devices/index.astro`, `src/pages/admin/cabinets/index.astro`, `src/components/projects/CabinetPicker.astro`). Devices carry every parameter the admin searches by as columns (`poles`, `rated_current_a`, `residual_current_ma`, `rcd_type`, `manufacturer`). Cabinets do **not** carry the attributes the electrician picks by: mounting type (natynkowa / podtynkowa / hermetyczna) exists only inside the `name` text; module capacity is only derivable from `geometry.rails[].lengthMm`. | STRONG                     |
| 4. Density and overview | Cabinet cards carry a drawing — `h-32` in the picker (2 columns), `h-40 w-40` in the admin list (one column) — so 33 cabinets are thousands of pixels. Device sections have no count and no jump navigation between the 7 kinds. Contributes to "no overview", secondary to 2–3.                                                                                                                                                                                                                                                                                | WEAK–MEDIUM                |

## Narrowing Signals

- The electrician picks a cabinet by **mounting type** and **needed module count** — not by model.
  Neither is a structured cabinet attribute today, and the picker shows neither except buried in
  the name.
- The admin finds a device by **parameters** (e.g. B16 1P, RCD 40 A 30 mA type A) and by
  **manufacturer** — not by model number. All of these are already columns, but the list offers
  no way to narrow by them and sorts the parameter text lexicographically.
- Both answers describe _attribute-based finding_. Pagination splits a list by position, which
  serves neither: the user would have to know which page holds "B16 1P".

## Cross-System Convention

Catalogs of a few hundred structured items are conventionally handled with faceted filters on
known attributes (plus a sensible natural sort), not pagination; pagination is a data-volume tool,
and this project has already decided data volume is not a problem at this size. The leading
hypothesis matches that convention.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the lists cannot be narrowed or ordered by the
> attributes users actually choose by — parameters and manufacturer for devices, mounting type and
> module capacity for cabinets — and for cabinets those attributes are not even structured data.

Length is the symptom. Paginating would keep every list long in total and add the cost of
guessing a page; grouping alone helps overview but not finding. Addressing ordering and
attribute-based narrowing fixes both reported pains (finding, overview) on all three screens. The
cabinet side has a data question behind the UI question: what "mounting type" and "module
capacity" are, and where they come from.

## Confidence

**HIGH** — strong code evidence for ordering and missing find affordances, a decisive user signal
(attribute-based finding on both sides), and a prior project decision ruling volume out as a data
problem.

## What Changes for /10x-plan

Plan attribute-based narrowing and natural ordering for the three screens instead of pagination.
The plan must decide how cabinets get mounting type and module capacity (structured column vs
derived from geometry), and whether the picker and the admin list share one cabinet-filter model.

## References

- Source files: `src/lib/catalog.ts:16-20`, `src/pages/admin/devices/index.astro:31-56`,
  `src/pages/admin/cabinets/index.astro:30-45`, `src/components/projects/CabinetPicker.astro:32-73`,
  `src/pages/dashboard/projects/new.astro:30-32`, `src/pages/dashboard/projects/[id].astro:112-114`
- Data: `supabase/catalog/source/*.json`, `supabase/migrations/20261021120000_karwasz_cabinets.sql`
- Prior decision: `context/archive/2026-10-21-production-catalog-seed/plan.md:46,63`
- Related research: none yet
