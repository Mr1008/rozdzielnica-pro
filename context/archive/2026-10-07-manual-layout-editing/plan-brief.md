# Manual Layout Editing — Plan Brief

> Full plan: `context/changes/manual-layout-editing/plan.md`

## What & Why

Roadmap S-06, FR-009: the electrician corrects the proposed cabinet layout before the quote. The PRD
measures success as "a proposal that needs only spot fixes". Without editing, one bad proposal blocks
the whole project, and US-01's "layout is editable before the quote" is unmet. The goal is the
safety net for the heuristic, not a mini-CAD.

## Starting Point

S-05 stores a proposal per project in `project_device_placements` (rail + `x_mm`), validates it on
every render, and draws it wired. Only two RPCs write placements, and there is no UPDATE grant. Every
circuit save, re-match or supply change re-creates the devices and so drops the placements; a cabinet
change clears them. The drawing is server-rendered, non-interactive SVG in millimetres.

## Desired End State

In the `placed` state, the "Układ w szafce" section is an always-on editor.

- **Moving.** The electrician drags a group or a single device, or uses the keyboard. Drops snap to
  0.5 TE, and an invalid drop is refused with a Polish reason.
- **Before saving.** The first change hides wires and lengths until the save. Undo/redo and cancel
  work on the unsaved draft.
- **Saving.** The save is re-validated on the server and stored with a "Poprawiony ręcznie" marker.
  The reload re-routes the wires.
- **Re-propose.** "Zaproponuj układ od nowa" restores the heuristic after a confirmation.
- **Re-match.** A manual layout survives a circuit save or re-match when it still fully applies and
  is valid. Otherwise a fresh proposal is stored and a notice says so.

## Key Decisions Made

| Decision            | Choice                                                                                 | Why (1 sentence)                                                                         |
| ------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Operations          | Move whole blocks (groups, etc.) and single devices; group devices only reorder inside | The typical fix ("group RCD 2 to the bottom rail") is one drag                           |
| Strictness          | Same `validateLayout` as the proposal (physical + rule 1); rules 2/3 are free          | One validator for propose, edit, render and print keeps risk #4 invariants               |
| Snapping            | 0.5 TE steps from the rail start, editor-only (server does not enforce the grid)       | Matches DIN and half-module devices, while proposals filled from the rail end stay valid |
| Invalid drop        | Refused: pointer snaps back, keyboard stays lifted + announcement                      | The draft is always valid, so a save is never blocked by a stale bad state               |
| Survival            | Carry over by `(role, group, circuit)` if the whole set applies and validates          | Renaming a circuit no longer wipes the fixes; an invalid layout is never stored          |
| Partial carry-over  | No; any mismatch means a fresh proposal plus a notice                                  | An incremental placer is optimiser and mini-CAD territory                                |
| Editor placement    | Always-on island in `placed`; the static wired drawing is the pre-hydration fallback   | No mode switch; the layout is visible before JavaScript loads                            |
| Wires while editing | Server wires until the first change, then hidden with a note; re-routed after save     | One router, on the server; lengths always match a saved layout                           |
| Controls            | Cancel, undo/redo, re-propose with confirmation, a "Poprawiony ręcznie" marker         | Covers "I made a mess" and tells the electrician the layout is their own                 |
| Marker storage      | `edited_manually` per placement row; no UPDATE grant                                   | Cascade deletes clear it automatically; writes stay RPC-only                             |
| Cabinet change      | Still clears the layout and the marker                                                 | Old rail indices mean nothing on a new geometry                                          |
| Bar-label overlap   | Deferred to S-09                                                                       | Keeps S-06 to editing; print legibility is S-09's job                                    |

## Scope

**In scope:**

- the pure editing model with property tests;
- a migration for the flag and the RPC parameters;
- the manual-save endpoint;
- carry-over in the circuits and rematch endpoints;
- interaction props on `CabinetDrawing` and the `LayoutEditor` island;
- notices and the badge, and the kitchen-sink states;
- AGENTS.md, the test-plan §6.5 entry, the roadmap and GitHub sync.

**Out of scope:**

- partial carry-over and live client-side wire routing;
- relaxing rule 1, and warnings for rules 2/3;
- server-side enforcement of the grid, and an UPDATE grant;
- carry-over across a cabinet change;
- touch support, and editing in `missing`, `outdated` or `does_not_fit`;
- bar labels, print, and Playwright e2e (test-plan Phase 3/4).

## Architecture / Approach

The pure model `src/lib/layout-editing.ts` holds units, moves, snapping, history, the payload parser
and carry-over, all ruled by `validateLayout`. Storage adds one column and two optional RPC
parameters, and `POST /api/projects/[id]/placements` re-validates and saves. The circuits and rematch
endpoints read the old layout before the RPC and carry it over. The `LayoutEditor` island
(`client:only`) reuses `CabinetDrawing` through optional, hook-free interaction props, and posts via
a hidden field, as `CircuitEditor` does.

## Phases at a Glance

| Phase                   | What it delivers                                             | Key risk                                                   |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| 1. Editing model        | Moves, snapping, history, parser, carry-over + property test | Reorder versus free-move semantics on edge geometries      |
| 2. Storage & write path | Flag migration, manual-save endpoint, carry-over, notices    | Backward-compatible RPC signature during the deploy window |
| 3. Editor island        | Pointer/keyboard editor, dirty state, controls, kitchen sink | SVG pointer mapping and keyboard accessibility             |
| 4. Docs & roadmap       | Tripwire, cookbook §6.5, S-09 note, GitHub sync              | —                                                          |

**Prerequisites:** S-05 done (archived 2026-10-07); a local Supabase stack on Docker; the `Mr1008` gh
account for the roadmap sync.
**Estimated effort:** ~4–5 sessions across 4 phases.

## Open Risks & Assumptions

- Any change to the device set beyond renames and identical re-matches resets a manual layout. The
  notice makes that visible, but it may feel harsh when a circuit is added.
- Placements filled from the rail end sit off the 0.5 TE grid, so the first move of such a device
  re-aligns it.
- No e2e test covers editing until test-plan Phase 3 bootstraps Playwright. Until then, manual
  browser checks and the property test carry the risk.

## Success Criteria (Summary)

- The electrician fixes a proposal in a few drags or keystrokes, saves, and gets re-routed wires and
  lengths.
- No edited layout that fails `validateLayout` is ever stored or drawn.
- Manual fixes survive a circuit rename or an identical re-match, and their loss is always announced.
