---
change_id: project-setup-and-supply-params
title: Nowy projekt — wybór szafki i parametry OSD/WLZ
status: implemented
created: 2026-09-24
updated: 2026-09-25
---

## Notes

S-03 z `context/foundation/roadmap.md` (issue #4). Wymaga F-01 (role, RLS) i S-02 (katalog szafek).
Odblokowuje S-04 (obwody i dobór aparatów).

### Kontrakty dla kolejnych plasterków (ustalone przy planowaniu 2026-09-24)

- **S-04 / S-05 / S-09:** geometria szafki projektu to `projects.cabinet_geometry` (snapshot), nigdy
  żywe `cabinets.geometry`. Snapshot (geometria + nazwa, producent, model, cena) zapisuje wyłącznie
  trigger `projects_snapshot_cabinet`; klient wysyła tylko `cabinet_id`. Przed użyciem geometrię
  i tak przepuść przez `parseCabinetGeometry`.
- **S-04:** parametry przyłącza są w kolumnach `projects` i są albo **wszystkie** ustawione, albo
  **wszystkie** `null` (CHECK `projects_supply_all_or_nothing`). **`null` = przyłącze nieuzupełnione**
  — S-04 nie dobiera aparatów z wartości domyślnych, tylko blokuje i odsyła na stronę projektu.
- **S-04:** ostrzeżenia z `supplyWarnings` (S-03) są informacyjne. Relacje wymagające obwodów
  (np. TN-C a wyłącznik RCD, dobór rozłącznika FR do zabezpieczenia przedlicznikowego) należą do S-04.
- **S-05:** zmiana szafki w projekcie robi nowy snapshot. S-03 nie ma jeszcze układu, więc nie
  definiuje, co zmiana szafki robi z układem — to decyzja S-05.
- **Admin nie widzi projektów** — tabela nie ma żadnej polityki dla admina.
