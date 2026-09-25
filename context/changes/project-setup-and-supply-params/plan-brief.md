# Project Setup and Supply Parameters — Plan Brief

> Full plan: `context/changes/project-setup-and-supply-params/plan.md`

## What & Why

Roadmap S-03 (FR-003, FR-004, FR-005): an electrician creates a project, picks a cabinet from the
admin catalog and describes the OSD/WLZ supply. This is the first data that belongs to one
electrician, and S-04 through S-09 all hang off it. The cabinet must be a snapshot, so admin
catalog edits never move an existing project.

## Starting Point

There are no projects anywhere. The cabinet catalog (S-02) exists. Its non-archived rows are readable
by any signed-in user, and archived rows are invisible to electricians. The owner-only table pattern
comes from `pricing_profiles` (S-07), the double-guard (CHECK + TS parser) pattern from the device
catalog (S-01), and the snapshot rule was decided in S-02.

## Desired End State

`/dashboard` links to a project list. An electrician creates a project (name, optional client and
address, cabinet from a radio list with drawings) and lands on its page. That page shows the cabinet
snapshot, lets them edit details, change the cabinet, fill in OSD/WLZ, and delete the project, and it
shows simplified, non-blocking warnings about the supply. The admin and other electricians see nothing.

## Key Decisions Made

| Decision            | Choice                                                                                                              | Why (1 sentence)                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Project fields      | Required name; optional client name and site address; no notes                                                      | Enough to tell projects apart and to head the S-09 printout.                                            |
| Snapshot mechanism  | DB trigger copies geometry + name/manufacturer/model/price on insert or `cabinet_id` change; ignores client values  | PostgREST is reachable with the user's token, so only the database can guarantee the snapshot's origin. |
| Archived cabinet    | Refused on insert/change (`P0002`); existing projects keep their snapshot                                           | Archiving hides from the picker only, as decided in S-02.                                               |
| Supply data model   | Seven columns with closed lists (protection 16–63 A, TN-C/TN-S/TN-C-S/TT, 1/3 phases, 2.5–35 mm², Cu/Al, 5 methods) | S-04 reads typed columns; enums block typos; the CHECK and parser mirror each other like `devices`.     |
| Unconfigured supply | Columns nullable, all-or-nothing CHECK; null = "not configured", S-04 blocks                                        | Same contract as the pricing profile: never compute from invented defaults.                             |
| Validation          | Non-blocking warnings: WLZ ampacity < protection, Al < 16 mm², TN-C PEN < 10 Cu / 16 Al, ΔU > 0.5 %                 | Early feedback without blocking; checks that need circuits stay in S-04.                                |
| Ampacity source     | PN-HD 60364-5-52 B.52.2–5, PVC 70 °C, no correction factors; method map C/B2/B2/C/D1                                | Simplified on purpose (Non-Goals); an electrician verifies the transcribed values by hand.              |
| Creation flow       | Two steps: create (details + cabinet) → project page with the supply form                                           | The project page becomes the hub S-04..S-09 extend.                                                     |
| Lifecycle           | Edit details, change cabinet (re-snapshot), hard delete behind a required checkbox                                  | A wrong cabinet doesn't force re-entry; test projects can be cleaned up without JS.                     |

## Scope

**In scope:**

- The `projects` table: enums, trigger, CHECKs and owner RLS (no admin policy)
- The list, create and project pages; endpoints for details, cabinet, supply and delete
- The `/api/projects` route gate
- The supply parser and the warning rules, with unit tests
- An RLS and trigger integration test
- Docs and tripwires

**Out of scope:**

- Circuits, matching, layout and quote (S-04 to S-09)
- Checks that need circuits (TN-C vs RCD, switch-disconnector rating)
- Blocking validation and correction factors
- Refreshing a snapshot from the catalog
- Custom cabinets, templates, notes, admin views, React islands and drafts

## Architecture / Approach

The database is the boundary. The trigger `projects_snapshot_cabinet` owns the five snapshot columns,
the CHECKs own the value lists and the all-or-nothing rule, and RLS owns isolation. Plain Astro forms
post FormData to `/api/projects/*` endpoints, which parse with TS mirrors of the CHECKs and redirect
back with `?saved=` or `?error=`. The warnings are pure functions over the stored supply, computed on
render. The cabinet drawing is the existing server-rendered `CabinetDrawing`, fed from the snapshot.

## Phases at a Glance

| Phase                           | What it delivers                                                     | Key risk                                                               |
| ------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1. Data and validation          | Table, enums, trigger, RLS, parsers, RLS/trigger integration test    | Trigger must re-snapshot only on a real `cabinet_id` change            |
| 2. Projects: list, create, page | Route gate, error map, three pages, details/cabinet/delete endpoints | Archived-cabinet and cross-user paths surfacing as clear Polish errors |
| 3. OSD/WLZ and warnings         | Supply form + endpoint, warning rules, docs and tripwires            | Transcription errors in the ampacity table                             |

**Prerequisites:** F-01, S-02 done (they are); local Supabase stack for integration tests.
**Estimated effort:** ~3 sessions, one per phase.

## Open Risks & Assumptions

- The ampacity values are transcribed by hand. The completeness test catches gaps, not wrong numbers,
  so an electrician's manual check (criterion 3.7) is the real guard.
- ΔU is computed at the full pre-meter protection current, so it overstates the drop. The warning text
  says so. The accepted cost is warnings that fire more often than real load would justify.
- `P0002` from the trigger is assumed to reach the client through PostgREST as the error `code`.
  Phase 1's integration test confirms it before the Phase 2 error map relies on it.

## Success Criteria (Summary)

- An electrician goes from the dashboard to a saved project with a cabinet snapshot and a filled
  supply, entirely in Polish.
- Admin edits and archiving of a cabinet never change an existing project. Nobody but the owner sees
  the project.
- Invalid supply values are refused by both the parser and the database, and the warnings flag
  under-sized WLZ, aluminium and PEN minimums, and high voltage drop.
