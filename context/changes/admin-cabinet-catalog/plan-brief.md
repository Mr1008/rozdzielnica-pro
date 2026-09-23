# Admin Cabinet Catalog — Plan Brief

> Full plan: `context/changes/admin-cabinet-catalog/plan.md`

## What & Why

Roadmap slice **S-02** (FR-002): the admin maintains a catalog of switchboard cabinets. Not a count
of rails, but the cabinet's real front-view geometry in millimetres — interior size, cable entry
zones, every DIN rail's position and length (two rails in one row with a gap are allowed), and the
built-in PE/N bars with depth and terminals. That geometry is the grid the north-star S-05 layout
heuristic places devices on, and the drawing S-06 edits and S-09 prints.

## Starting Point

The only table is `profiles` (F-01) with the `is_admin()` claim helper and per-operation RLS
pattern. `/admin` is a gated placeholder; `/api/admin` is not gated. Form endpoints use FormData +
`?error=<code>` redirects. There is no generated `Database` type and no product React island yet.

## Desired End State

The admin lists, creates, edits, archives and restores cabinets at `/admin/cabinets`, typing
datasheet values while a live SVG preview redraws; incoherent geometry is refused in Polish in the
browser and on the server. An electrician can read active cabinets (for S-03) but cannot write or
see archived ones. `supabase db reset` yields three clearly different starter cabinets.

## Key Decisions Made

| Decision           | Choice                                                                  | Why (1 sentence)                                                                     |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Geometry fidelity  | Full mm geometry: interior (w/h/depth), rails, entries, PE/N bars       | The planner must render the real cabinet, not an abstract rows × modules grid.       |
| Unit               | Integer millimetres everywhere; S-01 device widths also in mm           | One unit end to end; datasheets give mm.                                             |
| Storage            | Scalar columns + one `geometry` JSONB document, validated by zod        | Atomic single-row save and a one-copy snapshot for S-03.                             |
| Rails              | Horizontal only, fixed 35 mm height, any number per row, no depth       | Covers residential cabinets and keeps S-05 slot logic 1-D.                           |
| PE/N bars          | Built into the cabinet: position, length, orientation, `zMm` depth      | The cabinet represents itself fully; rule 3 gets fixed anchor points.                |
| Bar terminals      | Groups of `count × minMm2–maxMm2` cross-section                         | Matches datasheets and lets S-04 match conductor cross-sections directly.            |
| Removal            | Archive/restore via `archived_at`; no hard delete, no RLS delete policy | Future project references stay valid.                                                |
| Edits to used cabs | Edit in place; S-03 snapshots `geometry` into the project               | Nothing to build now and existing layouts never shift; row versioning needed an RPC. |
| Price              | Required `price_grosze` integer, feeds S-08 material cost               | The cabinet is real material on the quote.                                           |
| Admin editor       | Numeric lists + live SVG preview (React island)                         | Datasheet precision now; the mm-based renderer is ready for S-06 drag-and-drop.      |
| Starter data       | Three sample cabinets in `seed.sql`; prod catalog entered via the UI    | Keeps content out of migrations; seed validity proven by an integration test.        |
| Admin acceptance   | CRUD + archive/restore, Polish geometry rejection, RLS-proven read-only | Answers roadmap Open Question #1 for this slice.                                     |

## Scope

**In scope:** `cabinets` table, touch trigger, RLS; generated DB types; geometry module and unit
tests; seed of three cabinets; RLS integration tests; SVG drawing; list, new and edit pages;
archive/restore; create/update endpoints; `/api/admin` gate; Polish copy; AGENTS/README sync.

**Out of scope:** drag-and-drop in the admin editor; vertical rails; rail depth; per-terminal
listing; row versioning; hard delete; device catalog (S-01); projects (S-03); `profiles.updated_at`
fix; sub-millimetre precision.

## Architecture / Approach

`src/lib/cabinet-geometry.ts` owns the document shape and every coherence rule and returns coded
issues; the island, the API route (via `cabinet-form.ts`) and the tests all call it, while the DB
only checks the document is a v1 object. `CabinetDrawing.tsx` renders with `viewBox` = interior in
mm and works both server-side (list, later print) and in the editor island.

## Phases at a Glance

| Phase                            | What it delivers                                        | Key risk                                                    |
| -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| 1. Geometry model                | Schema, rules, issue codes, Polish messages, unit tests | Rules that S-05 later finds too loose or too strict         |
| 2. Database, types, starter data | Migration, RLS, generated types, seed, RLS tests        | Seed geometry that fails validation; unchecked JSONB writes |
| 3. Read-only surface             | SVG drawing, list, archive/restore, `/api/admin` gate   | RLS 0-row updates mistaken for success                      |
| 4. Editor and write path         | Island with live preview, create/update, docs sync      | Losing the typed geometry on a server-side error redirect   |

**Prerequisites:** F-01 merged (done); Docker for the local stack; the seeded admin account.
**Estimated effort:** ~3–4 sessions; Phase 4 (editor island) is the largest.

## Open Risks & Assumptions

- **`BAR_Z_CLEARANCE_MM = 10`** is an assumed minimum depth difference for two bars that overlap in
  the front view — a named constant, cheap to change.
- **Geometry is enforced only in TypeScript.** Any write that bypasses `parseCabinetGeometry`
  (hand SQL, a future endpoint) can store incoherent geometry; recorded as an AGENTS.md tripwire.
- **Integer mm** cannot express half-millimetre datasheet values; accepted for MVP.
- **S-01 must adopt mm widths** and **S-03 must snapshot geometry** — contracts recorded in
  `change.md`, not yet enforced by code.

## Success Criteria (Summary)

- The admin enters a real cabinet — including a split rail row and stacked PE/N bars — and sees it
  drawn correctly; incoherent input is refused in Polish.
- An electrician can read the active catalog but cannot change it, proven by integration tests.
- Three visibly different starter cabinets exist locally for S-05 to be verified against.
