# Realistic Wiring Render — Plan Brief

> Full plan: `context/changes/realistic-wiring-render/plan.md`

## What & Why

Roadmap S-11 (issue #32). The cabinet wiring drawing should look like a real, professionally wired
switchboard. The target is the "uber pro" reference photo, `rozdzielnica-z-opaskami.webp`: true-scale
conductors gathered into tied packs along the side walls, ferrules on terminals, and bends sized to
the wire. The schematic view stays available, for greyscale print (S-09 decides) and as an on-screen
view.

## Starting Point

- **Drawing.** Wires already have 30 % slack, rounded bends, sag and cable sheath stubs. Stroke widths
  are fixed screen pixels per conductor kind, not per cross-section.
- **Router.** `cabinet-wiring.ts` spaces every parallel wire on a uniform 3 mm grid and has no side
  packs. When there is no room it squeezes wires together without reporting it.
- **CPU.** Measured locally, the worst-case render already sits at ~8–10 ms of the 10 ms Worker CPU
  budget.

## Desired End State

**Realistic view (default, everywhere on screen).**

- Conductors are drawn at their true outer diameter, and the WLZ is clearly the thickest.
- Circuit and WLZ cores run in tied side packs and branch to their rows.
- Ferrules are coloured by cross-section.
- Where packs cannot fit, the extra wires run behind the rail ends and a Polish informational warning
  says so. Nothing is blocked.

**View switch.** A "Widok: realistyczny / schematyczny" switch on the project page shows the same routes
schematically.

**Lengths.** The lengths table reflects the new routes.

**CPU.** The budget has been verified on real Cloudflare.

## Key Decisions Made

| Decision             | Choice                                                                  | Why (1 sentence)                                                                  |
| -------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Realism level        | "Uber pro": tied side packs                                             | The user wants it to look like the professional reference board.                  |
| Thickness            | True outer diameter; spacing per conductor (rA + rB + 0.5 mm)           | Physically faithful; the cost is routes and lengths change.                       |
| Pack scope           | All circuit cable cores (L/N/PE, incl. to bars) + WLZ; feeds stay local | Matches both reference photos; avoids long detours for 10 cm bridges.             |
| Overflow             | Second layer behind rail ends + informational warning                   | Wiring is display-only, so it must never block a layout or quote.                 |
| Diameters / ferrules | Transcribed table with cited source, verified by the user               | The same proven pattern as `AMPACITY_A`.                                          |
| Runtime              | Server, measured on Cloudflare; client island if over budget            | Local timings are unreliable; rule: median ≤ 8 ms, max ≤ 10 ms on the worst case. |
| Measuring            | Separate throwaway bench Worker + `wrangler tail` / Workers Logs        | Production is never touched; Worker timers don't advance during computation.      |
| Variants             | One router, `realistic` / `schematic` drawing variants                  | One set of lengths; S-09 picks the print variant.                                 |
| On-screen view       | Realistic everywhere + project-page switch (`?wiring=schematic`)        | The server renders only one variant, so no doubled CPU.                           |
| Order                | Plan now, build after S-09                                              | MVP-critical print ships first; S-11 is post-PRD polish.                          |

## Scope

**In scope:**

- Bench Worker and Cloudflare measurements.
- `wire-dimensions.ts` with new tokens.
- Router rewrite: true-scale spacing, side packs, overflow flag and warning.
- Realistic drawing: bodies, sheen, ferrules, ties, sheaths, bends.
- Schematic variant and legends.
- View switch, landing hero, kitchen-sink states, AGENTS.md and roadmap.
- Client island only if over budget.

**Out of scope:**

- Layout heuristic, validation and states.
- Any database change.
- `WIRE_SLACK_RATIO`.
- Print styles (S-09).
- Per-manufacturer diameters.
- Pack fill or bend-radius standard checks.
- 3D.
- Packing the feeds.

## Architecture / Approach

The router stays the single source of geometry.

**Spacing.** The nudging stage (`cabinet-wiring.ts` ~524–1081) is rewritten to space tracks by
conductor diameters from `wire-dimensions.ts`. Compression is marked as `squeezed`, not hidden.

**Side packs.** The router gains left and right pack strips, between the wall or a vertical bar and the
rail ends. Circuit and WLZ cores route entry → lane → pack → row channel → terminal. Inside a pack, the
conductor that exits first sits innermost, so branches never cross.

**Overflow.** Overflow goes behind the rail ends and is flagged on each `Conductor`. `wiringWarnings()`
reports it.

**Drawing.** `cabinet-drawing.ts` derives everything visual from `Conductor.path` without changing it:
ties, ferrule ends, diameter-sized bends and sheath widths. `CabinetDrawing` renders either variant.

**CPU.** Measurements bracket the router work (before, after, and with the realistic SVG).

## Phases at a Glance

| Phase                              | What it delivers                                                | Key risk                                                         |
| ---------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1. Cloudflare CPU bench + baseline | Bench Worker, shared fixtures, today's CPU on Cloudflare        | No CPU field in tail/logs → needs the Cloudflare MCP             |
| 2. Wire dimensions data            | Diameter / sheath / ferrule tables + tokens, user-verified      | Transcription errors; waits on the user's check                  |
| 3. Router: true-scale spacing      | Per-conductor track spacing, `squeezed` marking                 | Rewrite of the nudging stage; test rework                        |
| 4. Router: side packs + overflow   | Packs, side rule, no crossings, overflow warning                | Seed cabinets have only 10–30 mm per side → frequent overflow    |
| 5. Re-measure + runtime decision   | Router v2 numbers; server or client island                      | Over budget → island, and S-09 print must wait for the SVG       |
| 6. Realistic + schematic drawing   | Bodies, sheen, ferrules, ties, sheaths, legends                 | ~3× SVG paths; greyscale must stay legible in the schematic view |
| 7. Switch, warning, landing, docs  | `?wiring=` switch, warning UI, kitchen sink, AGENTS.md, roadmap | Landing hero legibility at small size                            |

**Prerequisites:**

- S-09 shipped.
- The user's Cloudflare access for the bench deploy and delete, confirmed per action.
- The `Mr1008` gh account for the roadmap mirror.

**Estimated effort:** ~5–7 sessions; Phases 3–4 are the heavy ones.

## Open Risks & Assumptions

- The Cloudflare per-invocation CPU field is assumed reachable via `wrangler tail` or Workers Logs.
  Phase 1 verifies this, with the Cloudflare MCP as the fallback.
- The worst-case 60-circuit project will overflow at true scale on every seed cabinet. The drawing
  there is a deliberate simplification, made visible by the warning.
- Wire lengths change for existing projects on the next render. They are not part of the quote
  amounts.
- If a client island is chosen, S-09's print must wait for the rendered SVG. This is recorded in Phase 5
  for S-09's follow-up.

## Success Criteria (Summary)

- The electrician sees a drawing that reads like the reference board: true-scale wires, tied side
  packs, ferrules. They can switch to the schematic view.
- Lengths and both views come from one router, and overflow is reported, never hidden or blocking.
- The worst-case render fits the Worker CPU budget, as measured on Cloudflare, or the wires are routed
  in the browser.
