# Test-plan Phase 4 — Layout and Quote Invariants — Plan Brief

> Full plan: `context/changes/testing-layout-quote-invariants/plan.md`
> Research: `context/changes/testing-layout-quote-invariants/research.md`

## What & Why

The last rollout phase of `context/foundation/test-plan.md`: risks #4 (an impossible layout) and #5 (a
wrong quote). The quote arithmetic is already proven with hand-worked literals, but every test feeds
it rows the test wrote itself — so "the device count is the list length" is assumed, never checked
against a real project's bill of materials. The layout property tests never touch the production
cabinets.

## Starting Point

`src/lib/quote.test.ts` (independent literals), `cabinet-layout.property.test.ts` and
`layout-editing.property.test.ts` (seed + synthetic geometries), `layout-manual-edit.spec.ts`,
`quote-override.spec.ts`. No production code changes are expected.

## Desired End State

Four small projects run through the real matcher into the quote and match a bill of materials counted
by hand; the rounding and formula hold over arbitrary inputs; proposals and edits stay valid on all 33
Karwasz cabinets; test-plan Phase 4 is `complete` with a quote cookbook pattern and a dated visual
review.

## Key Decisions Made

| Decision             | Choice                                                                         | Why (1 sentence)                                         | Source   |
| -------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- | -------- |
| Quote oracle         | Hand-counted BOM through `matchDevices`, literals with the working in comments | Challenges the count without copying the formula         | Research |
| Rounding oracle      | Definition of half-up, in BigInt                                               | Independent of `(m·r + 30) div 60`                       | Plan     |
| Layout gap           | Add Karwasz geometries to both property tests                                  | The production geometries were never proposed on         | Research |
| Second layout oracle | Not added                                                                      | §6.5 keeps `validateLayout` the single definition        | Research |
| New e2e              | None                                                                           | Override covered in Phase 3; page renders the view as is | Research |
| Interview            | Skipped (settled input; parent asked for an uninterrupted chain)               | Research resolved every decision                         | Plan     |

## Scope

**In scope:** `quote.examples.test.ts`, `quote.property.test.ts`, Karwasz geometries in both layout
property tests, test-plan §3/§4/§6.5/§6.6, a 1–2-screen visual review on `/dev/kitchen-sink`.

**Out of scope:** production code, new e2e specs, `test-stack.md`, `astro check`.

## Architecture / Approach

Unit tests only. Fixture catalogs copied from the matcher suite's helpers; selections mapped to quote
rows by catalog id (what the snapshot trigger copies); every new test checked against a deliberate
break.

## Phases at a Glance

| Phase                           | What it delivers                                                      | Key risk                                   |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| 1. Quote worked examples        | 4 hand-BOM projects + no-profile + override through matcher and quote | Hand arithmetic errors — re-check each sum |
| 2. Quote property test          | Rounding vs definition; metamorphic relations                         | Generators too narrow to matter            |
| 3. Karwasz in layout properties | 33 production geometries proposed on and edited                       | Run time; vacuous small cabinets           |
| 4. Close-out + visual review    | test-plan updated, dated review                                       | Dev server availability                    |

**Prerequisites:** none beyond `npm run test:unit`; the dev server for the visual review.
**Estimated effort:** one session, four commits.

## Open Risks & Assumptions

- A new test may expose a real defect; it is reported and fixed separately, never by loosening the test.
- Small Karwasz cabinets (RN-6-P, 105 mm of rail) may fit few generated sets — the guard is per geometry.

## Success Criteria (Summary)

- A wrong device count or a per-segment busbar price fails a test derived by hand from the PRD.
- Proposals and edits on every production cabinet pass `validateLayout`.
- test-plan §3 Phase 4 reads `complete`, with the quote pattern in §6.5.
