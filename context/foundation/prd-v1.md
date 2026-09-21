---
project: "RozdzielnicaPro"
version: 1
status: draft
created: 2026-09-15
context_type: greenfield
product_type: web-app
target_scale:
  users: small
  qps: "# TODO: qps — see Open Questions"
  data_volume: "# TODO: data_volume — see Open Questions"
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
- Wycena i dobór aparatów muszą być zawsze spójne z podanymi parametrami obwodów — system nigdy nie proponuje aparatu niezgodnego z parametrami obwodu (np. za mały prąd znamionowy); błędna sugestia jest gorsza niż brak sugestii.

## User Stories

### US-01: Elektryk plans a cabinet installation and gets a quote

- **Given** a logged-in elektryk with an admin-provided catalog of devices and example cabinets
- **When** they create a new project, select a cabinet, enter OSD/WLZ parameters and the circuits feeding the cabinet
- **Then** they receive a suggested set of devices (lowest price meeting circuit parameters) and a proposed device layout in the cabinet, which they can adjust, and can generate a printable quote that includes the cabinet layout and estimated labor cost at their configured hourly rate

#### Acceptance Criteria
- Suggested devices always satisfy the entered circuit parameters (no under-rated device is ever suggested)
- The proposed layout is editable before the quote is generated
- The exported/printed quote includes both the cost breakdown and the cabinet layout visualization

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
- FR-006: Elektryk can enter the number and parameters of circuits (obwody) feeding into the cabinet. Priority: must-have
  > Socratic: Counter-argument considered: none — direct input to FR-007. Resolution: kept as written; per-project circuit templates/copying is deferred to a later version.
- FR-007: System suggests devices (aparaty) matching the entered circuit parameters; among matching devices, the lowest catalog price is the default selection/sort criterion. Priority: must-have
  > Socratic: Counter-argument considered: "lowest price" alone is too narrow — an electrician may want a preferred manufacturer instead of mixed brands in one cabinet. Resolution: kept lowest-price-among-valid-matches as the MVP default; a manufacturer-preference filter is noted as a possible v2 refinement, not required for MVP.
- FR-008: System proposes an automatic layout of the selected devices within the chosen cabinet, following simple heuristic rules (not a full optimization algorithm). Priority: must-have
  > Socratic: Counter-argument considered: a bad heuristic is worse than no suggestion if the electrician has to redo it entirely. Resolution: kept, but flagged as a risk to resolve concretely (not left vague) — the exact heuristic rules are defined in `## Business Logic`, precisely because "compliant with standards" must be reduced to a short, explicit rule list to be buildable in MVP.
- FR-009: Elektryk can manually modify the proposed layout. Priority: must-have
  > Socratic: Counter-argument considered: none — this is the safety valve for an imperfect heuristic (FR-008); without it, a bad suggestion blocks the whole project. Resolution: kept as written.

### Elektryk — wycena

- FR-010: Elektryk can configure their own hourly labor rate. Priority: must-have
  > Socratic: Counter-argument considered: none. Resolution: kept as written; a single rate is sufficient for MVP.
- FR-011: System estimates labor time/cost for the quote based on the project (devices, circuits, layout complexity); the estimate is a starting point that the elektryk can override before the quote is finalized — it is never presented as a final, non-editable value. Priority: must-have
  > Socratic: Counter-argument considered: an ungrounded ("out of thin air") labor estimate is worse than no estimate — it damages trust in the tool. Resolution: kept, with the override behavior made explicit in the FR itself; the concrete basis for the estimate (what inputs drive it) is defined in `## Business Logic`.
- FR-012: Elektryk can export/print the quote document, which includes a readable visualization of the cabinet layout project, not just the price. Priority: must-have
  > Socratic: Counter-argument considered: without a readable layout visualization, the printed document is just a line-item list and loses value versus a plain invoice. Resolution: kept as written — the visualization is a required part of the exported document, not optional polish.

## Non-Functional Requirements

- Sugerowany zestaw aparatów, propozycja układu i wycena pojawiają się bez zauważalnego oczekiwania dla katalogu tej skali (rzędu pojedynczych sekund, nie dziesiątek sekund).
- Projekty i dane klientów należące do danego elektryka są widoczne wyłącznie dla niego — inny elektryk (poza adminem) nie ma wglądu w cudze projekty.

## Business Logic

**System dobiera i rozmieszcza aparaty tak, by spełnić parametry obwodów przy minimalnej długości przewodów.**

Reguła konsumuje dane podane przez elektryka: parametry OSD/WLZ, listę obwodów wraz z ich pogrupowaniem w grupy różnicowoprądowe (RCD) — elektryk przy podawaniu obwodów wskazuje, które obwody dzielą wspólny RCD — oraz wybraną z katalogu szafkę (jej układ szyn/torów montażowych).

Wynikiem jest zestaw sugerowanych aparatów (spełniających parametry obwodów, o najniższej cenie spośród pasujących) oraz propozycja ich fizycznego rozmieszczenia w szafce, zgodna z regułą grupowania: wyłączniki nadprądowe danej grupy sąsiadują z jej wyłącznikiem RCD; jeśli grupa RCD ma tylko jeden obwód, system sugeruje pojedynczy wyłącznik RCBO (kombinowany RCD+nadprądowy) zamiast dwóch osobnych aparatów.

Elektryk spotyka tę regułę na ekranie planowania projektu: po wprowadzeniu obwodów i ich pogrupowaniu w RCD widzi zaproponowany zestaw aparatów i wizualny układ w szafce, który może ręcznie poprawić przed wygenerowaniem wyceny (FR-009).

## Access Control

Logowanie przez email + hasło. Bez weryfikacji adresu email w MVP (utrzymanie darmowe — brak wysyłki maili transakcyjnych, chyba że znajdzie się darmowa opcja).

Dwie role:

| Rola | Uprawnienia |
| --- | --- |
| **admin** | Zarządza katalogiem wspieranych aparatów (dane producentów: wymiary, cena katalogowa itp.) oraz katalogiem szafek rozdzielnic. |
| **elektryk** | Zakłada własne projekty instalacji, wybiera szafkę, otrzymuje propozycję układu aparatów, generuje wycenę; konfiguruje własną stawkę godzinową. |

Konta elektryków mogą powstać na dwa sposoby: samodzielna rejestracja lub założenie konta przez admina — oba tryby dopuszczone w MVP.

Niezalogowany użytkownik trafiający na chronioną trasę jest przekierowywany do logowania.

## Non-Goals

- **Bez pełnego algorytmu optymalizacyjnego układu** — MVP używa prostej heurystyki (grupowanie RCD, patrz `## Business Logic`), nie solvera/optymalizacji kombinatorycznej.
- **Bez masowego/automatycznego importu katalogu producentów** — admin dodaje aparaty i szafki ręcznie w MVP; integracja z realnymi bazami producentów to nie jest cel MVP.
- **Bez integracji płatności / faktur** — wycena to dokument informacyjny do wydruku/eksportu, nie faktura powiązana z systemem płatności.
- **Bez wsparcia dla ekranów dotykowych / urządzeń mobilnych** — MVP zakłada pracę na komputerze (mysz + klawiatura); brak dedykowanego UI dotykowego.
- **Bez pełnego, teoretycznego opomiarowania zgodnego z normami** — MVP robi proste walidacje na podstawie podanych danych (patrz FR-005, FR-007), nie pełne obliczenia inżynierskie/certyfikacyjne zgodności z normą.
- **Bez instalacji wielkoformatowych/komercyjnych** — MVP celuje wyłącznie w domki jednorodzinne i mieszkania, nie obiekty przemysłowe/komercyjne.
- **Bez wielu rozdzielnic w jednym projekcie** — jeden projekt odpowiada jednej szafce; łączone/wielorozdzielnicowe instalacje są poza zakresem MVP.

Uwaga (nie non-goal, doprecyzowanie zakresu): instalacje jednofazowe (1F) i trójfazowe (3F) mają być obsługiwane w MVP — to nie jest wykluczone (patrz FR-005: liczba faz jako pole OSD).

## Open Questions

1. **Jakie są oczekiwane rzędy wielkości `qps` i wolumenu danych?** — Shaping ustalił tylko liczbę użytkowników (`small`); obciążenie i wolumen danych nie zostały doprecyzowane. Owner: user. By: przed doborem stacku technologicznego. Block: no.
2. **Czy 4 listopada 2026 to twardy deadline?** — Ustalono, że to miękki cel; jeśli 3-tygodniowy szacunek MVP się nie zmieści, akceptowalne jest przesunięcie na 6 grudnia 2026 bez cięcia zakresu. Frontmatter zapisuje `hard_deadline: null`, ponieważ nie jest to wiążąca data. Owner: user. By: n/a (informacyjne, nieblokujące).
