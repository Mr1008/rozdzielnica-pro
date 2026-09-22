---
change_id: roles-and-rls-baseline
title: Role admin/elektryk i izolacja danych elektryka przez RLS
status: implementing
created: 2026-09-21
updated: 2026-09-22
archived_at: null
---

## Notes

F-01 — fundament z `context/foundation/roadmap.md` (issue #1). Odblokowuje S-01/S-02 (bramka roli
admina) oraz S-03–S-09 (izolacja projektów elektryka) i S-07 (profil jako miejsce na parametry
wyceny).

### Dopisane do zakresu Phase 5 (decyzja z 2026-09-22)

- **Wyłączyć `[analytics]` w `supabase/config.toml`** (`enabled = false`). Kontener
  `supabase_vector` nie potrafi połączyć się z gniazdem Dockera na Windows
  (`docker_logs` → `ConnectionRefused`), więc kończy się kodem 0 i restartuje w pętli — 74 restarty
  w ciągu godziny przy Phase 1. Ani `vector`, ani `analytics` nie są lokalnie do niczego używane.
  Wyłączenie ich to dwa kontenery mniej i koniec pętli restartów.
  Pułapka: zmiana w `config.toml` wymaga pełnego `supabase stop && supabase start` —
  `supabase db reset` **nie** przeładowuje konfiguracji (ustalone w Phase 1).
