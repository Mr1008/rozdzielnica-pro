# UI layout & theme ("Arkusz techniczny") Implementation Plan

## Overview

Move the whole app off the starter's dark "cosmic" styling onto a light, electricity-themed design
system: **"Arkusz techniczny"** (technical sheet). Semantic tokens in `src/styles/global.css` and
shadcn primitives in `src/components/ui/` become the only source of colour, type and surface. Every
page is rebuilt on a shared app shell. The planning screens put electrician usability and desktop
work first; the landing page is the one expressive, futuristic surface. A dev-only kitchen-sink page
is the screenshot check.

## Current State Analysis

From `context/changes/ui-layout-theme/research.md` (codebase at `9e04e95`):

- **Tokens exist and nothing reads them.** `global.css:6-111` has shadcn neutral tokens (light
  `:root`; a `.dark` set nothing applies). All 15 pages plus `Welcome.astro` cover `body` with
  `bg-cosmic` (`global.css:113-115`, hex gradient). They then hardcode `text-white`, `white/NN`,
  `blue-100/{50..80}`, `purple-*`, `amber-*`, `red-*`: 0 token classes in any page, 43 hardcoded
  colour classes in `dashboard/projects/[id].astro` alone.
- **`Button` is imported in 4 files and colour-overridden in every one** (`SubmitButton.tsx:18`,
  `CabinetEditor.tsx:712`, `DeviceEditor.tsx:521`, `forms/fields.tsx:171-185`). No `.astro` page
  uses it.
- **Three parallel field systems:**
  - `auth/FormField.tsx`: React, no `aria-invalid`.
  - `forms/fields.tsx`: React, aria wired.
  - Hand-written Astro inputs, copied 3 times: `ProjectDetailsFields.astro:25`,
    `SupplyFields.astro:91`, `profile.astro:51`.
- **Three page shells assembled per page.**
  - Shell A: `bg-cosmic` + `Topbar` + back link + gradient h1, on 10 pages.
  - Shell B: centred glass card with **no Topbar**, on 5 pages including `dashboard.astro` and
    `admin/index.astro`.
  - Shell C: `Welcome.astro`, with English inline copy.
- **Shared pieces that only work on the dark background:**
  - `Topbar.astro:13-41`: white/purple palette, no focus style.
  - `Banner.astro:27-41`: 9 hex values, rendered by `Layout.astro:22-37` outside the page wrapper.
  - `CabinetDrawing.tsx:18-23,83,94,109,194`: palette classes. The only token use is
    `destructive` (`:168,181`). All 4 callers wrap it in a `bg-white/90` frame.
- **No success/warning/info roles, no fonts, no print CSS, no visual-test infrastructure.**
  `scripts/smoke.mjs:88-92` asserts status and redirect only, so markup changes cannot break it.
- **Hydration today:** `CabinetEditor`/`DeviceEditor` are `client:only="react"` (admin new/[id]
  pages); `SignInForm`/`SignUpForm` are `client:load`; `CabinetDrawing` renders with no hydration in
  `.astro` pages. Astro therefore already renders React components statically, so shadcn TSX
  primitives can be used from `.astro` without shipping JS.

## Desired End State

- `global.css` holds the complete contract: light surface/ink/accent tokens, status roles, IEC
  conductor-colour domain tokens, a separate landing "hero" token set, and font tokens. Each
  externally sourced value carries a comment naming its source. `bg-cosmic` is gone.
- All pages render through one `AppLayout` (app header bar, desktop-first width, page header,
  in-shell banners) or the auth/landing variants that share its tokens.
- No `.astro`/`.tsx` file under `src/` uses a Tailwind palette colour class, hex or rgba colour. The
  grep check in Phase 5 proves it.
- `/dashboard/projects/[id]` is a two-column desktop workspace: sections on the left, a sticky
  summary aside with the cabinet drawing, supply status and an in-page section nav.
- `/` is an expressive Polish landing page on the hero tokens, with a live product drawing.
- `/dev/kitchen-sink` renders every primitive in every state plus the drawing. It returns 404 outside
  `astro dev`.
- Verification: lint, `astro check`, `test:unit`, build and smoke all pass. Screenshots of the
  kitchen sink and every page, taken in the in-app browser, are attached to the phase reviews.

### Key Discoveries:

- Astro renders React components statically unless a `client:*` directive is present
  (`dashboard/projects/[id].astro:148` renders `CabinetDrawing` that way). So `Input`, `Label`,
  `Card`, `Alert`, `Badge` and `Button` can be used directly in `.astro` pages.
- `SupplyFields.astro:95-96` sets dark option text because native `<select>` popups render on the OS
  light popup. On a light theme that workaround is no longer needed.
- `CabinetDrawing` already takes `highlight` and `invalid` props (`CabinetDrawing.tsx:6-11`). The
  kitchen sink can show all its states with a static demo geometry.
- Form field names, `id`s and `aria-describedby` wiring in the project components are part of the
  endpoint contract (`parseSupplyForm` and friends). Restyling must not rename them.
- Every push to `master` auto-deploys (`README.md` Deployment). A multi-phase restyle must not land
  on `master` half-done.

## What We're NOT Doing

- **Dark mode or a theme toggle.** The `.dark` token block is removed rather than maintained (no
  consumer, no FR).
- **Mobile/touch optimisation** (PRD `## Non-Goals`). Layouts are desktop-first and may simply stack
  below `lg`. There is no dedicated small-screen design and no `min-width` lock.
- **Print styles for the quote** (S-09 owns `@media print`). The light theme and drawing tokens make
  that easier but add no print CSS here.
- **Changing any endpoint, form field name, query parameter, route gate, or database object.**
- **New product behaviour.** The in-page section nav and sticky aside are layout only. There are no
  new data queries beyond what `projects/[id].astro` already loads.
- **Drawing semantics** (label overlap "NE", greyscale print distinguishability): recorded for
  S-06/S-09, not solved here.
- **A screenshot test harness or baselines.** The check is a manual screenshot pass
  (`CLAUDE.md:64`).
- **Re-running `shadcn init`** or introducing another component library.

## Implementation Approach

- Work on a branch `ui-layout-theme` and merge once at the end: each phase is a commit on the branch.
  **Why:** `master` auto-deploys, and between phases the app is deliberately mixed.
- **Contract before pixels.**
  - Phase 1 writes the tokens and primitives and proves them on the kitchen sink.
  - Phase 2 builds the shell and one reference view on them.
  - Phases 3–5 migrate the remaining pages by area.
  - Each page is migrated whole (shell and inner strings together), never shell-only, so no page ever
    shows white-on-light text.
- **Two registers from one token source:**
  - **Workspace** (all signed-in pages): calm paper surfaces, ink text, hairline borders, one
    blueprint-indigo accent, compact controls, tabular figures, generous desktop width.
  - **Hero** (landing and the auth side panel): deep "blueprint night" with an electric-cyan "current"
    accent and a subtle animated circuit line that respects `prefers-reduced-motion`.
  - Electricity shows up through the IEC conductor colours (PE green-yellow, N blue, L1 brown, L2
    black, L3 grey), the lightning mark, and the technical-drawing grid. Status colours are never
    re-used for this.

## Critical Implementation Details

- **Ordering within Phase 1.** Run `npx shadcn@latest add input label card alert badge` _before_
  retuning tokens. The generated files read the token names, so values can then be adjusted without
  re-editing components. Review each generated file's diff: the CLI must not rewrite `global.css`
  or `button.tsx` without an explicit confirmation, and any rewrite it proposes is declined.
- **Native `<select>` stays native.** shadcn's `Select` is a Radix client component that does not
  submit through a plain `<form>`. The native-select primitive must render a real `<select>` so the
  POST endpoints keep working without JS.
- **Kitchen-sink gating.** Gate with `import.meta.env.DEV` inside the page, returning a 404
  `Response` otherwise. Do not add a `PROTECTED_ROUTES` entry: the route must be screenshot-able
  without sign-in in dev and absent in the production build.

---

## Phase 1: Contract — tokens, fonts, primitives, kitchen sink

### Overview

Establish the design-system contract and prove it in isolation before any page depends on it.

### Changes Required:

#### 1. Font dependencies

**File**: `package.json`, `package-lock.json`

**Intent**: Self-host IBM Plex Sans (UI) and IBM Plex Mono (figures, units, device codes) with the
latin-ext subset for Polish diacritics. **This adds two runtime dependencies**, called out in the
commit message.

**Contract**: `@fontsource-variable/ibm-plex-sans@^5.3.0`, `@fontsource/ibm-plex-mono@^5.3.0`
(weights 400/500 only). Imported once from `global.css` or `Layout.astro`.

#### 2. Token rewrite

**File**: `src/styles/global.css`

**Intent**: Replace the neutral shadcn values with the "Arkusz techniczny" set, add the missing roles,
and delete `bg-cosmic` last (Phase 5) once nothing uses it. Each group gets a one-line source comment.

**Contract**: the token names consumed by shadcn stay (`--background`, `--foreground`, `--card`,
`--primary`, `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--destructive`,
`--border`, `--input`, `--ring`, `--radius`). Added and mapped in `@theme inline`:

- **Surfaces.** `--background` is paper, a faint cool off-white. `--card` is white. `--foreground`
  is a blue-black ink. `--muted-foreground` must reach at least 4.5:1 contrast on both
  `--background` and `--card`. `--border` and `--input` are hairline greys.
- **Accent.**
  - `--primary` is blueprint indigo. Source: Tailwind CSS v4 default palette, `indigo-700`.
  - `--primary-foreground` is white.
  - `--ring` is the indigo at reduced lightness, so the focus ring passes 3:1 against paper.
- **Status roles.** `--success`, `--warning`, `--info`, each with `-foreground` and `-muted`
  (tinted background) variants. `--destructive-foreground` is added too. Warning is amber-based;
  info is primary-tinted, so it never collides with the N-blue domain colour.
- **Domain (conductor colours).** `--wire-pe` (green-yellow pair: `--wire-pe`, `--wire-pe-stripe`),
  `--wire-n` (blue), `--wire-l1` (brown), `--wire-l2` (black), `--wire-l3` (grey). Source comment:
  conductor identification colours per PN-EN 60445 (IEC 60445); the hex/oklch values are this
  project's screen approximations.
- **Drawing roles.** `--drawing-paper`, `--drawing-rail`, `--drawing-entry`, `--drawing-frame`,
  `--drawing-highlight`, chosen so rail, entry and PE differ in lightness as well as hue.
- **Hero register.** `--hero-background` (blueprint night), `--hero-foreground`, `--hero-muted`,
  `--hero-current` (electric cyan), `--hero-grid` (faint grid line).
- **Type.** `--font-sans` is Plex Sans with a system fallback; `--font-mono` is Plex Mono. `body`
  also gets `font-variant-numeric: tabular-nums` in the workspace.
- **Base layer.** Keep `border-border`. Replace `outline-ring/50` with a visible global
  `:focus-visible` outline (2px `--ring`, 2px offset) so raw links and buttons get a real focus
  state.
- **Remove the `.dark` block** and the `@custom-variant dark` line (decision: no dark mode). Strip
  the now-inert `dark:` classes from `button.tsx` (and from generated primitives) in the same step.

#### 3. shadcn primitives

**File**: `src/components/ui/{input,label,card,alert,badge}.tsx` (generated), `src/components/ui/button.tsx`

**Intent**: Add the missing primitives through the existing shadcn config, and make `Button` usable
without overrides.

**Contract**:

- `npx shadcn@latest add input label card alert badge`.
- `Button` keeps its variants: `default` (indigo), `secondary`, `outline`, `ghost`, `destructive`
  (now `text-destructive-foreground`), `link`, plus size `sm`. The spinner is folded into a
  `pending` prop, or a small `Spinner` in `ui/`, so `SubmitButton` and the editors stop hand-rolling
  it.
- `Alert` gains `success`, `warning` and `info` variants on the status tokens.
- `Badge` gains `warning` and `success` variants.

#### 4. Native select + field helpers

**File**: `src/components/ui/native-select.tsx`, `src/components/ui/field.tsx`

**Intent**: One field system for React and Astro: a styled real `<select>` matching `Input`, and a
`Field` wrapper (label + control slot + hint + error). It wires `aria-describedby` and
`aria-invalid` the way `forms/fields.tsx:75,132` already does.

**Contract**: `NativeSelect` forwards all `<select>` props. `Field` takes `{ id, label, hint?,
error?, children }` and emits `${id}-hint` / `${id}-error` ids. Phases 2–5 replace every
hand-written input/label/hint with these.

#### 5. Kitchen sink

**File**: `src/pages/dev/kitchen-sink.astro`, `src/lib/demo-cabinet.ts`, `src/lib/demo-cabinet.test.ts`, `src/lib/i18n/pl.ts`

**Intent**: A single page showing every state the contract has to hold. It is the screenshot check
for every phase.

**Contract**:

- **Gating:** returns a 404 `Response` unless `import.meta.env.DEV`.
- **Sections:**
  - Token swatches: surfaces, accent, status, wire, hero.
  - Type scale: h1–h3, body, muted, mono figures.
  - `Button`: every variant × normal/disabled/pending, and a `:focus-visible` sample via
    `autofocus`.
  - Form controls: `Input` / `NativeSelect` / checkbox / radio card, each empty, filled, with hint,
    invalid with error, and disabled.
  - Feedback and containers: `Alert` × 4, `Badge` × variants, `Card`, a table, an empty state,
    `Banner` × 3.
  - `CabinetDrawing`: plain, with `highlight`, and with `invalid`.
- **Demo geometry:** exported from `src/lib/demo-cabinet.ts` (reused by the landing page in
  Phase 5). Its unit test asserts it passes `parseCabinetGeometry`.
- **Strings:** labels come from a new `t.devTools.kitchenSink` key group, so the i18n rule holds even
  on the dev page.

#### 6. Brand mark and static assets

**File**: `src/components/brand/Logo.astro`, `src/assets/brand/{mark.svg,circuit-grid.svg}`, `public/{favicon.svg,favicon.png,apple-touch-icon.png,og-image.png}`, `scripts/brand-assets.mjs`, `package.json`, `src/layouts/Layout.astro`, `README.md`

**Intent**: Give the product its own identity instead of the starter's favicon and template image.

- **Concept:** the mark is a switchboard cabinet in outline (rounded square) with DIN-rail module
  lines. A lightning bolt runs through the middle module, drawn as the "current" in the accent
  colour.
- **Wordmark:** "Rozdzielnica" in Plex Sans semibold plus "Pro" in the accent, set as live text
  from `t.app.name` (not outlined paths).
- **One set of shapes, two colourings:** the mark is drawn with `currentColor` plus a
  `--brand-current` token. It works in the workspace (ink + indigo), on the hero register
  (hero-foreground + cyan) and in mono.
- **Where it's used:** the header bar (Phase 2), the auth side panel and the landing page
  (Phase 5).

**Contract**:

- `Logo.astro` props: `{ variant?: "mark" | "full"; size?: number; class?: string }`. It renders
  inline SVG with `role="img"` and `aria-label={t.app.name}` on the mark-only variant, and is
  decorative (`aria-hidden`) when the text wordmark is next to it.
- `src/assets/brand/mark.svg` is the single source for the raster assets.
- `circuit-grid.svg` is a tileable drafting-grid-plus-trace pattern for hero backgrounds. It is
  used in Phase 5, and shown in the kitchen sink now.
- **Generated raster assets:** `scripts/brand-assets.mjs` (`npm run brand:assets`) rasterises the
  master with `sharp`. `sharp` is already installed as a transitive dependency of `astro`, and the
  script is dev-time only. It is a committed tool; the generated files are committed too.
  - `favicon.png`: 32×32. It replaces the starter's, and the file name stays.
  - `apple-touch-icon.png`: 180×180.
  - `og-image.png`: 1200×630, on the hero register. It carries the mark and the brand name only,
    no translatable tagline.
  - The script checks each output's dimensions and exits non-zero on a mismatch.
  - `favicon.svg` is copied from the master.
- **`Layout.astro` head:**
  - `icon` links: SVG first, PNG fallback.
  - `apple-touch-icon`.
  - `meta name="description"` from `t.app.tagline`.
  - `og:title`, `og:description`, `og:image`.
  - `theme-color` = `--background`.
- **Starter image:** `public/template.png` is deleted, and `README.md`'s header image points at
  `og-image.png` instead.
- **Kitchen sink:** gains a "Marka" section showing the mark and the full logo on paper, on hero
  and in mono, at 16/24/48 px, plus the grid pattern.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Types pass: `npx astro check`
- Unit tests pass, including the new demo-geometry test: `npm run test:unit`
- Brand assets regenerate with the right dimensions: `npm run brand:assets`
- Build passes and the kitchen-sink route is not reachable in the preview build: `npm run build`, then `npm run preview` and `/dev/kitchen-sink` returns 404
- `grep -n "bg-cosmic" src/styles/global.css` still matches (removed only in Phase 5); `grep -n "\.dark" src/styles/global.css` matches nothing

#### Manual Verification:

- `/dev/kitchen-sink` in the in-app browser (dev server) shows every listed state; a full-page screenshot is taken
- Focus ring visible on buttons, links, inputs, selects, checkbox and radio cards when tabbing
- Muted text, focus ring and status foregrounds meet contrast (4.5:1 text, 3:1 ring/borders) — checked via computed colours in the browser
- Polish diacritics render in Plex Sans (e.g. "Zabezpieczenie przedlicznikowe", "Wyłącznik różnicowoprądowy")
- Drawing: rail, entry and PE bar remain distinguishable when the screenshot is desaturated
- Logo reads clearly at 16 px (browser-tab favicon) and at 48 px on paper, hero and mono in the kitchen sink
- `og-image.png` and `apple-touch-icon.png` opened and eyeballed: mark centred, brand name legible, hero colours

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 2.

---

## Phase 2: App shell + reference view (`/dashboard/projects/[id]`)

### Overview

Build the shell every signed-in page will use. Migrate the shared pieces and the most complex
electrician page onto it: this proves the contract on real forms and the drawing.

### Changes Required:

#### 1. App layout and page header

**File**: `src/layouts/AppLayout.astro`, `src/components/PageHeader.astro`, `src/layouts/Layout.astro`

**Intent**: One signed-in shell: full-width app header bar, a desktop-first content area, and the
page header (back link, title, optional description and actions slot). Banners render inside the
shell under the header, not above the page.

**Contract**:

- `AppLayout` props: `{ title: string; width?: "default" | "wide"; }`, with slots `header-actions`
  and default. `default` is `max-w-6xl` and `wide` is `max-w-7xl`.
- `Layout.astro` keeps `<html lang="pl">` and the config banners. It gains the fonts import and
  `bg-background text-foreground`, and drops the scoped `height: 100%` hack if the new shell makes it
  moot.
- `PageHeader` props: `{ title; backHref?; backLabel?; description? }` plus an `actions` slot.

#### 2. Topbar → app header

**File**: `src/components/Topbar.astro`

**Intent**: Replace the floating glass pill with a hairline-bordered header bar: `Logo variant="full"`
(the Phase 1 brand mark + `t.app.name` wordmark), the role's home link, the user's email in muted text, and sign-out as a `ghost`
`Button`. It keeps the `ROLE_HOME` logic and comment. `AppLayout` includes it, so pages stop
importing it.

**Contract**: same props (none) and the same links and targets. It gains visible focus via the
global `:focus-visible` and marks the current area with `aria-current`.

#### 3. Banner on tokens

**File**: `src/components/Banner.astro`

**Intent**: Replace the scoped hex CSS with the `Alert` status tokens. Keep `variant` and `role`
semantics (error → `alert`, else `status`) and the `a` underline rule.

**Contract**: unchanged props `{ variant?: "info" | "warning" | "error" }`; a new `success` variant
is added and used for the project page's saved/created messages. Today those show as blue `info`.

#### 4. Drawing on domain tokens

**File**: `src/components/cabinets/CabinetDrawing.tsx`

**Intent**: Swap the palette classes for the drawing and wire tokens: `fill-[var(--drawing-paper)]`
style utilities mapped in `@theme`, so they read as `fill-drawing-paper`, `fill-wire-pe`, etc. The
drawing then sits on a card without a white frame and keeps its hook-free SSR contract.

**Contract**: props unchanged (`geometry`, `highlight?`, `invalid?`, `className?`). PE keeps the
green-yellow pair and N the blue, per the conductor-colour tokens. `destructive` stays for invalid
marks.

#### 5. Project page components

**File**: `src/components/projects/ProjectDetailsFields.astro`, `src/components/projects/SupplyFields.astro`, `src/components/projects/CabinetPicker.astro`

**Intent**: Replace the local `inputClass`/`labelClass`/`hintClass`/`optionClass` copies with
`Field` + `Input` / `NativeSelect`. The radio cards use the accent for the checked state. Supply
values render units in mono. OSD fields sit in a 3-column grid and WLZ in 2 columns (desktop).

**Contract**: every `name`, `id`, `required`, `pattern`, `maxlength`, `value`/`selected` and
`aria-describedby` stays byte-identical in meaning. Only presentation changes. Both
`dashboard/projects/new.astro` and `[id].astro` consume these, so `new.astro` must keep rendering
correctly until Phase 3 migrates its shell. It is on the cosmic background meanwhile; that
branch-only intermediate state is accepted.

#### 6. Project page layout

**File**: `src/pages/dashboard/projects/[id].astro`, `src/lib/i18n/pl.ts`

**Intent**: Turn the stacked cards into a desktop workspace.

**Contract**:

- **Layout:**
  - `AppLayout` with `width="wide"`.
  - `PageHeader`: back to the list, project name, client/address as a muted description.
  - Two-column grid at `lg`: `minmax(0,1fr)` main + a `22rem` aside.
- **Main column:** `Card` sections in the current order: details, cabinet, supply. Then the delete
  zone as a destructive-bordered `Card` at the bottom.
- **Sticky aside:**
  - The snapshot drawing, larger than today's `h-56`.
  - Cabinet name and model.
  - Supply status: "configured" `Badge`, or a warning `Alert` linking `#supply`.
  - Warning count.
  - In-page section nav: anchor links to `#details`, `#cabinet`, `#supply`, `#delete`.
- **Status and callouts:**
  - Warning and "not configured" callouts become `Alert` variants.
  - The saved/created banners use `success`.
- **Buttons:** save buttons are `Button` (`default` for the section's primary save, `outline` for
  "Zmień szafkę"). Delete is `destructive`.
- **i18n:** new strings for the aside and nav are added as `t.projects.page.*` keys.
- **Unchanged:** the data loading, forms, actions and error handling in the frontmatter.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Types pass: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Build passes: `npm run build`
- No palette colour classes remain in the migrated files: `grep -nE "(white|black|purple|blue|sky|amber|yellow|green|emerald|red|zinc|slate|fuchsia)-[0-9]|white/|bg-cosmic" src/pages/dashboard/projects/[id].astro src/components/projects/*.astro src/components/Topbar.astro src/components/cabinets/CabinetDrawing.tsx` returns nothing; `grep -n "#[0-9a-fA-F]\{3,6\}" src/components/Banner.astro` returns nothing

#### Manual Verification:

- Kitchen sink re-screenshotted: the drawing and Banner sections now match the tokens
- `/dashboard/projects/[id]` screenshotted at 1440×900 and 1280×800 in the in-app browser, signed in as an electrician on the local stack, in four states: supply configured with warnings, supply configured with no warnings, supply not configured, and archived-cabinet notice
- Saving details, changing cabinet, saving supply and deleting all still work end to end, and the success/error banners appear inside the shell
- Aside stays visible while scrolling the supply form; the section nav links jump and move focus to the section heading
- Keyboard-only pass: every control reachable in visual order with a visible focus ring

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 3.

---

## Phase 3: Electrician pages

### Overview

Migrate the remaining electrician-facing pages onto `AppLayout` and the primitives.

### Changes Required:

#### 1. Electrician home

**File**: `src/pages/dashboard.astro`

**Intent**: Replace shell B with `AppLayout`, which gives it the header bar it lacks today. Turn the
centred card into a dashboard: page header greeting, the pricing-not-configured notice as a warning
`Alert` with a link, and the two destinations (Projects, Pricing profile) as large clickable `Card`s
with a lucide icon. The duplicate sign-out button is removed, since the header carries it.

**Contract**: same links (`PROJECTS_PATH`, `PRICING_PROFILE_PATH`) and the same `pricingMissing()`
logic.

#### 2. Pricing profile

**File**: `src/pages/dashboard/profile.astro`

**Intent**: `AppLayout` + `PageHeader`, and one `Card` form with the three fields via `Field`/`Input`.
Minutes and złoty values render with mono suffixes. The local class constants are removed.

**Contract**: field names from `PRICING_FIELDS`, `required`/`min`/`max`/`step` constraints and the
`PRICING_API_PATH` action are unchanged.

#### 3. Projects list and new project

**File**: `src/pages/dashboard/projects/index.astro`, `src/pages/dashboard/projects/new.astro`

**Intent**:

- **List:**
  - The page header's actions slot holds the primary "Nowy projekt" `Button` (as a link via
    `buttonVariants`).
  - Projects appear as a dense list or table: name, client, cabinet, updated date (mono), and a
    "Przyłącze nieuzupełnione" warning `Badge`.
  - The empty state is a `Card` with the CTA.
- **New:** `AppLayout`, with details and cabinet `Card` sections on the Phase 2 components. The
  empty-catalog notice becomes a warning `Alert`.

**Contract**: same queries, sorting, links and form action. The date is still formatted with
`Astro.locals.timeZone`.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Types pass: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Build passes: `npm run build`
- Palette grep (Phase 2 pattern) over `src/pages/dashboard.astro src/pages/dashboard/**/*.astro` returns nothing

#### Manual Verification:

- Screenshots at 1440×900 of: dashboard (with and without the pricing notice), profile (empty and pre-filled), projects list (empty and with ≥3 projects incl. one without supply), new project (catalog present and empty)
- Creating a project, saving the profile and the list → project navigation work end to end
- Header shows the electrician's home link and sign-out on every page

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 4.

---

## Phase 4: Admin pages and editor islands

### Overview

Migrate the admin area, including the two large React editors and their field kit, and remove the
last `Button` overrides.

### Changes Required:

#### 1. Admin field kit

**File**: `src/components/forms/fields.tsx`

**Intent**: Rebuild `TextField`/`NumberField`/`SelectField`/`FieldError`/`Section`/`AddButton`/`RemoveButton`
on `Field`, `Input`, `NativeSelect`, `Card` and `Button` (`outline` / `ghost` `sm`). `inputClass`
and `smallButtonClass` are deleted.

**Contract**: exported component names and props are unchanged, so `CabinetEditor` and
`DeviceEditor` keep compiling. The `aria-invalid`/`aria-describedby` behaviour is preserved.

#### 2. Editors

**File**: `src/components/cabinets/CabinetEditor.tsx`, `src/components/devices/DeviceEditor.tsx`

**Intent**:

- **Palette:** replace the remaining palette strings: `ElementCard` borders, the issue lists, the
  amber "blocked" notes → `Alert`/`destructive` text, and the segmented radio group.
- **Buttons:** submit uses `Button` `default` with `pending`; cancel uses `Button` `outline` as a
  link.
- **Preview:** the cabinet editor preview sits in a sticky right column at `lg`, with the drawing
  on its card and no white frame.

**Contract**: form field names, draft-storage behaviour and `client:only` usage are unchanged.
`ServerError` is replaced by `Alert variant="destructive"` with `role="alert"` (see Phase 5 for the
auth side).

#### 3. Admin pages

**File**: `src/pages/admin/index.astro`, `src/pages/admin/cabinets/{index,new,[id]}.astro`, `src/pages/admin/devices/{index,new,[id]}.astro`

**Intent**:

- **Admin home:** moves onto `AppLayout` (it gains the header) with destination `Card`s, as in
  Phase 3.
- **Catalog lists:** `PageHeader` with the primary "Nowa szafka" / "Nowy aparat" action.
- **Devices:** the devices table uses token borders and mono parameter summaries.
- **Badges and states:** the archived badge becomes `Badge` `warning`; empty states become `Card`s;
  the per-row edit/archive/restore buttons become `Button` `outline` `sm`.
- **Editor pages:** `new`/`[id]` use `width="wide"`.

**Contract**: queries, form actions, archive/restore POSTs and `client:only` directives are
unchanged.

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Types pass: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Build passes: `npm run build`
- Palette grep (Phase 2 pattern) over `src/pages/admin/**/*.astro src/components/forms/fields.tsx src/components/cabinets/CabinetEditor.tsx src/components/devices/DeviceEditor.tsx` returns nothing
- No `className` override of Button colours remains: `grep -nE "<Button[^>]*className=\"[^\"]*(bg-|text-(white|purple))" src -r` returns nothing

#### Manual Verification:

- Signed in as the seeded admin, screenshots at 1440×900 of:
  - Admin home.
  - Cabinet catalog, in two states: with items including an archived one, and with an invalid stored geometry.
  - Cabinet editor, new and edit, including an invalid element highlighted in the preview.
  - Device catalog table.
  - Device editor for each kind, including validation errors.
- Create, edit, archive and restore work for both a cabinet and a device; a rejected save restores the draft

**Implementation Note**: After automated verification passes, pause for human confirmation of the manual checks before Phase 5.

---

## Phase 5: Auth, landing, cleanup

### Overview

Give the public surfaces the expressive hero register, unify the last field system, remove starter
leftovers, and lock the contract with a repo-wide check and an `AGENTS.md` rule.

### Changes Required:

#### 1. Auth pages and form kit

**File**: `src/pages/auth/{signin,signup,confirm-email}.astro`, `src/components/auth/{FormField,SubmitButton,PasswordToggle,ServerError,SignInForm,SignUpForm}.tsx`

**Intent**:

- **Layout:** a split layout at `lg`. The left panel is on hero tokens (`Logo` on the hero register, tagline,
  `circuit-grid.svg` background); the right is a paper `Card` with the form. Below `lg` only the form card
  shows.
- **Field kit:** `FormField` is rebuilt on `Field`/`Input`, which adds the missing
  `aria-invalid`/`aria-describedby`. `SubmitButton` becomes `Button` with `pending`.
- **Password toggle:** `PasswordToggle` becomes a `ghost` icon `Button`, focusable with a visible
  ring.
- **Server error:** `ServerError` becomes a thin wrapper over `Alert variant="destructive"`, or its
  callers use `Alert` directly and the file is deleted (implementer's choice; no remaining importer
  may reach into `auth/` for it).

**Contract**: form field names, validation behaviour, `client:load`, the `?error=` handling and
`authErrorMessage` are unchanged.

#### 2. Landing page

**File**: `src/components/Welcome.astro` (rename to `src/components/Landing.astro`), `src/pages/index.astro`, `src/lib/i18n/pl.ts`

**Intent**: Replace the English starter page with a Polish, future-leaning landing page on the hero
register:

- **Header:** a minimal header with sign-in/sign-up (or the role home link when signed in, reusing
  the Topbar logic).
- **Hero:**
  - Headline and subline about planning a switchboard and getting a labour quote.
  - Primary CTA "Załóż konto" and secondary "Zaloguj się".
  - The live `CabinetDrawing` of the demo cabinet on a drafting-grid panel, with an animated
    "current" line.
- **Features:** a three-step "Obwody → Układ w szafce → Wycena" band.
- **Footer:** a short footer.
- **Motion:** only CSS transforms and opacity, disabled under `prefers-reduced-motion: reduce`.

**Contract**: `index.astro` keeps the `?error=` → `authErrorMessage` banner. All copy comes from a
new `t.landing` key group. The no-role redirect target (`NO_ROLE_PATH`) must still show its message.

#### 3. Cleanup and guardrails

**File**: `src/styles/global.css`, `src/components/ui/LibBadge.astro`, `AGENTS.md`

**Intent**:

- Delete the `bg-cosmic` utility and the unused `LibBadge.astro`.
- Add an `AGENTS.md` convention: colours only via the tokens in `global.css`; no Tailwind palette,
  hex or rgba classes in components; new UI states go on `/dev/kitchen-sink` first.
- Update the `AGENTS.md` product-code sentence so the starter-leftover remark no longer applies to
  the landing page.

**Contract**: after this step the repo-wide check passes (see Success Criteria).

### Success Criteria:

#### Automated Verification:

- Lint passes: `npm run lint`
- Types pass: `npx astro check`
- Unit tests pass: `npm run test:unit`
- Build passes: `npm run build`
- Repo-wide palette check returns nothing: `grep -rnE "bg-cosmic|(bg|text|border|fill|stroke|ring|from|via|to|accent|placeholder|outline|divide|shadow)-(white|black|purple|blue|indigo|sky|cyan|amber|yellow|green|emerald|lime|red|rose|pink|fuchsia|zinc|slate|gray|neutral|stone)(\b|-[0-9]|/)" src --include=*.astro --include=*.tsx`
- No hex/rgba colours in components or pages: `grep -rnE "#[0-9a-fA-F]{3,8}\b|rgba?\(" src/components src/pages src/layouts` returns nothing
- No English starter copy left: `grep -rn "Welcome\|LibBadge" src` returns nothing
- Smoke passes against the preview build on the local stack: `npm run build && npm run preview` + `npm run smoke`

#### Manual Verification:

- Screenshots at 1440×900 of `/` (signed out, and with `?error=` banner), `/auth/signin` (clean, with server error, with field errors), `/auth/signup`, `/auth/confirm-email`
- Landing animation stops with `prefers-reduced-motion: reduce` emulated
- Final pass: every page from Phases 2–4 re-screenshotted on the final token values; kitchen sink screenshotted last
- Sign-up → sign-in → dashboard → project flow works end to end in the browser

**Implementation Note**: After automated verification passes and the human confirms the manual checks, merge `ui-layout-theme` into `master` in one merge (auto-deploy follows), then verify the deployed Worker's `/` and `/auth/signin` render with fonts loaded.

---

## Testing Strategy

### Unit Tests:

- `src/lib/demo-cabinet.test.ts`: the demo geometry passes `parseCabinetGeometry`. The landing page
  and kitchen sink depend on it.
- Existing suites must stay green. No test asserts markup; `route-access.test.ts` is untouched
  because no route gate changes.

### Integration Tests:

- None added. RLS is untouched. `npm run test:integration` is optional here, for no benefit, since
  the schema doesn't change.

### Manual Testing Steps:

1. Start the local stack (`npx supabase start`) and `preview_start` the `dev` configuration.
2. Screenshot `/dev/kitchen-sink` (no sign-in needed).
3. Sign in as a test electrician (created through sign-up in the session). Walk dashboard → profile
   → projects → new → project page in all listed states; screenshot each.
4. Sign in as the seeded admin. Walk the admin home, both catalogs and both editors; screenshot
   each.
5. Signed out: `/`, `/auth/*`; emulate reduced motion.
6. Keyboard-only pass on the project page and one editor.

## Performance Considerations

- The two font packages add roughly 4 woff2 files (latin + latin-ext, 400/500), served from the
  Worker's static assets. Use `font-display: swap` (the fontsource default).
- No new client JS: primitives render statically in `.astro`, and the islands keep their existing
  directives. The landing animation is pure CSS.

## Migration Notes

- Branch `ui-layout-theme`, one merge to `master`. Rollback is `npx wrangler rollback`: code only,
  and there is no migration in this change.
- Between phases on the branch the app is deliberately mixed (cosmic and paper pages). That is
  never deployed.

## References

- Related research: `context/changes/ui-layout-theme/research.md`
- Contract rules: `CLAUDE.md:40-71` (M2-L5), `AGENTS.md` Conventions (shadcn, `cn()`, i18n)
- Reference patterns: `src/components/ui/button.tsx:7-50` (cva variants), `src/components/forms/fields.tsx:75,132` (aria wiring), `src/components/Topbar.astro:7-10` (role home logic)
- Target view today: `src/pages/dashboard/projects/[id].astro:103-257`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Contract — tokens, fonts, primitives, kitchen sink

#### Automated

- [x] 1.1 Lint passes: `npm run lint` — 0ca49b4
- [x] 1.2 Types pass: `npx astro check` — 0ca49b4
- [x] 1.3 Unit tests pass, including the new demo-geometry test: `npm run test:unit` — 0ca49b4
- [x] 1.4 Build passes and the kitchen-sink route is not reachable in the preview build — 0ca49b4
- [x] 1.5 `bg-cosmic` still defined; no `.dark` block left in `global.css` — 0ca49b4
- [x] 1.11 Brand assets regenerate with the right dimensions: `npm run brand:assets` — 0ca49b4

#### Manual

- [x] 1.6 `/dev/kitchen-sink` shows every listed state; full-page screenshot taken — 0ca49b4
- [x] 1.7 Focus ring visible on every control type when tabbing — 0ca49b4
- [x] 1.8 Muted text, focus ring and status foregrounds meet contrast — 0ca49b4
- [x] 1.9 Polish diacritics render in Plex Sans — 0ca49b4
- [x] 1.10 Drawing elements distinguishable when desaturated — 0ca49b4
- [x] 1.12 Logo legible at 16 px and 48 px on paper, hero and mono — 0ca49b4
- [x] 1.13 og-image and apple-touch-icon eyeballed — 0ca49b4

### Phase 2: App shell + reference view (`/dashboard/projects/[id]`)

#### Automated

- [x] 2.1 Lint passes: `npm run lint` — 421f6bc
- [x] 2.2 Types pass: `npx astro check` — 421f6bc
- [x] 2.3 Unit tests pass: `npm run test:unit` — 421f6bc
- [x] 2.4 Build passes: `npm run build` — 421f6bc
- [x] 2.5 No palette colour classes or hex in the migrated files — 421f6bc

#### Manual

- [x] 2.6 Kitchen sink re-screenshotted with drawing and Banner on tokens — 421f6bc
- [x] 2.7 Project page screenshotted at 1440×900 and 1280×800 in all four states — 421f6bc
- [x] 2.8 Save details, change cabinet, save supply, delete work end to end — 421f6bc
- [x] 2.9 Sticky aside and section nav work — 421f6bc
- [x] 2.10 Keyboard-only pass with visible focus — 421f6bc

### Phase 3: Electrician pages

#### Automated

- [x] 3.1 Lint passes: `npm run lint` — 2cf49df
- [x] 3.2 Types pass: `npx astro check` — 2cf49df
- [x] 3.3 Unit tests pass: `npm run test:unit` — 2cf49df
- [x] 3.4 Build passes: `npm run build` — 2cf49df
- [x] 3.5 Palette grep over electrician pages returns nothing — 2cf49df

#### Manual

- [x] 3.6 Screenshots of dashboard, profile, projects list, new project in all listed states — 2cf49df
- [x] 3.7 Create project, save profile, list navigation work end to end — 2cf49df
- [x] 3.8 Header shows home link and sign-out on every page — 2cf49df

### Phase 4: Admin pages and editor islands

#### Automated

- [x] 4.1 Lint passes: `npm run lint`
- [x] 4.2 Types pass: `npx astro check`
- [x] 4.3 Unit tests pass: `npm run test:unit`
- [x] 4.4 Build passes: `npm run build`
- [x] 4.5 Palette grep over admin pages and editors returns nothing
- [x] 4.6 No Button colour overrides remain

#### Manual

- [x] 4.7 Admin screenshots of home, catalogs and editors in all listed states
- [x] 4.8 Create, edit, archive, restore work; rejected save restores the draft

### Phase 5: Auth, landing, cleanup

#### Automated

- [ ] 5.1 Lint passes: `npm run lint`
- [ ] 5.2 Types pass: `npx astro check`
- [ ] 5.3 Unit tests pass: `npm run test:unit`
- [ ] 5.4 Build passes: `npm run build`
- [ ] 5.5 Repo-wide palette check returns nothing
- [ ] 5.6 No hex/rgba colours in components, pages or layouts
- [ ] 5.7 No `Welcome` or `LibBadge` references left
- [ ] 5.8 Smoke passes against the preview build on the local stack

#### Manual

- [ ] 5.9 Screenshots of landing and auth pages in all listed states
- [ ] 5.10 Landing animation stops under reduced motion
- [ ] 5.11 Final re-screenshot of every page and the kitchen sink
- [ ] 5.12 Sign-up → sign-in → dashboard → project flow works end to end
