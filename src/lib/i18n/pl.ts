import { formatNumber, plural } from "./format";

/**
 * The Polish message catalog — the only locale the MVP ships.
 *
 * Deliberately NOT `as const`: without it, string literals widen to `string`,
 * so a future `en.ts` can be typed `const en: Messages = { ... }` and the
 * compiler will reject it if a key is missing or a parameter signature drifts.
 * `npx astro check` already runs in CI, so translation completeness is
 * machine-checked rather than a convention nobody enforces.
 */
export const pl = {
  app: {
    name: "RozdzielnicaPro",
    tagline: "Planowanie rozdzielnic i wycena robocizny",
  },

  common: {
    documentation: "Dokumentacja",
    warningPrefix: "Uwaga:",
  },

  nav: {
    dashboard: "Panel",
    admin: "Panel administratora",
    signIn: "Zaloguj się",
    signUp: "Załóż konto",
    signOut: "Wyloguj się",
    notSignedIn: "Nie zalogowano",
  },

  auth: {
    signInTitle: "Logowanie",
    signUpTitle: "Rejestracja",

    emailLabel: "Adres email",
    emailPlaceholder: "ty@przyklad.pl",
    passwordLabel: "Hasło",
    passwordPlaceholder: "Twoje hasło",
    passwordPlaceholderMin: (min: number) =>
      `Min. ${String(min)} ${plural(min, { one: "znak", few: "znaki", many: "znaków" })}`,
    confirmPasswordLabel: "Powtórz hasło",
    confirmPasswordPlaceholder: "Wpisz hasło ponownie",

    showPassword: "Pokaż hasło",
    hidePassword: "Ukryj hasło",

    signInAction: "Zaloguj się",
    signInPending: "Logowanie...",
    signUpAction: "Załóż konto",
    signUpPending: "Zakładanie konta...",

    noAccount: "Nie masz konta?",
    hasAccount: "Masz już konto?",

    charactersMissing: (n: number) =>
      `Brakuje jeszcze ${String(n)} ${plural(n, { one: "znaku", few: "znaków", many: "znaków" })}`,
  },

  validation: {
    emailRequired: "Podaj adres email",
    emailInvalid: "Nieprawidłowy adres email",
    passwordRequired: "Podaj hasło",
    passwordTooShort: (min: number) =>
      `Hasło musi mieć co najmniej ${String(min)} ${plural(min, { one: "znak", few: "znaki", many: "znaków" })}`,
    confirmPasswordRequired: "Powtórz hasło",
    passwordsDoNotMatch: "Hasła nie są takie same",
  },

  /**
   * Keyed by Supabase auth error code, never by its English message.
   * See `src/lib/auth-errors.ts` for the mapping.
   */
  authErrors: {
    invalidCredentials: "Nieprawidłowy email lub hasło",
    emailNotConfirmed: "Potwierdź adres email, zanim się zalogujesz",
    userAlreadyExists: "Konto z tym adresem email już istnieje",
    weakPassword: "Hasło jest zbyt słabe — użyj dłuższego",
    rateLimited: "Zbyt wiele prób. Spróbuj ponownie za chwilę",
    notConfigured: "Logowanie jest chwilowo niedostępne — skontaktuj się z administratorem",
    noRole: "Twoje konto nie ma przypisanej roli — skontaktuj się z administratorem",
    unknown: "Coś poszło nie tak. Spróbuj ponownie",
  },

  confirmEmail: {
    confirmedHeading: "Konto założone",
    confirmedDescription: "Twoje konto zostało utworzone. Możesz się teraz zalogować.",
    confirmedLink: "Przejdź do logowania",
    pendingHeading: "Sprawdź skrzynkę",
    pendingDescription: "Wysłaliśmy link potwierdzający na Twój adres email. Kliknij go, aby aktywować konto.",
    pendingLink: "Wróć do logowania",
  },

  dashboard: {
    title: "Panel",
    greeting: "Witaj,",
    restricted: "Ta strona jest dostępna tylko dla zalogowanych użytkowników.",
  },

  admin: {
    title: "Panel administratora",
    description: "Katalogi, z których elektrycy dobierają szafki i aparaty.",
    restricted: "Ta strona jest dostępna tylko dla administratorów.",
    cabinetCatalogLink: "Katalog szafek",
    cabinetCatalogDescription: "Szafki rozdzielnic z wymiarami, szynami DIN, wprowadzeniami i szynami PE/N.",
    deviceCatalogLink: "Katalog aparatów",
    deviceCatalogDescription: "Aparaty modułowe i szyny PE/N z wymiarami, ceną i parametrami elektrycznymi.",
  },

  cabinets: {
    geometry: "Geometria szafki",
    interior: "Wnętrze szafki",
    fields: {
      name: "Nazwa",
      manufacturer: "Producent",
      model: "Model",
      price: "Cena katalogowa",
      widthMm: "Szerokość (mm)",
      heightMm: "Wysokość (mm)",
      depthMm: "Głębokość (mm)",
      xMm: "X (mm)",
      yMm: "Y (mm)",
      lengthMm: "Długość (mm)",
      offsetMm: "Odsunięcie (mm)",
      zMm: "Odległość od płyty montażowej (mm)",
      side: "Strona",
      kind: "Rodzaj",
      orientation: "Ułożenie",
      terminalGroups: "Grupy zacisków",
      terminalCount: "Liczba zacisków",
      minMm2: "Przekrój min. (mm²)",
      maxMm2: "Przekrój maks. (mm²)",
    },
    elements: {
      rail: "Szyna DIN",
      entry: "Wprowadzenie przewodów",
      bar: "Szyna PE/N",
    },
    elementNumbered: {
      rail: (n: number) => `Szyna DIN ${String(n)}`,
      entry: (n: number) => `Wprowadzenie ${String(n)}`,
      bar: (n: number) => `Szyna PE/N ${String(n)}`,
    },
    sides: {
      top: "Góra",
      bottom: "Dół",
      left: "Lewo",
      right: "Prawo",
    },
    barKinds: {
      PE: "PE (ochronna)",
      N: "N (neutralna)",
    },
    orientations: {
      horizontal: "Pozioma",
      vertical: "Pionowa",
    },
    catalog: {
      title: "Katalog szafek",
      description: "Szafki, spośród których elektryk wybiera rozdzielnicę do projektu.",
      backToAdmin: "Wróć do panelu administratora",
      newCabinet: "Nowa szafka",
      empty: "Katalog szafek jest pusty.",
      loadFailed: "Nie udało się wczytać katalogu szafek. Spróbuj ponownie",
      edit: "Edytuj",
      archive: "Archiwizuj",
      restore: "Przywróć",
      archivedBadge: "Zarchiwizowana",
      dimensions: (widthMm: number, heightMm: number, depthMm: number) =>
        `${String(widthMm)} × ${String(heightMm)} × ${String(depthMm)} mm`,
      invalidStoredGeometry: "Zapisana geometria tej szafki jest nieprawidłowa — popraw ją w edycji.",
    },
    editor: {
      newTitle: "Nowa szafka",
      editTitle: "Edycja szafki",
      editTitleFor: (name: string) => `Edycja szafki: ${name}`,
      notFoundTitle: "Nie znaleziono szafki",
      loadFailed: "Nie udało się wczytać tej szafki. Spróbuj ponownie",
      backToCatalog: "Wróć do katalogu szafek",
      catalogSection: "Dane katalogowe",
      interiorHint: "Wymiary wnętrza w milimetrach. Położenia liczone są od lewego górnego rogu wnętrza.",
      railsSection: "Szyny DIN",
      railsHint: (railHeightMm: number) =>
        `Szyny są poziome i mają wysokość ${String(railHeightMm)} mm; X i Y to ich lewy górny róg. Dwie szyny w jednym rzędzie wpisz jako dwie osobne szyny.`,
      entriesSection: "Wprowadzenia przewodów",
      entriesHint: "Odsunięcie liczone jest od lewej krawędzi (góra i dół) albo od górnej krawędzi (lewo i prawo).",
      barsSection: "Szyny PE/N",
      barsHint: "Długość biegnie wzdłuż szyny, wysokość w poprzek. X i Y to lewy górny róg szyny w widoku z przodu.",
      noBars: "Brak szyn PE/N.",
      heightMm: "Wysokość (mm)",
      addRail: "Dodaj szynę DIN",
      addEntry: "Dodaj wprowadzenie",
      addBar: "Dodaj szynę PE/N",
      addTerminalGroup: "Dodaj grupę zacisków",
      remove: "Usuń",
      removeElement: (subject: string) => `Usuń: ${subject}`,
      terminalGroupNumbered: (n: number) => `Grupa zacisków ${String(n)}`,
      pricePlaceholder: "np. 249,99",
      priceHint: "W złotych, np. 249,99.",
      preview: "Podgląd",
      previewStale: "Podgląd pokazuje ostatni kompletny stan — uzupełnij wymiary, aby go odświeżyć.",
      previewUnavailable: "Uzupełnij wymiary wnętrza i elementów, aby zobaczyć podgląd.",
      save: "Zapisz szafkę",
      saving: "Zapisywanie...",
      cancel: "Anuluj",
      blocked: "Uzupełnij wymagane pola i popraw zaznaczone błędy, aby zapisać szafkę.",
      nameRequired: "Podaj nazwę szafki",
      manufacturerRequired: "Podaj producenta",
      modelRequired: "Podaj model",
      priceInvalid: "Podaj cenę większą od zera, z najwyżej dwoma miejscami po przecinku, np. 249,99",
    },
    drawing: {
      label: (widthMm: number, heightMm: number) =>
        `Rysunek wnętrza szafki, widok z przodu, ${String(widthMm)} × ${String(heightMm)} mm`,
      barLabels: {
        PE: "PE",
        N: "N",
      },
    },
  },

  /**
   * Keyed by the `?error=` code the cabinet endpoints redirect with. See `cabinetErrorMessage` in
   * `src/lib/cabinet-errors.ts` for the mapping.
   */
  cabinetErrors: {
    notConfigured: "Katalog szafek jest chwilowo niedostępny — baza danych nie jest skonfigurowana",
    forbidden: "Nie masz uprawnień do zmiany katalogu szafek",
    notFound: "Nie znaleziono tej szafki",
    duplicateModel: "Szafka o tym producencie i modelu już istnieje w katalogu",
    invalidInput: "Formularz zawiera nieprawidłowe dane",
    unknown: "Coś poszło nie tak. Spróbuj ponownie",
  },

  /**
   * Keyed by `GeometryIssueCode` (camelCased). See `geometryIssueMessage` in
   * `src/lib/cabinet-geometry.ts` for the mapping.
   */
  geometryIssues: {
    malformed: (subject: string) => `${subject}: dane są niekompletne lub nieprawidłowe`,
    sizeNotPositiveInteger: (subject: string) =>
      `${subject}: wymiary i długości muszą być dodatnimi liczbami całkowitymi (mm)`,
    positionNotNonNegativeInteger: (subject: string) =>
      `${subject}: położenie musi być nieujemną liczbą całkowitą (mm)`,
    noRails: "Szafka musi mieć co najmniej jedną szynę DIN",
    noEntries: "Szafka musi mieć co najmniej jedno wprowadzenie przewodów",
    railOutsideInterior: (n: number) => `Szyna DIN ${String(n)} wychodzi poza wnętrze szafki`,
    railsOverlap: (n: number) => `Szyna DIN ${String(n)} nachodzi na inną szynę DIN`,
    railOverlapsBar: (n: number) => `Szyna DIN ${String(n)} nachodzi na szynę PE/N`,
    barOutsideInterior: (n: number) => `Szyna PE/N ${String(n)} wychodzi poza wnętrze szafki`,
    barDepthOutsideInterior: (n: number) => `Szyna PE/N ${String(n)} wystaje poza głębokość wnętrza szafki`,
    barsTooClose: (n: number, clearanceMm: number) =>
      `Szyna PE/N ${String(n)} nachodzi na inną szynę PE/N, a ich odległości od płyty montażowej różnią się o mniej niż ${String(clearanceMm)} mm`,
    entryExceedsSide: (n: number) => `Wprowadzenie ${String(n)} wychodzi poza bok szafki`,
    entriesOverlap: (n: number) => `Wprowadzenie ${String(n)} nachodzi na inne wprowadzenie na tym samym boku`,
    barNoTerminalGroups: (n: number) => `Szyna PE/N ${String(n)} musi mieć co najmniej jedną grupę zacisków`,
    terminalCountInvalid: (n: number) =>
      `Szyna PE/N ${String(n)}: liczba zacisków w grupie musi być dodatnią liczbą całkowitą`,
    terminalRangeInvalid: (n: number) =>
      `Szyna PE/N ${String(n)}: zakres przekrojów zacisków musi spełniać warunek 0 < min. ≤ maks.`,
  },

  devices: {
    /** Keyed by `DeviceKind` (camelCased). See `deviceKindLabel` in `src/lib/device-spec.ts`. */
    kinds: {
      switchDisconnector: "Rozłącznik izolacyjny (FR)",
      rcd: "Wyłącznik różnicowoprądowy (RCD)",
      rcbo: "Wyłącznik różnicowonadprądowy (RCBO)",
      mcbB: "Wyłącznik nadprądowy B (MCB)",
      peBar: "Szyna PE",
      nBar: "Szyna N",
    },
    fields: {
      kind: "Rodzaj aparatu",
      name: "Nazwa",
      manufacturer: "Producent",
      model: "Model",
      price: "Cena katalogowa",
      width: "Szerokość",
      widthMm: "Szerokość (mm)",
      widthModules: "Szerokość (TE)",
      heightMm: "Wysokość (mm)",
      depthMm: "Głębokość (mm)",
      poles: "Liczba biegunów",
      ratedCurrentA: "Prąd znamionowy (A)",
      residualCurrentMa: "Prąd różnicowy (mA)",
      rcdType: "Typ wyłącznika różnicowoprądowego",
      breakingCapacityKa: "Zdolność zwarciowa (kA)",
      terminalGroups: "Grupy zacisków",
      terminalCount: "Liczba zacisków",
      minMm2: "Przekrój min. (mm²)",
      maxMm2: "Przekrój maks. (mm²)",
    },
    /** Keyed by `PoleConfig`. */
    poles: {
      "1P": "1P",
      "1P+N": "1P+N",
      "2P": "2P",
      "3P": "3P",
      "3P+N": "3P+N",
      "4P": "4P",
    },
    /** Keyed by `RcdType`. */
    rcdTypes: {
      AC: "Typ AC",
      A: "Typ A",
      F: "Typ F",
      B: "Typ B",
    },
    widthUnit: {
      label: "Jednostka szerokości",
      modules: "Moduły (TE)",
      millimetres: "Milimetry",
    },
    catalog: {
      title: "Katalog aparatów",
      description: "Aparaty, spośród których system dobiera zabezpieczenia do obwodów elektryka.",
      backToAdmin: "Wróć do panelu administratora",
      newDevice: "Nowy aparat",
      empty: "Katalog aparatów jest pusty.",
      loadFailed: "Nie udało się wczytać katalogu aparatów. Spróbuj ponownie",
      edit: "Edytuj",
      archive: "Archiwizuj",
      restore: "Przywróć",
      archivedBadge: "Zarchiwizowany",
      emptyKind: "Brak aparatów tego rodzaju.",
      parameters: "Parametry",
      actions: "Akcje",
      /** `modules` is null when the width is not a whole number of half-modules. */
      width: (modules: number | null, mm: number) =>
        modules === null ? `${formatNumber(mm)} mm` : `${formatNumber(modules)} TE (${formatNumber(mm)} mm)`,
      invalidStoredSpec: "Zapisane parametry tego aparatu są nieprawidłowe — popraw je w edycji.",
    },
    /**
     * The one-line parameter summary in the catalog list, e.g. "B16 1P, 6 kA". Assembled by
     * `deviceParameterSummary` in `src/lib/device-summary.ts`.
     */
    summary: {
      separator: ", ",
      /** A B-characteristic overcurrent rating (MCB, RCBO): "B16 1P". */
      characteristicB: (ratedCurrentA: number, poles: string) => `B${String(ratedCurrentA)} ${poles}`,
      /** A plain current rating (FR, RCD): "40 A 2P". */
      ratedCurrent: (ratedCurrentA: number, poles: string) => `${String(ratedCurrentA)} A ${poles}`,
      residualCurrent: (residualCurrentMa: number) => `${String(residualCurrentMa)} mA`,
      rcdType: (rcdType: string) => `typ ${rcdType}`,
      breakingCapacity: (breakingCapacityKa: number) => `${formatNumber(breakingCapacityKa)} kA`,
      terminalGroup: (count: number, minMm2: number, maxMm2: number) =>
        `${String(count)} × ${formatNumber(minMm2)}–${formatNumber(maxMm2)} mm²`,
    },
    editor: {
      newTitle: "Nowy aparat",
      editTitle: "Edycja aparatu",
      editTitleFor: (name: string) => `Edycja aparatu: ${name}`,
      notFoundTitle: "Nie znaleziono aparatu",
      loadFailed: "Nie udało się wczytać tego aparatu. Spróbuj ponownie",
      backToCatalog: "Wróć do katalogu aparatów",
      catalogSection: "Dane katalogowe",
      dimensionsSection: "Wymiary",
      dimensionsHint:
        "Szerokość w modułach TE (co 0,5 TE) albo w milimetrach z najwyżej dwoma miejscami po przecinku, np. 26,25. Wysokość i głębokość w milimetrach z najwyżej jednym miejscem po przecinku, np. 17,5.",
      widthModulesInvalid: "Szerokość w modułach podaj w krokach co 0,5 TE, np. 1,5",
      /** Under a width typed in modules: what will be saved. */
      widthEquals: (mm: number) => `= ${formatNumber(mm)} mm`,
      kindLocked: "Rodzaju zapisanego aparatu nie można zmienić.",
      chooseKindFirst: "Wybierz rodzaj aparatu, aby podać jego parametry.",
      parametersSection: "Parametry elektryczne",
      terminalGroupsSection: "Grupy zacisków",
      kindPlaceholder: "Wybierz rodzaj aparatu",
      polesPlaceholder: "Wybierz liczbę biegunów",
      rcdTypePlaceholder: "Wybierz typ",
      addTerminalGroup: "Dodaj grupę zacisków",
      remove: "Usuń",
      removeElement: (subject: string) => `Usuń: ${subject}`,
      terminalGroupNumbered: (n: number) => `Grupa zacisków ${String(n)}`,
      pricePlaceholder: "np. 49,99",
      priceHint: "W złotych, np. 49,99.",
      save: "Zapisz aparat",
      saving: "Zapisywanie...",
      cancel: "Anuluj",
      blocked: "Uzupełnij wymagane pola i popraw zaznaczone błędy, aby zapisać aparat.",
    },
  },

  /**
   * Keyed by the `?error=` code the device endpoints redirect with. See `deviceErrorMessage` in
   * `src/lib/device-errors.ts` for the mapping.
   */
  deviceErrors: {
    notConfigured: "Katalog aparatów jest chwilowo niedostępny — baza danych nie jest skonfigurowana",
    forbidden: "Nie masz uprawnień do zmiany katalogu aparatów",
    notFound: "Nie znaleziono tego aparatu",
    duplicateModel: "Aparat o tym producencie i modelu już istnieje w katalogu",
    invalidInput: "Formularz zawiera nieprawidłowe dane",
    unknown: "Coś poszło nie tak. Spróbuj ponownie",
  },

  /**
   * Keyed by `DeviceIssueCode` (camelCased). See `deviceIssueMessage` in `src/lib/device-spec.ts`
   * for the mapping; `subject` is the label of the field the issue is on.
   */
  deviceIssues: {
    malformed: (subject: string) => `${subject}: dane są niekompletne lub nieprawidłowe`,
    required: (subject: string) => `${subject}: pole jest wymagane`,
    invalidKind: "Wybierz rodzaj aparatu z listy",
    priceInvalid: "Podaj cenę większą od zera, z najwyżej dwoma miejscami po przecinku, np. 49,99",
    notPositive: (subject: string) => `${subject}: wartość musi być większa od zera`,
    notInteger: (subject: string) => `${subject}: podaj liczbę całkowitą`,
    tooLarge: (subject: string, max: number) => `${subject}: wartość jest za duża (maks. ${formatNumber(max)})`,
    tooManyDecimals: (subject: string, places: number) =>
      `${subject}: podaj najwyżej ${places === 1 ? "jedno miejsce" : `${String(places)} miejsca`} po przecinku`,
    poleNotAllowed: "Wybrany rodzaj aparatu nie występuje w takiej konfiguracji biegunów",
    invalidRcdType: "Wybierz typ wyłącznika różnicowoprądowego z listy",
    noTerminalGroups: "Szyna musi mieć co najmniej jedną grupę zacisków",
    terminalCountInvalid: "Liczba zacisków w grupie musi być dodatnią liczbą całkowitą",
    terminalRangeInvalid: "Zakres przekrojów zacisków musi spełniać warunek 0 < min. ≤ maks.",
    foreignParameter: (subject: string) => `${subject}: ten parametr nie dotyczy wybranego rodzaju aparatu`,
  },

  pricingProfile: {
    title: "Parametry wyceny",
    description:
      "Na ich podstawie system wylicza czas i koszt robocizny: liczba aparatów × średni czas montażu + stały narzut na projekt, razy stawka godzinowa.",
    backToDashboard: "Wróć do panelu",
    hourlyRateLabel: "Stawka godzinowa",
    hourlyRateHint: "W złotych za godzinę, np. 120 albo 120,50.",
    hourlyRatePlaceholder: "np. 120,50",
    mountMinutesLabel: "Średni czas montażu jednego aparatu",
    mountMinutesHint: (min: number, max: number) =>
      `W pełnych minutach, od ${String(min)} do ${String(max)}. Jedna uśredniona wartość dla wszystkich aparatów.`,
    overheadMinutesLabel: "Stały narzut czasowy na projekt",
    overheadMinutesHint: (min: number, max: number) =>
      `W pełnych minutach, od ${String(min)} do ${String(max)} — np. przygotowanie szafki i podłączenie WLZ.`,
    save: "Zapisz parametry",
    saved: "Parametry wyceny zostały zapisane.",
    loadFailed: "Nie udało się wczytać parametrów wyceny. Spróbuj ponownie",
    dashboardLink: "Parametry wyceny",
    dashboardLinkDescription: "Stawka godzinowa, średni czas montażu aparatu i stały narzut na projekt.",
    notConfigured: "Nie ustawiono jeszcze parametrów wyceny — uzupełnij je, zanim przygotujesz pierwszą wycenę.",
  },

  /**
   * Keyed by the `?error=` code the pricing-profile endpoint redirects with. See
   * `pricingErrorMessage` in `src/lib/pricing-errors.ts` for the mapping.
   */
  pricingErrors: {
    notConfigured: "Parametry wyceny są chwilowo niedostępne — baza danych nie jest skonfigurowana",
    forbidden: "Nie masz uprawnień do zmiany parametrów wyceny",
    invalidInput: "Formularz zawiera nieprawidłowe dane — sprawdź stawkę i czasy w minutach",
    unknown: "Coś poszło nie tak. Spróbuj ponownie",
  },

  projects: {
    dashboardLink: "Projekty",
    dashboardLinkDescription: "Twoje projekty rozdzielnic: szafka, przyłącze, a w kolejnych krokach obwody i wycena.",
    fields: {
      name: "Nazwa projektu",
      namePlaceholder: "np. Dom Kowalskich",
      clientName: "Klient",
      siteAddress: "Adres inwestycji",
      optionalHint: "Opcjonalnie.",
    },
    list: {
      title: "Projekty",
      description: "Projekty rozdzielnic, które przygotowujesz dla swoich klientów.",
      backToDashboard: "Wróć do panelu",
      newProject: "Nowy projekt",
      empty: "Nie masz jeszcze żadnego projektu. Załóż pierwszy, aby zaplanować rozdzielnicę.",
      loadFailed: "Nie udało się wczytać projektów. Spróbuj ponownie",
      count: (n: number) => `${String(n)} ${plural(n, { one: "projekt", few: "projekty", many: "projektów" })}`,
      supplyMissingBadge: "Przyłącze nieuzupełnione",
      noClient: "Bez klienta",
      cabinet: (name: string) => `Szafka: ${name}`,
      updatedAt: (date: string) => `Zmieniono ${date}`,
      deleted: "Projekt został usunięty.",
    },
    new: {
      title: "Nowy projekt",
      backToList: "Wróć do projektów",
      detailsSection: "Dane projektu",
      cabinetSection: "Szafka rozdzielnicy",
      cabinetHint:
        "Wybierz szafkę z katalogu. Projekt zapisze jej kopię — późniejsze zmiany w katalogu go nie zmienią.",
      noCabinets: "Katalog szafek jest pusty — skontaktuj się z administratorem.",
      loadFailed: "Nie udało się wczytać katalogu szafek. Spróbuj ponownie",
      create: "Załóż projekt",
    },
    page: {
      notFoundTitle: "Nie znaleziono projektu",
      notFound: "Nie znaleziono tego projektu.",
      backToList: "Wróć do projektów",
      loadFailed: "Nie udało się wczytać projektu. Spróbuj ponownie",
      created: "Projekt został założony.",
      savedDetails: "Dane projektu zostały zapisane.",
      savedCabinet: "Szafka projektu została zmieniona.",
      detailsSection: "Dane projektu",
      saveDetails: "Zapisz dane projektu",
    },
    cabinet: {
      section: "Szafka rozdzielnicy",
      snapshotHint: "Projekt przechowuje kopię szafki z chwili jej wybrania — zmiany w katalogu jej nie zmieniają.",
      drawingUnavailable: "Rysunek tej szafki jest niedostępny.",
      currentArchived: "Ta szafka została wycofana z katalogu. Projekt zachowuje jej zapisaną kopię.",
      changeTitle: "Zmień szafkę",
      changeHint: "Nowa szafka zastąpi zapisaną kopię w tym projekcie.",
      noCabinets: "Katalog szafek jest pusty — skontaktuj się z administratorem.",
      loadFailed: "Nie udało się wczytać katalogu szafek. Spróbuj ponownie",
      change: "Zmień szafkę",
    },
    delete: {
      section: "Usuń projekt",
      hint: "Usunięcia nie można cofnąć — projekt zniknie razem ze wszystkimi danymi.",
      confirm: "Potwierdzam usunięcie projektu",
      submit: "Usuń projekt",
    },
  },

  /**
   * Keyed by the `?error=` code the project endpoints redirect with. See `projectErrorMessage` in
   * `src/lib/project-errors.ts` for the mapping.
   */
  projectErrors: {
    notConfigured: "Projekty są chwilowo niedostępne — baza danych nie jest skonfigurowana",
    forbidden: "Nie masz uprawnień do zmiany tego projektu",
    notFound: "Nie znaleziono tego projektu",
    invalidInput: "Formularz zawiera nieprawidłowe dane",
    cabinetUnavailable: "Wybrana szafka nie jest już dostępna w katalogu — wybierz inną",
    unknown: "Coś poszło nie tak. Spróbuj ponownie",
  },

  config: {
    supabaseMissing: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    supabaseDocsLabel: "Zobacz instrukcję konfiguracji",
  },
};

export type Messages = typeof pl;
