---
project: "RozdzielnicaPro"
version: 1
status: draft
created: 2026-09-21
updated: 2026-09-23
prd_version: 2
main_goal: low-complexity
top_blocker: decisions
milestone_id: od-projektu-do-wyceny
milestone_seq: 1
milestone_status: open
---

# Roadmap: RozdzielnicaPro

> Wyprowadzone z `context/foundation/prd.md` (v2) + auto-zbadanego baseline'u kodu.
> Edytuj w miejscu; archiwizuj, gdy dokument zostanie zastąpiony.
> Plasterki poniżej są w kolejności zależności. Tabela „At a glance" jest indeksem.
> Nagłówki sekcji są po angielsku celowo — to kontrakt dla narzędzi; treść jest po polsku, jak PRD.

## Milestone

**M-1: Od projektu do wydrukowanej wyceny** — Status: open

- **Intent:** Udowodnić US-01 od końca do końca: elektryk zakłada projekt, dostaje dobrane aparaty i propozycję układu w szafce, a na wyjściu wydruk wyceny z rozbiciem na materiał i robociznę. Zakres wyznacza wynik, nie data.
- **Source materials:** `context/foundation/prd.md` (v2)
- **Done when:** każdy `F-NN` i `S-NN` poniżej ma status `done`.
- **Scope anchors:** FR-001 – FR-013 (wszystkie must-have), US-01, `## Access Control`, `## Non-Functional Requirements`.

## Vision recap

Elektryk instalator po spotkaniu z klientem zna już liczbę obwodów i planowane obciążenia, ale układ aparatów w rozdzielnicy przekłada ręcznie, „na oko" — stąd długie trasy przewodów, improwizacja na budowie i wycena robocizny liczona z palca. RozdzielnicaPro łączy dane katalogowe aparatów (wymiary, cena, parametry elektryczne) z geometrią konkretnej szafki i trzema jawnymi regułami heurystycznymi, żeby zaproponować układ i policzyć wycenę. Celowo nie jest to CAD elektryczny ani optymalizator — to wąski asystent dla prostych instalacji jednorodzinnych, budowany też jako projekt rozwojowy autora.

Twardy guardrail całego produktu: **system nigdy nie proponuje aparatu niespełniającego parametrów obwodu**; przy luce w katalogu zgłasza błąd z prośbą o kontakt z adminem, zamiast schodzić na aparat niezgodny.

## North star

**S-05: System proponuje układ dobranych aparatów w wybranej szafce** — to najbardziej ryzykowne założenie produktu (czyli to, którego obalenie unieważnia sens narzędzia): jeśli heurystyka nie daje układu, który elektryk tylko punktowo poprawia, narzędzie zostaje kalkulatorem i przegrywa z arkuszem.

> „Gwiazda przewodnia" (north star) znaczy tu: najmniejszy przepływ od końca do końca, którego udane dostarczenie dowodzi, że podstawowa hipoteza produktu jest prawdziwa — dlatego stawiamy go tak wcześnie, jak pozwalają zależności, bo reszta zakresu ma sens tylko wtedy, gdy ten element działa.

Uwaga: S-05 jest dziś `blocked` — Otwarte pytanie #2 (pierwszeństwo reguł rozmieszczenia) musi zostać rozstrzygnięte, zanim heurystykę da się jednoznacznie zaplanować. Patrz `## Open Roadmap Questions`.

## At a glance

| ID   | Change ID                           | Outcome (elektryk / admin może …)                                                          | Prerequisites | PRD refs                      | Status      |
| ---- | ----------------------------------- | ------------------------------------------------------------------------------------------ | ------------- | ----------------------------- | ----------- |
| F-01 | `roles-and-rls-baseline`            | (foundation) role `admin` / `elektryk` rozróżnialne, dane elektryka izolowane przez RLS    | —             | Access Control, NFR-izolacja  | done        |
| S-01 | `admin-device-catalog`              | Admin prowadzi katalog aparatów z wymiarami, ceną i parametrami elektrycznymi              | F-01          | FR-001                        | in-progress |
| S-02 | `admin-cabinet-catalog`             | Admin prowadzi katalog szafek z wymiarami i układem szyn                                   | F-01          | FR-002                        | done        |
| S-03 | `project-setup-and-supply-params`   | Elektryk zakłada projekt, wybiera szafkę i opisuje przyłącze OSD/WLZ                       | F-01, S-02    | FR-003, FR-004, FR-005, US-01 | proposed    |
| S-04 | `circuit-input-and-device-matching` | Elektryk podaje obwody i grupy RCD i dostaje dobrane aparaty (albo błąd o luce w katalogu) | S-01, S-03    | FR-006, FR-007, US-01         | proposed    |
| S-05 | `cabinet-layout-proposal`           | Elektryk widzi zaproponowany układ aparatów w swojej szafce                                | S-02, S-04    | FR-008, US-01                 | blocked     |
| S-06 | `manual-layout-editing`             | Elektryk poprawia zaproponowany układ przed wyceną                                         | S-05          | FR-009, US-01                 | proposed    |
| S-07 | `electrician-pricing-profile`       | Elektryk ustawia w profilu stawkę, średni czas montażu i narzut na projekt                 | F-01          | FR-010                        | ready       |
| S-08 | `quote-cost-estimate`               | Elektryk widzi koszt materiału i robocizny i nadpisuje estymowany czas                     | S-04, S-07    | FR-011, FR-013, US-01         | proposed    |
| S-09 | `printable-quote-export`            | Elektryk drukuje/eksportuje wycenę z wizualizacją układu szafki                            | S-06, S-08    | FR-012, US-01                 | proposed    |

## Streams

Pomoc nawigacyjna — grupuje elementy dzielące łańcuch zależności. Kanoniczna kolejność nadal żyje w grafie zależności poniżej; ta tabela to proponowana kolejność czytania między równoległymi torami.

| Stream | Theme                    | Chain                             | Note                                                                                       |
| ------ | ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------ |
| A      | Fundament ról i katalogi | `F-01` → `S-01` → `S-02`          | Wszystko inne tego potrzebuje; `S-01` i `S-02` da się prowadzić równolegle po `F-01`.      |
| B      | Projekt → dobór → układ  | `S-03` → `S-04` → `S-05` → `S-06` | Dołącza do Stream A przy `S-01`/`S-02` (potrzebuje obu katalogów). Zawiera gwiazdę `S-05`. |
| C      | Wycena                   | `S-07` → `S-08` → `S-09`          | `S-07` rusza zaraz po `F-01`, więc tor wyceny może biec obok Stream B aż do `S-08`.        |

## Baseline

Co jest już w kodzie na dzień `2026-09-21` (auto-zbadane + potwierdzone przez użytkownika).
Foundations poniżej zakładają, że to istnieje, i **nie** budują tego od nowa.

- **Frontend:** present — Astro 7 SSR + React 19 + Tailwind 4, shadcn/ui w `src/components/ui/`, `src/layouts/Layout.astro`. Brak jakiegokolwiek UI produktowego.
- **Backend / API:** partial — tylko trasy auth (`src/pages/api/auth/*.ts`, FormData + redirect z `?error=`), zero endpointów domenowych; ścieżka żądania przez `src/middleware.ts`.
- **Data:** absent — jest sam `supabase/config.toml`, brak katalogu migracji, brak tabel poza `auth.users`, brak `src/types.ts` i brak `zod` w `package.json`.
- **Auth:** present — Supabase SSR (`src/lib/supabase.ts`), użytkownik w `context.locals.user`, `PROTECTED_ROUTES` w `src/middleware.ts`, rejestracja/logowanie/wylogowanie, polskie komunikaty przez `src/lib/auth-errors.ts`. **Brak ról i brak profilu użytkownika.**
- **Deploy / infra:** present — Worker `rozdzielnica-pro` wdrożony, auto-deploy z `master` (Cloudflare Workers Builds), CI `.github/workflows/ci.yml` (lint + `astro check` + build + smoke).
- **Observability:** absent — brak loggera, error trackingu i metryk; w praktyce zostaje `wrangler tail`. PRD tego nie wymaga, więc nie powstaje pod to fundament.

## Foundations

### F-01: Role i izolacja danych elektryka

- **Outcome:** (foundation) aplikacja rozróżnia rolę `admin` od `elektryk`, każdy zalogowany użytkownik ma rekord profilu, a dane projektowe są izolowane per elektryk na poziomie bazy — nie w kodzie aplikacji.
- **Change ID:** `roles-and-rls-baseline`
- **Issue:** #1
- **PRD refs:** `## Access Control` (dwie role, admin bez wglądu w projekty), `## Non-Functional Requirements` (projekty widoczne wyłącznie dla właściciela)
- **Unlocks:** `S-01` i `S-02` (bramka roli admina — bez niej katalogi są otwarte dla każdego zalogowanego), `S-03`–`S-09` (izolacja projektów elektryka), `S-07` (profil jako miejsce na parametry wyceny)
- **Prerequisites:** —
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Baseline ma już działające logowanie Supabase, więc ten fundament dokłada wyłącznie role, profil i RLS — i minimalny zakres jest tu kluczowy: rola + profil + wzorzec polityki RLS dla pierwszej tabeli, a nie „cały model danych" z góry. Ryzyko idzie w drugą stronę — jeśli izolacja powstanie później niż pierwsze tabele projektowe, dopisywanie polityk wstecz do istniejących danych jest droższe i łatwiej przeoczyć tabelę bez RLS.
- **Status:** done

## Slices

### S-01: Admin prowadzi katalog aparatów

- **Outcome:** Admin może dodać i edytować aparat wraz z wymiarami, ceną katalogową i parametrami elektrycznymi potrzebnymi do dopasowania do obwodu.
- **Change ID:** `admin-device-catalog`
- **Issue:** #2
- **PRD refs:** FR-001, `## Non-Goals` (zamknięta lista typów: FRy, RCD, RCBO, nadprądowe typu B, szyny PE, szyny N)
- **Prerequisites:** F-01
- **Parallel with:** S-02, S-07
- **Blockers:** —
- **Unknowns:**
  - Jak wygląda akceptacja ścieżki admina — PRD nie ma dla niej żadnej historyjki ani kryteriów (Otwarte pytanie #1) — Owner: user. Block: no.
- **Risk:** To zestaw pól, od którego zależy cały dobór aparatów w S-04. Zbyt ubogi model parametrów elektrycznych wymusi migrację w środku najważniejszego plasterka; zbyt bogaty spala wieczory na dane, których MVP nie użyje. Granicą jest zamknięta w PRD lista typów aparatów.
- **Status:** in-progress

### S-02: Admin prowadzi katalog szafek

- **Outcome:** Admin może dodać i edytować szafkę rozdzielnicy wraz z jej wymiarami i układem szyn montażowych.
- **Change ID:** `admin-cabinet-catalog`
- **Issue:** #3
- **PRD refs:** FR-002
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-07
- **Blockers:** —
- **Unknowns:**
  - Jak wygląda akceptacja ścieżki admina (Otwarte pytanie #1) — Owner: user. Block: no.
- **Risk:** PRD stawia tu wyraźny warunek treściowy: 2-3 startowe szafki muszą się **istotnie** różnić rozmiarem lub liczbą szyn, inaczej w S-05 nie da się zobaczyć, czy heurystyka w ogóle dostosowuje się do geometrii. Trzy prawie identyczne szafki unieważniają weryfikację gwiazdy przewodniej.
- **Status:** done

### S-03: Elektryk zakłada projekt i opisuje przyłącze

- **Outcome:** Elektryk może założyć nowy projekt, wybrać do niego szafkę z katalogu i podać parametry OSD (zabezpieczenie przedlicznikowe, układ TN-C / TN-S / TN-C-S / TT, liczba faz) oraz WLZ (długość, przekrój, materiał, sposób ułożenia).
- **Change ID:** `project-setup-and-supply-params`
- **Issue:** #4
- **PRD refs:** FR-003, FR-004, FR-005, US-01
- **Prerequisites:** F-01, S-02
- **Parallel with:** S-01, S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Pierwszy plasterek, w którym powstają dane należące do konkretnego elektryka — tu realnie weryfikuje się izolacja z F-01. Ryzyko zakresowe: pola OSD/WLZ kuszą, żeby od razu dorobić pełne obliczenia normowe, co PRD jawnie wyklucza; w MVP to wejście do prostej walidacji i doboru zabezpieczeń głównych, nie kalkulator inżynierski. Jeden projekt = jedna szafka.
- **Status:** proposed

### S-04: Elektryk podaje obwody i dostaje dobrane aparaty

- **Outcome:** Elektryk może podać liczbę i parametry obwodów oraz wskazać, które dzielą wspólną grupę RCD, i dostaje zestaw dobranych aparatów — najtańszych spośród spełniających parametry — albo czytelny błąd z prośbą o kontakt z administratorem, gdy w katalogu nie ma pasującego aparatu.
- **Change ID:** `circuit-input-and-device-matching`
- **Issue:** #5
- **PRD refs:** FR-006, FR-007, US-01, `## Success Criteria` (guardrail doboru)
- **Prerequisites:** S-01, S-03
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Tu mieszka najgorsza możliwa awaria tego produktu: ciche zejście na aparat o za niskich parametrach. Guardrail jest binarny — dopasowanie albo błąd — a „najtańszy spośród pasujących" jest kryterium dopiero _po_ filtrze poprawności, nigdy zamiast niego. Drugie ryzyko: brak pasującego aparatu musi dawać komunikat o luce w katalogu do uzupełnienia przez admina, a nie wyglądać jak awaria aplikacji.
- **Status:** proposed

### S-05: System proponuje układ aparatów w szafce

- **Outcome:** Elektryk widzi propozycję fizycznego rozmieszczenia dobranych aparatów w wybranej szafce, wyliczoną z trzech reguł stosowanych łącznie: grupowanie nadprądowych przy RCD swojej grupy (z RCBO zamiast dwóch aparatów dla grupy jednoobwodowej), bliskość strony, którą wchodzą przewody, oraz odległość do szyn PE i N.
- **Change ID:** `cabinet-layout-proposal`
- **Issue:** #6
- **PRD refs:** FR-008, US-01, `## Business Logic`
- **Prerequisites:** S-02, S-04
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:**
  - Które z trzech reguł rozmieszczenia mają pierwszeństwo, gdy wskazują różne miejsca dla tej samej grupy? (Otwarte pytanie #2) — Owner: user. Block: yes.
- **Risk:** Gwiazda przewodnia i zarazem jedyny element, którego PRD sam nie domyka. Implementacja i tak wymusi _jakąś_ kolejność reguł — jeśli zapadnie milcząco w kodzie, nie da się później powiedzieć, czy zły układ to zła reguła, czy zła precedencja. Dlatego plasterek stoi jako `blocked`, dopóki precedencja nie zostanie zapisana świadomie. To heurystyka stosowana wprost, nie optymalizator — droga do solvera jest zamknięta w `## Non-Goals`.
- **Status:** blocked

### S-06: Elektryk poprawia układ ręcznie

- **Outcome:** Elektryk może zmodyfikować zaproponowany układ aparatów w szafce, zanim wygeneruje wycenę.
- **Change ID:** `manual-layout-editing`
- **Issue:** #7
- **PRD refs:** FR-009, US-01
- **Prerequisites:** S-05
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:** —
- **Risk:** To bezpiecznik na niedoskonałą heurystykę — bez niego jedna zła sugestia blokuje cały projekt, a kryterium akceptacji US-01 („układ jest edytowalny przed wygenerowaniem wyceny") nie jest spełnione. Ryzyko zakresowe: edytor kusi, żeby urósł w mini-CAD; MVP potrzebuje punktowej korekty, bo taka jest deklarowana miara sukcesu — „tylko punktowe poprawki, nie budowa od zera". Docelowo mysz i klawiatura; dotyk jest poza zakresem.
- **Status:** proposed

### S-07: Elektryk ustawia parametry wyceny w profilu

- **Outcome:** Elektryk może zapisać w swoim profilu stawkę godzinową, średni czas montażu przypadający na jeden aparat i stały narzut czasowy na projekt.
- **Change ID:** `electrician-pricing-profile`
- **Issue:** #8
- **PRD refs:** FR-010
- **Prerequisites:** F-01
- **Parallel with:** S-01, S-02, S-03, S-04, S-05, S-06
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Mały plasterek, ale trzyma rozstrzygnięcie z walidacji PRD: te parametry są atrybutem **profilu elektryka**, nie polem w katalogu aparatów i nie globalną stałą. Wsadzenie czasu montażu do katalogu byłoby trudne do cofnięcia i rozjechałoby wycenę między elektrykami. Sekwencyjnie wolny — może iść równolegle do całego toru projektowego.
- **Status:** ready

### S-08: Elektryk widzi koszt materiału i robocizny

- **Outcome:** Elektryk widzi wyliczony czas pracy (liczba aparatów × średni czas montażu + stały narzut), koszt robocizny (czas × stawka) oraz koszt materiału z cen katalogowych, i może nadpisać estymowany czas przed sfinalizowaniem wyceny.
- **Change ID:** `quote-cost-estimate`
- **Issue:** #9
- **PRD refs:** FR-011, FR-013, US-01
- **Prerequisites:** S-04, S-07
- **Parallel with:** S-05, S-06
- **Blockers:** —
- **Unknowns:**
  - FR-013 (zestawienie kosztu materiału) nie przeszedł rundy kontrargumentu przy pisaniu PRD (Otwarte pytanie #3) — Owner: user. Block: no.
- **Risk:** Estymacja nigdy nie może być pokazana jako wartość ostateczna — możliwość nadpisania czasu jest częścią wymagania, nie udogodnieniem; bez niej „estymacja z powietrza" podkopuje zaufanie do całego narzędzia. Kwoty w PLN idą przez wspólne formatowanie, nie przez ręcznie sklejany format.
- **Status:** proposed

### S-09: Elektryk drukuje wycenę z wizualizacją układu

- **Outcome:** Elektryk może wydrukować lub wyeksportować dokument wyceny zawierający rozbicie kosztów (materiał + robocizna) oraz czytelną wizualizację układu szafki.
- **Change ID:** `printable-quote-export`
- **Issue:** #10
- **PRD refs:** FR-012, US-01
- **Prerequisites:** S-06, S-08
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Domyka główne Kryterium sukcesu — bez tego elektryk nie wynosi z narzędzia żadnego artefaktu. Twarde ograniczenie środowiska: dokument musi powstać po stronie przeglądarki (patrz `context/foundation/infrastructure.md`), więc wizualizacja układu musi być drukowalna, a nie tylko interaktywna. Wizualizacja jest wymaganą częścią dokumentu, nie dodatkiem — sam cennik degraduje wydruk do zwykłej listy pozycji.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                           | Suggested issue title                                      | Ready for `/10x-plan` | Notes                                                                                     |
| ---------- | ----------------------------------- | ---------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| F-01       | `roles-and-rls-baseline`            | Role admin/elektryk + izolacja danych przez RLS            | done                  | Zarchiwizowane → `context/archive/2026-09-21-roles-and-rls-baseline/`                     |
| S-01       | `admin-device-catalog`              | Katalog aparatów prowadzony przez admina                   | yes                   | Uruchom `/10x-plan admin-device-catalog`                                                  |
| S-02       | `admin-cabinet-catalog`             | Katalog szafek rozdzielnic prowadzony przez admina         | done                  | Zarchiwizowane → `context/archive/2026-09-23-admin-cabinet-catalog/`                      |
| S-03       | `project-setup-and-supply-params`   | Nowy projekt: wybór szafki + parametry OSD/WLZ             | no                    | Czeka na S-02                                                                             |
| S-04       | `circuit-input-and-device-matching` | Obwody, grupy RCD i dobór aparatów z guardrailem           | no                    | Czeka na S-01, S-03                                                                       |
| S-05       | `cabinet-layout-proposal`           | Heurystyczna propozycja układu aparatów w szafce           | no                    | `blocked` — wymaga rozstrzygnięcia Otwartego pytania #2                                   |
| S-06       | `manual-layout-editing`             | Ręczna korekta zaproponowanego układu                      | no                    | Czeka na S-05                                                                             |
| S-07       | `electrician-pricing-profile`       | Parametry wyceny w profilu elektryka                       | yes                   | Uruchom `/10x-plan electrician-pricing-profile`; może iść równolegle do toru projektowego |
| S-08       | `quote-cost-estimate`               | Koszt materiału i robocizny z możliwością nadpisania czasu | no                    | Czeka na S-04, S-07                                                                       |
| S-09       | `printable-quote-export`            | Wydruk wyceny z wizualizacją układu szafki                 | no                    | Czeka na S-06, S-08                                                                       |

## Open Roadmap Questions

1. **Kryteria akceptacji dla ścieżki admina** — FR-001 i FR-002 nie mają żadnej historyjki użytkownika ani kryteriów akceptacji; cała rola admina jest nieopisana od strony zachowania. Owner: user. Block: `S-01`, `S-02` (nie blokuje planowania, ale utrudnia napisanie dla nich testu akceptacyjnego).
2. **Jak rozstrzygać konflikt reguł rozmieszczenia?** — reguły (1) grupowania, (2) bliskości wyprowadzeń i (3) bliskości szyn PE/N mogą wskazywać różne miejsca dla tej samej grupy; pierwszeństwo nie zostało ustalone. Owner: user. Block: `S-05` — blokująco, a pośrednio wstrzymuje też `S-06` i `S-09`.
3. **FR-013 nie przeszedł rundy kontrargumentu** — dodany po rundzie wyzwań, przy walidacji PRD. Owner: user. Block: `S-08` (nie blokuje planowania).
4. **Który termin zgłoszenia obowiązuje: 4 listopada 2026 czy 6 grudnia 2026?** — cel to 4 listopada bez presji; przy przekroczeniu 3-tygodniowego szacunku akceptowalne jest przesunięcie na 6 grudnia bez cięcia zakresu. Owner: user. Block: roadmap-wide (nie blokuje planowania — roadmapa nie zawiera dat).

## Parked

- **Pełny algorytm optymalizacyjny układu** — Why parked: PRD `## Non-Goals`; MVP stosuje trzy jawne reguły heurystyczne, nie solver ani optymalizację kombinatoryczną.
- **Typy aparatów spoza listy MVP** (bloki rozdzielcze, charakterystyki inne niż B) — Why parked: PRD `## Non-Goals`; lista typów jest zamknięta.
- **Masowy/automatyczny import katalogu producentów** — Why parked: PRD `## Non-Goals`; admin dodaje aparaty i szafki ręcznie.
- **Integracja płatności / faktur** — Why parked: PRD `## Non-Goals`; wycena jest dokumentem informacyjnym.
- **Wsparcie dla ekranów dotykowych i urządzeń mobilnych** — Why parked: PRD `## Non-Goals`; MVP zakłada mysz i klawiaturę.
- **Pełne obliczenia normowe** — Why parked: PRD `## Non-Goals`; MVP robi proste walidacje z podanych danych.
- **Instalacje wielkoformatowe/komercyjne** — Why parked: PRD `## Non-Goals`; celem są domy jednorodzinne i mieszkania.
- **Wiele rozdzielnic w jednym projekcie** — Why parked: PRD `## Non-Goals`; jeden projekt = jedna szafka.
- **Szafka własna/niestandardowa spoza katalogu** — Why parked: świadome zawężenie zapisane przy FR-004; elektryk wybiera wyłącznie z katalogu admina.
- **Filtr preferowanego producenta przy doborze** — Why parked: odnotowany przy FR-007 jako rozszerzenie po MVP; kryterium MVP to najniższa cena spośród poprawnych dopasowań.
- **Szablony obwodów / kopiowanie obwodów między projektami** — Why parked: odłożone przy FR-006 na późniejszą wersję.
- **Observability (logger, error tracking, metryki)** — Why parked: baseline pokazuje brak, ale PRD tego nie wymaga; przy jednym użytkowniku `wrangler tail` wystarcza, a cel `low-complexity` nie uzasadnia fundamentu pod monitoring.
- **Włączenie potwierdzania adresu email** (`enable_confirmations = true`) — Why parked: świadomie
  odłożone na **sam koniec MVP**, żeby przez cały czas budowy testowanie było łatwiejsze. Docelowo
  do zrobienia: jest darmowe na Supabase, a widok `/auth/confirm-email` już istnieje, więc włączenie
  wychodzi taniej niż utrzymywanie ścieżki bez potwierdzeń. Uwaga wykonawcza: `scripts/smoke.mjs`
  rejestruje użytkownika i od razu go loguje, więc włączenie potwierdzeń wymaga przepisania skryptu
  (logowanie jako zaseedowany admin albo potwierdzenie przez Mailpit). Patrz tripwire w `AGENTS.md`.
- **Trójwymiarowy podgląd szafki** (obrót, przybliżanie i przesuwanie myszą) — Why parked: pomysł
  użytkownika z 2026-09-23, niski priorytet, na sam koniec MVP, jeśli zostanie czas. Żaden FR tego
  nie wymaga — wystarcza rysunek 2D z przodu (S-05, S-06, S-09). Uwaga wykonawcza: geometria szafki
  ma już głębokość (`depthMm`, `zMm` szyn PE/N), a aparaty dostają wysokość i głębokość w S-01, więc
  dane pod 3D istnieją. Renderer byłby wyspą Reacta po stronie klienta (np. three.js), bez wpływu na
  wydruk, który zostaje w 2D. Śledzone w GitHub
  [#14](https://github.com/Mr1008/rozdzielnica-pro/issues/14).
- **Tłumaczenie interfejsu na inny język** — Why parked: PRD `## Non-Functional Requirements`; warstwa tłumaczeń już istnieje i nie blokuje drugiego języka, ale sam przekład nie jest celem MVP.

## Milestone History

(Append-only. Pusta przy pierwszym kamieniu milowym.)

## Done

(Pusta przy generowaniu. Wpisy dopisuje wyłącznie `/10x-archive`, gdy zarchiwizowana zmiana pasuje `Change ID` do elementu roadmapy.)

- **F-01: (foundation) aplikacja rozróżnia rolę `admin` od `elektryk`, każdy zalogowany użytkownik ma rekord profilu, a dane projektowe są izolowane per elektryk na poziomie bazy — nie w kodzie aplikacji.** — Archived 2026-09-22 → `context/archive/2026-09-21-roles-and-rls-baseline/`. Lesson: —.
- **S-02: Admin może dodać i edytować szafkę rozdzielnicy wraz z jej wymiarami i układem szyn montażowych.** — Archived 2026-09-23 → `context/archive/2026-09-23-admin-cabinet-catalog/`. Lesson: —.
