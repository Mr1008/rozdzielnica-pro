---
change_id: roles-and-rls-baseline
title: Role admin/elektryk i izolacja danych elektryka przez RLS
status: archived
created: 2026-09-21
updated: 2026-09-22
archived_at: 2026-09-22T14:18:53Z
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

### Follow-ups (poza zakresem tej zmiany)

- **`public.profiles.updated_at` nie ma triggera dotykającego kolumnę.** Ma `default now()`, więc
  ustawia się przy insercie, ale przy update nigdy się nie przesuwa. Do naprawienia w `S-07`, zanim
  na `profiles` wylądują pola wyceny — inaczej pierwsze pole, którego zmianę trzeba będzie
  wyśledzić w czasie, odziedziczy martwą kolumnę.
- **Job `smoke` w CI mógłby uruchamiać `npm run test:integration`.** Już startuje żywe Supabase z
  migracjami i seedem, więc asercje RLS kosztowałyby jeden krok więcej, a stałyby się granicą
  pilnowaną przez CI zamiast testem uruchamianym wyłącznie lokalnie. **To nie jest jednak dopisanie
  jednego kroku**: job `smoke` używa binarki `supabase` z `supabase/setup-cli@v3` (wersja `latest`),
  a test woła `npx supabase status -o env`, co npm rozwiązuje najpierw do devDependency
  (`supabase@^2.23.4`) w `node_modules/.bin`. To dwie różne binarki, a test parsuje wyjście `-o env`
  regexem — rozjazd wersji może je cicho zepsuć. Najpierw ujednolicić wywołanie CLI, potem dopisać
  krok.
- **Ryzyko przyjęte świadomie: zmiana roli działa dopiero od następnego tokenu.** `is_admin()`
  i trigger czytają claim `user_role` wypalony w tokenie, nie aktualne `profiles.role`. Zdegradowany
  admin zachowuje uprawnienia — łącznie z przywróceniem sobie roli — aż do wygaśnięcia tokenu
  (`jwt_expiry`, 3600 s). Dziś nieosiągalne: nie ma UI do zarządzania użytkownikami, role zmienia
  się SQL-em. Kto zbuduje takie UI, musi przy degradacji unieważnić sesję
  (`supabase.auth.admin.signOut(userId, 'global')`). Zapisane też jako tripwire w `AGENTS.md`.
