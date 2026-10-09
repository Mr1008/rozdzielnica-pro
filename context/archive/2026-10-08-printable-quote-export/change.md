---
change_id: printable-quote-export
title: Wydruk wyceny z wizualizacją układu szafki
status: archived
created: 2026-10-08
updated: 2026-10-09
archived_at: 2026-10-09T07:36:13Z
---

## Notes

S-09 z `context/foundation/roadmap.md` (issue #10), FR-012. Wymaga S-08 (done). Roadmapa wymienia też
S-06 (`manual-layout-editing`, wciąż `proposed`) — świadomie planowane przed nim: wydruk czyta zapisane
rozmieszczenie przez `computeLayoutView`, więc ręczne poprawki z S-06 trafią na wydruk bez zmian tutaj.

Decyzje użytkownika z planowania (2026-10-08):

- osobna strona `/dashboard/projects/[id]/print` + `window.print()` (eksport = „Zapisz jako PDF”
  przeglądarki), bez biblioteki PDF;
- wydruk tylko gdy wycena `ready` **i** układ `placed`; inaczej blokada z linkami, bez kwot i rysunku;
- materiał wyszczególniony per aparat z katalogu, sumy wyłącznie z `computeQuoteView` (test: suma
  pozycji = `devicesGrosze`);
- nagłówek z danymi firmy: nowa tabela `business_profiles` (tylko właściciel, bez admina), pola
  opcjonalne, edycja na `/dashboard/profile`; brak danych → fallback do imienia/emaila + podpowiedź
  tylko na ekranie, druk nie jest blokowany;
- robocizna: czas, stawka, koszt — bez markerów estymacji/nadpisania; nieaktualne nadpisanie →
  ostrzeżenie tylko na ekranie;
- A4 pionowo: strona 1 nagłówek + koszty, strona 2 rysunek + legendy; bez tabeli długości przewodów;
- implementacja fazami dla Sonnet (wąskie kontrakty), Opus tylko tam, gdzie nie da się zawęzić.
