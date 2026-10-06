<!-- PLAN-REVIEW-REPORT -->

# Plan Review: Cabinet Layout Proposal (S-05)

- **Plan**: context/changes/cabinet-layout-proposal/plan.md
- **Mode**: Deep
- **Date**: 2026-10-06
- **Verdict**: REVISE → SOUND after triage (8/8 fixed)
- **Findings**: 0 critical, 6 warnings, 2 observations

## Verdicts

| Dimension             | Verdict |
| --------------------- | ------- |
| End-State Alignment   | PASS    |
| Lean Execution        | PASS    |
| Architectural Fitness | WARNING |
| Blind Spots           | WARNING |
| Plan Completeness     | WARNING |

## Grounding

20/20 paths ✓, 6/6 symbols ✓, brief↔plan ✓, Progress↔Phases ✓

## Findings

### F1 — Deploy race in the other direction: new code before the migration

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 / Migration Notes
- **Detail**: If the Worker deploys before db-migrate, `select("*")` rows lack `n_terminal_side`, `parseDeviceSpec` reports `required`, and `activeCatalog` (device-matching.ts:124-136) silently drops every N-carrying device (all RCD/RCBO, FR 2P/4P). The matcher reports gaps, and a circuit save in that window stores an empty snapshot.
- **Fix**: Two pushes — migration alone first, then parser/editor/fixtures once db-migrate is green.
- **Decision**: FIXED — differently: new Phase 0 deploys from Actions after `migrate` (Workers Builds auto-deploy off)

### F2 — Existing project_devices snapshots get NULL n_terminal_side

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1, Phase 2 `LayoutDevice`
- **Detail**: Only `devices` is backfilled; legacy snapshots stay `current` (staleness compares role/deviceId/groupId/circuitId/notes only) yet carry NULL, which rule 3 and the wiring read.
- **Fix**: Backfill `project_devices.n_terminal_side` from `devices` in the same migration; contract: never NULL on N-carrying poles.
- **Decision**: FIXED — differently: no backfill; before the Phase 1 push, check prod via Supabase MCP and truncate `project_devices` if any rows exist; local `db reset`

### F3 — Rule 3 measures conductors the wiring rule says don't exist

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Precedence record "Rule 3" vs Phase 5 "N routing"
- **Detail**: Rule 3 scores block N terminals → N bar and block centre → PE bar, but Phase 5 routes grouped N to the RCD, only the RCD line-side N to the N bar, and circuit PE entry → PE bar without touching devices.
- **Fix**: Define rule 3 over the line-side N terminal (RCD/RCBO; ungrouped N-carrying MCBs) → nearest N-bar terminal group; keep PE term as an explicit PRD proxy.
  - Strength: rule 3 and Phase 5 share one model.
  - Tradeoff: terminal x positions pulled into Phase 2.
  - Confidence: MED — PE term is a judgement call.
  - Blind spot: whether PE should be weighted at all.
- **Decision**: FIXED — rule 3 N term over routed N-bar conductors, PE term kept as declared proxy, shared `deviceTerminals` helper

### F4 — Composite FK target and trigger column list missing

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3 §1, Phase 1 §1
- **Detail**: `project_devices` has no UNIQUE (project_id, id), so the composite FK fails; the snapshot trigger's explicit `select … into new.*` lists must gain the column; RETURNING must be joined on `position`.
- **Fix**: Add `project_devices_project_id_id_key unique (project_id, id)`; name both trigger lists; specify a writable CTE joined on `position = ordinality - 1`.
- **Decision**: FIXED

### F5 — No test can reach the vertical-collision branch

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §2, "Fit"
- **Detail**: No seed rail rejects an 85 mm centred device, so tests on seed geometries never exercise rail rejection; "adjacent rail" undefined (seed (c) has two rails in one row).
- **Fix**: Hand-built fixtures (bar in a device band, top rail near edge, pitch < 85 mm); define collision as overlapping device rects on different rails.
- **Decision**: FIXED

### F6 — Blast radius of the new device parameter not listed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 1 §4–5
- **Detail**: Unlisted files that break under the new CHECK/column: tests/integration/rls-circuits.test.ts, device-matching-server.test.ts, kitchen-sink SnapshotRows, src/pages/admin/devices/[id].astro, src/pages/api/admin/devices/index.ts, src/pages/api/admin/devices/[id]/index.ts.
- **Fix**: List them in Phase 1 §4 and Phase 3 §4.
- **Decision**: FIXED

### F7 — Gap insertion is ambiguous with mixed fill directions

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: "Gaps"
- **Detail**: With main switch at a rail end plus left- and right-filled blocks, the plan does not say which blocks shift to open gaps.
- **Fix**: State "blocks keep their anchor end; gaps open toward the rail's free middle".
- **Decision**: FIXED

### F8 — The CPU budget is measured before the wiring exists

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 3 §5
- **Detail**: Render runs matchDevices + validate (+ propose) + Phase 5 routing; Phase 3 times only layout + validate.
- **Fix**: Repeat the timing in Phase 5 with routing, with a Progress item.
- **Decision**: FIXED — Phase 5 timing (5.7) + named fallback: wiring to a client island; match/validation never leave the server
