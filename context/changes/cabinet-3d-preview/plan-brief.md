# Cabinet 3D Preview — Plan Brief

> Full plan: `context/changes/cabinet-3d-preview/plan.md`

## What & Why

The electrician gets a 3D view of the planned switchboard (cabinet, devices, PE/N bars, comb busbars
and wires) that they can rotate, zoom and pan with the mouse. It answers the "how deep, what's behind
what" questions that the 2D front drawing can't. This is the parked roadmap idea
[#14](https://github.com/Mr1008/rozdzielnica-pro/issues/14). No FR requires it, and it must not
disturb anything that does.

## Starting Point

- **The data is already there.** Every device's depth is in the project snapshot. Built-in bars carry
  `zMm`, and `DrawnDevice.rect` gives each front-view box.
- **Wires are 2D.** The browser-side router (`routeWiring`) produces 2D orthogonal routes. It also
  records side packs, overflow layers, tied bundles and runs behind devices.
- **The view switch** is two server links (`?wiring=schematic`).
- **No 3D library is installed.**

## Desired End State

"Widok: realistyczny / schematyczny / **3D**". The 3D option loads a WebGL scene whose front view
matches the 2D drawing exactly; turned sideways, it shows wires dropping to terminals, packs along the
walls and runs behind devices. Without WebGL there is a Polish Alert with a link back. three.js loads
only in that view. Routes, lengths, the quote and the printout are unchanged.

## Key Decisions Made

| Decision      | Choice                                                   | Why (1 sentence)                                                                        |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Scene content | Full scene including wires in 3D                         | The wiring look is the point of S-11; 3D without it would show less than 2D.            |
| Wire depth    | Pure 3D lift after routing; router untouched             | One route and one length still feed 2D, the lengths table and print; zero risk to them. |
| Length gap    | 3D path slightly longer than `lengthMm`, accepted        | Reconciling would change lengths for every project, for a display-only view.            |
| Entry point   | Third "Widok" option `?wiring=3d`, replaces editor there | Fits the server-link switch; three.js loads only when chosen.                           |
| Renderer      | @react-three/fiber + drei `OrbitControls`, `client:only` | Declarative React scene; rotate/zoom/pan built in; R3F 9 supports React 19.2.           |
| Cabinet body  | Open box: back plate + four thin walls, no door          | Honest to the data (interior dims only); depth constants are named display assumptions. |
| No WebGL      | Polish Alert + link to realistic view                    | Clear and cheap; no silent fallback that looks like a broken "3D" tab.                  |
| Testing       | Unit tests for both pure modules + one Playwright smoke  | Logic pinned in Vitest (node env); E2E catches a broken lazy import or mount.           |
| `3d` type     | New `DrawingView`, not a third `WiringVariant`           | `WiringVariant` drives the 2D drawing and printout, which must not see `3d`.            |

## Scope

**In scope:**

- the `src/lib/cabinet-3d.ts` box model and depth constants;
- the `src/lib/wiring-3d.ts` wire and busbar lift;
- the three-way view switch and Polish strings;
- the R3F island with a WebGL fallback;
- kitchen-sink states, an E2E smoke test, and the `layout-wiring.md` rule.

**Out of scope:**

- router, length, quote or printout changes;
- editing in 3D, or showing unsaved drafts;
- legend, labels or warnings in 3D;
- door, frame or catalog depth data;
- a landing-page 3D hero;
- wire sag and ferrules in 3D;
- touch;
- depth-fit validation;
- roadmap edits.

## Architecture / Approach

```
page (server): drawing.devices + snapshot depth_mm + drawing.wiring ──► Cabinet3DData (only on ?wiring=3d)
island (browser): routeWiring(wiring) ─► liftWiring(…) ─┐
                  buildCabinetScene(data) ──────────────┴─► R3F Canvas + OrbitControls (axis flip here only)
```

Both pure modules work in cabinet mm: x right, y down, z from the back plate toward the viewer. They
contain no three.js and are unit-tested.

**The lift.** Endpoints sit at terminal or bar depth, and channels at the shallowest terminal depth.
Segments over a device body run between the plate and the rail. The overflow layer sits one bundle
width behind, and bundle members are spread in z. Each depth change is a pure-z step, so the front view
equals the 2D route exactly.

## Phases at a Glance

| Phase                          | What it delivers                                               | Key risk                                                    |
| ------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------- |
| 1. 3D scene model              | `cabinet-3d.ts`: cabinet, rails, devices, bars as mm boxes     | Depth constants look wrong against real enclosures          |
| 2. 3D wire & busbar lift       | `wiring-3d.ts`: every conductor as a 3D polyline, busbar boxes | Bundle spreading or behind-device detection looks odd in 3D |
| 3. 3D view on the project page | `?wiring=3d`, R3F island, token colours, WebGL fallback        | three.js leaking into the default view's chunks             |
| 4. Kitchen-sink, E2E, docs     | UI states, Playwright smoke, area rule, final gate             | Headless chromium WebGL may need SwiftShader flags          |

**Prerequisites:** a local Supabase stack, for the E2E test and the manual checks on a placed project.

**Estimated effort:** about 2–3 sessions across 4 phases. Phase 2 and Phase 3 are the bulk.

## Open Risks & Assumptions

- **Invented constants.** Rail standoff, terminal depth ratio, wall thickness and built-in bar depth
  are display assumptions, not catalog data. They are named in one place, so they are easy to tune.
- **Bundles are approximate.** Spreading members in z keeps tubes from passing through each other, but
  it won't match a hand-tied bundle's exact cross-section.
- **Dependency peer range.** R3F 9 caps React at `<19.4`, so a future React bump must move R3F with it.
- **oklch colours.** Tokens are converted to sRGB at runtime through a 1-pixel canvas, which avoids
  relying on three.js's CSS parser.

## Success Criteria (Summary)

- On a placed project, "3D" shows the full switchboard. From the front it matches the 2D drawing, and
  it rotates, zooms and pans smoothly with the mouse.
- Nothing else changes. The default and schematic views, wire lengths, the quote and the printout stay
  as they were, and the default view never downloads three.js.
- `lint`, `test:unit`, `astro check`, build and the `cabinet-3d` E2E smoke are green.
