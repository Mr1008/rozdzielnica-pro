---
change_id: quote-cost-estimate
title: Koszt materiału i robocizny z nadpisywanym czasem pracy
status: implemented
created: 2026-10-07
updated: 2026-10-08
---

## Notes

S-08 z `context/foundation/roadmap.md` (issue #9). Wymaga S-04 (dobór aparatów) i S-07 (profil
wyceny). Odblokowuje S-09 (wydruk wyceny), który drukuje dokładnie to, co liczy ta zmiana.

Decyzje użytkownika z planowania (2026-10-07):

- liczba aparatów = każdy wiersz snapshotu `project_devices`, łącznie z szynami PE/N z katalogu;
- materiał = cena szafki (snapshot `projects.cabinet_price_grosze`, osobna pozycja) + ceny aparatów;
- nadpisany czas zapisany na projekcie (`labour_minutes_override`) razem z estymacją, wobec której go
  ustawiono; gdy estymacja się zmieni, nadpisanie zostaje, ale jest oznaczone jako nieaktualne;
- koszt robocizny zaokrąglany do grosza w górę od połowy, w liczbach całkowitych;
- bez limitu stawki — ostrzeżenie przy stawce powyżej 500 zł/h;
- wycena tylko przy `computeMatchView(...).state === "current"` i skonfigurowanym profilu; stan
  układu nie jest wymagany;
- nadpisanie wpisywane jako godziny + minuty.
