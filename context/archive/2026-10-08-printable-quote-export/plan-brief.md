# Printable Quote Export (S-09) — Plan Brief

> Full plan: `context/changes/printable-quote-export/plan.md`

## What & Why

The electrician prints the quote, or saves it as PDF, as a client-facing document. It holds the
company letterhead, an itemised material list, the labour cost, the totals and the cabinet drawing with
its wires. This closes FR-012 and US-01, the product's main success criterion: the electrician finally
leaves the tool with an artifact. The edge runtime rules out a server-side PDF, so the browser
produces it.

## Starting Point

S-08 computes the quote (`computeQuoteView`, aggregates only). S-05 stores the layout and renders it as
server-side SVG (`CabinetDrawing`, built for greyscale). No print CSS exists, and there are no company
details anywhere. S-06 (manual editing) is not built yet. The print reads stored placements, so S-06
edits will flow in later with no change here.

## Desired End State

A "Drukuj wycenę" link on the quote section opens `/dashboard/projects/[id]/print`. It shows an
A4-sized document, a print / save-as-PDF button, and notices meant for the screen only. The printout is
two A4 portrait pages: letterhead and costs, then the drawing with its legends. The page refuses to
show any amounts or drawing unless the quote is `ready` and the layout is `placed`, and links to the fix
instead. The electrician edits company details on the profile page.

## Key Decisions Made

| Decision             | Choice                                                                   | Why (1 sentence)                                                                         |
| -------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| S-06 ordering        | Plan S-09 now                                                            | The print depends on stored placements, not on how they were made.                       |
| Mechanism            | Dedicated print route + `window.print()`                                 | No dependencies, the SVG stays vector, and the browser handles PDF export.               |
| Gating               | Quote `ready` **and** layout `placed`                                    | FR-012 makes the visualisation mandatory.                                                |
| Material detail      | Itemised per catalog device; totals only from `computeQuoteView`         | The client can check it; an invariant test keeps it from becoming a second price source. |
| Letterhead           | New owner-only `business_profiles` (company, NIP, address, phone, email) | The admin can read `profiles`, so the data needs an isolated table.                      |
| Missing company data | Print anyway, fall back to name/email, screen-only nudge                 | Cosmetic data never blocks the core flow.                                                |
| Labour on paper      | Time, rate, cost; the outdated-override warning is screen-only           | The pricing internals stay off the client document.                                      |
| Pages                | A4 portrait, drawing on its own page, no wire-lengths table              | Avoids the "SVG split across pages" pre-mortem risk.                                     |
| Implementers         | Sonnet for every phase, with narrow contracts                            | User directive; Opus only if print fidelity resists twice.                               |

## Scope

**In scope:**

- `business_profiles` migration, RLS, parser and profile-page card;
- `computePrintView` pure helper;
- `QuoteDocument.astro`, the print route and print CSS;
- the shared drawing builder and legend extraction;
- kitchen-sink states, landing copy, AGENTS/README.

**Out of scope:**

- a PDF library, server PDF;
- document number, VAT, logo;
- the wire lengths on paper;
- the formula and override markers on paper;
- S-06, S-11.

## Architecture / Approach

The print page assembles the same inputs as the project page and passes them to the pure
`computePrintView`, which returns `blocked` (with reasons) or `ready` (quote, itemised lines,
letterhead, notices). `QuoteDocument.astro` renders `ready` as A4 sheets and reuses `CabinetDrawing`,
a shared `buildLayoutDrawing` and `DrawingLegend`. The kitchen sink renders the same component, including
a greyscale copy, so the print layout can be checked on screen. `@media print` only hides the chrome
and sets `@page`, with `print-color-adjust: exact`.

## Phases at a Glance

| Phase                       | What it delivers                                            | Key risk                                      |
| --------------------------- | ----------------------------------------------------------- | --------------------------------------------- |
| 1. Company details — data   | Table, owner-only RLS, parser with NIP checksum, RLS test   | An isolation gap the tests do not assert      |
| 2. Company details — form   | Profile card + `/api/profile/business`                      | The two cards' banners colliding              |
| 3. Print view model         | `computePrintView`: gates, itemisation, letterhead, notices | Itemised sum drifting from the quote          |
| 4. Print page and document  | A4 document, route, print CSS, entry link, kitchen sink     | Drawing not fitting or losing colour in print |
| 5. Landing, docs, contracts | Landing copy, AGENTS tripwires, README routes               | —                                             |

**Prerequisites:** S-08 done. Local Supabase on Docker for Phase 1. S-06 not required.

**Estimated effort:** about 3–4 sessions across 5 small phases.

## Open Risks & Assumptions

- **Greyscale legibility** of rails, entries and the PE bar is unverified on paper (an existing roadmap
  open question). Phase 4 checks it on the kitchen-sink greyscale figure.
- **Browser print engines differ.** The plan targets Chromium print preview and Save as PDF.
- **The roadmap dependency on S-06 is relaxed.** US-01's "editable layout" criterion is still met only
  by S-06.

## Success Criteria (Summary)

- On a ready, placed project the electrician gets a clean two-page A4 PDF with costs and a legible
  drawing.
- Nothing is printable while the quote or the layout is not trustworthy.
- The company details print, and only the owner can read them.
