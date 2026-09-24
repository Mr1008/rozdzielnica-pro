---
change_id: electrician-pricing-profile
title: Parametry wyceny w profilu elektryka
status: implemented
created: 2026-09-24
updated: 2026-09-24
---

## Notes

S-07 z `context/foundation/roadmap.md` (issue #8). Wymaga F-01 (profil, role, `user_role` claim).
Odblokowuje S-08 (koszt materiału i robocizny).

### Kontrakty dla kolejnych plasterków (ustalone przy planowaniu 2026-09-24)

- **S-08:** parametry wyceny czyta z `public.pricing_profiles` (jeden wiersz na elektryka, klucz
  `user_id`). **Brak wiersza = parametry nieskonfigurowane** — S-08 nie liczy wyceny z wartości
  domyślnych, tylko pokazuje prośbę o uzupełnienie profilu z linkiem do `/dashboard/profile`.
- **S-08:** jednostki: `hourly_rate_grosze` (integer, grosze za godzinę), `mount_minutes_per_device`
  (integer, 1–600 min), `project_overhead_minutes` (integer, 0–6000 min). Czas pracy =
  aparaty × `mount_minutes_per_device` + `project_overhead_minutes` (w minutach); koszt robocizny =
  czas / 60 × stawka — zaokrąglenie do grosza jest decyzją S-08.
- **Admin nie widzi i nie edytuje** parametrów wyceny — tabela nie ma żadnej polityki dla admina.
