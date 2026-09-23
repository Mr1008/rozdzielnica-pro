# Plan: Cabinet preview clipping

## Overview

`CabinetDrawing` renders with `overflow-visible` and never clips, so any element that
`parseCabinetGeometry` rejects as outside the interior is painted outside the drawing's frame — in
the editor it spills below the preview card and over the text beneath it. Fix it in the drawing
component (the list page and the future printed quote reuse it) and mark elements with a geometry
issue in the editor preview.

Refs: https://github.com/Mr1008/rozdzielnica-pro/issues/13

## Current State

- `src/components/cabinets/CabinetDrawing.tsx` — hook-free, `viewBox` = interior in mm, no
  transform; `overflow-visible` on the `<svg>`; highlight outline drawn unclipped.
- `src/lib/cabinet-draft.ts` `isDrawable` — already accepts out-of-bounds/overlapping geometry
  (only NaN or non-positive sizes are undrawable), covered by `cabinet-draft.test.ts`. The editor
  falls back to `lastDrawable` only for half-typed fields. **Decision: keep it** — an out-of-bounds
  but complete geometry is previewed, clipped and marked.
- `src/components/cabinets/CabinetEditor.tsx` — computes `issues` per element but does not pass
  them to the drawing.

## Desired End State

- Nothing the drawing paints ever lands outside the interior rectangle, in every consumer.
- The `viewBox`/1 SVG unit = 1 mm contract and the no-transform rule (needed for S-06 pointer
  mapping) are unchanged.
- In the editor, every rail/entry/bar with a geometry issue is outlined in the destructive colour in
  the preview (its in-interior part), while the candidate itself is what the preview shows.
- Geometry validation rules are unchanged.

## What We're NOT Doing

- No change to `parseCabinetGeometry`, `isDrawable` or any validation rule.
- No new user-facing text: the marks reuse the issue list already shown next to each element card.

## Phase 1: Clip the drawing and mark invalid elements

### Changes Required

- New `src/lib/cabinet-drawing.ts` (+ `cabinet-drawing.test.ts`): pure helpers moved out of / added
  for the drawing — `entryRect` (moved from the component), `elementRect(geometry, element)`,
  `clipRect(rect, interior)` (intersection with the interior, `null` when empty),
  `clampRect(rect, interior)` (squashes a wholly-outside rectangle onto the edge it lies beyond) and
  `issueElements(issues)` (distinct element refs of issues that carry one).
- `CabinetDrawing.tsx`: content goes inside a nested `<svg x=0 y=0 width height>` (overflow hidden
  by default, no `viewBox`, so no scaling and no transform — the coordinate system is identical to
  the outer one and no page-unique `clipPath` id is needed). The frame stroke, the highlight and the
  new `invalid` outlines are drawn on top, from `clipRect`-ed rectangles. The outer `<svg>` keeps
  `overflow-visible` so the frame hairline and outlines on the edge are not half-cut; the most that
  can reach past the frame is half an overlay stroke. New optional prop
  `invalid?: readonly { kind; index }[]`, drawn with `stroke-destructive` and a light
  `fill-destructive/15` tint; an invalid element with nothing inside the interior (the repro's rail 3,
  y = 350 > 300) gets a dashed destructive line on the edge it lies beyond (`clampRect`).
- `CabinetEditor.tsx`: pass `invalid={issueElements(issues)}` only when the candidate itself is
  what is drawn (`candidateDrawable`) — the stale fallback's indices might not match.

### Success Criteria

#### Automated

- `npm run test:unit`
- `npm run lint`
- `npx astro check`

#### Manual

- Editor `/admin/cabinets/new`, repro geometry (400 × 300 × 100, rails y = 100/225/350, length 400):
  rail 3 is clipped to the interior, outlined red, and nothing overlaps the text under the card.
- `/admin/cabinets` list thumbnails still render correctly.

## References

- `context/changes/cabinet-preview-clipping/change.md`
- `context/archive/2026-09-23-admin-cabinet-catalog/` (origin of the drawing; read-only)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Clip the drawing and mark invalid elements

#### Automated

- [x] 1.1 Pure drawing helpers with unit tests — b51cdd0
- [x] 1.2 CabinetDrawing clips to the interior and outlines invalid elements — b51cdd0
- [x] 1.3 Editor passes invalid elements to the preview — b51cdd0
- [x] 1.4 Unit tests, lint and astro check pass — b51cdd0

#### Manual

- [x] 1.5 Repro geometry clipped and marked in the editor preview — b51cdd0
- [x] 1.6 Cabinet list thumbnails unchanged — b51cdd0
