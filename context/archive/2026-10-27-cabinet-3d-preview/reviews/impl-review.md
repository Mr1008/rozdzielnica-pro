<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Cabinet 3D Preview

- **Plan**: context/changes/cabinet-3d-preview/plan.md
- **Scope**: Full plan (commits `ef8a521..HEAD`, through `ec38f8e`)
- **Reviewed phases**: 1, 2, 3, 4, 5
- **Date**: 2026-10-28
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 5 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Invariants checked

| Invariant                                                           | Result              | Evidence                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Router, routes and lengths untouched                                | Holds               | `git diff ef8a521..HEAD` is empty for `cabinet-wiring.ts`, `wiring-island.ts`, `layout-server.ts`, `quote*.ts` and `wire-dimensions.ts`. `cabinet-drawing.ts` only moves code without changing behaviour (`runSagMm`, `SAG_CONTROL_FACTOR`, `realisticSagLimits`, `FERRULE_EXTRA_MM`, `isWireCrossSection`). Its 2D call sites compute the same values, and the existing drawing tests are green. |
| `WiringVariant` has no `3d`                                         | Holds               | `cabinet-drawing.ts:321` is still `"realistic" \| "schematic"`. `DrawingView` lives in `wiring-view.ts:11`, and `wiringVariantOf("3d")` → realistic is tested. No test pins `WIRING_VARIANTS` itself (see F2).                                                                                                                                                                                    |
| three.js only in `Cabinet3D*.tsx`, and absent from the default view | Holds               | A grep finds three.js imported only in `Cabinet3DKit.tsx:2-22` and `Cabinet3DScene.tsx:3-15`. `Cabinet3DPreview.tsx:11` loads the scene through `React.lazy`. In the built `dist/client/_astro`, `WebGLRenderer` appears only in `Cabinet3DScene.*.js`, and only `Cabinet3DPreview.*.js` references it. Nothing automated guards this (see F2).                                                   |
| Models stay inside their pure-model boxes                           | Holds and is tested | `cabinet-3d-models.test.ts` checks it with `expectInside` for devices, bars, rails, busbars and the cabinet.                                                                                                                                                                                                                                                                                      |
| 3D wires reuse the 2D realistic rules                               | Mostly holds        | `bendRadiusMm`, `realisticSagLimits`, `runSagMm`, `FERRULE`, `buildCableTies` and `buildDrawnCables` are all imported, not restated. The one exception is the per-corner bend clamp, which is copied (F1).                                                                                                                                                                                        |
| Polish UI through `pl.ts`                                           | Holds               | All new copy is under `layout.section.preview3d`, `view.options["3d"]` and `devTools.kitchenSink`. The label texture draws the existing `DrawnDevice.lines`.                                                                                                                                                                                                                                      |
| Colours from tokens only                                            | Holds               | Components contain no hex, `rgb`/`rgba`, `0x…` or palette classes. The 8 new tokens are in `:root` and `@theme inline`.                                                                                                                                                                                                                                                                           |
| `cn()`                                                              | Holds               | No class strings are concatenated or built from template literals.                                                                                                                                                                                                                                                                                                                                |
| Pure modules are bundle-safe                                        | Holds               | `cabinet-3d.ts`, `cabinet-3d-models.ts`, `wiring-3d.ts` and `wiring-view.ts` import only pure `src/lib` modules, and nothing that touches Supabase.                                                                                                                                                                                                                                               |

## Success criteria

- This review ran: `npm run lint` (exit 0), `npm run test:unit` (60 files, 1482 tests, all pass), and `npm run build` (exit 0, with the expected chunk-size warning).
- This review did not re-run `npx astro check` or `npm run test:e2e -- cabinet-3d`. The phase 5 session reports both green (`astro check`: 0 errors after the `matchContext?.geometry` fix; E2E: 4/4 without SwiftShader, with a break-check that went red).
- Manual rows 1.3, 3.4–3.8, 4.5–4.9 and 5.6 are ticked. Their evidence is the screenshots and JSON in the session notes folder (`phase-3-evidence/`, `phase-4-evidence/`, `phase-5-evidence/`), not in the repo. Row 4.8 records 60 fps (p95 19.1 ms) on the large layout. Nothing points to rubber-stamping.

## Findings

### F1 — The 3D bend clamp copies the 2D rule instead of sharing it

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/lib/wiring-3d.ts:418-431 (copy of src/lib/cabinet-drawing.ts:381-389)
- **Detail**: `smoothConductor3D` rebuilds the per-corner radius `min(bendMm, before/2, after/2)`, then the clamp that keeps the first and last runs straight for a ferrule's length. This is a line-for-line copy of the private `wirePathPieces` logic in `cabinet-drawing.ts`. The `layout-wiring.md` rule this change added says "never fork a 3D-only bend, sag, ferrule or tie rule". The two copies agree today, but a later change to the 2D clamp (for example a different straight length per end) would make the 3D bends drift without any test noticing. The `wiring-3d.test.ts` "within one bend radius" test checks the 3D output only against itself, not against 2D.
- **Fix**: Extract the clamp into an exported pure helper in `cabinet-drawing.ts`, for example `cornerRadiiMm(runLengths, bendMm, straight)`. Have `wirePathPieces` and `smoothConductor3D` both call it.
  - Strength: One rule with one test, in line with the area rule. It follows how `runSagMm` and `realisticSagLimits` were already extracted in this change.
  - Tradeoff: Touches the 2D drawing module again. The 2D drawing tests must stay byte-identical.
  - Confidence: HIGH — both sides already take the same inputs (segment lengths, bend radius, straight start and end).
  - Blind spot: The 2D code measures run length in Manhattan distance and 3D in Euclidean distance. Both are equal on orthogonal runs, but the helper has to take lengths rather than points.
- **Decision**: FIXED in 0f9869f — `cornerRadiiMm(runLengthsMm, bendMm, straight)` in `cabinet-drawing.ts`, called by `wirePathPieces` and `smoothConductor3D`, with its own test; the existing 2D drawing tests pass unchanged.

### F2 — Nothing automated guards the bundle and type invariants

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: eslint.config.js (no rule); src/lib/wiring-view.test.ts
- **Detail**: "three.js imported only by `Cabinet3D*.tsx`" and "absent from the default view's chunks" are protected only by a prose rule in `layout-wiring.md` and by manual rows 3.6 and 4.9. A single `import … from "three"` in a pure `src/lib` module, or a static import of `Cabinet3DScene` in place of `lazy()`, would pass lint, the unit tests, the build and the E2E smoke test. Likewise, no test fails if someone adds `"3d"` to `WIRING_VARIANTS`.
- **Fix**: Add an ESLint `no-restricted-imports` rule that bans `three`, `three/*` and `@react-three/*` everywhere except `src/components/projects/Cabinet3D*.tsx`. Add one assertion to `wiring-view.test.ts` that `WIRING_VARIANTS` does not contain `"3d"`.
- **Decision**: FIXED in 0f9869f — `no-restricted-imports` in `eslint.config.js` bans `three`, `three/*` and `@react-three/*` outside `src/components/projects/Cabinet3D*.tsx` (a deliberate `import … from "three"` in `wiring-view.ts` failed lint, then was reverted); `wiring-view.test.ts` asserts `WIRING_VARIANTS` has no `"3d"`.

### F3 — No handling of a lost WebGL context

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/projects/Cabinet3DScene.tsx:378 (`onCreated`)
- **Detail**: `SceneErrorBoundary` catches render errors and errors while creating the context. A `webglcontextlost` event after mount (a GPU reset or driver hiccup, or too many contexts open in other tabs) leaves a blank canvas without the Polish Alert. That is the "silently broken 3D tab" the plan set out to avoid.
- **Fix**: In `onCreated`, listen for `webglcontextlost` on `gl.domElement` and switch the preview to `Cabinet3DUnavailable`.
- **Decision**: FIXED in 0f9869f — `onCreated` listens for `webglcontextlost` and the scene rethrows during render, so `SceneErrorBoundary` shows `Cabinet3DUnavailable`.

### F4 — A token that fails to resolve silently becomes black

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/projects/Cabinet3DKit.tsx:56-67
- **Detail**: `makeTokenReader` sets `ctx.fillStyle` to `getPropertyValue('--token')`. A misspelled or missing token gives an empty string, which the canvas ignores. The cleared pixel then reads `(0,0,0)`, so the material is black with no error. The same happens when the 2D context is null. A typo in a token name, or a token renamed in `global.css`, would ship as a black part, and no test covers it, because Vitest has no DOM.
- **Fix**: Throw when the property value is empty or the context is null, so the error boundary shows the Alert. A wrong token then fails loudly in the E2E console check.
- **Decision**: FIXED in 0f9869f — `makeTokenReader` throws on an undefined token or a null 2D context.

### F5 — Phase 4's instancing contract was only partly met, and the plan was not amended

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/projects/Cabinet3DScene.tsx:68, :235, :260-296
- **Detail**: The plan says screws, ties and ferrules are "instanced where there are many repeats". Only ferrules use `InstancedMesh`. Screws are merged into each element's per-material mesh (`mergeParts`), and ties are four boxes each, merged into one mesh. The measured 60 fps on the largest layout shows the goal was met. Similarly, criterion 2.3 ("no change to `cabinet-drawing.ts`") was later superseded by Phase 4's reuse of the helpers. That is reasonable, but the plan does not say so.
- **Fix**: Add a one-line note to the plan's Phase 4 that merged meshes replaced instancing for screws and ties, and that `cabinet-drawing.ts` received behaviour-preserving extractions.
- **Decision**: FIXED in 0f9869f — an "As built" note in the plan's Phase 4.

### F6 — Dead exports and a stale comment

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/cabinets/CabinetDrawing.tsx:84, :96; src/lib/wiring-view.ts:29; src/components/projects/LayoutSection.astro:48
- **Detail**: Phase 3 exported `BAR_CLASSES` and `DEVICE_CLASSES` so the 3D view could take its colours from them. After the Eaton-housing change in `0a568da`, nothing imports them. `wiringViewFromParam` survives only in its own test, since both call sites moved to `drawingViewFromParam`. The `LayoutSection.astro:48` comment still cites `wiringViewFromParam`.
- **Fix**: Un-export the two class maps, delete `wiringViewFromParam` and its test, and point the comment at `wiringVariantOf`.
- **Decision**: FIXED in 0f9869f — `BAR_CLASSES` / `DEVICE_CLASSES` un-exported, `wiringViewFromParam` and its test deleted, the `LayoutSection.astro` comment points at `wiringVariantOf`.

### F7 — The R3F peer range caps React below the caret range in `package.json`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: package.json:41 (`@react-three/fiber ^9.8.2`), with `react` / `react-dom` at `^19.2.6`
- **Detail**: `@react-three/fiber` 9.8.2 declares `react >=19 <19.4`, but the caret on React lets `npm update` move to 19.4, which breaks the peer range (and `npm ci` once the lockfile is refreshed). The plan brief lists this as a risk, but neither the repo nor the area rule records it anywhere a future dependency bump would see it.
- **Fix**: Add a deploy-tooling or `layout-wiring.md` note that a React minor bump must move `@react-three/fiber` with it. Or pin React to `~19.2.6` until R3F widens its range.
- **Decision**: FIXED in 0f9869f — a note in `context/foundation/agent-rules/deploy-tooling.md`; React not pinned.

### F8 — Disposing in an effect cleanup next to `useMemo` breaks on a remount

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/projects/Cabinet3DKit.tsx:401-404; Cabinet3DScene.tsx:68-72, :198-199, :246, :289-294
- **Detail**: Geometries, materials and textures are created in `useMemo` and disposed in a `useEffect` cleanup. Under React StrictMode's dev double-effect (or any future effect replay), the cleanup disposes resources that the memo then hands back. three.js usually re-uploads them, so this is latent rather than broken today. Astro islands do not enable StrictMode.
- **Fix**: If StrictMode is ever turned on, create the owned objects inside the effect (or a ref-guarded lazy init) rather than in `useMemo`.
- **Decision**: SKIPPED — Jakub's decision (2026-10-28).

### F9 — The kitchen-sink page pulls in the preview island module to render only the Alert

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/dev/kitchen-sink.astro:10
- **Detail**: `Cabinet3DUnavailable` is a named export of `Cabinet3DPreview.tsx`, so the dev page's server render imports the island module along with `cabinet-wiring` and `wiring-3d`. It does not import three.js, because the scene is lazy, and it is server-rendered only. This is harmless, but it couples the static Alert to the island.
- **Fix**: Move `Cabinet3DUnavailable` into its own `Cabinet3DUnavailable.tsx`. Leave it as is if the coupling does not matter.
- **Decision**: SKIPPED — Jakub's decision (2026-10-28).
