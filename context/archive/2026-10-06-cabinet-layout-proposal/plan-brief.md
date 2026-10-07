# Cabinet Layout Proposal — Plan Brief

> Full plan: `context/changes/cabinet-layout-proposal/plan.md`

## What & Why

Roadmap S-05, the north star: after S-04 matches the devices, the system places them on the DIN rails
of the project's cabinet and draws the result, wired. If the proposal needs only spot fixes, the tool
beats a spreadsheet; if not, it is just a calculator. This plan also closes PRD Open Question #2 —
which placement rule wins when they disagree.

## Starting Point

S-04 stores the matched devices as an immutable snapshot (`project_devices`) with widths and poles,
but no placement. The cabinet snapshot has rails, entries and PE/N bars; circuits carry an entry
side. `CabinetDrawing` draws only the empty cabinet. The catalog does not record where a device's
N pole sits (#15).

## Desired End State

A "Układ w szafce" section shows, whenever the match is current, the cabinet with every device on
its rail, grouped by RCD, wires drawn with sag, and a table of conductor lengths (15% slack
included). If the devices do not fit, a clear error states the shortfall in modules (TE). A cabinet
change or an invalid stored layout is flagged with "Zaproponuj układ ponownie". Admins set each
device's N-terminal side. The landing hero shows a wired demo layout.

## Key Decisions Made

| Decision             | Choice                                                                                    | Why (1 sentence)                                                           |
| -------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Rule precedence      | Strict 1 > 2 > 3: grouping hard, entry side orders groups, PE/N distance only breaks ties | Every placement is explainable in one sentence and testable as invariants  |
| Storage              | New `project_device_placements` table, written atomically with the match                  | S-06 starts from a real data model; never a matched set without a layout   |
| Staleness            | Cleared on cabinet change (trigger) + validated on every render                           | A stored row is not proof of validity (S-04 lesson)                        |
| When shown           | Only when the match is `current`                                                          | Same contract as S-08/S-09 — never draw devices that may not comply        |
| Overflow             | Block with required vs available TE; devices still stored, no placements                  | All-or-nothing, like the matcher                                           |
| Group split          | Only when a group is wider than every rail                                                | Rule 1 holds in every realistic house group                                |
| Main switch / no-RCD | FR first on the rail nearest the cabinet's first entry; ungrouped MCBs as the last block  | Common practice; WLZ entry side assumed = first entry (stated in UI)       |
| Mixed entry sides    | Majority side of the group's circuits, tie → earliest circuit                             | Follows most of the group's cables; deterministic                          |
| Spacing              | 1 TE gap between groups on each rail that has room for all its gaps; else packed          | Visual grouping without ever causing "does not fit"                        |
| Wires                | Circuit cables in, WLZ → main switch, feeds between devices; orthogonal routes with sag   | User wants a realistic wired board                                         |
| Slack                | 15% of routed length (`WIRE_SLACK_RATIO`), no minimum                                     | User's (electrician's) standard reserve                                    |
| Lengths              | Table of total length per cross-section; feeds at the WLZ cross-section                   | Useful for ordering wire; feeds sized conservatively                       |
| N in RCD groups      | Circuit N runs to its RCD's outgoing N, never the shared N bar; TN-C draws PEN to PE bar  | A neutral bypassing the RCD trips it — drawing it otherwise would be wrong |
| N-terminal side      | Catalog enum left/right, required for N-carrying poles, guarded twice, backfilled `left`  | Closes #15; layout rule 3 and N wires need it                              |
| Deploy ordering      | Phase 0: deploy from Actions after `migrate` (Workers Builds off)                         | New code must never meet the old schema (review F1)                        |
| Slice split          | One change, seven phases (0–6); placement before wires                                    | North-star placement lands and is tested first                             |

## Scope

**In scope:** N side in catalog + snapshot; pure `proposeLayout`/`validateLayout`; placements table,
RPC extension, layout-only re-propose; layout states on the project page and kitchen sink; device
and wire drawing; lengths table; landing hero; AGENTS/PRD/roadmap updates.

**Out of scope:** manual editing (S-06), optimiser, comb busbars or bar selection, phase balancing,
cable cost in the quote, WLZ entry-side field, reserve %, print styles (S-09), matcher changes.

## Architecture / Approach

Pure modules mirror the matcher: `cabinet-layout.ts` (propose + validate), `cabinet-wiring.ts`
(routes + lengths), `layout-server.ts` (load, `computeLayoutView`, RPC args). The circuits/rematch
endpoints compute the layout after a `matched` result and pass placements to the extended
`save_project_circuits` (one transaction). The page renders `CabinetDrawing` with a device layer and a
wire layer, server-side, all colours from tokens.

## Phases at a Glance

| Phase                   | What it delivers                                                 | Key risk                                                         |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| 0. One pipeline         | Actions: migrate → deploy; Workers Builds auto-deploy off        | Needs Cloudflare API token + one dashboard step                  |
| 1. N side in catalog    | Field guarded by CHECK + parser, editor, snapshot, seed          | Old editor briefly cannot add N-carrying devices (deploy-length) |
| 2. Placement logic      | `proposeLayout`/`validateLayout` with invariant + property tests | Precedence edge cases on unusual geometries                      |
| 3. Storage & write path | Placements table, RPC, re-propose endpoint, layout states        | Worker CPU budget on render                                      |
| 4. Drawing              | Device layer, "Układ w szafce" section, kitchen sink             | Legibility at small scale and in greyscale                       |
| 5. Wires                | Routing, sag, 15% slack, lengths table                           | Clutter on 20+ circuits; routing realism                         |
| 6. Landing & docs       | Wired demo hero, tripwires, OQ#2 closed, roadmap synced          | —                                                                |

**Prerequisites:** S-04 done (it is); local Supabase on Docker; Mr1008 gh account for the roadmap sync.
**Estimated effort:** ~5–7 sessions across 6 phases.

## Open Risks & Assumptions

- WLZ entry side is assumed to be the cabinet's first entry.
- Backfilled `left` N sides on existing cloud devices are guesses until the admin reviews them.
- Every circuit save replaces placements — S-06 must decide whether manual edits survive a re-match.
- Feeds use the WLZ cross-section in the lengths table — conservative, not measured.

## Success Criteria (Summary)

- On all three starter cabinets the proposal visibly follows rules 1–3 and needs at most spot fixes.
- No proposed or stored layout that fails `validateLayout` is ever drawn as valid.
- The wired drawing reads like a real board, also in greyscale, with plausible lengths.
