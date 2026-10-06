---
change_id: cabinet-layout-proposal
title: Propozycja układu aparatów w szafce (z przewodami i stroną N)
status: implementing
created: 2026-10-06
updated: 2026-10-06
---

## Notes

S-05 z `context/foundation/roadmap.md` (issue #6) — gwiazda przewodnia. Wymaga S-02 (szafki) i S-04
(dobór aparatów). Odblokowuje S-06 (ręczna korekta układu) i pośrednio S-09 (wydruk).

Rozstrzyga Otwarte pytanie #2 PRD (pierwszeństwo reguł rozmieszczenia): **ściśle 1 > 2 > 3** —
grupowanie jest twardym ograniczeniem, strona wprowadzenia porządkuje grupy, odległość od szyn PE/N
rozstrzyga remisy. Decyzja użytkownika z 2026-10-06.

Zakres poszerzony przy planowaniu (decyzje użytkownika 2026-10-06):

- strona zacisku N aparatu w katalogu (GitHub #15) — w tej zmianie;
- rysunek przewodów z zapasem 15% długości i realistycznym zwisem, plus lista długości przewodów.

### Kontrakty dla kolejnych plasterków

- **S-06:** układ jest zapisany w `project_device_placements` (szyna + x w mm na aparat ze
  snapshotu). Każdy zapis obwodów / „Dobierz ponownie” wymienia cały snapshot aparatów, więc kasuje
  też rozmieszczenie (kaskada) i zapisuje świeżą propozycję. S-06 musi zdecydować, czy ręczne
  poprawki mają przetrwać ponowny dobór. Zmiana szafki projektu kasuje rozmieszczenie.
- **S-08 / S-09:** zapisany układ nie jest dowodem poprawności — czytaj go przez
  `computeLayoutView` (stan `placed`), nigdy wprost z tabeli.
