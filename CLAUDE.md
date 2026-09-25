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

## 10xDevs AI Toolkit - Module 2, Lesson 5 (10xDevs 4.0 UI)

Treat a visual change as a **10x change with a design-system contract**, not a "make it pretty" chat:

```
/10x-new -> audit+reference research -> plan (tokens then one view) -> implement -> screenshot gate -> /10x-impl-review
```

### Task Router - Where to start

| Skill                          | Use it when                                                                                                                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/10x-ui`                      | A view that already renders and needs auditing and improving: theme, restyle, "nicer UI", tokens, visual pass — on the course app or any other stack. Not for building the view in the first place. |
| `/10x-research`                | Locate this repo's value source and shared components, map which views read them, and pick a named motif — not a moodboard. Output is a list of charges (file, line, user impact).                  |
| `/10x-plan` / `/10x-implement` | Same chain as earlier M2 lessons; payload is UI.                                                                                                                                                    |
| `/10x-impl-review`             | Before merge; do not skip visual findings as cosmetic.                                                                                                                                              |

### Contract

- Two halves, whatever the stack: semantic tokens in one source, and importable components living in the repo. Tailwind v4 `@theme` + shadcn is how the course app realises them; read this repo's own realisation before proposing values.
- Values taken from outside go into the repo with a line naming the source. Not into the chat history.
- One view + global tokens. Not a whole-MVP rebrand. Not worktrees/`/goal`.
- Three charge categories: missing tokens, missing shared component, accidental architecture.
- Visual gate: a kitchen sink rendering every state, screenshotted; wire it into a screenshot test only if the repo already has one. Do not blind-update baselines.
- No design system in the repo? Proposing one is allowed — marked as adding a dependency, scoped to what the change needs, and always losing to a system that already exists.
- Models: route by phase, not vendor. Strongest model you have for audit, plan and review; a cheaper working tier for implementing charges in the loop; escalate only when the same charge survives two rounds. Any vision-capable model works, and no single model — Fable 5.1 included — is a requirement.

### Lesson boundaries

- Do not reteach Exa/Context7, worktrees, or screenshot testing as a testing course.
- Do not initialize a second design system on a repo that already has one — `shadcn init` on the course starter included.

<!-- END @przeprogramowani/10x-cli -->
