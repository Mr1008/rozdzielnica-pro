---
change_id: observability
title: Close the remaining observability gaps — auth outages, browser errors, silent fallbacks, boundaries, metrics
status: implementing
created: 2026-10-27
updated: 2026-10-27
---

## Notes

GitHub issue [#29](https://github.com/Mr1008/rozdzielnica-pro/issues/29) — the parked idea
"Observability (logger, error tracking, metryki)". The logger shipped in `server-error-logging`
(archived 2026-10-22, audit fix steps 1–2). This change does audit fix steps 3–6 of
`context/audits/observability/2026-10-21_sign-in-circuits-layout-quote.md`, plus info/warn events as
the "metrics" part. Workers Logs stays the only sink; no third-party tracker.
