---
project: "RozdzielnicaPro"
context_type: greenfield
created: 2026-09-15
updated: 2026-09-15
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: "pain category"
      decision: "workflow friction — manual layout planning after client meeting is slow and improvised on-site; tool should also speed up adequate labor pricing"
    - topic: "insight"
      decision: "deliberately simple/narrow tool vs. heavy professional electrical CAD ('kobyła'); also a personal learning project"
    - topic: "primary persona scope"
      decision: "single named user (the author, an electrician) for MVP; extensible later to other installers"
    - topic: "auth strategy"
      decision: "email + password login; two roles (admin, elektryk); no email verification for MVP to keep hosting free"
    - topic: "sign-up model"
      decision: "both admin-created accounts and electrician self-registration are allowed"
    - topic: "labor estimation basis (resolved during PRD validation, 2026-09-15)"
      decision: "average assembly time per device is a profile-level setting of the elektryk (one statistical average for all devices, not per model, not a catalog field, not a global constant), alongside the hourly rate and a fixed per-project overhead"
    - topic: "quote scope (resolved during PRD validation, 2026-09-15)"
      decision: "quote covers labor AND material — material cost comes from catalog prices of the selected devices; both shown as a breakdown"
    - topic: "admin visibility (resolved during PRD validation, 2026-09-15)"
      decision: "admin manages catalogs only and has NO access to electricians' projects or client data"
    - topic: "PRD language (resolved during PRD validation, 2026-09-15)"
      decision: "prd.md is written in Polish end-to-end, keeping schema tokens (FR-NNN, Priority:, **Given/When/Then**) — regeneration must preserve this"
    - topic: "no matching device in catalog (resolved 2026-09-16)"
      decision: "system raises an error asking the user to contact the admin; it never falls back to an under-rated device — a missing device is a catalog gap the admin fills"
    - topic: "layout heuristic scope (resolved 2026-09-16)"
      decision: "RCD grouping alone is NOT enough — the heuristic also accounts for proximity to the cable entry side of the cabinet (top/left/right/bottom) and proximity to PE and N bars; still applied directly, not as global optimization"
    - topic: "supported device types in MVP (resolved 2026-09-16)"
      decision: 'fuse switch-disconnectors ("FRy"), RCD, RCBO, MCBs of curve B only, PE bars, N bars; distribution blocks and other MCB curves come after MVP if time allows'
  frs_drafted: 13
  quality_check_status: accepted
---

## Vision & Problem Statement

Elektryk instalator, po spotkaniu z klientem i analizie zastanej instalacji, zna już liczbę obwodów, planowane obciążenia i ustalenia z klientem — ale przekłada to na układ aparatów w rozdzielnicy ręcznie, "na oko". Prowadzi to do rozwiązań nieekonomicznych (długie trasy przewodów, nieporządek w oprzewodowaniu), potencjalnie niezgodnych z dobrymi praktykami montażu, wymaga improwizacji na miejscu u klienta i utrudnia szybkie, adekwatne wyliczenie wyceny robocizny.

Połączenie danych katalogowych aparatów (wymiary, cena) z geometrią konkretnej szafki rozdzielnicy i prostymi regułami heurystycznymi pozwala automatycznie zaproponować układ, który jest jednocześnie wygodny w montażu, zgodny ze standardami i ekonomiczny w przewodowaniu — bez budowania ciężkiego, profesjonalnego narzędzia CAD elektrycznego. Istniejące rozwiązania tej klasy są zbyt złożone dla prostych instalacji domowych; celem jest prosty, celowo ograniczony branżowo asystent planowania i wyceny, budowany też jako projekt rozwojowy dla autora.

## User & Persona

**Elektryk instalator** wykonujący proste instalacje elektryczne w domach jednorodzinnych. Na start MVP: sam autor projektu, jako pojedynczy nazwany użytkownik (elektryk w trakcie zdobywania dalszych uprawnień), z możliwością rozszerzenia na innych instalatorów w przyszłości.

Sięga po narzędzie **po spotkaniu z klientem i analizie zastanej instalacji/projektu**, gdy zna już liczbę obwodów i planowane obciążenia — żeby zaplanować konkretny układ rozdzielnicy z wyprzedzeniem (bez improwizacji na miejscu montażu) i przygotować szybką, adekwatną wycenę robocizny.

## Access Control

Logowanie przez email + hasło. Bez weryfikacji adresu email w MVP (utrzymanie darmowe — brak wysyłki maili transakcyjnych, chyba że znajdzie się darmowa opcja).

Dwie role:

| Rola         | Uprawnienia                                                                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **admin**    | Zarządza katalogiem wspieranych aparatów (dane producentów: wymiary, cena katalogowa itp.) oraz katalogiem szafek rozdzielnic. Nie ma wglądu w projekty ani dane klientów elektryków.                                                        |
| **elektryk** | Zakłada własne projekty instalacji, wybiera szafkę, otrzymuje propozycję układu aparatów, generuje wycenę; konfiguruje w profilu stawkę godzinową, średni czas montażu na aparat i stały narzut na projekt. Widzi wyłącznie własne projekty. |

Konta elektryków mogą powstać na dwa sposoby: samodzielna rejestracja lub założenie konta przez admina — oba tryby dopuszczone w MVP.

Niezalogowany użytkownik trafiający na chronioną trasę jest przekierowywany do logowania.

## Success Criteria

### Primary

- Elektryk może dojść od założenia projektu do wygenerowanej wyceny robocizny dla realnej, prostej instalacji — otrzymując po drodze konkretny projekt/układ szafki (nie tylko liczbę) — bez ręcznego liczenia w Excelu.

### Secondary

- Zaproponowany układ aparatów wymaga tylko punktowych ręcznych poprawek, nie budowy od zera.

### Guardrails

- Wycena i dobór aparatów muszą być zawsze spójne z podanymi parametrami obwodów — system nigdy nie proponuje aparatu niezgodnego z parametrami obwodu (np. za mały prąd znamionowy); błędna sugestia jest gorsza niż brak sugestii.

**Pierwszy przepływ MVP (numerowana sekwencja):**

```
1. Elektryk loguje się
2. Zakłada nowy projekt
3. Wybiera szafkę (z przykładowych, dodanych przez admina)
4. Podaje parametry przyłączeniowe OSD i parametry WLZ
5. Podaje liczbę i parametry obwodów doprowadzonych do szafki
6. System sugeruje producenta / aparaty / łączniki wg najniższej ceny spełniającej wymogi obwodów
7. System proponuje układ aparatów w szafce, z możliwością ręcznej modyfikacji
8. Elektryk generuje wycenę robocizny
```

**Ocena kosztu/czasu:** przepływ ma 8 odrębnych kroków i zawiera realną logikę domenową (dobór aparatów wg parametrów obwodu, heurystyczny układ) — więcej niż typowa 3-tygodniowa ścieżka smoke-test. Użytkownik ocenia, że powinien zdążyć w ~3 tygodnie pracy po godzinach (~15-27h); jeśli się nie uda, świadomie akceptuje przesunięcie na późniejszy termin zgłoszenia bez cięcia zakresu.

## Functional Requirements

### Admin — katalog

- FR-001: Admin can add and edit supported devices (aparaty) with manufacturer data (dimensions, catalog price, electrical parameters needed for circuit matching). Priority: must-have
  > Socratic: Counter-argument considered: none — this is the foundation the rest of the system depends on (no catalog, no device matching or layout). Resolution: kept as written.
- FR-002: Admin can add and edit distribution cabinets (szafki) with their dimensions and mounting-rail layout, forming a cabinet catalog. Priority: must-have
  > Socratic: Counter-argument considered: 2-3 seed cabinets could be too similar to show layout differences. Resolution: kept, with an explicit content note — the 2-3 seed cabinets must be meaningfully different (size/rail count) so the layout heuristic visibly adapts.

### Elektryk — projekt instalacji

- FR-003: Elektryk can create a new project. Priority: must-have
  > Socratic: Counter-argument considered: none — trivial but necessary container for steps 4-8. Resolution: kept as written.
- FR-004: Elektryk can select a cabinet from the cabinet catalog (admin-managed) for the project. Priority: must-have
  > Socratic: Counter-argument considered: restricting to catalog cabinets (no custom cabinet) limits real-world use beyond demo. Resolution: kept for MVP — deliberate scope narrowing; renamed from "przykładowe szafki" to "katalog szafek" to make the mechanism (FR-002) and its consumer (FR-004) consistent.
- FR-005: Elektryk can enter OSD connection parameters (zabezpieczenie przedlicznikowe, system instalacji: TN-C / TN-S / TN-C-S / TT, liczba faz) and WLZ parameters (długość, przekrój i materiał, sposób ułożenia: natynkowo / w rurce / w gruncie itp.) for the project, for simple validation and selection of main protective devices. Priority: must-have
  > Socratic: Counter-argument considered: none — these fields are direct inputs to correct main-protection selection (FR-007) and validation; without them, downstream suggestions would be unfounded. Resolution: kept, with the specific field list captured verbatim from the user.
- FR-006: Elektryk can enter the number and parameters of circuits (obwody) feeding into the cabinet, and mark which circuits share a common residual-current group (RCD). Priority: must-have
  > Socratic: Counter-argument considered: none — direct input to FR-007. Resolution: kept as written; per-project circuit templates/copying is deferred to a later version.
- FR-007: System suggests devices (aparaty) matching the entered circuit parameters; among matching devices, the lowest catalog price is the default selection/sort criterion. Priority: must-have
  > Socratic: Counter-argument considered: "lowest price" alone is too narrow — an electrician may want a preferred manufacturer instead of mixed brands in one cabinet. Resolution: kept lowest-price-among-valid-matches as the MVP default; a manufacturer-preference filter is noted as a possible v2 refinement, not required for MVP.
- FR-008: System proposes an automatic layout of the selected devices within the chosen cabinet, following simple heuristic rules (not a full optimization algorithm). Priority: must-have
  > Socratic: Counter-argument considered: a bad heuristic is worse than no suggestion if the electrician has to redo it entirely. Resolution: kept, but flagged as a risk to resolve concretely (not left vague) — the exact heuristic rules are defined in `## Business Logic` (Step 5), precisely because "compliant with standards" must be reduced to a short, explicit rule list to be buildable in MVP.
- FR-009: Elektryk can manually modify the proposed layout. Priority: must-have
  > Socratic: Counter-argument considered: none — this is the safety valve for an imperfect heuristic (FR-008); without it, a bad suggestion blocks the whole project. Resolution: kept as written.

### Elektryk — wycena

- FR-010: Elektryk can configure their quoting parameters in their profile: hourly rate, average assembly time per device (one statistical average across all devices — not per model), and a fixed per-project time overhead. Priority: must-have
  > Socratic: Counter-argument considered: none. Resolution: kept as written; a single rate is sufficient for MVP. Extended during PRD validation (2026-09-15) — the estimation time parameters live on the electrician's profile, not as a catalog field or a system-wide constant, so each electrician calibrates the quote to their own pace.
- FR-011: System estimates labor time/cost for the quote based on the project (number of selected devices × the average per-device assembly time from the electrician's profile, plus the fixed per-project overhead); the estimate is a starting point that the elektryk can override before the quote is finalized — it is never presented as a final, non-editable value. Priority: must-have
  > Socratic: Counter-argument considered: an ungrounded ("out of thin air") labor estimate is worse than no estimate — it damages trust in the tool. Resolution: kept, with the override behavior made explicit in the FR itself; the concrete basis for the estimate (what inputs drive it) is defined in `## Business Logic`.
- FR-012: Elektryk can export/print the quote document, which includes a readable visualization of the cabinet layout project, not just the price. Priority: must-have
  > Socratic: Counter-argument considered: without a readable layout visualization, the printed document is just a line-item list and loses value versus a plain invoice. Resolution: kept as written — the visualization is a required part of the exported document, not optional polish.
- FR-013: System totals material cost from the catalog prices of the selected devices and shows it in the quote alongside the labor cost. Priority: must-have
  > Socratic: not yet challenged — added during PRD validation (2026-09-15), after the Socratic round had already run.

## User Stories

### US-01: Elektryk plans a cabinet installation and gets a quote

- **Given** a logged-in elektryk with an admin-provided catalog of devices and example cabinets
- **When** they create a new project, select a cabinet, enter OSD/WLZ parameters and the circuits feeding the cabinet
- **Then** they receive a suggested set of devices (lowest price meeting circuit parameters) and a proposed device layout in the cabinet, which they can adjust, and can generate a printable quote that includes the cabinet layout and estimated labor cost at their configured hourly rate

#### Acceptance Criteria

- Suggested devices always satisfy the entered circuit parameters (no under-rated device is ever suggested)
- The proposed layout is editable before the quote is generated
- The estimated labor time is visible and can be overridden before the quote is finalized
- The exported/printed quote includes the cost breakdown (material + labor) and the cabinet layout visualization

## Business Logic

**System dobiera i rozmieszcza aparaty tak, by spełnić parametry obwodów przy minimalnej długości przewodów.**

Reguła konsumuje dane podane przez elektryka: parametry OSD/WLZ, listę obwodów wraz z ich pogrupowaniem w grupy różnicowoprądowe (RCD) — elektryk przy podawaniu obwodów wskazuje, które obwody dzielą wspólny RCD — oraz wybraną z katalogu szafkę (jej układ szyn/torów montażowych).

Wynikiem jest zestaw sugerowanych aparatów (spełniających parametry obwodów, o najniższej cenie spośród pasujących) oraz propozycja ich fizycznego rozmieszczenia w szafce. Rozmieszczenie realizuje trzy reguły stosowane łącznie: (1) grupowanie — wyłączniki nadprądowe danej grupy sąsiadują z jej wyłącznikiem RCD, a grupa jednoobwodowa dostaje pojedynczy RCBO zamiast dwóch osobnych aparatów; (2) bliskość wyprowadzeń — grupa umieszczana możliwie blisko tej strony szafki, którą wchodzą przewody jej obwodów (góra, lewo, prawo, dół); (3) bliskość elementów wspólnych — odległość do szyn PE i N. Te trzy reguły razem są tym, czym MVP przybliża "minimalną długość przewodów". Gdy dla obwodu żaden aparat w katalogu nie pasuje, system zgłasza błąd z prośbą o kontakt z administratorem — nie schodzi na aparat niezgodny.

Zakres typów aparatów w MVP: rozłączniki bezpiecznikowe ("FRy"), RCD, RCBO, wyłączniki nadprądowe wyłącznie o charakterystyce B, szyny PE, szyny N. Bloki rozdzielcze i inne charakterystyki nadprądowych — po MVP, jeśli pójdzie łatwo i zostanie czas.

Na tej samej podstawie powstaje wycena: liczba dobranych aparatów przemnożona przez średni czas montażu na aparat (parametr profilu elektryka, obok stawki godzinowej — jedna uśredniona wartość dla wszystkich aparatów, nie per model), powiększona o stały narzut na projekt, daje szacowany czas pracy; ten czas × stawka godzinowa = koszt robocizny, a ceny katalogowe dobranych aparatów = koszt materiału.

Elektryk spotyka tę regułę na ekranie planowania projektu: po wprowadzeniu obwodów i ich pogrupowaniu w RCD widzi zaproponowany zestaw aparatów i wizualny układ w szafce, który może ręcznie poprawić (FR-009) oraz nadpisać estymowany czas (FR-011) przed wygenerowaniem wyceny.

## Non-Functional Requirements

- Sugerowany zestaw aparatów, propozycja układu i wycena pojawiają się bez zauważalnego oczekiwania dla katalogu tej skali (rzędu pojedynczych sekund, nie dziesiątek sekund).
- Projekty i dane klientów należące do danego elektryka są widoczne wyłącznie dla niego — żaden inny użytkownik, łącznie z adminem, nie ma wglądu w cudze projekty.

## Forward: PRD frontmatter

Draft product-level frontmatter for `/10x-prd`:

```yaml
project: "RozdzielnicaPro"
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: null # soft target 2026-11-04, acceptable fallback 2026-12-06 — see note below
  after_hours_only: true
```

Note: nie jest to twardy deadline. Użytkownik celuje w 4.11.2026, ale bez presji akceptuje przesunięcie do 6.12.2026, jeśli 3-tygodniowy szacunek MVP się nie zmieści.

## Non-Goals

- **Bez pełnego algorytmu optymalizacyjnego układu** — MVP używa prostej heurystyki (grupowanie RCD, patrz `## Business Logic`), nie solvera/optymalizacji kombinatorycznej.
- **Bez masowego importu katalogu producentów (API/CSV)** — admin dodaje aparaty i szafki ręcznie w MVP; integracja z realnymi bazami producentów to nie jest cel MVP.
- **Bez integracji płatności / faktur** — wycena to dokument informacyjny (PDF/wydruk), nie faktura powiązana z systemem płatności.
- **Bez wsparcia dla ekranów dotykowych / urządzeń mobilnych** — MVP zakłada pracę na komputerze (mysz + klawiatura); brak dedykowanego UI dotykowego.
- **Bez pełnego, teoretycznego opomiarowania zgodnego z normami** — MVP robi proste walidacje na podstawie podanych danych (patrz FR-005, FR-007), nie pełne obliczenia inżynierskie/certyfikacyjne zgodności z normą.
- **Bez instalacji wielkoformatowych/komercyjnych** — MVP celuje wyłącznie w domki jednorodzinne i mieszkania, nie obiekty przemysłowe/komercyjne.
- **Bez wielu rozdzielnic w jednym projekcie** — jeden projekt odpowiada jednej szafce; łączone/wielorozdzielnicowe instalacje są poza zakresem MVP.

**Uwaga (nie non-goal, doprecyzowanie zakresu):** instalacje jednofazowe (1F) i trójfazowe (3F) mają być obsługiwane w MVP — to nie jest wykluczone (patrz FR-005: liczba faz jako pole OSD).
