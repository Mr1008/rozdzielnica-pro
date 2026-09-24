---
change_id: admin-device-catalog
title: Katalog aparatów prowadzony przez admina
status: archived
created: 2026-09-23
updated: 2026-09-24
archived_at: 2026-09-24T10:38:08Z
---

## Notes

S-01 z `context/foundation/roadmap.md` (issue #2). Wymaga F-01 (bramka roli admina, `is_admin()`).
Odblokowuje S-04 (dobór aparatów do obwodów z guardrailem).

### Kontrakty dla kolejnych plasterków (ustalone przy planowaniu 2026-09-23)

- **S-04:** dopasowanie czyta wyłącznie typowane kolumny parametrów `devices`; zarchiwizowany aparat
  nigdy nie jest proponowany. **FR to zwykły rozłącznik izolacyjny bez wkładek** — nie jest
  zabezpieczeniem nadprądowym i nie może być traktowany jako takie.
- **S-04 / S-08:** projekt **kopiuje** wybrany aparat (cena, wymiary, parametry) w chwili doboru —
  późniejsza edycja katalogu przez admina nie przesuwa istniejącej wyceny ani układu (ta sama zasada
  co snapshot geometrii szafki w S-03).
- **S-05:** szerokość aparatu jest w **mm z dokładnością 0,01** (`width_mm numeric(6,2)`), żeby pół
  modułu było dokładne (1,5 TE = 26,25 mm); wysokość i głębokość z dokładnością 0,1 mm. Geometria
  szafki zostaje w całych mm; 1 moduł DIN = 17,5 mm, krok 0,5 TE. (Doprecyzowane w fazie 1
  implementacji 2026-09-23 — plan zakładał 0,1 mm, co nie mieściło połówek modułu.)
