# Catalog Lists and Cabinet Picker at Production Scale — Plan Brief

> Full plan: `context/changes/catalog-pickers/plan.md`
> Frame brief: `context/changes/catalog-pickers/frame.md`

## What & Why

The actual problem: the lists cannot be narrowed or ordered by the attributes users actually choose
by (parameters and manufacturer for devices, mounting type and module capacity for cabinets), and for
cabinets those attributes are not even structured data. On top of that, the long wall of large cards
looks unprofessional, and every new cabinet makes it longer.

## Starting Point

Three server-rendered lists show the whole production catalog (355 devices, 33+ cabinets) on one
page, sorted by name text (`B10, B16, B2 … B6`; `RN-12-P` before `RN-6-P`), with no search or
filters. A cabinet's mounting type lives only in its name, and its module capacity only in its
geometry.

## Desired End State

Every list opens short: collapsed groups with counts (cabinets by mounting, devices by kind). A filter
bar narrows the list instantly; devices sort by parameters (B6 before B10, 1P before 3P). Cabinets show
their mounting and capacity (`3×12 = 36`) and switch between large thumbnails, small thumbnails and a
list. Without JavaScript everything still renders and submits.

## Key Decisions Made

| Decision        | Choice                                                   | Why (1 sentence)                                                        | Source |
| --------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- | ------ |
| Pagination      | None                                                     | Users find by attribute, not by position; volume was ruled out before   | Frame  |
| Mounting source | New `cabinets.mounting` column, backfilled               | Structured, admin-controlled; name text is not a contract               | Plan   |
| Mounting values | `surface` / `flush` only; hermetic RNH = surface         | Mounting and sealing are separate; sealing dropped                      | Plan   |
| Sealing / IP    | Out of scope                                             | Dropped by the user; IP data exists only for RNH                        | Plan   |
| Filtering       | In the browser over server-rendered `data-*`             | Instant, keeps the picker's radio and typed project name, no API change | Plan   |
| Page length     | Collapsible `<details>` groups with counts               | Page stays short however big the catalog grows                          | Plan   |
| Cabinet views   | Large / small thumbnails / list, remembered per browser  | Thumbnails for recognising, list for comparing                          | Plan   |
| Module filter   | Total capacity `≥ N`, smallest fitting first             | Answers "will it fit"; per-rail fit stays the layout's job              | Plan   |
| Device order    | In → poles → kind's params → manufacturer; archived last | How an electrician thinks; same device from both makers side by side    | Plan   |

## Scope

**In scope:** mounting column + parser + editor field + parity test; a shared pure list model
(capacity, order, filters); grouped, filterable cabinet picker and admin cabinet list with three
views; grouped, filterable admin device list; kitchen-sink entries; e2e for the picker.

**Out of scope:** pagination, server or URL filters, IP / sealing, the project's cabinet snapshot,
matching / layout / quote, regenerating the deployed Karwasz migration, NOT NULL on `mounting`.

## Architecture / Approach

Data first, then one pure module (`src/lib/catalog-list.ts`) that both the server renderer and a
small shared browser script use. Pages render every item with `data-*` attributes; the script toggles
`hidden` and opens/closes native `<details>` groups. No React island.

## Phases at a Glance

| Phase                        | What it delivers                                            | Key risk                                                          |
| ---------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Cabinet mounting type     | `cabinets.mounting`, backfill, editor field, parity test    | Migration must stay compatible with the deployed code             |
| 2. Shared catalog list model | Capacity, ordering, filter predicates, unit-tested          | Sort rules for kinds with sparse parameters (bars, busbars)       |
| 3. Cabinet lists             | Grouped, filterable picker and admin list, three views, e2e | A `required` radio inside a closed group blocking submit silently |
| 4. Admin device list         | Collapsible kind sections, parameter order, filters         | Archived devices hidden by default being mistaken for deleted     |

**Prerequisites:** local Supabase stack for Phase 1 (`db reset`, `db:types`, `test:integration`).
**Estimated effort:** ~3–4 sessions across 4 phases.

## Open Risks & Assumptions

- A cabinet created by the old code during the deploy window gets a null mounting and shows under
  "Bez rodzaju montażu" until the admin sets it.
- The `≥ N` filter can offer a cabinet whose rails cannot hold a group unsplit; the layout step still
  catches that.
- Assumes a few hundred items stay cheap to filter in the DOM; true at today's catalog size.

## Success Criteria (Summary)

- The new-project page opens short, and "podtynkowa, at least 24 modules" is one filter change away.
- In the admin device list, "B16 1P Legrand" is one search away, and B6 sorts before B10.
- Adding cabinets or devices never makes any of the three pages grow without bound.
