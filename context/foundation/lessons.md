# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Write structured files with the Write tool, not shell heredocs

- **Context**: Writing files whose content is structured or multi-line — SQL, YAML, code or markdown; anything containing characters a shell may interpret.
- **Problem**: The heredoc aborts with a parse error, no file is written, and the turn is spent reissuing the same content through a different tool.
- **Rule**: Use the Write tool by default when creating or overwriting a file. Reserve a bash heredoc for short, plain, single-line content with no special characters.
- **Applies to**: all
