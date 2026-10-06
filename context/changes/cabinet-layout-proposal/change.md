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
- rysunek przewodów z zapasem 30% długości i realistycznym zwisem, plus lista długości przewodów.
- (Faza 5, 2026-10-06) zapas długości przewodów podniesiony z 15% do 30% (`WIRE_SLACK_RATIO = 0.3`);
- (Faza 5) TN-C-S: PEN rozdzielany w rozdzielnicy — PEN z WLZ na szynę PE, mostek rozdziału do N
  rozłącznika głównego; spójne z `supply-warnings`;
- (Faza 5) każdy przewód na własnym torze — żadne dwa przewody nie biegną po tej samej linii, żeby
  każdy dało się prześledzić na rysunku; przewody mogą biec pod szyną DIN, za aparatami;
- (Faza 5) przewód podświetla się po najechaniu kursorem (pozostałe przygasają) i ma etykietkę z
  identyfikacją (obwód / WLZ / mostek, żyła, przekrój, długość) — bez JavaScriptu, rysunek zostaje SSR;
- (Faza 5b, nowa) szafka bez wbudowanych szyn PE/N dostaje szyny dobrane z katalogu aparatów
  (najtańsze pasujące albo luka w katalogu), umieszczone w układzie i użyte przez okablowanie —
  odwraca punkt „nie dobieramy szyn z katalogu” z planu;
- zaparkowane w roadmapie: listwy zasilające 1F/3F do podłączania faz grup RCD.

### Kontrakty dla kolejnych plasterków

- **S-06:** układ jest zapisany w `project_device_placements` (szyna + x w mm na aparat ze
  snapshotu). Każdy zapis obwodów / „Dobierz ponownie” wymienia cały snapshot aparatów, więc kasuje
  też rozmieszczenie (kaskada) i zapisuje świeżą propozycję. S-06 musi zdecydować, czy ręczne
  poprawki mają przetrwać ponowny dobór. Zmiana szafki projektu kasuje rozmieszczenie.
- **S-08 / S-09:** zapisany układ nie jest dowodem poprawności — czytaj go przez
  `computeLayoutView` (stan `placed`), nigdy wprost z tabeli.

### Pomiar CPU (Faza 3, 2026-10-06)

`proposeLayout` + `validateLayout` na najgorszym przypadku planu (60 obwodów, 20 grup RCD, 81 aparatów,
szafka seed (c)), test „layout CPU budget” w `src/lib/layout-server.test.ts`, 30 przebiegów po
rozgrzewce, 3 lokalne uruchomienia (Node, nie workerd): mediana 1,22 / 1,36 / 2,88 ms, maksimum
15,19 / 12,13 / 5,03 ms. Mediana mieści się z zapasem w budżecie 10 ms CPU Workera. Pojedyncze
maksima powyżej 10 ms wyglądają na skoki GC/JIT w Node; limit Workers liczy CPU na żądanie, więc
Faza 5 mierzy całą ścieżkę renderu jeszcze raz — przy przekroczeniu stosujemy fallback z
`## Performance Considerations` planu. Realne projekty są o rząd wielkości mniejsze niż ten przypadek.

### Pomiar CPU — pełna ścieżka renderu (Faza 5, 2026-10-06)

`computeMatchView` + `computeLayoutView` (zapisany układ `placed`) + `computeWiring` + rysunek
przewodów + `wireLengthsBySection` na tym samym najgorszym przypadku (60 obwodów, 20 grup, 81
aparatów, 284 przewody, szafka seed (c)), test „render path CPU budget” w
`src/lib/layout-server.test.ts`, 3 lokalne uruchomienia (Node): mediana 3,15 / 3,55 / 2,04 ms,
maksimum 12,5 / 21,3 / 14,6 ms. Sam układ w tych samych przebiegach: mediana 1,5–1,7 ms. Mediana
mieści się w budżecie 10 ms CPU Workera, więc fallback z `## Performance Considerations` nie jest
stosowany. Pojedyncze maksima > 10 ms to rozgrzewka JIT/GC w Node; na Workerze ryzyko dotyczy tylko
skrajnie dużych projektów — przy realnej skali (kilkanaście obwodów) czas jest kilkukrotnie mniejszy.
Do obserwacji po wdrożeniu (`wrangler tail` — błędy CPU limit).

### Pomiar CPU po rozdzieleniu torów przewodów (Faza 5, 2026-10-06)

Każdy przewód na własnym torze (`nudgeTracks`, `WIRE_TRACK_PITCH_MM = 3`) podniósł koszt ścieżki
renderu. Najgorszy przypadek (60 obwodów, 20 grup, 284 przewody, seed (c)): mediana 7,9 / 9,2 / 10,2
ms w 3 uruchomieniach — na granicy budżetu 10 ms CPU Workera. Realistyczny projekt (12 obwodów, 4
grupy, 60 przewodów): mediana 1,4–1,7 ms. Fallback z `## Performance Considerations` (routing w wyspie
po stronie klienta) zostaje gotowy do użycia, jeśli `wrangler tail` pokaże przekroczenia CPU.
