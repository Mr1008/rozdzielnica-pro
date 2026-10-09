# RCD Group Comb Busbars — Plan Brief

> Full plan: `context/changes/rcd-group-busbars/plan.md`

## What & Why

Comb busbars (listwy zasilające 1F/3F) feed the MCBs of an RCD group from the RCD's output. This is how
groups are actually mounted. Today the app draws and counts that connection as wire jumpers. GitHub
issue #17 was parked at S-05.

With busbars, the drawing and the printout look like a real switchboard. The replaced jumpers drop out
of the wire lengths, and the busbar is priced in the material.

## Starting Point

- The device kinds form a closed set in the PRD, the database CHECK and `parseDeviceSpec`.
- The matcher emits main switch → groups → ungrouped MCBs → catalog PE/N bars, and every snapshot row is
  placed on a DIN rail.
- The router emits one `feed` conductor per MCB terminal from the RCD. Every 1P MCB in a 3F group is fed
  from L1.
- The quote counts every snapshot row as a device and prices every row.

## Desired End State

- The admin keeps busbars in the catalog.
- The electrician sees busbar segments per RCD group in the match result. They are cut greedily from
  bought pieces, with offcuts reused across groups. The quote prices a piece once and counts each
  segment in labour.
- In the layout, the RCD stands with its N outward.
- The drawing shows a busbar with teeth on the phase terminals. On 3F busbars the 1P MCBs take the phase
  of their pin. N jumpers remain.
- A missing busbar never blocks: the group keeps its jumpers and shows a note.

## Key Decisions Made

| Decision                  | Choice                                                                                       | Why (1 sentence)                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Physical model            | Unplaced snapshot row on the terminals, no DIN width                                         | A real busbar takes no TE, and the editor moves nothing extra                |
| Catalog item              | Fixed pin count (width in TE = pins), 1F/3F as `poles` 1P/3P, rated current, price per piece | This is how busbars are bought, and no new `devices` column is needed        |
| Which groups              | RCD + ≥2 MCB; a 1-MCB group only from an offcut                                              | User rule: cut the surplus and reuse it where it fits, otherwise it is waste |
| Cutting                   | Greedy first-fit decreasing, computed at match time                                          | A predictable heuristic, no optimiser (PRD Non-Goals)                        |
| Compliance filter         | Phases match, pins ≥ group width in TE, In ≥ group RCD's In                                  | The busbar is never the weak link, consistent with the guardrail             |
| Missing busbar            | Keep the jumpers, informational note, no gap                                                 | Jumpers are a correct supply, so a missing busbar is no blocker              |
| Group wider than any rail | Jumpers, informational note                                                                  | Rare, and keeps matching independent of the layout                           |
| 3F phases                 | Pin = phase (1P MCBs spread over L1/L2/L3)                                                   | Matches a real 3F busbar                                                     |
| N conductor               | Stays a wire jumper; busbars carry phases only                                               | One busbar type, no L+N variants                                             |
| N under a pin             | RCD at the group end that puts its N outward; teeth broken off only as a last resort         | User rule: reversing the order avoids breaking teeth                         |
| Labour                    | Each segment counts as a device; pieces count only in material                               | Mounting a segment is real work                                              |
| Seed                      | 1F/3F × 12/54 pins, 63 A                                                                     | Covers cutting and both phase counts                                         |
| Existing projects         | Read stale until "Dobierz ponownie"                                                          | The safe direction, with no data migration                                   |

## Scope

**In scope:**

- the new kind `comb_busbar` (migrations, guard, editor, seed);
- the cutting module;
- the `busbar` snapshot role with `busbar_piece`;
- quote and print changes;
- the layout exclusions and the RCD orientation;
- router and drawing in both variants, print and legend;
- PRD, `AGENTS.md`, roadmap S-12, kitchen sink and landing.

**Out of scope:**

- busbars with N;
- busbars for the main switch, RCBOs or ungrouped MCBs;
- busbars split across rails;
- an exact cutting optimiser;
- pricing per pin and reusing offcuts across projects;
- busbar dragging in the editor;
- rewriting existing snapshots.

## Architecture / Approach

A new pure module, `busbar-cutting.ts`, turns per-group demands (phases, pins, minimum In) and the
catalog into segments with piece numbers. `matchDevices` appends them as `busbar` selections after the
catalog bars, so earlier indices stay stable. Staleness, `saveCircuitsArgs` and the snapshot all follow
from the matcher.

The segments carry `rcd_group_id` but no placement. The RPC already skips rows without one. Every layout
group check must exclude them.

The router skips the phase jumpers of busbar groups and emits a busbar geometry, which the drawing
paints between the devices and the wires.

## Phases at a Glance

| Phase                           | What it delivers                                                          | Key risk                                                             |
| ------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1. Busbar device kind           | The admin maintains busbars; PRD, `AGENTS.md` and roadmap updated         | The enum value must sit in its own migration; both guards must match |
| 2. Selection, cutting and quote | Segments in the match result, pieces in the quote                         | Quote dedup must keep the print-sum invariant                        |
| 3. Layout                       | Segments unplaced, RCD with its N outward                                 | Busbar rows carry `rcd_group_id` and leak into the group checks      |
| 4. Wiring and drawing           | Busbar replaces the phase jumpers, 3F pin phases, both variants and print | Router changes break the pinned jumper tests                         |
| 5. Kitchen sink, landing, docs  | Every new state visible, docs and tripwires                               | —                                                                    |

**Prerequisites:** S-11 done (it is); a local Supabase on Docker for migrations, `db:types` and
integration tests; the `Mr1008` gh account for the roadmap sync.
**Estimated effort:** ~5 sessions, one per phase.

## Open Risks & Assumptions

- Assumes `save_project_layout` accepts unplaced rows. Phase 3 checks its body and extends the Phase 2
  migration if it does not.
- Assumes device terminals sit at `DIN_MODULE_MM` pitch, so pin = module. A device whose width is not a
  whole number of TE maps terminals to pins by x position.
- The production catalog has no busbars until the admin adds them. Until then every group shows the
  "brak listwy" note.

## Success Criteria (Summary)

- Busbar groups in a project show busbars instead of phase jumpers, in the drawing and on the printout.
- The quote prices bought pieces once, with offcuts reused, and counts the segments in labour.
- No busbar is ever below the group RCD's rating, and a missing busbar never blocks matching.
