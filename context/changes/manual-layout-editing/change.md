---
change_id: manual-layout-editing
title: Ręczna korekta zaproponowanego układu aparatów
status: implementing
created: 2026-10-07
updated: 2026-10-07
---

## Notes

S-06 z `context/foundation/roadmap.md` (issue #7), FR-009 i kryterium akceptacji US-01 („układ jest
edytowalny przed wygenerowaniem wyceny”). Wymaga S-05 (propozycja układu, zarchiwizowana
2026-10-07). Odblokowuje S-09 (wydruk), który rysuje układ w stanie `placed` — także poprawiony ręcznie.

Decyzje użytkownika z planowania (2026-10-07):

- przesuwane są całe bloki (grupa RCD, rozłącznik główny, obwody bez grupy, szyny z katalogu) i
  pojedyncze aparaty; aparat grupy może zmienić tylko kolejność w swojej grupie;
- poprawiony układ musi przejść ten sam `validateLayout` co propozycja (fizyka + reguła 1); reguły
  2 i 3 są decyzją elektryka;
- upuszczenie przyciąga do kroków 0,5 TE od początku szyny; upuszczenie, które łamie układ, jest
  odrzucane (szkic jest zawsze poprawny);
- ręczne poprawki przechodzą przez zapis obwodów i „Dobierz ponownie”, jeśli po przeniesieniu na nowy
  zestaw aparatów nadal są poprawne; inaczej zapisuje się świeża propozycja i strona o tym mówi;
- edytor jest zawsze włączony w sekcji „Układ w szafce”; przewody i długości z serwera znikają przy
  pierwszej niezapisanej zmianie i wracają po zapisie;
- kontrolki: Anuluj, cofnij/ponów, „Zaproponuj układ od nowa” (z potwierdzeniem) i znacznik
  „Poprawiony ręcznie” zapisany przy rozmieszczeniu;
- nakładające się etykiety szyn PE/N (odłożone z S-02) przechodzą do S-09.
