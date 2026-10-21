---
change_id: server-error-logging
title: Log server-side failures with context and stop losing the transport error code
status: implementing
created: 2026-10-21
updated: 2026-10-21
archived_at: null
---

## Notes

Fix steps 1-2 from the observability audit
(`context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md`, runtime proof in
`2026-10-21_runtime-sign-in-circuits-layout-quote.md`): a shared server `logError` helper, logging in
the error mappers, and mapping the empty transport code to `unknown`. Closes C2, C3, M14 (and M11,
M4/M8 partly). Before/after check: the probe suite in
`.claude/worktrees/agent-ae7a77891485cc62c` (`bash probe/suite.sh`).
