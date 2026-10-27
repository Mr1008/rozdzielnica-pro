---
change_id: testing-critical-path-e2e
title: Critical-path e2e — project page domain verdicts and cross-electrician IDOR (test-plan Phase 3)
status: implementing
created: 2026-10-27
updated: 2026-10-27
archived_at: null
---

## Notes

Rollout Phase 3 of `context/foundation/test-plan.md` ("Critical-path e2e", risks #2 and #6).

- #2: prove the project page shows what the domain decided — the catalog-gap error (no substitute),
  the stale-match marker after a supply or circuit change ("Dobierz ponownie"), saved circuits come
  back without loss. Challenge "the endpoint calls the parser and the matcher, so the UI is OK".
  One e2e per flow, not per variant; the rest goes to integration.
- #6: one e2e IDOR via URL — electrician B opening electrician A's project page / posting to A's
  project endpoints gets not-found/refusal, never A's data. Challenge "there is RLS, so the endpoint
  is secure".
- §6.3 candidates (S-08 impl-review F7): `POST /api/projects/[id]/quote` refuses an override with no
  pricing profile and with a stale match, stores the server-recomputed base not the form value,
  "Przywróć estymację" always works, another electrician gets `not_found`. Research picks the
  cheapest layer for each.
- CI gate: an e2e job/step in `.github/workflows/ci.yml`, reusing the `smoke` job's local Supabase;
  the `elektryk` e2e user and a second electrician must exist locally and in CI without repository
  secrets.
