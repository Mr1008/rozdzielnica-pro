---
date: 2026-09-25T13:31:10+02:00
researcher: Jakub Michałek (with Claude Opus 5.5)
git_commit: 9e04e95e13b677ac19944b113cb19e4f6b16bc15
branch: master
repository: Mr1008/rozdzielnica-pro
topic: "UI layout & theme audit — design-system contract, charges, motif and target view"
tags: [research, ui, theme, tokens, tailwind, shadcn, layout, cabinet-drawing, print]
status: complete
last_updated: 2026-09-25
last_updated_by: Jakub Michałek (with Claude Opus 5.5)
---

# Research: UI layout & theme audit

**Date**: 2026-09-25T13:31:10+02:00
**Researcher**: Jakub Michałek (with Claude Opus 5.5)
**Git Commit**: 9e04e95e13b677ac19944b113cb19e4f6b16bc15
**Branch**: master
**Repository**: Mr1008/rozdzielnica-pro

## Research Question

`change.md` carries no intent beyond the id `ui-layout-theme`, so the question is taken from the
M2-L5 contract in `CLAUDE.md:40-71`: locate this repo's **value source** (tokens) and **shared
components**, map which views read them, list the **charges** (missing tokens / missing shared
component / accidental architecture — file, line, user impact), and pick a **named motif** and one
target view — so `/10x-plan` can plan "global tokens + one view", not an MVP rebrand.

## Summary

- **The repo has a design system on paper, and none of the views use it.** `src/styles/global.css:6-111`
  holds the shadcn "new-york" neutral token set (light `:root`, unused `.dark`) mapped through
  Tailwind v4 `@theme inline`, and `src/components/ui/button.tsx` is the one shadcn component. But
  all 15 product/auth pages plus `Welcome.astro` paint over the token-driven `body` with the
  starter's `bg-cosmic` hex gradient (`global.css:113-115`) and hardcode `text-white`, `white/NN`,
  `blue-100/NN`, `purple-*`, `amber-*`, `red-*`. Across the 35 inspected view files the only token
  classes outside `button.tsx` are three `destructive` classes in `CabinetDrawing.tsx:168,181`.
- **`Button` is imported in 4 files and colour-overridden at every call site** (`SubmitButton.tsx:18`,
  `CabinetEditor.tsx:712`, `DeviceEditor.tsx:521`, `fields.tsx:171-185`); no `.astro` file uses it
  or `buttonVariants`. So the declared system and the rendered UI are two different systems.
- **No prior decision exists** to keep or drop the cosmic look — it spread because each slice copied
  the previous page. The only standing styling decisions are: the cabinet drawing uses Tailwind
  tokens for errors and is the component the S-09 printed quote will reuse
  (`context/archive/2026-09-23-admin-cabinet-catalog/plan.md:85,297,301`), and the drawing must be
  printable (`roadmap.md` S-09).
- **No visual-test infrastructure exists** (no Playwright/Storybook/kitchen sink/baselines; CI is
  lint + `astro check` + unit + build + HTTP smoke). Per `CLAUDE.md:64` the gate is a kitchen-sink
  page screenshotted by hand, not a new screenshot test.
- **Recommended target view:** `/dashboard/projects/[id]` — the most hardcoded file (43 colour
  classes), the core electrician screen, host of the drawing, and the page S-04–S-09 will grow.
- **Recommended motif (candidate, needs user confirmation):** _"Arkusz techniczny"_ — light
  technical-drawing paper: off-white surfaces, hairline borders, one saturated accent, domain colours
  (PE green-yellow, N blue) kept as named tokens. Rationale in Architecture Insights.

## Detailed Findings

### 1. Value source (tokens)

- `src/styles/global.css:6-39` — light `:root` shadcn neutral tokens (`--background` white,
  `--primary` near-black `oklch(0.205 0 0)`, `--ring` grey `oklch(0.708 0 0)`, `--destructive`, 5
  chart and 8 sidebar tokens).
- `global.css:41-73` — `.dark` token set; `global.css:4` declares `@custom-variant dark`. Nothing in
  `src` applies `.dark` (no toggle, no `prefers-color-scheme`; `Layout.astro:15` is
  `<html lang="pl">` with no class), so the 7 `dark:` variants in `button.tsx` are inert.
- `global.css:75-111` — `@theme inline` maps tokens to `--color-*` and `--radius-*`.
- `global.css:113-115` — `@utility bg-cosmic` (hex gradient `#0a0e1a → #0f1529`), a starter leftover
  used by 17 files (15 pages, `Welcome.astro`, `global.css`).
- `global.css:117-124` — base layer: `* { border-border outline-ring/50 }`, `body { bg-background
text-foreground }` — i.e. a white body every page then covers.
- **Missing roles:** no `success`, `warning`, `info` tokens; no surface-on-dark tokens; no font
  tokens (no font loading anywhere — only Tailwind's default `font-sans`); no domain tokens for the
  drawing.
- `src/components/Banner.astro:27-41` — the only alert component styles itself with 9 hex values in
  scoped CSS (light info/warning/error), outside the token system.

### 2. Shared components and who reads them

| Component                                                                                                                        | Defined                          | Consumers                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Button`/`buttonVariants` (shadcn)                                                                                               | `ui/button.tsx:7-50`             | `SubmitButton.tsx`, `forms/fields.tsx`, `CabinetEditor.tsx`, `DeviceEditor.tsx` — all override colours; `buttonVariants` unused |
| `LibBadge.astro`                                                                                                                 | `ui/LibBadge.astro`              | none (grep over `src`) — dead starter code                                                                                      |
| `Banner.astro`                                                                                                                   | `Banner.astro:11-42`             | `Layout.astro`, `index`, `profile`, `projects/{index,new,[id]}`, `admin/{cabinets,devices}/{index,[id]}`                        |
| `ServerError`                                                                                                                    | `auth/ServerError.tsx`           | auth forms + both admin editors (reach into `auth/`)                                                                            |
| Auth field kit (`FormField`, `SubmitButton`, `PasswordToggle`)                                                                   | `components/auth/`               | `SignInForm`, `SignUpForm` only                                                                                                 |
| Editor field kit (`TextField`, `NumberField`, `SelectField`, `FieldError`, `Section`, `AddButton`, `RemoveButton`, `inputClass`) | `forms/fields.tsx:11-198`        | `CabinetEditor`, `DeviceEditor` only                                                                                            |
| `ProjectDetailsFields`, `SupplyFields`, `CabinetPicker`                                                                          | `components/projects/*.astro`    | `dashboard/projects/new.astro`, `[id].astro`                                                                                    |
| `CabinetDrawing`                                                                                                                 | `cabinets/CabinetDrawing.tsx:61` | `CabinetPicker`, `CabinetEditor`, `admin/cabinets/index`, `dashboard/projects/[id]`                                             |
| `Topbar.astro`                                                                                                                   | `Topbar.astro:13-43`             | imported per page by 10 type-A pages + `Welcome` — not by `Layout`                                                              |

Not present: `Input`, `Select`, `Label`, `Card`, `Badge`, `Alert`, page shell, page header.

### 3. Page shells (three, built per page)

- **A. App page** `bg-cosmic min-h-screen p-4 text-white sm:p-8` → `mx-auto max-w-{2xl|4xl|5xl|6xl}`
  → `<Topbar />` → purple back link → gradient h1. 10 pages: `admin/{cabinets,devices}/{index,new,[id]}`,
  `dashboard/profile`, `dashboard/projects/{index,new,[id]}` (e.g. `projects/[id].astro:113`).
- **B. Centred glass card**, **no Topbar**: `auth/{signin,signup,confirm-email}`, `dashboard.astro:36`,
  `admin/index.astro:13` — the two role landing pages have no nav bar.
- **C. Landing** `Welcome.astro:5` (orbs + inline-style star field), with **English inline copy**
  (`Welcome.astro:22-110`), violating the i18n rule in `AGENTS.md`.
- `Layout.astro:22-37` renders config `Banner`s outside and above each page's cosmic wrapper, so they
  sit on the white body as light strips.

### 4. Duplicated markup (top repeats, counts over the 35 inspected files)

1. Gradient h1 `bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text … text-transparent` — 15 pages (+3-stop variant in `Welcome.astro:22`).
2. Purple text link `text-purple-300 … hover:text-purple-100 hover:underline` — 14 (10 back links, 4 in `Topbar`), +3 shorter variants on auth pages.
3. Shell A wrapper — 10.
4. Glass panel `rounded-2xl border border-white/10 bg-white/10 …` — 19 places (empty states, sections, cards).
5. Text input string — 5 definitions: `profile.astro:51`, `ProjectDetailsFields.astro:25`, `SupplyFields.astro:91` (identical), `forms/fields.tsx:11`, `auth/FormField.tsx:6` (near-identical); label/hint pair repeated ~6/~5.
6. Secondary button `rounded-lg border border-white/20 bg-white/10 px-4 py-2 …` — 4 exact + 4 variants.
7. Primary CTA: two different purples — `bg-purple-500/80` ×4 (list/new pages) vs `bg-purple-600` ×3 (`Button` overrides) + spinner ×3.
8. Amber notice ×5, amber badge ×3; muted text as four ad-hoc steps `text-blue-100/{50,60,70,80}` (~71 lines).

### 5. Cabinet drawing and print

- Colours are Tailwind palette classes, not tokens: interior `fill-white` (`CabinetDrawing.tsx:83`),
  rails `fill-zinc-300 stroke-zinc-500` (`:94`), entries `fill-amber-400/70 stroke-amber-600`
  (`:109`), PE `fill-yellow-400 stroke-green-700` / N `fill-sky-500 stroke-sky-800` (`:20-23`),
  highlight `stroke-fuchsia-600` (`:194`); only invalid marks use `destructive` (`:168,181`). 1px
  `non-scaling-stroke` hairlines (`:18`).
- It is hook-free and SSR-rendered as static SVG in 3 `.astro` callers; all 4 callers wrap it in a
  `bg-white/90` frame to survive the dark page (`CabinetPicker.astro:60`, `projects/[id].astro:146`,
  `admin/cabinets/index.astro:91`, `CabinetEditor.tsx:686`).
- No `@media print` / `print:` anywhere in `src`. Inference (not rendered): in greyscale print, rails
  (zinc-300), entries (amber-400/70) and the PE bar (yellow-400) become near-identical light greys
  and only bars carry text labels (`:32-48`) — a risk for S-09, not a blocker for this change.

### 6. Accessibility states

- Inputs: `focus:` (not `focus-visible:`) `ring-2 ring-purple-400` across the 5 input copies.
- `Button`: `focus-visible:ring-ring/50` — grey 50% ring from `--ring`, on navy.
- Raw `<a>`/`<button>` in every `.astro` page, `Topbar` and `PasswordToggle.tsx:14` have no focus
  style; they fall back to `outline-ring/50` (grey at 50% alpha) on the dark gradient — likely
  insufficient contrast (not measured).
- `aria-invalid`/`aria-describedby` wired in `forms/fields.tsx:75,132` but not in
  `auth/FormField.tsx:42-55`; Astro forms rely on native validation with no invalid styling.
- Disabled styling exists only via `Button` (`button.tsx:8`).

## Charges

**(a) Missing tokens**

| #   | Where                                                                                                                                                                                                                                                    | User impact                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| T1  | Dark "cosmic" palette is ad hoc: `global.css:113-115` + `white/NN`, `blue-100/NN` in ~20 files; tokens say light neutral                                                                                                                                 | Tokens don't describe the UI; any theme change is a ~20-file edit |
| T2  | No `success`/`warning`/`info` roles: amber in 6+ places (`projects/[id].astro:163,208,219`, `dashboard.astro:49`, `projects/new.astro:62`), success `text-emerald-100` once (`projects/[id].astro:214`), errors mix `red-200/300/800` with `destructive` | Status colours drift page to page                                 |
| T3  | `Banner.astro:27-41` hex palette                                                                                                                                                                                                                         | Light banner strips above a dark app; unthemeable                 |
| T4  | Primary accent is purple in 4 shades (`purple-600`, `purple-500/80`, `purple-300`, `purple-400`) vs `--primary` near-black; `--ring` grey                                                                                                                | Inconsistent CTAs; low-contrast focus ring                        |
| T5  | Drawing colours not tokens (`CabinetDrawing.tsx:20-23,83,94,109,194`)                                                                                                                                                                                    | Theme and print variants can't reach the drawing                  |

**(b) Missing shared components**

| #   | Candidate                                                                                                                            | Would replace                                                                                                                          | Impact today                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| C1  | `Input`/`Select`/`Label`/`FieldHint`/`FieldError` usable from `.astro` and TSX (class module in `.ts` or cva, like `buttonVariants`) | 5 input copies, 4 error-line copies (`fields.tsx:14-21`, `FormField.tsx:58-62`, `CabinetEditor.tsx:107-122`, `DeviceEditor.tsx:76-79`) | A focus/invalid fix needs 5 edits; label size drifts (`text-sm` vs `text-xs`) |
| C2  | `Card`/`Section` surface                                                                                                             | 19 glass-panel strings                                                                                                                 | Surface changes are N-file edits                                              |
| C3  | Button variants actually used (theme `primary`/`secondary`, `.astro` via `buttonVariants()`)                                         | ~8 secondary + 7 primary hand-rolled buttons                                                                                           | Two primaries; raw buttons lack focus/disabled                                |
| C4  | `Alert`/`Callout` (and move `ServerError` out of `auth/`)                                                                            | amber notices ×5, `ServerError`, editor "blocked" notes, possibly `Banner`                                                             | Status messaging looks different per page                                     |
| C5  | `Badge`                                                                                                                              | amber badge ×3 (`admin/cabinets/index.astro:103`, `admin/devices/index.astro:145`, `projects/index.astro:91`)                          | — ; `LibBadge` is unrelated dead code                                         |
| C6  | `AppShell`/`PageHeader` (Topbar + back link + h1 + width)                                                                            | 10 shell-A pages, 5 shell-B pages, 15 gradient h1s                                                                                     | Landing pages lack nav; widths vary 2xl–6xl                                   |
| C7  | `DrawingFrame`                                                                                                                       | 4 `bg-white/90` wrappers                                                                                                               | —                                                                             |

**(c) Accidental architecture**

| #   | Where                                                                                                                           | Impact                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A1  | Three parallel field systems: `auth/FormField.tsx`, `forms/fields.tsx`, hand-written Astro inputs                               | Auth, admin and electrician forms differ in labels, focus and error a11y |
| A2  | shadcn tokens + `Button` installed but bypassed at every call site                                                              | Two design systems; the declared one is fiction                          |
| A3  | Page shells assembled per page; `Topbar` imported per page instead of by a layout; `Banner` rendered outside the themed wrapper | Missing nav on `dashboard.astro` / `admin/index.astro`; visual seams     |
| A4  | Shared `Topbar.astro:13-41` hardcodes the dark palette, links have no focus style                                               | Only works on `bg-cosmic`; breaks on any light or print surface          |
| A5  | Starter leftovers: `Welcome.astro` English copy, `LibBadge.astro` unused, `README.md` still starter-titled                      | English UI on `/`; dead code beside real components                      |

## Code References

- `src/styles/global.css:4,6-39,41-73,75-111,113-115,117-124` — value source, dark variant, cosmic utility, base layer
- `src/layouts/Layout.astro:15,22-37` — no theme class, Banners outside page wrappers
- `src/components/Topbar.astro:13-41` — hardcoded dark palette
- `src/components/Banner.astro:27-41` — hex alert palette
- `src/components/ui/button.tsx:7-50` — shadcn cva variants
- `src/components/forms/fields.tsx:11-12,162,171` — editor field kit, Section, smallButtonClass
- `src/components/auth/FormField.tsx:6,37,53` — parallel auth input
- `src/components/auth/SubmitButton.tsx:18-22` — Button override + spinner
- `src/components/cabinets/CabinetDrawing.tsx:18-23,83,94,109,168,181,194` — drawing palette
- `src/pages/dashboard/projects/[id].astro:103-105,113,146,163,174,203-219,237-248` — target view hot spots
- `src/pages/dashboard.astro:36-79`, `src/pages/admin/index.astro:13-44` — shell B without Topbar
- `src/components/Welcome.astro:5,14,22-110` — landing, English copy

## Architecture Insights

- **Do not add a second design system** (`CLAUDE.md:71`): shadcn is initialised (`components.json`,
  `new-york`, `neutral`, CSS variables, lucide). The fix is to make the existing `@theme` tokens
  describe the chosen look and route views through them; new components come via
  `npx shadcn@latest add <name>` (`AGENTS.md`), e.g. `input label badge alert card`, which already
  read the tokens.
- **Astro and React share one styling contract only if it is framework-neutral.** Class constants live
  in `.tsx` today (`fields.tsx:11`) and are re-typed in `.astro` files. Astro can import from `.tsx`,
  but a plain `.ts` module (or cva variants such as `buttonVariants`) is the natural shared source.
- **Motif rationale — "Arkusz techniczny" (light technical sheet):** (1) the drawing already paints
  its own white paper and every caller adds a white frame to escape the dark page — a light theme
  removes that seam; (2) S-09 prints via the browser, and a light UI makes screen and print converge;
  (3) the domain is technical drawing (DIN rails, PE/N bars), so hairline borders, a grid-like
  rhythm and restrained colour fit the product better than the generic starter "cosmic" glass;
  (4) the PE green-yellow and N blue are domain conventions and belong in named tokens, not theme
  colours. The existing `.dark` token set can stay as an unused option — a toggle is out of scope.
  Alternative: keep dark and tokenise the cosmic palette into `.dark` (apply `class="dark"` in
  `Layout`) — cheaper visually, but keeps the print/screen split.
- **Scope per `CLAUDE.md:62`:** global tokens (`global.css`) + shared primitives needed by the one view
  - `/dashboard/projects/[id]`. Other pages will change colour where they already read shared pieces
    (`Topbar`, `Banner`, `fields.tsx`) — that knock-on is expected, but restyling their page-local
    strings is a follow-up change, not this one. With a light theme, un-migrated pages keep
    `bg-cosmic`, so the app will be visually mixed until follow-ups land — a plan-level trade-off.

## Historical Context (from prior changes)

- `context/archive/2026-09-23-admin-cabinet-catalog/plan.md:85,297,301` — drawing reused for the printed quote, server-renderable without hydration, "colours via Tailwind tokens" (only partly honoured: errors use `destructive`, the rest is palette) — **partial**.
- `context/archive/2026-09-23-admin-cabinet-catalog/plan.md:392` — "Uses shadcn inputs if added (`npx shadcn@latest add input label`)" — never added.
- `context/archive/2026-09-23-admin-cabinet-catalog/reviews/impl-review.md:69-71,109-111` — removal focus not re-checked in a browser; overlapping PE/N labels deferred to S-06.
- `context/archive/2026-09-23-cabinet-preview-clipping/plan.md:53-54` — errors as `stroke-destructive` + `fill-destructive/15` — **supported** by `CabinetDrawing.tsx:168`.
- `context/foundation/infrastructure.md:133-137,157-158` — browser print; expects `@media print` fights for the SVG.
- No archived plan or review records a decision about theme, dark mode, cosmic background, fonts or print CSS (searched all of `context/archive/**`, `context/foundation/*.md`, `docs/10x-toolkit.md`, `AGENTS.md`, `README.md`).

## Related Research

Not applicable — no earlier `research.md` covers UI.

## Open Questions

1. **Light vs dark** — adopt the light "Arkusz techniczny" motif, or keep dark and tokenise it into `.dark`? Owner: user. Blocks the plan.
2. **Target view** — confirm `/dashboard/projects/[id]` (recommended) vs e.g. `/dashboard/projects` or the auth pages. Owner: user.
3. **Mixed-app period** — accept un-migrated pages keeping `bg-cosmic` until follow-up changes, or also swap the shell on all pages (tokens-only, no per-page restyle)? Owner: user.
4. **Accent colour** — one saturated accent to replace the purples (source to be named in the repo per `CLAUDE.md:61`). Owner: user/plan.
5. **Drawing print palette** — greyscale distinguishability of rails/entries/PE (inference, not rendered); likely S-09 scope, but domain tokens introduced here should anticipate it.
6. **Kitchen-sink route** — where it lives (e.g. a dev-only page gated in `route-access.ts`) and whether it ships to production.
