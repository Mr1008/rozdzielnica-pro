# UI layout & theme ("Arkusz techniczny") — Plan Brief

> Full plan: `context/changes/ui-layout-theme/plan.md`
> Research: `context/changes/ui-layout-theme/research.md`

## What & Why

The app looks like the starter template. Every page covers the design tokens with a dark "cosmic"
gradient and hardcoded white, purple and amber classes. The tokens, and the one shadcn component
(`Button`), describe a UI nobody sees. This change moves the whole app onto a light,
electricity-themed design system, so colour, type and surfaces come from one source. The planning
screens favour electrician usability on desktop; the landing page is where the app shows off.

## Starting Point

`global.css` holds unused shadcn neutral tokens and a `bg-cosmic` hex utility used by 15 pages. The
app has three hand-assembled page shells and three separate form-field systems. The top bar and
banners only work on the dark background, and the cabinet drawing uses fixed palette colours inside
white frames. There are no status colours, no fonts, and no visual tests.

## Desired End State

Every page renders on "Arkusz techniczny": paper surfaces, ink text, hairline borders, a
blueprint-indigo accent, IBM Plex type, and IEC conductor colours for PE/N/L. Every signed-in page
shares one app shell with a header bar. The project page is a two-column desktop workspace with a
sticky drawing and summary. `/` is a Polish, futuristic landing page with a live drawing. A grep
finds no palette, hex or rgba colour anywhere in components or pages. `/dev/kitchen-sink` shows every
state of the contract.

## Key Decisions Made

| Decision          | Choice                                                                                                                                                                                                  | Why (1 sentence)                                                                              | Source          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| Visual direction  | Light technical sheet; no dark mode, `.dark` block removed                                                                                                                                              | The drawing already sits on white paper, and a light UI converges with the S-09 browser print | Research → Plan |
| Scope             | **All pages**, shells swapped everywhere                                                                                                                                                                | User choice; deliberately overrides CLAUDE.md's "one view + global tokens" guidance           | Plan (user)     |
| Sequencing        | Contract → reference view → areas; each page migrated whole                                                                                                                                             | Proves the contract before it spreads, and never leaves white-on-light text                   | Plan            |
| Delivery          | Branch `ui-layout-theme`, one merge                                                                                                                                                                     | `master` auto-deploys, and the app is intentionally mixed between phases                      | Plan            |
| Reference view    | `/dashboard/projects/[id]` in Phase 2                                                                                                                                                                   | Most hardcoded (43), core screen, hosts the drawing, grows in S-04–S-09                       | Research        |
| Accent / type     | Blueprint indigo (`indigo-700`) + IBM Plex Sans/Mono via `@fontsource` (**2 new deps**)                                                                                                                 | Reads as a technical drawing and stays distinct from N-blue and amber warnings                | Plan (user)     |
| Electricity theme | IEC 60445 conductor colours as domain tokens + a separate hero register (night blueprint, cyan "current") for landing/auth                                                                              | Keeps the domain meaning of colours intact while making the public pages expressive           | Plan (user)     |
| Target device     | Desktop-first; stacks below `lg`, no mobile design                                                                                                                                                      | PRD non-goal; the user asked for desktop UX for electricians                                  | Plan (user)     |
| Primitives        | `shadcn add input label card alert badge` + own `NativeSelect` and `Field`                                                                                                                              | Uses the existing system (no second one); a native select keeps no-JS form POSTs              | Research → Plan |
| Brand & assets    | Own mark (cabinet outline + DIN modules + lightning "current"), text wordmark, SVG favicon + generated PNG favicon/touch icon/OG image via `npm run brand:assets` (sharp, already transitive via astro) | Replaces the starter's favicon/template image; one SVG master themes on paper, hero and mono  | Plan (user)     |
| Visual check      | Dev-only `/dev/kitchen-sink` (404 outside `astro dev`), screenshotted by hand per phase                                                                                                                 | The repo has no screenshot harness; `CLAUDE.md:64` says not to add one                        | Plan (user)     |

## Scope

**In scope:**

- Tokens, fonts and primitives.
- The app shell, `Topbar`, `Banner` and `CabinetDrawing`.
- All 15 pages and the landing page.
- All three field systems, the auth kit and both admin editors.
- The kitchen sink.
- The logo, favicon, touch icon, OG image and hero pattern, plus their generator script.
- Deleting `bg-cosmic` and `LibBadge`.
- An `AGENTS.md` token rule.

**Out of scope:**

- Dark mode or a theme toggle.
- Mobile design.
- Print CSS (S-09).
- Any endpoint, field-name, route-gate or database change.
- Drawing label overlap and greyscale print semantics (S-06/S-09).
- A screenshot test harness.

## Architecture / Approach

There is one token source, `global.css`, with two registers:

- **Workspace:** paper, ink and indigo, used on signed-in pages.
- **Hero:** night blueprint with cyan "current", used on landing and the auth side panel.

Plus the domain tokens (conductor and drawing colours). The shadcn primitives read the tokens and
render statically in `.astro` pages (no new client JS). `AppLayout` + `PageHeader` replace the
per-page shells, and `Topbar` becomes the header bar inside `AppLayout`. Pages keep their frontmatter
data loading and form contracts byte-for-byte in meaning; only presentation changes.

## Phases at a Glance

| Phase                     | What it delivers                                                                               | Key risk                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. Contract               | Tokens, fonts, 5 shadcn primitives + `NativeSelect`/`Field`, logo + brand assets, kitchen sink | shadcn CLI rewriting `global.css`/`button.tsx` — review its diff      |
| 2. Shell + reference view | `AppLayout`, header bar, tokenised Banner/drawing, project page as a desktop workspace         | Form field names/ids must not change (endpoint contract)              |
| 3. Electrician pages      | Dashboard, profile, projects list, new project                                                 | `new.astro` shares components migrated in Phase 2                     |
| 4. Admin + editors        | Admin pages, `fields.tsx`, Cabinet/Device editors without Button overrides                     | Large React islands; draft-restore must still work                    |
| 5. Auth, landing, cleanup | Split auth layout, Polish landing on hero tokens, repo-wide colour check, `AGENTS.md` rule     | Landing motion vs `prefers-reduced-motion`; the no-role banner on `/` |

**Prerequisites:** local Supabase stack running (signed-in screenshots, smoke), network access for
`npx shadcn` and `npm install`, branch `ui-layout-theme` created from `master`.
**Estimated effort:** ~5 sessions, one per phase; Phases 2 and 4 are the largest.

## Open Risks & Assumptions

- The mixed look between phases is acceptable only because nothing merges before Phase 5.
- Token values are this plan's choices. Contrast is checked in the browser in Phase 1; if the muted
  ink fails 4.5:1, the value changes and not the rule.
- IEC 60445 names the colours, not their screen values. The oklch/hex approximations are ours and
  documented as such.
- The desktop-first layout may be cramped below `lg`. That is accepted, since mobile is a non-goal.

## Success Criteria (Summary)

- An electrician plans a project on a calm, legible desktop workspace where the cabinet drawing,
  supply status and actions are all in view; every flow still works as before.
- No page, component or island carries a hardcoded palette, hex or rgba colour. Changing the look
  means editing `global.css`.
- A first-time visitor sees a Polish, modern landing page that shows the product itself (a real
  cabinet drawing) and leads to sign-up.
