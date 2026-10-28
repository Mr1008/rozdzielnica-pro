---
change_id: testing-layout-quote-invariants
title: Test-plan phase 4 - layout and quote invariants (risks 4 and 5)
status: implemented
created: 2026-10-28
updated: 2026-10-28
archived_at: null
---

## Notes

Rollout Phase 4 of `context/foundation/test-plan.md` ("Layout and quote invariants", risks #4 and #5).

- #5 (main gap): prove the quote from hand-computed examples of the PRD formula — (device count × average mount time) + per-project overhead = minutes; minutes × rate rounded half-up in integers = labour cost; catalog prices = material cost; a missing pricing profile blocks; an override changes the cost. Challenge "device count = list length" (catalog bars and comb busbar segments count as devices; a busbar piece is priced once per distinct `(device_id, busbar_piece)`). Avoid an oracle copied from the code. Say whether `src/lib/quote.test.ts` expectations are independent; fill test-plan §6.5 "Quote: TBD".
- #4: largely delivered (`src/lib/layout-editing.property.test.ts`, `tests/e2e/layout-manual-edit.spec.ts`) — inventory; add only a real gap (e.g. the proposal itself always passes `validateLayout`, incl. single-circuit group → RCBO).
- Optional: dated multimodal visual review of the drawing/printout only if no deterministic check catches the regression.
- Phase 3 already covers the labour-override endpoint (`tests/e2e/quote-override.spec.ts`) — do not redo.
