---
change_id: testing-matching-oracle
title: Test-plan phase 1 — matching and validation oracle
status: archived
created: 2026-09-29
updated: 2026-09-30
archived_at: 2026-09-30T09:15:56Z
---

## Notes

Open a change folder for rollout Phase 1 of context/foundation/test-plan.md: "Matching and validation oracle".
Risks covered: #1 (system proponuje aparat niespełniający parametrów obwodu albo po cichu podstawia zamiennik przy luce w katalogu), #3 (niebezpieczna konfiguracja przechodzi bez blokady lub ostrzeżenia: RCD w TN-C, 3F przy przyłączu 1F, obciążalność przewodu < In, błąd w tabeli obciążalności). Test types planned: unit (table-driven, boundary, property-based).
Risk response intent:

- #1: dla każdej kombinacji obwodu i katalogu-fixture wybrany aparat spełnia każdy parametr; przy luce jest błąd z nazwą brakującego aparatu, nigdy aparat — wyrocznia z PRD/praktyki, nie z implementacji.
- #3: każdy blocker i warning odpala się na granicy wartości (In równe obciążalności, ±1 A), a wartości tabeli są przypięte do normy.
  After creating the folder, follow the downstream continuation rule.
