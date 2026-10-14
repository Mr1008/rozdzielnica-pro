# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project guidance lives in @AGENTS.md — commands, architecture, conventions and the RozdzielnicaPro
domain rules. Read it first; this file only adds what is specific to Claude Code.

## 10xDevs toolkit

This repo is also a 10xDevs AI Toolkit workspace. The full lesson text — chain diagram, task router,
the inclusion test, the five-pattern calibration drill — is preserved at @docs/10x-toolkit.md.

Skill chain:

```
/10x-init → /10x-shape → /10x-prd → /10x-tech-stack-selector → /10x-bootstrapper
          → /10x-agents-md → /10x-rule-review → /10x-lesson
```

| Skill                                                                        | Use it when                                                                                                                                             |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/10x-agents-md`                                                             | Regenerate or surgically update `AGENTS.md` (repo-level or directory-level)                                                                             |
| `/10x-rule-review <path>`                                                    | 5-axis scorecard for a rules-for-AI file — length, embedded snippets, precision, redundancy, ordering. Read-only unless you approve the Check 5 reorder |
| `/10x-lesson [seed]`                                                         | Append one Context/Problem/Rule/Applies-to entry to `context/foundation/lessons.md` (append-only)                                                       |
| `/10x-shape` · `/10x-prd` · `/10x-tech-stack-selector` · `/10x-bootstrapper` | Re-run upstream to fix the PRD, swap the stack or re-scaffold                                                                                           |
| `/10x-stack-assess` · `/10x-health-check`                                    | Brownfield assessment of an existing stack                                                                                                              |

**Never write to `context/archive/`.** Archived changes are immutable — if a resolved target path
starts with `context/archive/`, stop and say: "This change is archived. Open a new change with
`/10x-new` instead."

## Rules-for-AI hygiene

Before adding a rule here or to `AGENTS.md`, apply the inclusion test: _could an agent that already
knows TypeScript, Astro and Supabase figure this out without being told?_ If yes, drop it. Keep
project-specific conventions, traps and workarounds; reference canonical files with `@`-paths rather
than pasting their contents. Most important rules go at the top — attention is weakest in the middle
of a long file. Per-area rules belong in a nested `AGENTS.md` next to the code they govern.
<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 4 (E2E Tests)

**For E2E tests, use the two M3L4 skills in this order:**

1. **`/10x-e2e-setup`** — one-time setup: Playwright config (`webServer`,
   auth `setup` project, `storageState`), a green seed test, and `context/foundation/test-stack.md`.
2. **`/10x-e2e`** — the per-risk loop: risk → explore the running app with
   `playwright-cli` → generate → review against the five anti-patterns →
   re-prompt by name → verify with a deliberate break.

The skills' `references/` carry the full rules, anti-patterns, seed pattern, and
prompt-template.

A few hard rules that hold even before you invoke the skill:

- **Locators:** `getByRole` / `getByLabel` / `getByText` first; `getByTestId`
  only when accessibility attributes are ambiguous. Never CSS selectors, XPath,
  or DOM structure.
- **Never `page.waitForTimeout()`.** Wait for state: `toBeVisible()`,
  `waitForURL()`, `waitForResponse()`.
- **Test independence + cleanup.** Each test runs standalone — its own setup,
  action, assertion, and cleanup; unique ids (timestamp suffix) so parallel runs
  and re-runs don't collide.

Two boundaries to keep straight:

- **DOM (snapshot) is the default.** Vision (`--caps=vision`) is a supplement for
  visual-only risks (layout, z-index, animation); for pixel regression prefer
  deterministic tools (`toHaveScreenshot`, Argos, Lost Pixel). VLM model
  selection/cost is a debugging topic (Lesson 5), not testing.
- **A red test is a signal, not a chore.** A changed selector → update the
  locator in a reviewed diff. A changed business behavior → the test caught a
  bug; never edit the assertion to match it. Fixing failing tests is Lesson 5.

<!-- END @przeprogramowani/10x-cli -->
