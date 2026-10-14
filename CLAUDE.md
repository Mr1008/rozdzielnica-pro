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

## 10xDevs AI Toolkit - Module 3, Lesson 3 (10xDevs 4.0 Hooks)

Treat a hook as a **quality gate the harness runs for the agent**, not a script you hope the agent notices. Hooks run outside the model, so they survive context compaction and forgotten instructions — but only a hook whose signal actually reaches the agent closes the loop:

```
test-plan.md "Quality Gates" -> pick the moment per gate -> /10x-configure-hook -> prove with sample JSON -> watch the agent fix a deliberate error
```

### Task Router - Where to start

| Skill                                                            | Use it when                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/10x-configure-hook`                                            | Turning the gates from `context/foundation/test-plan.md` into agent hooks, fixing hooks that fire but the agent never reacts to, or auditing an existing hook config. It detects the harness from the repo and carries dated per-harness references. |
| `/10x-test-plan --status`                                        | Read the current gates and rollout state. Changing which gates exist belongs to Lesson 1, not here.                                                                                                                                                  |
| `/10x-new` -> `/10x-research` -> `/10x-plan` -> `/10x-implement` | A hook surfaced a failure the agent cannot fix with a trivial correction (wrong business logic, flaky integration). Open a change instead of looping the hook.                                                                                       |

### Hook lifecycle

1. **Trigger** — an event in the harness: a tool finished editing a file, the agent is about to end its turn.
2. **Matcher** — narrows which tool calls or files the hook reacts to. Not every harness honours matchers the same way.
3. **Handler** — usually a shell command or script that reads the event payload as JSON on stdin.
4. **Signal** — what the hook returns. The exit code, stderr, stdout and JSON fields mean different things in different harnesses, and only one channel per event actually reaches the agent. **The signal channel differs per harness — check the skill's references before writing or reviewing a hook.**

A hook that runs but sends its message down the wrong channel is the most common failure: the user sees "hook error", the agent sees nothing and keeps going.

### Moments and layers

The slower the check, the rarer the moment:

| Moment                               | Typical checks                                                          | Reaches the agent?               |
| ------------------------------------ | ----------------------------------------------------------------------- | -------------------------------- |
| Per edit                             | Lint/format of **the edited file only**; related tests if they are fast | Yes, mid-work                    |
| End of turn (Stop or its equivalent) | Lint + tests for every file changed this turn, whole-project typecheck  | Yes, before the agent hands back |
| Pre-commit (git)                     | Lint + tests on staged files; catches edits made without the agent      | No — blocks the commit           |
| Pre-push (git)                       | Heavier suites, e2e that run locally                                    | No — blocks the push             |
| CI                                   | Integration, shared state, infrastructure you do not have locally       | No — PR feedback                 |

Local layers do not replace CI; each one saves a CI round-trip. Start with one per-edit lint hook and one end-of-turn typecheck, then add layers when you see what escapes.

### Contract

- Read the gates from the "Quality Gates" section of `context/foundation/test-plan.md` (by title, not section number). A gate the plan explicitly defers stays deferred unless the user overrides it — quote the deferral when you ask.
- Per-edit hooks check only the file that was edited. Never run `--fix` or a linter over the whole project on every edit.
- End-of-turn hooks that can send the agent back must stop after one retry (the harness's "already continued" flag or equivalent), so an unfixable error does not loop.
- Per-edit hooks only see the harness's edit tools; a file rewritten through a shell command skips them. The end-of-turn hook re-checks every file changed this turn (`git diff`), so it is the net for those edits.
- Timeouts are usually in **seconds**. Check the unit before copying a number.
- Prove every hook before trusting it: run the script with a sample payload on a deliberately broken file and on a clean one, then revert the error.
- Never overwrite existing hook config silently. Audit it, name the defects, merge, and show the diff.

### Lesson boundaries

- Do not change the risk strategy or the gate definitions — that is Lesson 1 (`/10x-test-plan`).
- Do not write new tests here — hooks only run the tests Lesson 2 produced.
- Do not write E2E scenarios or browser verification — that is Lesson 4.
- Do not author CI pipelines or install git-hook managers unasked; recommend pre-commit/pre-push gates, let the user decide.

<!-- END @przeprogramowani/10x-cli -->
