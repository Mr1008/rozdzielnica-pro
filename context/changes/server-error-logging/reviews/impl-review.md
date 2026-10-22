<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Server error logging

- **Plan**: context/changes/server-error-logging/plan.md
- **Scope**: Full plan
- **Reviewed phases**: 1, 2, 3, 4
- **Date**: 2026-10-22
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Evidence: commits 0f45f14 (p1), 06a0d69 (p2), 01036e7 (p3), 691c57e (p4). In this session: `npm run test:unit` (1377 passed), `npm run lint`, `npx astro check` (0 errors), `npm run build` and the `console.error` grep were all green on 01036e7. The Phase 4 probe suite passed in the probe worktree (see `probe-before-after.md`). The plan-drift pass found no DRIFT, MISSING or EXTRA items.

## Findings

### F1 — Dropped-catalog log line is unbounded

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/device-matching-server.ts:85
- **Detail**: `dropped: dropped.join(",")` joins every dropped catalog id. With a badly broken catalog (up to the 1000-row PostgREST cap), that is about 37 KB in one record, emitted on every match, rematch and circuit save. This was already unbounded before this change (the old log passed the whole array), but this is the line the change touched.
- **Fix**: Log `count` plus the first 10 ids (`dropped.slice(0, 10).join(",")`).
- **Decision**: FIXED — the log now carries the first 10 ids plus `count`

### F2 — Mapped business outcomes are logged at error level, the same as faults

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/projects/[id]/{circuits,rematch,layout,placements,cabinet}.ts
- **Detail**: Every write branch logs before mapping, as the plan says, so expected outcomes produce the same `console.error` record as a server fault. These include `P0002` project not found, a device archived mid-edit (`device_unavailable`) and `42501`. There is no alerting yet, but any future alert on error-record counts would fire on them.
- **Fix A ⭐ Recommended**: Leave as is and carry the question into the M4 change (SQLSTATE remapping), which decides what these codes mean.
  - Strength: Matches the approved plan ("log every `if (error)` branch"); M4 already owns these codes.
  - Tradeoff: Records carry some noise until M4 lands.
  - Confidence: HIGH — the event name and `code` field already let a log search filter them.
  - Blind spot: None significant.
- **Fix B**: Log only when the mapper returns `unknown` or an unmapped code.
  - Strength: Error records mean faults only.
  - Tradeoff: Expected-but-rare outcomes (an archived device mid-edit) leave no trace, so this partly undoes C3.
  - Confidence: MED — depends on which codes count as "expected".
  - Blind spot: Some mapped codes (`42501`) may indicate real bugs.
- **Decision**: ACCEPTED via Fix A — left as is; carry the question into the M4 (SQLSTATE remapping) change

### F3 — `22xxx` messages can echo input values; `hint` is not truncated

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/server-log.ts:41,49
- **Detail**: The constraint errors (23505, 23514, 23502, 23503) keep their values in `details`, which is never read. Input-syntax errors (22P02, 22003, 22007, 22008), however, quote the offending value in `message`, e.g. `invalid input syntax for type uuid: "<value>"`. Today the app parses ids and numbers before every DB call, so free text does not reach those paths. `hint` is copied untruncated.
- **Fix**: Run `hint` through `truncate()`. Optionally mask quoted literals in the message when the code starts with `22`.
- **Decision**: FIXED — `hint` truncated; class 22 messages have quoted input masked; 3 tests added

### F4 — Parse failures log `code: "none"`, `name: "UnknownError"`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/device-matching-server.ts:85,155
- **Detail**: Both calls pass `undefined` as the error, as the plan specified. The record therefore looks identical to a gateway failure without a code (`code: "none"`, empty message). Only the event name and the `issueCode` / `dropped` fields tell them apart.
- **Fix**: No change needed; the event names are distinct. If dashboards group by `code`, pass `{ code: "parse" }` as the error.
- **Decision**: FIXED — both parse-failure sites pass `{ code: "parse" }`

### F5 — The logger has no guard of its own

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/server-log.ts:59-62
- **Detail**: `logServerError` throws only for pathological input, such as a throwing getter on `code` or `message`. It is called inside the `catch` in `print.astro`, where a throw would turn a handled failure into a 500.
- **Fix**: Wrap the body of `logServerError` in `try { … } catch { /* never break a request */ }`.
- **Decision**: FIXED — `logServerError` catches a failing record build and logs a fallback record; test added

### F6 — The plan says 22 write call sites; there are 20

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/server-error-logging/plan.md (Phase 2, criterion 2.5)
- **Detail**: `src/pages/api` has 20 `*ErrorFromPostgrest(` / `*RpcErrorCode(` calls, and each has a `logServerError` call in its branch (21 in total, because `quote.ts` also carries a Phase 3 read log). The plan miscounted; nothing is missing.
- **Fix**: None; recorded here as the explanation.
- **Decision**: SKIPPED — explanation recorded in this report

## Triage summary

- Fixed: F1, F3, F4, F5 (4)
- Accepted: F2 (Fix A, deferred to M4) (1)
- Skipped: F6 (1)

The fixes were verified with `npm run test:unit` (1381 passed), `npm run lint`, `npx astro check` and `npm run build`. The break-check made the matching test go red when the class 22 masking, the hint truncation or the logger's try/catch was disabled.
