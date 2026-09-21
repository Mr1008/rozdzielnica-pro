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
