---
change_id: circuit-input-and-device-matching
title: Obwody, grupy RCD i dobór aparatów z guardrailem
status: archived
created: 2026-09-29
updated: 2026-09-30
archived_at: 2026-09-30T09:08:14Z
---

## Notes

S-04 z `context/foundation/roadmap.md` (issue #5). Wymaga S-01 (katalog aparatów) i S-03 (projekt,
szafka, przyłącze). Odblokowuje S-05 (układ w szafce) i S-08 (wycena).

### Kontrakty dla kolejnych plasterków (ustalone przy planowaniu 2026-09-29)

- **S-05 / S-06:** obwody (`circuits`) i grupy RCD (`rcd_groups`) mają **stabilne id** między
  zapisami (upsert po id, nie replace-all) — układ może się do nich odwoływać. Obwód niesie stronę
  wprowadzenia przewodów (`entry_side`) pod regułę (2) oraz przekrój przewodu.
- **S-05:** reguła „grupa jednoobwodowa → RCBO" jest realizowana już w S-04 (dobór), z fallbackiem
  na zgodną parę RCD + MCB, gdy w katalogu nie ma pasującego RCBO. S-05 rozmieszcza to, co S-04
  dobrało — nie dobiera ponownie.
- **S-08:** czyta wyłącznie snapshot `project_devices` (cena, parametry, wymiary skopiowane
  triggerem). Pusty snapshot przy niepustych obwodach = dobór nieaktualny/niemożliwy → blokada,
  nigdy przeliczanie z żywego katalogu.
  **Wycena i wydruk tylko przy stanie `current`** (`computeMatchView`): zapisany snapshot nie jest
  dowodem zgodności — trigger kopiuje wiersz katalogu z chwili zapisu, więc edycja aparatu przez
  admina albo zmiana przyłącza w trakcie zapisu mogą zostawić aparat niezgodny z obwodem. Stan
  `stale`/`cleared`/`gaps`/`blocked` blokuje wycenę i odsyła do „Dobierz ponownie"
  (impl-review F1, 2026-09-30).
- **Zmiana przyłącza czyści snapshot** (`project_devices`) — dobór trzeba zatwierdzić ponownie.
