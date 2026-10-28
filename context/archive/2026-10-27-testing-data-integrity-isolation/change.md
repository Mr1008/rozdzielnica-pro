---
change_id: testing-data-integrity-isolation
title: Test rollout phase 2 — data integrity and isolation (risks #6, #7)
status: archived
created: 2026-10-27
updated: 2026-10-28
archived_at: 2026-10-28T09:10:32Z
---

## Notes

Rollout Phase 2 of `context/foundation/test-plan.md`: "Data integrity and isolation". Test types: integration + CI gate.

- Risk #6 (abuse): an electrician reads or changes another's project or circuits via an id, the admin sees projects, a new table ships without RLS. Prove electrician B gets a refusal or empty response for A's resources, the admin sees no projects, and every table holding electrician data has an RLS test. Challenge "there is RLS, so the endpoint is secure"; avoid testing only one's own reads.
- Risk #7 (catalog↔project drift): a DB CHECK and its TS parser disagree, or an admin catalog edit changes an existing project. Prove the same fixture passes or fails identically in the TS parser and the DB CHECK, and that editing a cabinet or device does not change an existing project's snapshot. Challenge "a parser unit test is enough"; avoid separate fixtures for DB and parser.
- Already exists (inventory, don't redo): 9 RLS suites in `tests/integration/` incl. "as another electrician" cases. Not done: `npm run test:integration` is not in CI; CHECK↔parser parity for every pair in `context/foundation/agent-rules/data-guards.md` is unverified; snapshot immutability is unverified.
