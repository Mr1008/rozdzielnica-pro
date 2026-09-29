# Circuit Input and Device Matching — Plan Brief

> Full plan: `context/changes/circuit-input-and-device-matching/plan.md`

## What & Why

Roadmap S-04. The electrician enters the project's circuits and groups them under RCDs in a
drag-and-drop editor. The system then picks the **cheapest device that satisfies every parameter**:
the main FR, an RCD per group, an MCB B per circuit, and an RCBO for a single-circuit group. If the
catalog has no such device, it shows a catalog-gap error asking the user to contact the admin.
Silently proposing an under-rated device is the worst failure this product can have. This slice is
where the guardrail against it lives.

## Starting Point

Projects already carry a cabinet snapshot and the OSD/WLZ supply (S-03), and the admin maintains a
typed device catalog (S-01). The project page is fully server-rendered, with no React. Nothing
stores circuits, groups or chosen devices yet. The seed has a cheaper second-manufacturer B16 and a
deliberate B40 gap, but no 2P/4P FR.

## Desired End State

A new "Obwody i dobór aparatów" section on the project page holds a React island.

- **Editor.** The electrician drags circuits within and between RCD groups (or to "Bez grupy") and
  reorders the groups. Keyboard and button equivalents exist for every drag.
- **Save.** Saving matches the whole set, stores a device snapshot (prices and parameters copied
  from the catalog), and shows one of three outcomes:
  - the matched list;
  - every catalog gap, stated precisely;
  - a blocker: supply missing, TN-C with RCD groups, or a 3-phase circuit on a single-phase supply.
- **Cable check.** Per-circuit cable-ampacity warnings are informational and never block the save.
- **Stale snapshot.** A supply change or a catalog change after the match is flagged, with a
  "Dobierz ponownie" button.

## Key Decisions Made

| Decision             | Choice                                                                                                                    | Why (1 sentence)                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Per-circuit input    | Name, In, phases, cable cross-section + installation method, entry side, RCD group                                        | In drives matching; cross-section feeds the ampacity warning; entry side is ready for S-05 |
| MCB / RCBO rating    | **Exact** In, poles by phase count (TN-C: 1P/3P only)                                                                     | An over-rated breaker leaves the cable unprotected — "larger" is not "safer"               |
| RCD group            | Per-group IΔn (exact, default 30 mA) + minimum type (AC<A<F<B, default A); RCD In ≥ max MCB In; 4P if any 3-phase circuit | Never swaps a cheaper AC in where A was asked; RCD sized to its largest circuit            |
| Single-circuit group | RCBO; if none qualifies, a compliant RCD + MCB pair (flagged); gap only if both fail                                      | Both options are fully compliant, so the fallback is not a downgrade                       |
| Main FR              | In ≥ pre-meter protection; 1-phase → 2P, 3-phase → 4P (TN-C: 1P/3P); seed gains FR 2P/4P                                  | An FR is not protection, so "at least" is safe; poles follow whether N is switched         |
| TN-C with RCD groups | Block matching with an explanatory message                                                                                | RCDs cannot work in TN-C — proposing one would be a non-functional set                     |
| Ungrouped circuits   | Allowed → plain MCB, with an info note                                                                                    | Real installs have them; TN-C cannot have RCDs at all                                      |
| Cable check          | Warn via verified `AMPACITY_A` (Cu) + new 1.5 mm² row the electrician verifies                                            | Reuses a table already checked against the standard                                        |
| Storage              | Tables `rcd_groups`, `circuits` (stable client UUIDs, upsert) + `project_devices` snapshot                                | Typed CHECKs, FKs S-05/S-06 can reference, per-row RLS                                     |
| Result               | Stored snapshot written by a trigger on save; a supply change clears it; stale hint + re-match                            | Honours "catalog edits never shift a project"; S-08 reads stable rows                      |
| All-or-nothing       | Any gap → nothing stored, every gap listed                                                                                | A quote over a partial set would understate the job                                        |
| PE/N bars            | Not selected — cabinet's bars used; warn if terminals are short                                                           | Cabinet geometry already models bars; avoids double counting                               |
| Editor               | React island with **drag and drop** (`@dnd-kit`, new dependency) + keyboard/button equivalents, one save                  | Bulk entry of 10–20 circuits and free rearranging, as requested                            |

## Scope

**In scope:**

- Circuit and group entry with drag-and-drop.
- Matching for the FR, RCD, RCBO and MCB B.
- Catalog-gap and blocker messages.
- Cable and bar warnings.
- The device snapshot and re-matching.
- Aside badge, kitchen sink, RLS tests, and FR 2P/4P seed rows.

**Out of scope:**

- Breaking-capacity (Icn) filtering.
- Choosing PE/N bars from the catalog.
- Computing In from a load.
- Physical layout (S-05).
- Material and labour totals (S-08).
- Manufacturer preference and circuit templates.
- Aluminium circuit cables.
- Touch drag.

## Architecture / Approach

1. The pure `matchDevices(input, catalog)` in `src/lib/device-matching.ts` filters for correctness
   first and only then takes the cheapest match. Ties are broken deterministically by manufacturer,
   model and id.
2. The endpoint parses the editor's JSON payload (`parseCircuitsPayload`, the same parser the island
   runs) and matches against the active catalog, read under RLS.
3. It then calls the `save_project_circuits` RPC, which runs security invoker in one transaction.
   The RPC upserts the groups and circuits and replaces the `project_devices` rows. Each device row
   is snapshotted by a BEFORE INSERT trigger from the active catalog.
4. The page recomputes a fresh match only to show gaps and blockers and to detect a stale snapshot.
   "Matched" is always the stored snapshot.

## Phases at a Glance

| Phase                   | What it delivers                                                               | Key risk                                                                    |
| ----------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| 1. Domain logic         | Lists + parser, cable warnings, draft ops for DnD, matcher — all unit-tested   | A wrong rule in the table → silent mis-match; pinned by tests + your review |
| 2. Database             | 3 tables, snapshot + supply-clear triggers, save RPC, seed FR 2P/4P, RLS tests | Upsert-by-id across owners — must raise 42501, tested                       |
| 3. Endpoints + result   | Save-and-match and re-match endpoints, result panel, stale state, badge        | Four result states must never show an unsaved match                         |
| 4. Drag-and-drop editor | `CircuitEditor` island (dnd-kit), kitchen sink, browser checks, AGENTS.md      | New dependency's React 19 peer range; keyboard DnD a11y                     |

**Prerequisites:** S-01 and S-03 done (they are). A local Supabase stack for Phases 2–4.
**Estimated effort:** ~4 sessions, one per phase. Phase 4 is the largest.

## Open Risks & Assumptions

- The 1.5 mm² Cu ampacity values are transcribed and **must be verified by you** before they are
  relied on (manual step 1.4).
- No Icn requirement is collected, so every catalog MCB and RCBO counts as adequate on breaking
  capacity. This is the next parameter to add.
- The cloud catalog needs FR 2P/4P devices added by hand. Until then, single-phase and TN-S projects
  there show a correct main-switch gap.
- `@dnd-kit` peer compatibility with React 19 is checked at install. If it fails, stop and ask; do
  not force the install.
- The circuit order set by drag-and-drop is list order, not cabinet placement. S-05 decides
  placement.

## Success Criteria (Summary)

- From a seeded project the electrician enters circuits by drag-and-drop and gets a matched set:
  cheapest compliant devices, never an over-rated MCB, never type AC where A was required, and an
  RCBO for a single-circuit group.
- A missing device (e.g. B40) yields a precise contact-admin error and no substitute. A TN-C supply
  with RCD groups, or a missing supply, blocks with a fix link.
- Catalog or supply changes never silently change a stored match. They are flagged and re-matched
  on request.
