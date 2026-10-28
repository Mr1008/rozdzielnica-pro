# Test stack

## E2E

<!-- Written by /10x-e2e-setup. Re-run it to change this section; other skills only read it. -->

- runner: Playwright Test, @playwright/test 1.64.1
- config: playwright.config.ts
- single-spec command: npx playwright test tests/e2e/<name>.spec.ts
- full-suite command: npm run test:e2e (= npx playwright test); local and in the CI `smoke` job (after `test:integration`, report uploaded on failure)
- base URL: http://localhost:4321
- port: 4321 (detected from the `astro preview` default — astro.config.mjs sets no server.port; detected default 4321, override with E2E_PORT)
- web server command: npm run build && npm run preview -- --port $E2E_PORT; reuseExistingServer outside CI
- auth setup project: setup (tests/e2e/auth.setup.ts), electrician A from E2E_USERNAME / E2E_PASSWORD in .env when both are set, otherwise provisioned in the local Supabase stack (`npx supabase start`) through its admin API — CI needs no secrets; further users via `provisionElectrician` + `signedInContext` (tests/e2e/support.ts); the preview reads SUPABASE_URL / SUPABASE_KEY from .dev.vars
- storageState: playwright/.auth/user.json (gitignored)
- seed: tests/e2e/seed.spec.ts — protects risk #2 (catalog gap reaches the project page as an error, never as a substitute device)
- browser CLI: playwright-cli, command skill at .claude/skills/playwright-cli/SKILL.md
- updated: 2026-10-20

## E2E specs

<!-- Maintained by hand: one line per spec, with the test-plan.md risk it covers. -->

| Spec                                     | Risk (`test-plan.md` §2) | What the electrician does / sees                                                                           |
| ---------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `tests/e2e/seed.spec.ts`                 | #2                       | Catalog gap (no B40 in the local seed) shows on the project page as an error, never as a substitute device |
| `tests/e2e/layout-manual-edit.spec.ts`   | #4                       | Dragging an MCB away from its RCD group is refused; only the accepted edit is saved and redrawn            |
| `tests/e2e/circuits-match-state.spec.ts` | #2                       | Saved circuits read back intact; a supply change shows "Dobierz ponownie" until re-matched                 |
| `tests/e2e/idor.spec.ts`                 | #6                       | Another electrician gets 404 / `not_found` from every project page and endpoint; the project is unchanged  |
| `tests/e2e/quote-override.spec.ts`       | #5, #6                   | Override refused without a profile or a current match; base computed by the server; estimate restorable    |
