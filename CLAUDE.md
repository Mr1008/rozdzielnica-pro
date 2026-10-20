# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Project guidance lives in @AGENTS.md — commands, architecture, conventions and the RozdzielnicaPro
domain rules. Read it first; this file only adds what is specific to Claude Code.

## 10xDevs toolkit

This repo is also a 10xDevs AI Toolkit workspace. The full lesson text — chain diagram, task router,
the inclusion test, the five-pattern calibration drill — is preserved at `docs/10x-toolkit.md` — open it only when working on the toolkit itself.

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
project-specific conventions, traps and workarounds; reference canonical files by a plain backtick
path rather than pasting their contents — never an `@`-path: in Claude Code `@path` _imports_ the whole
file into every session (that is how `AGENTS.md` once loaded ~350 KB of source). Most important rules go at the top — attention is weakest in the middle
of a long file. A per-area rule goes in its file in `context/foundation/agent-rules/` (tool-agnostic,
the only copy); a new area also needs a `.claude/rules/<area>.md` shim (`paths:` globs plus
`@../../context/foundation/agent-rules/<area>.md`) and an entry with the same patterns in the
`AGENTS.md` "Area tripwires" index. Never write a rule into a shim, and keep the shim's `paths:` and
the index patterns identical.
<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 5, Lesson 5 (Async & Remote Agents)

Delegate a bounded, planned change and come back to review it. Control doesn't disappear; it moves to the task contract, the sandbox setup and the review at the end.

```
/10x-plan -> /goal + /10x-goal-implement (interactive or claude -p) -> review the commits and the manual checklist
```

### Task Router - Where to start

| Skill                             | Use it when                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/10x-goal-implement <change-id>` | An approved `context/changes/<id>/plan.md` should run unattended. Pair it with `/goal <condition>`; it commits each phase on green and ends with pending manual checks. |
| `/10x-implement`                  | You want to steer each phase yourself.                                                                                                                                  |

### Hard rules

- **Delegate only planned work.** No approved `plan.md`, no unattended run.
- **Bound every run.** The `/goal` condition names the finish state and a turn limit.
- **A green run is not a finished change.** Review the commits and work through the manual checklist before merging.
- **Give the sandbox only the secrets and network access the task needs.**
- **Watch parallel and remote runs from one place.** Run each unattended session in its own herdr workspace so you can see which agents are working, blocked or done and step in from the browser (setup in the M2L6 Deep Dive).

<!-- END @przeprogramowani/10x-cli -->
