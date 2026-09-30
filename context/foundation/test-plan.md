# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-30

## 1. Strategy

Testy w tym projekcie trzymają się trzech zasad:

1. **Cost × signal.** Wygrywa najtańszy test, który daje realny sygnał dla
   danego ryzyka. Nie promujemy testu do e2e, bo „wydaje się bezpieczniejszy”.
   Nie kładziemy modelu wizyjnego na deterministyczną różnicę, która już łapie
   regresję.
2. **Obawy użytkownika są pełnoprawnym dowodem.** Ryzyko „autor boi się, że
   system zaprojektuje niebezpieczną rozdzielnicę, za którą elektryk weźmie
   odpowiedzialność” waży tyle samo co linia PRD czy dane o churnie.
3. **Risks are scenarios, not code locations.** Ten plan opisuje, _co może
   się zepsuć_ i _dlaczego uważamy to za prawdopodobne_ — na podstawie
   dokumentów, wywiadu i sygnału z kodu (churn, struktura, baza testów). NIE
   twierdzi, która linia odpowiada za awarię. Tę wiedzę produkuje
   `/10x-research` w każdej fazie wdrażania. Gdy plan i research się nie
   zgadzają co do miejsca awarii, research jest źródłem prawdy.

Dodatkowa zasada domenowa: **wyrocznia testu pochodzi z wymagań lub normy,
nigdy z kodu pod testem.** Oczekiwany aparat, blokada czy kwota jest
wyprowadzona z PRD, tabeli normy albo przykładu policzonego ręcznie.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/migrations/`,
`scripts/` (bez `src/lib/database.types.ts` i `src/lib/i18n/pl.ts`).

## 2. Risk Map

| #   | Risk (failure scenario)                                                                                                                                                                                                                     | Impact | Likelihood     | Source (evidence — not anchor)                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | System proponuje aparat niespełniający parametrów obwodu (za niskie In, złe bieguny, za wysokie IΔn lub za niski typ RCD, FR poniżej zabezpieczenia przedlicznikowego) albo przy luce w katalogu po cichu podstawia zamiennik zamiast błędu | High   | High           | PRD `## Success Criteria` (guardrail), US-01 AC; interview Q1; roadmap S-04 in-progress; hot-spot dir `src/lib/` (30 commits/30d)                                                                                        |
| 2   | Domena liczy poprawnie, ale elektryk widzi co innego: nieaktualny dobór po zmianie przyłącza lub obwodów, niewidoczny błąd luki, fallback RCD+MCB pokazany jak zwykła propozycja, zapis obwodów gubi dane                                   | High   | High           | interview Q4 (brak e2e); AGENTS.md Tripwires (suite covers no HTTP); `context/changes/circuit-input-and-device-matching/plan.md` p3 (ręczne kroki o stanie nieaktualnym); hot-spot dir `src/pages/api/` (12 commits/30d) |
| 3   | Niebezpieczna konfiguracja przechodzi bez blokady lub ostrzeżenia: RCD w TN-C, obwód 3F przy przyłączu 1F, obciążalność przewodu poniżej In, błąd w przepisanej tabeli obciążalności                                                        | High   | Medium         | interview Q1; PRD FR-005, `## Non-Goals` (tylko proste walidacje); archive `2026-09-24-project-setup-and-supply-params` (pierwsza transkrypcja D1 była błędna)                                                           |
| 4   | Propozycja układu albo ręczna edycja daje układ fizycznie niemożliwy lub łamiący reguły (aparat poza szyną lub nachodzący na inny, MCB oderwane od swojego RCD, grupa jednoobwodowa bez RCBO), który trafia na wydruk                       | High   | High (od S-05) | interview Q3 (edytor szafki i układu, dużo przyszłych zmian); PRD FR-008, FR-009, `## Business Logic`; roadmap S-05, S-06; hot-spot dir `src/components/cabinets/` (8 commits/30d)                                       |
| 5   | Wycena błędna: zła liczba aparatów, zaokrąglenia groszy lub minut, domyślne wartości zamiast blokady przy braku profilu, estymacja pokazana jako ostateczna i nienadpisywalna                                                               | High   | Medium         | PRD FR-010, FR-011, FR-013, `## Business Logic`; AGENTS.md Tripwires (brak wiersza profilu = nieskonfigurowany); roadmap S-08                                                                                            |
| 6   | Nadużycie: elektryk czyta lub zmienia cudzy projekt albo obwody (IDOR przez id w URL lub formularzu), admin widzi projekty, nowa tabela trafia do bazy bez RLS                                                                              | High   | Medium         | PRD `## Access Control`, NFR izolacji; roadmap F-01; hot-spot dir `supabase/migrations/` (9 commits/30d)                                                                                                                 |
| 7   | Rozjazd danych katalog↔projekt: CHECK w bazie i parser w TS przestają się zgadzać (aparaty, przyłącze, wycena, obwody) albo edycja katalogu przez admina zmienia istniejący projekt lub dobór                                               | Medium | Medium         | AGENTS.md Tripwires (reguły pilnowane dwa razy, snapshot S-03); interview Q5 (liczą się dane katalogu, nie wygląd); hot-spot dir `supabase/migrations/` (9 commits/30d)                                                  |

Wysoki wpływ × niskie prawdopodobieństwo (awaria Supabase lub Cloudflare,
migracja psująca dane produkcyjne) należy do obserwowalności i procesu
wdrożenia, nie do testów.

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                          | Must challenge                                                                                        | Context `/10x-research` must ground                                                                        | Likely cheapest layer                                                        | Anti-pattern to avoid                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| #1   | Dla każdej kombinacji obwodu i katalogu-fixture wybrany aparat spełnia każdy parametr; przy luce jest błąd z nazwą brakującego aparatu, nigdy aparat | „Najtańszy” liczony dopiero po filtrze poprawności; istniejące testy doboru mają niezależną wyrocznię | tabela reguł dopasowania, zachowanie fallbacku RCBO → RCD+MCB, skąd obecne testy biorą oczekiwane wartości | unit (tabelaryczne + property-based na katalogu-fixture)                     | oczekiwania skopiowane z implementacji (problem wyroczni) |
| #2   | Na stronie projektu widać ten sam wynik co w domenie: błąd luki, oznaczenie nieaktualnego doboru, brak zamiennika; zapisane obwody wracają bez strat | „Endpoint woła parser i matcher, więc UI jest OK”                                                     | ścieżka formularz → endpoint → zapis → render, mapowanie `?error=`, snapshot doboru                        | e2e na 2–3 krytycznych przepływach, reszta integration                       | e2e dla każdego wariantu zamiast dla przepływu            |
| #3   | Każdy blocker i warning odpala się na granicy (In równe obciążalności, ±1 A); wartości tabeli przypięte do normy                                     | „Tabela kompletna, więc poprawna”                                                                     | źródło wartości tabeli, warunki blokad i ostrzeżeń                                                         | unit z wartościami granicznymi                                               | test tylko przypadku jawnie niebezpiecznego               |
| #4   | Po propozycji i po każdej edycji: brak kolizji, aparaty w obrębie szyn, grupa obok swojego RCD, RCBO dla grupy jednoobwodowej                        | „Heurystyka dała układ, więc jest fizycznie poprawny”                                                 | model układu z S-05, rozstrzygnięta precedencja reguł (OQ#2)                                               | unit na niezmiennikach + 1 e2e edycji + selektywny przegląd wizualny wydruku | snapshot SVG bez znaczenia                                |
| #5   | Kwoty z przykładów policzonych ręcznie w groszach i minutach; brak profilu blokuje; nadpisany czas zmienia koszt                                     | „Liczba aparatów to długość listy”                                                                    | co liczy się jako aparat, zaokrąglenia, ścieżka nadpisania                                                 | unit z przykładami z PRD                                                     | formuła przepisana z kodu do testu                        |
| #6   | Elektryk B dostaje odmowę lub pustą odpowiedź na zasoby A; admin nie widzi projektów; każda tabela z danymi elektryka ma test RLS                    | „Jest RLS, więc endpoint jest bezpieczny”                                                             | pełna lista tabel z danymi elektryka, endpointy przyjmujące id                                             | integration (RLS) + 1 e2e IDOR przez URL                                     | test tylko własnego odczytu                               |
| #7   | Ten sam fixture przechodzi albo pada identycznie w parserze TS i w CHECK bazy; edycja szafki lub aparatu nie zmienia istniejącego projektu           | „Unit parsera wystarczy”                                                                              | pary CHECK↔parser, trigger snapshotu, snapshot doboru                                                      | integration (żywa baza)                                                      | osobne fixtury dla bazy i parsera                         |

## 3. Phased Rollout

| #   | Phase name                     | Goal (one line)                                                                                                               | Risks covered | Test types                                    | Status      | Change folder                              |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------- | ----------- | ------------------------------------------ |
| 1   | Matching and validation oracle | Udowodnić guardrail doboru i blokady na danych z wymagań i normy, nie z kodu                                                  | #1, #3        | unit (table-driven, boundary, property-based) | complete    | `context/changes/testing-matching-oracle/` |
| 2   | Data integrity and isolation   | Parytet CHECK↔parser, niezmienność snapshotów, RLS każdej tabeli; `test:integration` w CI                                     | #6, #7        | integration + CI gate                         | not started | —                                          |
| 3   | Critical-path e2e              | Bootstrap Playwright: projekt → przyłącze → obwody → dobór, luka w katalogu, stan nieaktualny, IDOR przez URL (po S-04 p3–p4) | #2, #6        | e2e + CI gate                                 | not started | —                                          |
| 4   | Layout and quote invariants    | Niezmienniki układu i edycji, wycena z przykładów ręcznych, przegląd wizualny wydruku (po S-05, S-06, S-08)                   | #4, #5        | unit + e2e + multimodal visual review         | not started | —                                          |

## 4. Stack

| Layer                 | Tool                                                       | Version              | Notes                                                                                                                                             |
| --------------------- | ---------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit                  | Vitest (`vitest.config.ts`)                                | ^5.0.1               | `src/**/*.test.ts`, bez infrastruktury, w CI                                                                                                      |
| integration (RLS, DB) | Vitest (`vitest.integration.config.ts`) + lokalny Supabase | ^5.0.1 / CLI ^2.23.4 | `tests/integration/**`; dziś tylko lokalnie — do CI w §3 Phase 2                                                                                  |
| property-based        | fast-check — checked: 2026-09-30                           | ^4.10.2              | `src/lib/*.property.test.ts`, w `test:unit` i w CI                                                                                                |
| e2e                   | none yet — see Phase 3                                     | —                    | kandydat: Playwright; job `smoke` w CI już stawia Supabase                                                                                        |
| HTTP smoke            | `scripts/smoke.mjs`                                        | —                    | tylko auth i bramki ról                                                                                                                           |
| (optional) AI-native  | multimodal review wydruku wyceny — checked: 2026-09-29     | n/a                  | Tylko 1–2 ekrany (rysunek szafki, wydruk). When NOT to use: gdy deterministyczny test niezmienników układu albo porównanie DOM już łapie regresję |

**Stack grounding tools (current session):**

- Docs: Supabase MCP `search_docs` — dostępny, nieużyty na tym etapie; Context7 not available in current session; checked: 2026-09-29
- Search: WebSearch/WebFetch — dostępne, nieużyte; Exa.ai not available in current session; checked: 2026-09-29
- Runtime/browser: wbudowana przeglądarka (Claude Browser) — do ręcznej weryfikacji, nie jako warstwa testów; checked: 2026-09-29
- Provider/platform: Supabase MCP, SonarQube MCP — potencjalnie do bramki jakości (pokrycie, issues), nieużyte; checked: 2026-09-29

## 5. Quality Gates

| Gate                     | Where                             | Required?                 | Catches                                    |
| ------------------------ | --------------------------------- | ------------------------- | ------------------------------------------ |
| lint + `astro check`     | local (pre-commit lint) + CI `ci` | required                  | typy, formatowanie, rozjazd enumów TS↔baza |
| `test:unit`              | local + CI `ci`                   | required                  | regresje logiki domenowej                  |
| `test:integration`       | local + CI                        | required after §3 Phase 2 | RLS, parytet CHECK↔parser, snapshoty       |
| e2e on critical flows    | CI                                | required after §3 Phase 3 | zepsute krytyczne przepływy elektryka      |
| smoke (`smoke.mjs`)      | CI `smoke`                        | required                  | build, adapter Cloudflare, auth przez HTTP |
| multimodal visual review | on demand                         | optional after §3 Phase 4 | nieczytelny rysunek szafki lub wydruk      |

## 6. Cookbook Patterns

### 6.1 Adding a unit test for a domain rule

- **Gdzie:** `src/lib/<module>.test.ts` obok helpera; testy property-based w `src/lib/<module>.property.test.ts`. Uruchomienie: `npm run test:unit` (bez infrastruktury, w CI).
- **Nazewnictwo:** nazwa testu (lub komentarz nad tabelą) wskazuje źródło oczekiwanej wartości: wiersz tabeli reguł, sekcję PRD albo ręczne obliczenie. Bez źródła test jest tylko opisem kodu.
- **Wyrocznia:** oczekiwane wartości są literałami z PRD, normy lub obliczenia ręcznego. Test nie importuje reguł implementacji (list, tabel, predykatów) — predykat w teście property-based jest napisany od nowa z tabeli reguł S-04.
- **Granica:** wartości są dyskretne (listy In, przekrojów, zabezpieczeń), więc „±1 A” nie istnieje. Granica to „równe” kontra „następna wartość z listy”; równość nigdy nie ostrzega ani nie odrzuca aparatu.
- **Testy wzorcowe:**
  - `src/lib/device-matching.test.ts`, blok „Boundary tables (risk #1)” (aparaty tuż poniżej i tuż powyżej wymagania w jednym katalogu),
  - `src/lib/device-matching.property.test.ts` (niezależny predykat, „najtańszy spośród zgodnych”, dokładna lista luk, strażnik rozkładu statusów),
  - tabela równości `it.each` w `src/lib/supply-warnings.test.ts` (blok `wlz_ampacity_below_protection`).
- **Jak dodać test graniczny dla nowego ostrzeżenia (bez czytania planu):**
  1. Wskaż źródło reguły (PRD, tabela normy, obliczenie ręczne) i zapisz je w komentarzu nad tabelą.
  2. Wypisz z wartości dyskretnych wszystkie kombinacje, w których wartość jest dokładnie równa progowi, oraz następną wartość z listy po stronie ostrzeżenia.
  3. Wstaw je do jednego `it.each`; w każdym wierszu oczekiwane kody ostrzeżeń i liczby jako literały, nigdy odczytane z kodu implementacji.
  4. Asercja: równość nie ostrzega, następna wartość ostrzega (`toContainEqual` z pełnym obiektem ostrzeżenia).
  5. Sprawdź, że test czegoś pilnuje: zmień w implementacji operator (`>` na `>=`) albo wartość w tabeli i upewnij się, że test pada; cofnij zmianę.
  6. Przy obliczeniach zmiennoprzecinkowych dodaj przypadek dokładnie na progu (np. spadek napięcia 0,5 %).

### 6.2 Adding an integration test (RLS, CHECK↔parser parity)

- TBD — see §3 Phase 2 (wzorzec: wspólny fixture dla parsera i bazy; test odmowy dostępu dla drugiego elektryka i admina).

### 6.3 Adding an e2e test for an electrician flow

- TBD — see §3 Phase 3 (wzorzec: błąd luki w katalogu widoczny na stronie projektu, bez zamiennika).

### 6.4 Adding a test for a new table or endpoint

- TBD — see §3 Phase 2 and Phase 3 (wzorzec: każda nowa tabela = test RLS; każdy nowy endpoint z id = test IDOR).

### 6.5 Adding a test for layout or quote

- TBD — see §3 Phase 4 (wzorzec: niezmienniki układu po propozycji i edycji; wycena z przykładu policzonego ręcznie).

### 6.6 Per-rollout-phase notes

**Phase 1 — Matching and validation oracle (complete, 2026-09-30).** Dostarczono: tabele graniczne doboru aparatów (`device-matching.test.ts`), test property-based doboru (`device-matching.property.test.ts`, `fast-check`), tabele równości obciążalności, przypięcie mapowania sposobu ułożenia na metodę referencyjną (`supply-warnings.test.ts`, `circuit-warnings.test.ts`) oraz przypadki „TN-S / TN-C-S / TT nie blokuje” (`device-matching.test.ts`). Znalezisko: spadek napięcia dla 1F, Cu 10 mm², 16,1 m, 20 A to dokładnie 0,5 %, ale w IEEE-754 wychodziło 0,5000000000000001 i `supplyWarnings` ostrzegało fałszywie. Poprawka: spadek jest zaokrąglany do 9 miejsc po przecinku przed porównaniem i wyświetleniem. Wniosek: testy graniczne na wartościach obliczanych zmiennoprzecinkowo muszą zawierać przypadek dokładnie na progu.

## 7. What We Deliberately Don't Test

- **Wygląd panelu admina** — jedynym użytkownikiem jest autor, toporny UI jest akceptowalny. Poprawność _danych_ katalogu nadal jest testowana (#7). Re-evaluate, gdy pojawi się drugi admin. (Source: Phase 2 interview Q5.)
- **UI dotykowe i mobilne** — poza zakresem MVP. (Source: PRD `## Non-Goals`.)
- **Zdolność zwarciowa (Icn) aparatów** — nigdy nie jest porównywana, bo aplikacja nie ma wejścia z poziomem zwarcia, więc żaden test nie udaje, że to pokrywa. Re-evaluate, gdy pojawi się pole poziomu zwarcia w przyłączu. (Source: research `testing-matching-oracle`, Open Question 1.)
- **Dobór RCD do obciążenia grupy** — RCD jest oceniany względem największego prądu znamionowego obwodu w grupie, nie sumy obciążenia grupy (B16+B20+B20 przechodzi na RCD 25 A). Test przypina tę regułę, nie jej słuszność. Re-evaluate, gdy elektryk zakwestionuje regułę albo pojawi się obciążenie obwodu w amperach. (Source: research `testing-matching-oracle`, Open Question 2.)
- **Pełne obliczenia normowe** — testujemy tylko uproszczone kontrole i przepisane tabele, nie zgodność z normą w całości. (Source: PRD `## Non-Goals`.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-29
- Stack versions last verified: 2026-09-29
- AI-native tool references last verified: 2026-09-29

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
