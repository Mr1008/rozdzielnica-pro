---
project: "RozdzielnicaPro"
version: 2
status: draft
created: 2026-09-15
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

Elektryk instalator, po spotkaniu z klientem i analizie zastanej instalacji, zna już liczbę obwodów, planowane obciążenia i ustalenia z klientem — ale przekłada to na układ aparatów w rozdzielnicy ręcznie, "na oko". Prowadzi to do rozwiązań nieekonomicznych (długie trasy przewodów, nieporządek w oprzewodowaniu), potencjalnie niezgodnych z dobrymi praktykami montażu, wymaga improwizacji na miejscu u klienta i utrudnia szybkie, adekwatne wyliczenie wyceny robocizny.

Połączenie danych katalogowych aparatów (wymiary, cena) z geometrią konkretnej szafki rozdzielnicy i prostymi regułami heurystycznymi pozwala automatycznie zaproponować układ, który jest jednocześnie wygodny w montażu, zgodny ze standardami i ekonomiczny w przewodowaniu — bez budowania ciężkiego, profesjonalnego narzędzia CAD elektrycznego. Istniejące rozwiązania tej klasy są zbyt złożone dla prostych instalacji domowych; celem jest prosty, celowo ograniczony branżowo asystent planowania i wyceny, budowany też jako projekt rozwojowy dla autora.

## User & Persona

**Elektryk instalator** wykonujący proste instalacje elektryczne w domach jednorodzinnych. Na start MVP: sam autor projektu, jako pojedynczy nazwany użytkownik (elektryk w trakcie zdobywania dalszych uprawnień), z możliwością rozszerzenia na innych instalatorów w przyszłości.

Sięga po narzędzie **po spotkaniu z klientem i analizie zastanej instalacji/projektu**, gdy zna już liczbę obwodów i planowane obciążenia — żeby zaplanować konkretny układ rozdzielnicy z wyprzedzeniem (bez improwizacji na miejscu montażu) i przygotować szybką, adekwatną wycenę robocizny.

## Success Criteria

### Primary
- Elektryk może dojść od założenia projektu do wygenerowanej wyceny robocizny dla realnej, prostej instalacji — otrzymując po drodze konkretny projekt/układ szafki (nie tylko liczbę) — bez ręcznego liczenia w arkuszu kalkulacyjnym.

### Secondary
- Zaproponowany układ aparatów wymaga tylko punktowych ręcznych poprawek, nie budowy od zera.

### Guardrails
- Wycena i dobór aparatów muszą być zawsze spójne z podanymi parametrami obwodów — system nigdy nie proponuje aparatu niezgodnego z parametrami obwodu (np. za mały prąd znamionowy); błędna sugestia jest gorsza niż brak sugestii. Gdy żaden aparat w katalogu nie spełnia parametrów obwodu, system zgłasza błąd z prośbą o kontakt z administratorem, zamiast schodzić na aparat niezgodny.

## User Stories

### US-01: Elektryk planuje rozdzielnicę i otrzymuje wycenę

- **Given** zalogowany elektryk oraz katalog aparatów i katalog szafek prowadzone przez admina
- **When** zakłada nowy projekt, wybiera szafkę z katalogu, podaje parametry OSD/WLZ oraz obwody doprowadzone do szafki wraz z ich przypisaniem do grup RCD
- **Then** otrzymuje zaproponowany zestaw aparatów (najtańszy spośród spełniających parametry obwodów) i propozycję ich układu w szafce, którą może poprawić, a następnie generuje wycenę do wydruku zawierającą układ szafki, koszt materiału i koszt robocizny wyliczony wg jego stawki godzinowej

#### Acceptance Criteria
- Sugerowane aparaty zawsze spełniają podane parametry obwodów (aparat o zbyt niskich parametrach nie zostaje nigdy zaproponowany)
- Gdy dla któregoś obwodu żaden aparat w katalogu nie spełnia parametrów, elektryk widzi błąd z prośbą o kontakt z administratorem, a nie propozycję niezgodnego aparatu
- Zaproponowany układ jest edytowalny przed wygenerowaniem wyceny
- Estymowany czas robocizny jest widoczny i możliwy do nadpisania przed sfinalizowaniem wyceny
- Wyeksportowana/wydrukowana wycena zawiera rozbicie kosztów (materiał + robocizna) oraz czytelną wizualizację układu szafki

## Functional Requirements

### Admin — katalog

- FR-001: Admin może dodawać i edytować wspierane aparaty wraz z danymi producenta (wymiary, cena katalogowa, parametry elektryczne potrzebne do dopasowania do obwodu). Priority: must-have
  > Socratic: Rozważony kontrargument: brak — to fundament, na którym opiera się reszta systemu (bez katalogu nie ma doboru aparatów ani układu). Rozstrzygnięcie: zachowane bez zmian.
- FR-002: Admin może dodawać i edytować szafki rozdzielnic wraz z ich wymiarami i układem szyn montażowych, tworząc katalog szafek. Priority: must-have
  > Socratic: Rozważony kontrargument: 2-3 szafki startowe mogą być zbyt podobne, by pokazać różnice w układzie. Rozstrzygnięcie: zachowane, z wyraźną notatką co do treści — 2-3 szafki startowe muszą się istotnie różnić (rozmiar / liczba szyn), żeby heurystyka układu widocznie się do nich dostosowywała.

### Elektryk — projekt instalacji

- FR-003: Elektryk może założyć nowy projekt. Priority: must-have
  > Socratic: Rozważony kontrargument: brak — trywialny, ale niezbędny kontener na kroki 4-8. Rozstrzygnięcie: zachowane bez zmian.
- FR-004: Elektryk może wybrać do projektu szafkę z katalogu szafek prowadzonego przez admina. Priority: must-have
  > Socratic: Rozważony kontrargument: ograniczenie do szafek z katalogu (brak szafki własnej/niestandardowej) zawęża realne zastosowanie poza demo. Rozstrzygnięcie: zachowane na MVP — świadome zawężenie zakresu; nazwa ujednolicona z "przykładowych szafek" na "katalog szafek", żeby mechanizm (FR-002) i jego konsument (FR-004) mówiły tym samym językiem.
- FR-005: Elektryk może podać dla projektu parametry przyłączeniowe OSD (zabezpieczenie przedlicznikowe, system instalacji: TN-C / TN-S / TN-C-S / TT, liczba faz) oraz parametry WLZ (długość, przekrój i materiał, sposób ułożenia: natynkowo / w rurce / w gruncie itp.), na potrzeby prostej walidacji i doboru zabezpieczeń głównych. Priority: must-have
  > Socratic: Rozważony kontrargument: brak — te dane są bezpośrednim wejściem do poprawnego doboru zabezpieczeń głównych (FR-007) i walidacji; bez nich dalsze sugestie byłyby bezpodstawne. Rozstrzygnięcie: zachowane, z listą pól zapisaną wprost za użytkownikiem.
- FR-006: Elektryk może podać liczbę i parametry obwodów doprowadzonych do szafki oraz wskazać, które obwody dzielą wspólną grupę różnicowoprądową (RCD). Priority: must-have
  > Socratic: Rozważony kontrargument: brak — bezpośrednie wejście do FR-007. Rozstrzygnięcie: zachowane bez zmian; szablony/kopiowanie obwodów między projektami odłożone na późniejszą wersję.
- FR-007: System sugeruje aparaty spełniające podane parametry obwodów; spośród pasujących domyślnym kryterium wyboru i sortowania jest najniższa cena katalogowa. Priority: must-have
  > Socratic: Rozważony kontrargument: sama "najniższa cena" to zbyt wąskie kryterium — elektryk może chcieć preferowanego producenta zamiast mieszanki marek w jednej szafce. Rozstrzygnięcie: na MVP zachowana najniższa cena spośród poprawnych dopasowań; filtr preferowanego producenta odnotowany jako możliwe rozszerzenie w kolejnej wersji, nie wymagany w MVP.
- FR-008: System proponuje automatyczny układ dobranych aparatów w wybranej szafce, stosując proste reguły heurystyczne (nie pełny algorytm optymalizacyjny). Priority: must-have
  > Socratic: Rozważony kontrargument: zła heurystyka jest gorsza niż brak sugestii, jeśli elektryk musi ją całkowicie przełożyć. Rozstrzygnięcie: zachowane, ale oznaczone jako ryzyko do rozstrzygnięcia konkretnie (nie pozostawione ogólnikiem) — dokładne reguły heurystyki są zdefiniowane w `## Business Logic`, właśnie dlatego, że "zgodność ze standardami" musi zostać sprowadzona do krótkiej, jawnej listy reguł, żeby dało się to zbudować w MVP.
- FR-009: Elektryk może ręcznie zmodyfikować zaproponowany układ. Priority: must-have
  > Socratic: Rozważony kontrargument: brak — to bezpiecznik na wypadek niedoskonałej heurystyki (FR-008); bez niego zła sugestia blokuje cały projekt. Rozstrzygnięcie: zachowane bez zmian.

### Elektryk — wycena

- FR-010: Elektryk może skonfigurować w swoim profilu parametry wyceny: stawkę godzinową, średni czas montażu przypadający na jeden aparat (jedna uśredniona wartość statystyczna dla wszystkich aparatów, nie osobny czas per model) oraz stały narzut czasowy na projekt. Priority: must-have
  > Socratic: Rozważony kontrargument: brak. Rozstrzygnięcie: zachowane bez zmian; jedna stawka wystarcza na MVP. Uzupełnione przy walidacji PRD — parametry czasowe estymacji są atrybutem profilu elektryka, a nie polem w katalogu aparatów ani globalną stałą systemu, więc każdy elektryk kalibruje wycenę własnym tempem pracy.
- FR-011: System estymuje czas i koszt robocizny dla wyceny na podstawie projektu (liczba dobranych aparatów przemnożona przez średni czas montażu na aparat z profilu elektryka, plus stały narzut na projekt); estymacja jest punktem wyjścia, który elektryk może nadpisać przed sfinalizowaniem wyceny — nigdy nie jest prezentowana jako wartość ostateczna i nieedytowalna. Priority: must-have
  > Socratic: Rozważony kontrargument: estymacja robocizny "wzięta z powietrza" jest gorsza niż brak estymacji — podkopuje zaufanie do narzędzia. Rozstrzygnięcie: zachowane, z wyraźnie zapisanym w samym FR zachowaniem nadpisywania; konkretna podstawa estymacji (co ją napędza) jest zdefiniowana w `## Business Logic`.
- FR-012: Elektryk może wyeksportować/wydrukować dokument wyceny, który zawiera czytelną wizualizację projektu układu szafki, a nie tylko cenę. Priority: must-have
  > Socratic: Rozważony kontrargument: bez czytelnej wizualizacji układu wydruk jest tylko listą pozycji i traci wartość względem zwykłej faktury. Rozstrzygnięcie: zachowane bez zmian — wizualizacja jest wymaganą częścią eksportowanego dokumentu, nie opcjonalnym dodatkiem.
- FR-013: System zestawia koszt materiału na podstawie cen katalogowych dobranych aparatów i pokazuje go w wycenie obok kosztu robocizny. Priority: must-have

## Non-Functional Requirements

- Sugerowany zestaw aparatów, propozycja układu i wycena pojawiają się bez zauważalnego oczekiwania dla katalogu tej skali (rzędu pojedynczych sekund, nie dziesiątek sekund).
- Projekty i dane klientów należące do danego elektryka są widoczne wyłącznie dla niego — żaden inny użytkownik nie ma wglądu w cudze projekty.

## Business Logic

**System dobiera i rozmieszcza aparaty tak, by spełnić parametry obwodów przy minimalnej długości przewodów.**

Reguła konsumuje dane podane przez elektryka: parametry OSD/WLZ, listę obwodów wraz z ich pogrupowaniem w grupy różnicowoprądowe (RCD) — elektryk przy podawaniu obwodów wskazuje, które obwody dzielą wspólny RCD — oraz wybraną z katalogu szafkę (jej układ szyn/torów montażowych).

Wynikiem jest zestaw sugerowanych aparatów (spełniających parametry obwodów, o najniższej cenie spośród pasujących) oraz propozycja ich fizycznego rozmieszczenia w szafce. Rozmieszczenie realizuje trzy reguły stosowane łącznie: **(1) grupowanie** — wyłączniki nadprądowe danej grupy sąsiadują z jej wyłącznikiem RCD, a jeśli grupa RCD obejmuje tylko jeden obwód, system sugeruje pojedynczy wyłącznik RCBO (kombinowany RCD + nadprądowy) zamiast dwóch osobnych aparatów; **(2) bliskość wyprowadzeń** — grupa jest umieszczana możliwie blisko tej strony szafki, którą wchodzą do niej przewody jej obwodów (góra, lewo, prawo, dół); **(3) bliskość elementów wspólnych** — rozmieszczenie uwzględnia odległość do szyn PE i N. Te trzy reguły razem są tym, czym MVP przybliża "minimalną długość przewodów"; pozostają heurystyką stosowaną wprost, nie optymalizacją globalną. Gdy dla któregoś obwodu żaden aparat w katalogu nie spełnia podanych parametrów, reguła nie schodzi na aparat niezgodny — system zgłasza błąd z prośbą o kontakt z administratorem, bo brakujący aparat jest luką w katalogu, którą uzupełnia admin (FR-001).

Na tej samej podstawie powstaje wycena: liczba dobranych aparatów przemnożona przez średni czas montażu na aparat — parametr z profilu elektryka, obok stawki godzinowej, jedna uśredniona wartość dla wszystkich aparatów — powiększona o stały narzut na projekt (przygotowanie szafki, podłączenie WLZ) daje szacowany czas pracy; ten czas przemnożony przez stawkę godzinową daje koszt robocizny, a ceny katalogowe dobranych aparatów — koszt materiału. Elektryk spotyka te reguły na ekranie planowania projektu: widzi zaproponowany zestaw aparatów i wizualny układ w szafce, może poprawić układ (FR-009) oraz nadpisać estymowany czas (FR-011), zanim wygeneruje wycenę.

## Access Control

Logowanie przez email + hasło. W MVP bez weryfikacji adresu email.

Dwie role:

| Rola | Uprawnienia |
| --- | --- |
| **admin** | Zarządza katalogiem wspieranych aparatów (dane producentów: wymiary, cena katalogowa itp.) oraz katalogiem szafek rozdzielnic. Nie ma wglądu w projekty ani dane klientów elektryków. |
| **elektryk** | Zakłada własne projekty instalacji, wybiera szafkę, otrzymuje propozycję układu aparatów, generuje wycenę; konfiguruje w profilu stawkę godzinową, średni czas montażu na aparat i stały narzut na projekt. Widzi wyłącznie własne projekty. |

Konta elektryków mogą powstać na dwa sposoby: samodzielna rejestracja lub założenie konta przez admina — oba tryby dopuszczone w MVP.

Niezalogowany użytkownik trafiający na chronioną trasę jest przekierowywany do logowania.

## Non-Goals

- **Bez pełnego algorytmu optymalizacyjnego układu** — MVP używa prostej heurystyki (grupowanie RCD, bliskość wyprowadzeń przewodów, bliskość szyn PE/N — patrz `## Business Logic`), nie solvera ani optymalizacji kombinatorycznej.
- **Bez typów aparatów spoza listy wspieranej w MVP** — MVP obsługuje wyłącznie: rozłączniki bezpiecznikowe ("FRy"), wyłączniki różnicowoprądowe (RCD), wyłączniki różnicowoprądowe z członem nadprądowym (RCBO), wyłączniki nadprądowe o charakterystyce B, szyny PE i szyny N. Pozostałe typy — w tym bloki rozdzielcze (rozważane przy regułach bliskości, ale nieujęte w MVP) oraz wyłączniki nadprądowe o charakterystykach innych niż B — dochodzą dopiero po MVP, o ile pójdzie łatwo i zostanie czas.
- **Bez masowego/automatycznego importu katalogu producentów** — admin dodaje aparaty i szafki ręcznie w MVP; integracja z realnymi bazami producentów to nie jest cel MVP.
- **Bez integracji płatności / faktur** — wycena to dokument informacyjny do wydruku/eksportu, nie faktura powiązana z systemem płatności.
- **Bez wsparcia dla ekranów dotykowych / urządzeń mobilnych** — MVP zakłada pracę na komputerze (mysz + klawiatura); brak dedykowanego UI dotykowego.
- **Bez pełnego, teoretycznego opomiarowania zgodnego z normami** — MVP robi proste walidacje na podstawie podanych danych (patrz FR-005, FR-007), nie pełne obliczenia inżynierskie/certyfikacyjne zgodności z normą.
- **Bez instalacji wielkoformatowych/komercyjnych** — MVP celuje wyłącznie w domki jednorodzinne i mieszkania, nie obiekty przemysłowe/komercyjne.
- **Bez wielu rozdzielnic w jednym projekcie** — jeden projekt odpowiada jednej szafce; łączone/wielorozdzielnicowe instalacje są poza zakresem MVP.

Uwaga (nie non-goal, doprecyzowanie zakresu): instalacje jednofazowe (1F) i trójfazowe (3F) mają być obsługiwane w MVP — to nie jest wykluczone (patrz FR-005: liczba faz jako pole OSD).

## Open Questions

1. **Kryteria akceptacji dla ścieżki admina** — FR-001 i FR-002 nie mają żadnej historyjki użytkownika ani kryteriów akceptacji; cała rola admina jest nieopisana od strony zachowania. Owner: user. Block: nie (ale utrudnia napisanie testu dla tej ścieżki).
2. **Jak rozstrzygać konflikt reguł rozmieszczenia?** — Reguły (1) grupowania, (2) bliskości wyprowadzeń i (3) bliskości szyn PE/N mogą wskazywać różne miejsca dla tej samej grupy. Nie ustalono, która ma pierwszeństwo, gdy się wykluczają. Owner: user. Block: nie (ale implementacja heurystyki wymusi jakąś kolejność — lepiej, żeby była świadoma).
3. **FR-013 nie przeszedł rundy Sokratesa** — dodany po rundzie wyzwań, przy walidacji PRD; nie skonfrontowany z kontrargumentem jak pozostałe FR-y. Owner: user. Block: nie.
4. **Który termin zgłoszenia ostatecznie obowiązuje: 4 listopada 2026 czy 6 grudnia 2026?** — Cel to 4 listopada, ale bez presji; przy przekroczeniu 3-tygodniowego szacunku MVP akceptowalne jest przesunięcie na 6 grudnia bez cięcia zakresu. Dlatego frontmatter zapisuje `hard_deadline: null`. Owner: user. Block: nie.

**Rozstrzygnięte przy walidacji:**

- *(2026-09-15)* Źródło czasu montażu aparatu — uśredniony, statystyczny parametr profilu elektryka (obok stawki godzinowej), nie pole w katalogu aparatów i nie stała globalna systemu; patrz FR-010 i `## Business Logic`.
- *(2026-09-16)* Brak pasującego aparatu w katalogu — system zgłasza błąd z prośbą o kontakt z administratorem, zamiast schodzić na aparat niezgodny; patrz guardrail w `## Success Criteria`, `## Business Logic` i kryteria akceptacji US-01.
- *(2026-09-16)* Grupowanie RCD nie wystarcza jako realizacja "minimalnej długości przewodów" — heurystyka obejmuje dodatkowo bliskość wyprowadzeń przewodów do szafki (góra/lewo/prawo/dół) oraz bliskość szyn PE i N; patrz `## Business Logic`.
- *(2026-09-16)* Zakres typów aparatów w MVP zawężony do: rozłączniki bezpiecznikowe ("FRy"), RCD, RCBO, nadprądowe o charakterystyce B, szyny PE, szyny N; patrz `## Non-Goals`.
- *(2026-09-16)* Rzędy wielkości obciążenia i danych — `qps: low`, `data_volume: small`: jeden elektryk, praca projektowa (kilka-kilkanaście projektów miesięcznie), katalog aparatów i szafek prowadzony ręcznie przez admina. Skala mieści się z dużym zapasem w darmowych limitach wybranego stacku; patrz frontmatter `target_scale` i `context/foundation/tech-stack.md`.
