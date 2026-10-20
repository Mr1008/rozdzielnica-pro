# E2E Quality Rules

These rules govern every E2E test the agent writes. They are **not** copied into
your agent's rules file (`CLAUDE.md`, `AGENTS.md`, …): they matter only while
you work on E2E tests, so they ship with the skills and load when one runs.
`/10x-e2e-setup` writes the seed to follow them; `/10x-e2e` reads this file
before it generates a test and reviews every test against it. The rules
constrain the agent's output so generated tests are stable by default — agents
apply known patterns far more reliably than they invent new ones.

## The rules (Playwright)

```
# E2E Testing Rules

- Use getByRole, getByLabel, getByText as primary locators.
  Fall back to getByTestId only when accessibility attributes are ambiguous.
- Never use CSS selectors, XPath, or DOM structure for locating elements.
- Each test must be independently runnable — no shared state between tests.
- Never use page.waitForTimeout(). Wait for specific conditions:
  toBeVisible(), waitForURL(), waitForResponse().
- Assert the business outcome, not implementation details.
- Use unique identifiers (e.g., timestamp suffix) for test data
  to avoid collisions in parallel runs. Clean up in afterEach and
  assert every cleanup call succeeded (expect(res).toBeOK()) — a
  cleanup that fails silently leaves data behind while the test stays green.
- Use storageState for authentication — never log in through UI
  in individual tests.
```

## Governing rules (the reasoning behind the rules)

- **Don't generate E2E tests from scratch.** Start from `test-plan.md`: pick the
  2–3 highest risks that need browser-level coverage and feed them as input. A
  risk needs E2E when it crosses several system boundaries (auth, routing, API,
  DB) or exists only in the rendered UI; if an isolated function can prove it, a
  unit test is enough.
- **E2E ≠ zero mocking.** Internal boundaries (auth, routing, DB) stay real —
  that's where integration risk hides. Mock expensive/non-deterministic external
  APIs (LLMs, payment gateways) at the network layer.
- **Name the test after the risk:** `test('flashcard data persists after page
  reload', ...)`, not `test('test 1', ...)`.
- **The assertion must fail if the risk materializes.** Control question for
  every assertion: would this fail if the `test-plan.md` risk came true? If not,
  it's decorative.

## Why these rules (source authority)

Every rule traces to Playwright's official Best Practices and Test Assertions
docs:

- `getByRole` is the recommended default locator strategy; CSS selectors couple
  tests to implementation details.
- Each test must be completely isolated with its own storage, data, cookies.
- Web-first assertions wait until conditions are met; `waitForTimeout` is
  officially designated an anti-pattern ("Never wait for timeout in production.
  Tests that wait for time are inherently flaky").
- `storageState` is the standard pattern for authenticated tests.

## Other stacks

The rules above are Playwright syntax; the principles are tool-agnostic. Map
each to your tool's idiom:

| Principle | Playwright | Cypress | WebdriverIO / Selenium |
| --- | --- | --- | --- |
| Role-based locator | `getByRole` | `cy.findByRole` (Testing Library) | accessibility-name / role strategy |
| Wait for state | `expect().toBeVisible()`, `waitForResponse` | `cy.contains().should('be.visible')`, `cy.intercept` | explicit waits on conditions, never `sleep` |
| Test isolation | parallel workers, own data | `beforeEach` reset, no shared aliases | fresh session per test |
| Auth without UI | `storageState` | `cy.session` | saved cookies / token injection |
| Data cleanup | unique ids + `afterEach`, each call asserted | unique ids + `afterEach`, each call asserted | unique ids + teardown, each call asserted |

If you work on a non-Playwright stack, write these mappings into your seed test
and your E2E prompts so the agent produces idiomatic, stable tests for your tool.

## Project conventions — RozdzielnicaPro

Local additions to the rules above; they win where the two differ. Exemplars:
`tests/e2e/seed.spec.ts` (risk #2) and `tests/e2e/layout-manual-edit.spec.ts` (risk #4).

- **Locators use the Polish UI text verbatim.** Take every accessible name from the snapshot or
  from `src/lib/i18n/pl.ts`, with its typographic quotes (`„Obwód 1”`) — never translate or retype
  it. A name that embeds state is matched whole with `exact: true`: a layout device is
  `Aparat „B16 Obwód 1”, szyna DIN 1, pozycja 5 TE`, so its rail and position are part of the
  assertion.
- **Hydration.** Plain Astro forms (new project, supply, delete) need no wait. React islands
  (sign-in, circuit editor, layout editor — `client:load` / `client:only`) drop input typed before
  they hydrate: call `waitForIslands(page)` from `tests/e2e/hydration.ts` before the first input,
  and again after every navigation that re-renders the island.
- **Wait for the redirect, not the response.** Form endpoints answer with a redirect carrying
  `?saved=<what>` on success and `?error=<code>` on failure: `await page.waitForURL(/saved=circuits/)`.
  An `?error=` URL is a failed step, never a state to assert around.
- **Assert the stored state.** Reload (or `goto` the project path) before the risk assertion, so it
  reads what the database kept, not the page the save produced.
- **Test data and cleanup.** Name everything `E2E <scenario> ${Date.now()}` and record it with
  `test.info().annotations.push({ type: "test-data", … })`. Capture the project id right after
  creation and delete it in `afterEach` through
  `POST /api/projects/<id>/delete` with `form: { confirm_delete: "on" }`,
  `headers: { Origin }`, `maxRedirects: 0`; assert `302` and a `deleted=1` location. Deleting the
  project cascades to its circuits, devices and placements. Never clean up in the test body — a
  red run stops before it.
- **Residue check** after the green and the deliberate-break runs:
  `docker exec supabase_db_10x-astro-starter psql -U postgres -tAc "select count(*) from public.projects where name like 'E2E%'"` must print `0`.
- **Catalog facts come from `supabase/seed.sql`** (local only): no MCB above B32 and no B40 in any
  pole count (the catalog-gap case), cabinets "mała / średnia / duża". Tests rely on them and never
  edit the catalog — the admin catalog is shared by every parallel test.
- **Roles.** Every spec runs as the `elektryk` test user (`E2E_USERNAME`). An admin-path or
  cross-user (IDOR, risk #6) test needs its own user and `storageState` file; never reuse the
  electrician's session for it, and never sign the shared user out.
- **Deliberate break.** Many rules are guarded twice (the layout editor's `moveDevice` and
  `validateLayout`, client and server). Breaking one guard can rightly leave the test green: break
  until the risk itself materializes end-to-end, and check that the local catalog can actually
  produce the failure (relaxing `===` to `>=` substitutes nothing when no larger device exists).
