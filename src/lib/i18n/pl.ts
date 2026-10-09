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
    /**
     * The logo wordmark in two parts, the second set in the accent colour. `lead + accent` must
     * equal `name`; `Logo.astro` reads `name` for the accessible label.
     */
    wordmark: {
      lead: "Rozdzielnica",
      accent: "Pro",
    },
  },

  common: {
    documentation: "Dokumentacja",
    warningPrefix: "Uwaga:",
    loading: "Wczytywanie",
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

  /** The split auth shell (sign-in, sign-up, confirm-email): the hero side panel next to the form. */
  authShell: {
    panelHeadline: "Rozdzielnica zaplanowana, zanim pojedziesz do klienta",
    panelDescription:
      "Obwody i grupy RCD, dobór aparatów z katalogu, układ w szafce i wycena robocizny według Twojej stawki — w jednym miejscu.",
    homeLink: "Strona główna RozdzielnicaPro",
  },

  /** The public landing page (`/`). */
  landing: {
    navLabel: "Konto",
    eyebrow: "Asystent elektryka instalatora",
    headline: "Zaplanuj rozdzielnicę",
    headlineAccent: "i wyceń robociznę w kilka minut",
    subline:
      "Podajesz obwody i grupy RCD, a RozdzielnicaPro dobiera aparaty z katalogu, proponuje ich układ w wybranej szafce i liczy koszt materiału oraz robocizny według Twojej stawki.",
    drawingCaption:
      "Przykładowa szafka: aparaty rozmieszczone przez system w grupach RCD zasilanych listwami, z przewodami od wprowadzeń do aparatów i szyn PE/N.",
    stepsTitle: "Od obwodów do wyceny w trzech krokach",
    steps: {
      circuits: {
        title: "Obwody",
        description:
          "Podajesz obwody z ich parametrami i wskazujesz, które z nich dzielą wspólny wyłącznik różnicowoprądowy.",
      },
      layout: {
        title: "Układ w szafce",
        description:
          "System dobiera najtańsze aparaty spełniające parametry i rozmieszcza je w szafce z katalogu. Układ możesz poprawić.",
      },
      quote: {
        title: "Wycena",
        description:
          "Liczba aparatów × średni czas montażu + narzut na projekt, razy Twoja stawka — obok koszt materiału z cen katalogowych. Wycenę z rysunkiem szafki drukujesz albo zapisujesz jako PDF.",
      },
    },
    guaranteeTitle: "Nigdy aparat o za niskich parametrach",
    guaranteeDescription:
      "Gdy w katalogu nie ma aparatu spełniającego parametry obwodu, zobaczysz błąd z prośbą o kontakt z administratorem — a nie zamiennik o za niskich parametrach.",
    footerNote: "Proste instalacje w domach jednorodzinnych i mieszkaniach, jedno- i trójfazowe.",
  },

  dashboard: {
    title: "Panel",
    greeting: "Witaj,",
    greetingTitle: (email: string) => `Witaj, ${email}`,
    description: "Zaplanuj rozdzielnicę dla klienta albo zaktualizuj parametry swojej wyceny.",
    destinationsLabel: "Skróty",
  },

  admin: {
    title: "Panel administratora",
    description: "Katalogi, z których elektrycy dobierają szafki i aparaty.",
    restricted: "Ta strona jest dostępna tylko dla administratorów.",
    cabinetCatalogLink: "Katalog szafek",
    cabinetCatalogDescription: "Szafki rozdzielnic z wymiarami, szynami DIN, wprowadzeniami i szynami PE/N.",
    deviceCatalogLink: "Katalog aparatów",
    deviceCatalogDescription: "Aparaty modułowe i szyny PE/N z wymiarami, ceną i parametrami elektrycznymi.",
    destinationsLabel: "Katalogi",
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
      combBusbar: "Listwa zasilająca (grzebieniowa)",
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
      nTerminalSide: "Strona zacisku N",
      busbarPhases: "Liczba faz",
    },
    /** Keyed by `NTerminalSide`: where the N pole sits, viewed from the front. */
    nTerminalSides: {
      left: "Lewa",
      right: "Prawa",
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
    /** A comb busbar's phases, keyed by its `PoleConfig` ("1P" is a 1F busbar, "3P" a 3F one). */
    busbarPhases: {
      "1P": "1F",
      "3P": "3F",
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
      /** A comb busbar: "3F, 63 A, 12 pinów". `phases` is the label from `devices.busbarPhases`. */
      busbar: (phases: string, ratedCurrentA: number, pins: number) =>
        `${phases}, ${String(ratedCurrentA)} A, ${String(pins)} ${plural(pins, { one: "pin", few: "piny", many: "pinów" })}`,
      /** Keyed by `NTerminalSide`. */
      nTerminalSide: {
        left: "N z lewej",
        right: "N z prawej",
      },
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
      phasesPlaceholder: "Wybierz liczbę faz",
      busbarPhasesHint: "1F — listwa jednofazowa, 3F — trójfazowa. Listwa nie ma bieguna N.",
      /** Under a busbar's width: its length in pins, one pin per DIN module. */
      busbarWidthHint: (pins: number) =>
        `Szerokość to długość listwy w pinach (1 pin = 1 TE = 17,5 mm): ${String(pins)} ${plural(pins, { one: "pin", few: "piny", many: "pinów" })}.`,
      busbarWidthHintEmpty:
        "Szerokość to długość listwy w pinach (1 pin = 1 TE = 17,5 mm), np. 12 TE to listwa 12-pinowa.",
      rcdTypePlaceholder: "Wybierz typ",
      nTerminalSideHint: "Po której stronie aparatu, patrząc od przodu, jest biegun N.",
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
    notConfiguredLink: "Uzupełnij parametry wyceny",
    hourlyRateUnit: "zł/h",
    minutesUnit: "min",
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

  /** The profile page's "Dane firmy do wyceny" card (S-09). See `src/components/forms/BusinessProfileCard.astro`. */
  businessProfile: {
    title: "Dane firmy do wyceny",
    description:
      "Te dane pojawią się w nagłówku wydrukowanej wyceny. Wszystkie pola są opcjonalne — puste pola zostaną pominięte.",
    companyNameLabel: "Nazwa firmy",
    companyNamePlaceholder: "np. Instalacje Elektryczne Jan Kowalski",
    nipLabel: "NIP",
    nipHint: "10 cyfr, z kreskami lub bez",
    nipPlaceholder: "np. 123-456-32-18",
    addressLabel: "Adres",
    addressHint: "Ulica, kod pocztowy i miejscowość — w kilku wierszach, jeśli chcesz.",
    phoneLabel: "Telefon",
    phonePlaceholder: "np. +48 600 100 200",
    emailLabel: "Adres email",
    emailPlaceholder: "np. biuro@przyklad.pl",
    save: "Zapisz dane firmy",
    saved: "Dane firmy zostały zapisane.",
    loadFailed: "Nie udało się wczytać danych firmy. Spróbuj ponownie",
  },

  /**
   * Keyed by the `?businessError=` code the company-details endpoint redirects with. See
   * `businessErrorMessage` in `src/lib/business-errors.ts` for the mapping.
   */
  businessErrors: {
    notConfigured: "Dane firmy są chwilowo niedostępne — baza danych nie jest skonfigurowana",
    forbidden: "Nie masz uprawnień do zmiany danych firmy",
    invalidInput: "Formularz zawiera nieprawidłowe dane — sprawdź NIP, telefon i adres email",
    unknown: "Coś poszło nie tak. Spróbuj ponownie",
  },

  /** The project page's "Wycena" section (S-08). See `src/components/projects/QuoteSection.astro`. */
  quote: {
    section: "Wycena",
    description:
      "Koszt materiału z cen katalogowych i szacowany koszt robocizny: liczba aparatów × średni czas montażu + stały narzut, razy Twoja stawka. Czas możesz nadpisać.",
    loadFailed: "Nie udało się wczytać parametrów wyceny. Spróbuj ponownie",
    columns: { item: "Pozycja", detail: "Szczegóły", amount: "Kwota" },
    groups: { material: "Materiał", labour: "Robocizna" },
    cabinet: "Szafka",
    devices: "Aparaty (w tym szyny z katalogu i odcinki listew)",
    deviceCount: (n: number) => `${String(n)} ${plural(n, { one: "aparat", few: "aparaty", many: "aparatów" })}`,
    materialTotal: "Materiał razem",
    estimatedTime: "Czas estymowany",
    /** "11 aparatów × 15 min + 90 min": device count × mount time + project overhead. */
    formula: (count: number, mountMinutes: number, overheadMinutes: number) =>
      `${String(count)} ${plural(count, { one: "aparat", few: "aparaty", many: "aparatów" })} × ${String(mountMinutes)} min + ${String(overheadMinutes)} min`,
    timeUsed: "Czas robocizny",
    overriddenMarker: "nadpisany",
    estimateMarker: "estymacja",
    hourlyRate: "Stawka godzinowa",
    perHour: (money: string) => `${money} / h`,
    labourCost: "Koszt robocizny",
    total: "Razem (materiał + robocizna)",
    /** 4 h 15 min · 4 h · 45 min — the zero part is left out. */
    duration: (hours: number, minutes: number) => {
      if (hours === 0) return `${String(minutes)} min`;
      return minutes === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(minutes)} min`;
    },
    notCurrentTitle: "Wycena czeka na aktualny dobór aparatów",
    notCurrent:
      "Wycenę liczymy tylko z aktualnego, zapisanego doboru aparatów — bez niego nie pokazujemy żadnych kwot.",
    notCurrentLink: "Przejdź do doboru aparatów",
    override: {
      legend: "Nadpisz czas robocizny",
      hint: "Estymacja jest punktem wyjścia — wpisz czas, który uważasz za realny. Zapisana wartość trafi do wyceny.",
      hours: "Godziny",
      minutes: "Minuty",
      hoursUnit: "h",
      minutesUnit: "min",
      set: "Zapisz czas",
      clear: "Przywróć estymację",
      /** Shown by the browser when both fields are 0 — the per-field limits cannot say it. */
      zeroTotal: "Podaj czas co najmniej 1 minuty.",
    },
    outdatedTitle: "Nadpisany czas może być nieaktualny",
    /** `estimate` is the current estimated time, already formatted by `duration`. */
    outdated: (estimate: string) =>
      `Od zapisania nadpisanego czasu zmienił się dobór aparatów albo parametry wyceny; obecna estymacja to ${estimate}. Nadal liczymy z Twojego czasu — zapisz go ponownie albo przywróć estymację.`,
    /** `thresholdZl` is the ceiling in złote; the profile page shows the same text. */
    rateWarning: (thresholdZl: number) =>
      `Stawka godzinowa przekracza ${formatNumber(thresholdZl)} zł/h — sprawdź, czy to nie literówka. Zapis nie jest blokowany.`,
    /** The aside row's badge texts; a ready quote shows its total instead. */
    badges: {
      notConfigured: "Brak parametrów wyceny",
      notCurrent: "Czeka na dobór",
      unavailable: "Niedostępna",
    },
  },

  /** The printable quote (S-09): the print page, its blocked states and its screen-only notices. See `src/lib/quote-print.ts`. */
  quotePrint: {
    /** The entry link on the project page. */
    open: "Drukuj wycenę",
    title: "Wycena",
    pageTitle: (projectName: string) => `Wycena — ${projectName}`,
    toolbar: {
      back: "Wróć do projektu",
      print: "Drukuj / zapisz jako PDF",
    },
    issuedOn: "Data wystawienia",
    nip: (nip: string) => `NIP ${nip}`,
    /** The letterhead's contact line: NIP, phone and email, whichever are set. */
    contactLine: (parts: readonly string[]) => parts.join(" · "),
    client: {
      project: "Projekt",
      client: "Klient",
      siteAddress: "Adres inwestycji",
      cabinet: "Szafka",
    },
    material: {
      title: "Materiał",
      item: "Pozycja",
      /** The muted line under an item's name: kind, manufacturer, model. */
      itemDetails: (parts: readonly string[]) => parts.join(" · "),
      /** A comb busbar's length, in the muted line under its name. */
      busbarPins: (pins: number) => `${String(pins)} ${plural(pins, { one: "pin", few: "piny", many: "pinów" })}`,
      quantity: "Ilość",
      unitPrice: "Cena jedn.",
      lineTotal: "Wartość",
      cabinetRow: "Szafka rozdzielnicy",
      subtotal: "Materiał razem",
    },
    labour: {
      title: "Robocizna",
      time: "Czas robocizny",
      hourlyRate: "Stawka godzinowa",
      cost: "Koszt robocizny",
    },
    grandTotal: "Razem (materiał + robocizna)",
    quantity: (n: number) => `${String(n)} szt.`,
    informationalNote:
      "Dokument informacyjny — nie jest fakturą ani fakturą VAT. Ceny aparatów pochodzą z katalogu z chwili doboru aparatów.",
    drawingTitle: "Układ aparatów w szafce",
    blockedTitle: "Nie można wydrukować wyceny",
    blocked: {
      noProfile: "Nie ustawiono parametrów wyceny — uzupełnij je w profilu.",
      matchNotCurrent: "Dobór aparatów nie jest aktualny — dobierz aparaty ponownie.",
      layoutNotPlaced: "Aparaty nie mają zapisanego, aktualnego układu w szafce — zaproponuj układ.",
      noProfileLink: "Uzupełnij parametry wyceny",
      matchNotCurrentLink: "Przejdź do doboru aparatów",
      layoutNotPlacedLink: "Przejdź do układu w szafce",
    },
    /** Screen-only notices above the document; they never print. */
    notices: {
      /** `estimate` is the current estimated time, already formatted by `t.quote.duration`. */
      overrideOutdated: (estimate: string) =>
        `Nadpisany czas robocizny może być nieaktualny — obecna estymacja to ${estimate}. Na wydruku jest Twój czas.`,
      businessMissing:
        "Nie podano nazwy firmy — w nagłówku wydruku zamiast niej będzie Twoje imię i nazwisko albo adres email. Nazwę firmy uzupełnisz w profilu.",
      rateWarning: "Stawka godzinowa jest bardzo wysoka — sprawdź, czy to nie literówka, zanim wydrukujesz wycenę.",
    },
    notFound: "Nie znaleziono tego projektu.",
    loadFailed: "Nie udało się wczytać wyceny. Spróbuj ponownie",
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
      columns: {
        name: "Projekt",
        client: "Klient",
        cabinet: "Szafka",
        updatedAt: "Zmieniono",
      },
      noClient: "Bez klienta",
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
      /** The page header's muted line: client and site address, whichever are set. */
      headerDescription: (parts: readonly string[]) => parts.join(" · "),
      summary: "Podsumowanie projektu",
      sectionNav: "Sekcje projektu",
      supplyStatus: "Przyłącze",
      supplyConfigured: "Uzupełnione",
      supplyMissing: "Parametry przyłącza nie są uzupełnione.",
      supplyMissingLink: "Uzupełnij przyłącze",
      warningsStatus: "Kontrola przyłącza",
      warningCount: (n: number) =>
        n === 0
          ? "Brak ostrzeżeń"
          : `${String(n)} ${plural(n, { one: "ostrzeżenie", few: "ostrzeżenia", many: "ostrzeżeń" })}`,
      savedCircuits: "Obwody zostały zapisane. Wynik doboru aparatów znajdziesz poniżej.",
      savedRematch: "Dobór aparatów został wykonany ponownie. Wynik znajdziesz poniżej.",
      savedLayout: "Zaproponowano nowy układ aparatów w szafce.",
      savedLayoutEdited: "Poprawiony układ aparatów został zapisany.",
      savedQuote: "Czas robocizny został zapisany.",
      /** The aside's device-matching row: its label and one badge text per `MatchViewState`. */
      matchingStatus: "Dobór aparatów",
      matchingCurrent: (n: number) =>
        `Dobrano ${String(n)} ${plural(n, { one: "aparat", few: "aparaty", many: "aparatów" })}`,
      matchingGaps: "Luka w katalogu",
      matchingOutdated: "Nieaktualny",
      matchingNoCircuits: "Brak obwodów",
      matchingBlocked: "Zablokowany",
      matchingUnavailable: "Niedostępny",
      /** The aside's layout row: its label and one badge text per layout state. */
      layoutStatus: "Układ w szafce",
      layoutPlaced: "Rozmieszczony",
      layoutMissing: "Nie zaproponowano",
      layoutDoesNotFit: "Nie mieści się",
      layoutOutdated: "Nieaktualny",
      layoutNotCurrent: "Czeka na dobór",
      layoutUnavailable: "Niedostępny",
      layoutEditedManually: "Poprawiony ręcznie",
      /** The aside's quote row: its label; the badge texts live in `t.quote.badges`. */
      quoteStatus: "Wycena",
    },
    cabinet: {
      section: "Szafka rozdzielnicy",
      snapshotHint: "Projekt przechowuje kopię szafki z chwili jej wybrania — zmiany w katalogu jej nie zmieniają.",
      drawingUnavailable: "Rysunek tej szafki jest niedostępny.",
      currentArchived: "Ta szafka została wycofana z katalogu. Projekt zachowuje jej zapisaną kopię.",
      manufacturerModel: (manufacturer: string, model: string) => `${manufacturer} · ${model}`,
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
    deviceUnavailable: "Katalog aparatów zmienił się w trakcie zapisu — spróbuj ponownie",
    circuitsInvalid: "Lista obwodów zawiera nieprawidłowe dane",
    layoutMatchNotCurrent:
      "Układ można zaproponować tylko dla aktualnego doboru aparatów — najpierw dobierz aparaty ponownie",
    layoutDoesNotFit:
      "Dobrane aparaty nie mieszczą się na szynach DIN tej szafki — wybierz większą szafkę albo zmniejsz liczbę obwodów",
    layoutDeviceUnavailable: "Dobór aparatów zmienił się w trakcie zapisu układu — spróbuj ponownie",
    layoutInvalid:
      "Układ nie został zapisany, bo nie spełnia zasad rozmieszczenia (aparaty nachodzą na siebie lub na szyny PE/N, wychodzą poza szynę DIN albo grupa RCD nie stoi razem) — popraw go i zapisz ponownie",
    quoteMatchNotCurrent:
      "Czas robocizny można nadpisać tylko dla aktualnego doboru aparatów — najpierw dobierz aparaty ponownie",
    quotePricingNotConfigured:
      "Nie ustawiono parametrów wyceny — uzupełnij je w profilu, zanim nadpiszesz czas robocizny",
    unknown: "Coś poszło nie tak. Spróbuj ponownie",
  },

  /** The project page's OSD/WLZ section. Option values come from `src/lib/supply-params.ts`. */
  supply: {
    section: "Przyłącze i WLZ",
    description:
      "Parametry przyłącza od OSD i wewnętrznej linii zasilającej (WLZ). Na ich podstawie system wyświetla uproszczone ostrzeżenia, a w kolejnym kroku dobiera zabezpieczenia główne.",
    osdSection: "Przyłącze (OSD)",
    wlzSection: "WLZ — wewnętrzna linia zasilająca",
    fields: {
      premeterProtection: "Zabezpieczenie przedlicznikowe",
      earthingSystem: "Układ sieci",
      phaseCount: "Liczba faz",
      wlzLength: "Długość WLZ (m)",
      wlzCrossSection: "Przekrój żył WLZ",
      wlzMaterial: "Materiał żył",
      wlzInstallation: "Sposób ułożenia",
    },
    choose: "Wybierz…",
    protectionOption: (amperes: number) => `${String(amperes)} A`,
    phaseCountOption: (n: number) => `${String(n)} ${plural(n, { one: "faza", few: "fazy", many: "faz" })}`,
    crossSectionOption: (mm2: number) => `${formatNumber(mm2)} mm²`,
    /** Keyed by `EarthingSystem`. */
    earthingSystems: {
      "TN-C": "TN-C",
      "TN-S": "TN-S",
      "TN-C-S": "TN-C-S",
      TT: "TT",
    },
    /** Keyed by `ConductorMaterial`. */
    materials: {
      Cu: "Miedź (Cu)",
      Al: "Aluminium (Al)",
    },
    /** Keyed by `WlzInstallation`. */
    installations: {
      surface: "Natynkowo",
      conduit_surface: "W rurce natynkowo",
      conduit_flush: "W rurce podtynkowo",
      in_wall: "Bezpośrednio w ścianie/tynku",
      in_ground: "W gruncie",
    },
    protectionHint: "Prąd znamionowy zabezpieczenia przed licznikiem, w amperach — z warunków przyłączenia OSD.",
    lengthHint: (maxMetres: number) =>
      `W metrach, np. 15 albo 12,5 — najwyżej jedno miejsce po przecinku, maks. ${formatNumber(maxMetres)} m.`,
    lengthPlaceholder: "np. 12,5",
    crossSectionHint: "Przekrój jednej żyły, w mm².",
    save: "Zapisz przyłącze",
    saved: "Parametry przyłącza zostały zapisane.",
    notConfigured:
      "Nie uzupełniono jeszcze parametrów przyłącza — podaj je, zanim przejdziesz do obwodów i doboru aparatów.",
    warningsTitle: "Kontrola przyłącza",
  },

  /**
   * Keyed by `SupplyWarningCode` (camelCased). See `supplyWarningMessage` in
   * `src/lib/supply-warnings.ts` for the mapping.
   */
  supplyWarnings: {
    wlzAmpacityBelowProtection: (ampacityA: number, protectionA: number) =>
      `Obciążalność prądowa długotrwała WLZ (${formatNumber(ampacityA)} A dla tego przekroju, materiału i sposobu ułożenia) jest mniejsza niż zabezpieczenie przedlicznikowe (${formatNumber(protectionA)} A). Rozważ większy przekrój WLZ.`,
    aluminiumBelowMinimum: (minimumMm2: number) =>
      `WLZ z żyłami aluminiowymi powinna mieć przekrój co najmniej ${formatNumber(minimumMm2)} mm².`,
    penBelowMinimum: (minimumMm2: number) =>
      `Przewód PEN w WLZ (układ TN-C albo TN-C-S z rozdziałem PEN w rozdzielnicy) powinien mieć przekrój co najmniej ${formatNumber(minimumMm2)} mm² dla wybranego materiału żył.`,
    voltageDropHigh: (percent: number, limitPercent: number) =>
      `Spadek napięcia na WLZ wynosi ok. ${formatNumber(percent)} % i przekracza zalecane ${formatNumber(limitPercent)} %. Wyliczono go przy pełnym prądzie zabezpieczenia przedlicznikowego, więc jest zawyżony — to oszacowanie z zapasem.`,
    note: "Kontrole są uproszczone i mają charakter informacyjny: obciążalność pochodzi z tabel dla izolacji PVC bez współczynników poprawkowych (temperatura, grupowanie), a spadek napięcia liczony jest przy pełnym prądzie zabezpieczenia przedlicznikowego. Nie blokują zapisu i nie zastępują obliczeń projektowych.",
    none: "Uproszczone kontrole nie wykazały zastrzeżeń do parametrów przyłącza.",
  },

  /** The project page's "Obwody i dobór aparatów" section. See `src/components/projects/MatchResult.astro`. */
  circuitSection: {
    section: "Obwody i dobór aparatów",
    description:
      "Obwody doprowadzone do szafki i ich grupy RCD. Po zapisie system dobiera najtańsze aparaty spełniające parametry każdego obwodu.",
    loadFailed: "Nie udało się wczytać obwodów i doboru aparatów. Spróbuj ponownie",
    /** The circuit editor's submit button. */
    save: "Zapisz obwody i dobierz aparaty",
    warningsTitle: "Kontrola obwodów",
    resultTitle: "Dobrane aparaty",
    previewTitle: "Podgląd nowego doboru (niezapisany)",
    gapsTitle: "Luki w katalogu aparatów",
    blockedTitle: "Nie można dobrać aparatów",
    stale:
      "Katalog aparatów albo parametry projektu zmieniły się od ostatniego doboru — zapisany zestaw jest nieaktualny. Dobierz aparaty ponownie.",
    cleared:
      "Projekt nie ma zapisanego doboru aparatów — na przykład po zmianie parametrów przyłącza. Poniżej widać podgląd doboru, który zostanie zapisany dopiero po kliknięciu „Dobierz ponownie”.",
    rematch: "Dobierz ponownie",
    fixSupply: "Uzupełnij przyłącze",
    fixCircuits: "Popraw obwody",
    columns: {
      role: "Funkcja",
      device: "Aparat",
      parameters: "Parametry",
      price: "Cena katalogowa",
      serves: "Zabezpiecza",
    },
    /** What a selection serves: the whole supply (main switch), a group or one circuit. */
    servesSupply: "Całą instalację",
    servesGroup: (label: string) => `Grupa „${label}”`,
    servesCircuit: (name: string) => `Obwód „${name}”`,
    /** A comb busbar segment in the match result: "Grupa „Kuchnia” — sztuka 1, odcinek 8 TE". */
    busbarSegment: (group: string, piece: number, modules: number) =>
      `Grupa „${group}” — sztuka ${String(piece)}, odcinek ${String(modules)} TE`,
    /** In the price cell of a segment cut from a piece an earlier row already priced. */
    busbarSharedPrice: "w cenie sztuki",
    summaryUnavailable: "Parametry niedostępne",
    count: (n: number) => `${String(n)} ${plural(n, { one: "aparat", few: "aparaty", many: "aparatów" })}`,
  },

  /** Circuit editor labels and defaults (S-04). */
  circuits: {
    /** The label a new RCD group gets: the lowest unused n. See `nextGroupLabel` in `src/lib/circuit-draft.ts`. */
    defaultGroupLabel: (n: number) => `RCD ${String(n)}`,
    /** The name a new circuit gets; the electrician renames it. */
    defaultCircuitName: (n: number) => `Obwód ${String(n)}`,
    /** The editor island, `src/components/circuits/CircuitEditor.tsx`. */
    editor: {
      label: "Edytor obwodów i grup RCD",
      hint: "Przeciągnij obwód za uchwyt do innej grupy albo zmień jego grupę na liście „Grupa”. Każda grupa RCD dostaje własny wyłącznik różnicowoprądowy.",
      empty: "Nie dodano jeszcze żadnego obwodu. Dodaj grupę RCD albo obwód bez grupy.",
      emptyContainer: "Brak obwodów — przeciągnij tu obwód albo dodaj nowy.",
      ungrouped: "Bez grupy",
      ungroupedHint: "Obwody bez wyłącznika różnicowoprądowego.",
      addGroup: "Dodaj grupę RCD",
      addCircuit: "Dodaj obwód",
      addCircuitTo: (container: string) => `Dodaj obwód: ${container}`,
      maxGroups: (max: number) => `Osiągnięto limit ${String(max)} grup RCD.`,
      maxCircuits: (max: number) => `Osiągnięto limit ${String(max)} obwodów.`,
      groupCard: (label: string) => `Grupa RCD „${label}”`,
      circuitRow: (name: string) => `Obwód „${name}”`,
      circuitCount: (n: number) => `${String(n)} ${plural(n, { one: "obwód", few: "obwody", many: "obwodów" })}`,
      rcboHint: "1 obwód → zostanie dobrany RCBO",
      groupFields: {
        label: "Nazwa grupy",
        residualCurrent: "Prąd różnicowy IΔn",
        minRcdType: "Minimalny typ RCD",
        rcdMargin: "Zapas prądu RCD",
      },
      circuitFields: {
        name: "Nazwa obwodu",
        ratedCurrent: "Prąd znamionowy In",
        phaseCount: "Liczba faz",
        crossSection: "Przekrój przewodu",
        installation: "Sposób ułożenia",
        entrySide: "Wprowadzenie przewodów",
        group: "Grupa",
      },
      ratedCurrentOption: (amperes: number) => `${String(amperes)} A`,
      residualCurrentOption: (milliamperes: number) => `${String(milliamperes)} mA`,
      marginOption: (percent: number) => `${String(percent)} %`,
      /** Under the margin select: the rating the group's RCD must reach. */
      rcdRequirement: (minRatedA: number, circuitsSumA: number, marginPercent: number) =>
        `RCD co najmniej ${formatNumber(minRatedA)} A (suma prądów obwodów ${formatNumber(circuitsSumA)} A + ${formatNumber(marginPercent)} % zapasu).`,
      /** An entry side the cabinet snapshot has no cable entry on. */
      entrySideMissing: (side: string) => `${side} (brak w szafce)`,
      dragGroup: (label: string) => `Przeciągnij grupę „${label}”`,
      dragCircuit: (name: string) => `Przeciągnij obwód „${name}”`,
      moveUp: (subject: string) => `Przesuń w górę: ${subject}`,
      moveDown: (subject: string) => `Przesuń w dół: ${subject}`,
      remove: "Usuń",
      removeGroup: (label: string) => `Usuń grupę „${label}” (jej obwody trafią do „Bez grupy”)`,
      removeCircuit: (name: string) => `Usuń obwód „${name}”`,
      blocked: "Popraw zaznaczone błędy, aby zapisać obwody.",
      saving: "Zapisywanie...",
    },
    /** Screen-reader instructions and announcements for drag and drop (dnd-kit `accessibility`). */
    dnd: {
      instructions:
        "Aby podnieść element, naciśnij spację albo Enter. Strzałkami przesuwasz go, spacją albo Enterem upuszczasz, a klawiszem Escape anulujesz przenoszenie.",
      /** Accusative subjects: "Podniesiono obwód „Gniazda kuchnia”." */
      circuitSubject: (name: string) => `obwód „${name}”`,
      groupSubject: (label: string) => `grupę „${label}”`,
      groupList: "lista grup RCD",
      groupContainer: (label: string) => `grupa „${label}”`,
      ungroupedContainer: "bez grupy",
      pickedUp: (subject: string) => `Podniesiono ${subject}.`,
      movedOver: (subject: string, position: number, total: number, container: string) =>
        `Przesunięto ${subject} na pozycję ${String(position)} z ${String(total)}: ${container}.`,
      dropped: (subject: string, position: number, total: number, container: string) =>
        `Upuszczono ${subject} na pozycji ${String(position)} z ${String(total)}: ${container}.`,
      droppedNowhere: (subject: string) => `Upuszczono ${subject} poza listą — bez zmian.`,
      cancelled: (subject: string) => `Anulowano przenoszenie. Przywrócono ${subject} na poprzednie miejsce.`,
    },
  },

  /**
   * Keyed by `CircuitIssueCode` (camelCased). See `circuitIssueMessage` in `src/lib/circuit-params.ts`.
   */
  circuitIssues: {
    payload: "Lista obwodów",
    groupList: "Grupy RCD",
    circuitList: "Obwody",
    groupNumbered: (n: number) => `Grupa RCD ${String(n)}`,
    circuitNumbered: (n: number) => `Obwód ${String(n)}`,
    /** "Obwód 3" + "Prąd znamionowy" → "Obwód 3, Prąd znamionowy". */
    subject: (owner: string, field: string) => `${owner}, ${field}`,
    /** Keyed by `CircuitField` (camelCased). */
    fields: {
      id: "Identyfikator",
      label: "Nazwa grupy",
      residualCurrentMa: "Prąd różnicowy",
      minRcdType: "Minimalny typ wyłącznika różnicowoprądowego",
      rcdMarginPercent: "Zapas prądu wyłącznika różnicowoprądowego",
      rcdGroupId: "Grupa RCD",
      name: "Nazwa obwodu",
      ratedCurrentA: "Prąd znamionowy",
      phaseCount: "Liczba faz",
      crossSectionMm2: "Przekrój przewodu",
      installation: "Sposób ułożenia",
      entrySide: "Strona wprowadzenia przewodów",
    },
    malformed: (subject: string) => `${subject}: dane są niekompletne lub nieprawidłowe`,
    required: (subject: string) => `${subject}: pole jest wymagane`,
    notInList: (subject: string) => `${subject}: wybierz wartość z listy`,
    tooLong: (subject: string, max: number) =>
      `${subject}: najwyżej ${String(max)} ${plural(max, { one: "znak", few: "znaki", many: "znaków" })}`,
    unknownGroup: (subject: string) => `${subject}: wskazana grupa RCD nie istnieje`,
    duplicateId: (subject: string) => `${subject}: identyfikator powtarza się w formularzu`,
    tooMany: (subject: string, max: number) => `${subject}: za dużo pozycji (maks. ${String(max)})`,
  },

  /**
   * Keyed by `CircuitWarningCode` (camelCased). See `circuitWarningMessage` in
   * `src/lib/circuit-warnings.ts`.
   */
  circuitWarnings: {
    cableAmpacityBelowIn: (circuitName: string, ampacityA: number, ratedA: number) =>
      `Obwód „${circuitName}”: obciążalność prądowa długotrwała przewodu (${formatNumber(ampacityA)} A dla tego przekroju i sposobu ułożenia) jest mniejsza niż prąd znamionowy zabezpieczenia (${formatNumber(ratedA)} A). Rozważ większy przekrój albo mniejsze zabezpieczenie.`,
    barsMissing: "Wybrana szafka nie ma szyn PE ani N — przewody ochronne i neutralne nie mają gdzie się podłączyć.",
    barTerminalsInsufficient: (kind: string, needed: number, available: number) =>
      `Szyna ${kind}: potrzeba ${formatNumber(needed)} ${plural(needed, { one: "zacisku", few: "zacisków", many: "zacisków", other: "zacisku" })} o pasującym przekroju (obwody i WLZ), a pasuje tylko ${formatNumber(available)}.`,
    entrySideNotInCabinet: (circuitName: string, side: string) =>
      `Obwód „${circuitName}”: szafka nie ma wprowadzenia przewodów od strony „${side}”.`,
    note: "Kontrole są uproszczone i mają charakter informacyjny: obciążalność pochodzi z tabel dla przewodów miedzianych w izolacji PVC bez współczynników poprawkowych (temperatura, grupowanie). Nie blokują zapisu i nie zastępują obliczeń projektowych.",
  },

  /** Device matching: roles, catalog gaps and blockers. See `src/lib/device-matching.ts`. */
  matching: {
    /** Keyed by `SelectionRole` (camelCased). */
    roles: {
      mainSwitch: "Rozłącznik główny (FR)",
      rcd: "Wyłącznik różnicowoprądowy (RCD)",
      rcbo: "Wyłącznik różnicowonadprądowy (RCBO)",
      mcb: "Wyłącznik nadprądowy B (MCB)",
      peBar: "Szyna PE (z katalogu)",
      nBar: "Szyna N (z katalogu)",
      busbar: "Listwa zasilająca (grzebieniowa)",
    },
    /** Keyed by `SelectionNote` (camelCased). */
    notes: {
      rcboFallback:
        "W katalogu nie ma pasującego wyłącznika RCBO — zamiast niego dobrano wyłącznik różnicowoprądowy i wyłącznik nadprądowy.",
      noRcd: "Ten obwód nie ma ochrony różnicowoprądowej.",
      busbarMissing:
        "Brak listwy zasilającej w katalogu dla tej grupy — aparaty grupy łączą przewody. Skontaktuj się z administratorem, jeśli chcesz użyć listwy.",
      busbarGroupTooWide:
        "Grupa jest szersza niż każda szyna DIN szafki, więc nie dostaje listwy zasilającej — aparaty łączą przewody.",
    },
    /** A pole set as the gap text shows it: "1P / 1P+N / 2P". */
    polesSeparator: " / ",
    /** The conductors a catalog bar must take, per cross-section: "3 × 2,5 mm²". */
    barSections: (count: number, mm2: number) => `${String(count)} × ${formatNumber(mm2)} mm²`,
    barSectionsSeparator: ", ",
    /** Keyed by the gap's `role`. Each names exactly the device the catalog is missing. */
    gaps: {
      mainSwitch: (minRatedA: number, poles: string) =>
        `Brak w katalogu: rozłącznik izolacyjny (FR) o prądzie znamionowym co najmniej ${formatNumber(minRatedA)} A, ${poles} — rozłącznik główny.`,
      rcd: (
        minRatedA: number,
        circuitsSumA: number,
        marginPercent: number,
        residualMa: number,
        minType: string,
        poles: string,
        groupLabel: string,
      ) =>
        `Brak w katalogu: wyłącznik różnicowoprądowy o prądzie znamionowym co najmniej ${formatNumber(minRatedA)} A (suma prądów obwodów ${formatNumber(circuitsSumA)} A + ${formatNumber(marginPercent)} % zapasu), ${formatNumber(residualMa)} mA, typ ${minType} lub wyższy, ${poles} — grupa: „${groupLabel}”.`,
      rcbo: (ratedA: number, residualMa: number, minType: string, poles: string, circuitName: string) =>
        `Brak w katalogu: wyłącznik różnicowonadprądowy B${String(ratedA)}, ${formatNumber(residualMa)} mA, typ ${minType} lub wyższy, ${poles} — obwód: „${circuitName}”.`,
      mcb: (ratedA: number, poles: string, circuitName: string) =>
        `Brak w katalogu: wyłącznik nadprądowy B${String(ratedA)}, ${poles} — obwód: „${circuitName}”.`,
      /** A bar kind the cabinet has no built-in bar of, and no catalog bar takes every conductor. */
      bar: (kind: string, terminals: number, sections: string) =>
        `Brak w katalogu: szyna ${kind} z co najmniej ${String(terminals)} ${plural(terminals, { one: "zaciskiem pasującym", few: "zaciskami pasującymi", many: "zaciskami pasującymi" })} do przewodów: ${sections} — szafka nie ma wbudowanej szyny ${kind}.`,
      /** Appended to an RCD or MCB gap that is part of the RCD + MCB alternative to a missing RCBO. */
      fallbackSuffix: " To alternatywa dla brakującego wyłącznika RCBO tego obwodu.",
      contactAdmin: "Skontaktuj się z administratorem, aby uzupełnił katalog aparatów.",
    },
    /** Keyed by `BlockReason["code"]` (camelCased). */
    blockReasons: {
      supplyMissing: "Uzupełnij parametry przyłącza, zanim system dobierze aparaty.",
      noCircuits: "Dodaj co najmniej jeden obwód, zanim system dobierze aparaty.",
      tnCWithRcd:
        "W układzie TN-C nie można stosować wyłączników różnicowoprądowych. Jeśli PEN jest rozdzielany w rozdzielnicy, wybierz w przyłączu układ TN-C-S, albo usuń obwody z grup RCD.",
      circuitPhaseExceedsSupply: (circuitName: string) =>
        `Obwód „${circuitName}” jest trójfazowy, a przyłącze jest jednofazowe.`,
      circuitGroupUnknown: (circuitName: string) =>
        `Obwód „${circuitName}” jest przypisany do grupy RCD, która nie istnieje — przypisz go ponownie.`,
    },
  },

  /** The cabinet layout proposal (S-05). See `src/lib/cabinet-layout.ts`. */
  layout: {
    /** Block names a `does_not_fit` failure reports. A group block uses `circuitSection.servesGroup`. */
    blocks: {
      mainSwitch: "Rozłącznik główny (FR)",
      ungrouped: "Obwody bez grupy RCD",
      bars: "Szyny PE/N z katalogu",
    },
    /** Labels on the devices in the cabinet drawing. `B16` is the B-characteristic rating. */
    drawing: {
      mainSwitch: "FR",
      rcd: "RCD",
      rcbo: "RCBO",
      mcbCharacteristic: (ratedCurrentA: number) => `B${String(ratedCurrentA)}`,
      ampere: (ratedCurrentA: number) => `${String(ratedCurrentA)}A`,
      milliampere: (residualCurrentMa: number) => `${String(residualCurrentMa)}mA`,
      nTerminal: "N",
    },
    /** The project page's "Układ w szafce" section. See `src/components/projects/LayoutSection.astro`. */
    section: {
      title: "Układ w szafce",
      description:
        "Propozycja rozmieszczenia dobranych aparatów na szynach DIN szafki: aparaty grupy stoją razem z jej wyłącznikiem różnicowoprądowym, grupa blisko strony, z której wchodzą jej przewody, a przy równorzędnych miejscach wygrywa bliskość szyn N i PE.",
      drawingTitle: "Rozmieszczenie aparatów",
      wlzHint:
        "Przyjęto, że WLZ wchodzi do szafki pierwszym wprowadzeniem przewodów z katalogu szafek — tam trafia rozłącznik główny.",
      notCurrent:
        "Układ powstaje dopiero z aktualnego, zapisanego doboru aparatów. Uzupełnij obwody i sprawdź wynik doboru powyżej.",
      notCurrentLink: "Przejdź do doboru aparatów",
      missingTitle: "Układ nie został jeszcze zaproponowany",
      missing: "Aparaty są dobrane. Zaproponuj ich rozmieszczenie w szafce — później możesz je poprawić.",
      propose: "Zaproponuj układ",
      outdatedTitle: "Układ nieaktualny",
      outdated:
        "Zapisany układ nie pasuje już do dobranych aparatów albo do szafki. Zaproponuj go ponownie — nieaktualnego układu nie rysujemy.",
      proposeAgain: "Zaproponuj układ ponownie",
      manualReset: "Ręczne poprawki układu nie pasowały do nowego doboru aparatów — zaproponowano układ od nowa.",
      doesNotFitTitle: "Aparaty nie mieszczą się w szafce",
      legendLabel: "Legenda rysunku",
      legend: {
        mainSwitch: "Rozłącznik główny (FR)",
        protection: "Wyłącznik różnicowoprądowy (RCD) i różnicowonadprądowy (RCBO)",
        mcb: "Wyłącznik nadprądowy (MCB)",
        group: "Przerywany obrys — grupa RCD",
        /** A comb busbar in the drawing, both variants (`rcd-group-busbars`). */
        busbar:
          "Listwa zasilająca (grzebieniowa) — zasila fazami aparaty grupy zamiast przewodów; ząb przy każdym zacisku fazowym",
      },
      /** The tooltip of a comb busbar in the drawing: "Listwa zasilająca 3F — grupa „Kuchnia”, 8 pinów". */
      busbarTitle: (phases: number, group: string, pins: number) =>
        `Listwa zasilająca ${String(phases)}F${group === "" ? "" : ` — grupa „${group}”`}, ${String(pins)} ${plural(pins, { one: "pin", few: "piny", many: "pinów" })}`,
      /** The wire legend: colour per PN-EN 60445 plus the pattern a greyscale print keeps. */
      wireLegendLabel: "Legenda przewodów",
      /** The tooltip of one conductor in the drawing, shown on hover. */
      wireTitle: {
        circuit: (name: string, details: string) => `Obwód „${name}” — ${details}`,
        wlz: (details: string) => `WLZ — ${details}`,
        feed: (from: string, to: string, details: string) => `Połączenie ${from} → ${to} — ${details}`,
        details: (role: string, crossSectionMm2: number, metres: number) =>
          `${role}, ${formatNumber(crossSectionMm2)} mm², ${formatNumber(metres)} m`,
        deviceInGroup: (device: string, group: string) => `${device} „${group}”`,
        entry: "wprowadzenie przewodów",
        peBar: "szyna PE",
        nBar: "szyna N",
        /** "szyna N, zacisk 3": terminals are numbered along the bar from 1. */
        barTerminal: (bar: string, n: number) => `${bar}, zacisk ${String(n)}`,
        /** A cable core's title with the bar terminal it lands on. */
        landsOn: (title: string, place: string) => `${title} — ${place}`,
        unknownCircuit: "obwód",
      },
      wireLegend: {
        l: "L — przewód fazowy (L1 brązowy, L2 czarny, L3 szary), linia ciągła",
        n: "N — przewód neutralny (niebieski), linia przerywana",
        pe: "PE — przewód ochronny (zielono-żółty), szersza linia z ciągłym jasnym paskiem w środku",
        pen: "PEN — przewód ochronno-neutralny (TN-C; w TN-C-S do punktu rozdziału na szynie PE), najszerszy zielono-żółty z niebieskimi kreskami",
        terminal:
          "Zacisk szyny PE/N — kółko; zacisk zajęty przez przewód jest wypełniony jego kolorem (jeden przewód na zacisk)",
        cable: "Kabel w izolacji zewnętrznej — od wprowadzenia do miejsca, w którym rozchodzą się żyły",
      },
      /** The realistic drawing's wire legend (S-11): true-scale bodies, ferrules, ties and packs. */
      realisticWireLegend: {
        l: "L — przewód fazowy (L1 brązowy, L2 czarny, L3 szary)",
        n: "N — przewód neutralny (niebieski)",
        pe: "PE — przewód ochronny (żółto-zielony)",
        pen: "PEN — przewód ochronno-neutralny (TN-C; w TN-C-S do punktu rozdziału na szynie PE), w paski żółte, zielone i niebieskie na całej długości",
        thickness:
          "Grubość przewodu w skali rysunku — średnica zewnętrzna zależy od przekroju, więc WLZ jest najgrubsza",
        ferrules: "Tulejki na końcach żył, kolor według przekroju (DIN 46228-4):",
        tie: "Opaska kablowa spinająca wiązkę żył",
        pack: "Żyły kabli obwodów i WLZ biegną wiązkami w kanałach przy bokach szafki i odchodzą poziomo do swoich zacisków",
        overflow:
          "Żyły, które nie zmieściły się w wiązce, biegną w drugiej warstwie — za końcami szyn DIN, pod aparatami",
      },
      /** Where the wires go while the browser routes them (`WiringDrawing`). */
      wiresLoading: "Wczytywanie przewodów…",
      /** The "Widok: realistyczny / schematyczny" switch over the drawing (`WiringViewSwitch`). */
      view: {
        label: "Widok",
        navLabel: "Widok rysunku przewodów",
        /** Keyed by `WiringVariant`. */
        options: {
          realistic: "realistyczny",
          schematic: "schematyczny",
        },
      },
      lengthsTitle: "Długości przewodów",
      lengthsColumns: {
        crossSection: "Przekrój",
        conductor: "Żyła",
        usage: "Przeznaczenie",
        count: "Odcinki",
        length: "Długość (m)",
      },
      crossSection: (mm2: number) => `${formatNumber(mm2)} mm²`,
      metres: (metres: number) => formatNumber(metres),
      /** Keyed by `WireClass`. */
      wireClasses: {
        L: "L (fazowa)",
        N: "N (neutralna)",
        PE: "PE (ochronna)",
        PEN: "PEN (ochronno-neutralna)",
      },
      /** Keyed by `ConductorKind`. */
      conductorKinds: {
        circuit: "obwody",
        wlz: "WLZ",
        feed: "połączenia między aparatami",
      },
      kindsSeparator: ", ",
      lengthsNote: (slackPercent: number) =>
        `Długości zawierają ${formatNumber(slackPercent)} % zapasu montażowego. Trasy są przybliżone (po kanałach nad i pod szynami DIN i wzdłuż boków szafki), więc to szacunek do zamówienia przewodów, a nie wynik pomiaru. Połączenia między aparatami liczone są przekrojem WLZ.`,
      noBarsNote: "Szafka nie ma szyn PE ani N — przewodów do szyn nie narysowano i nie policzono.",
      /** `count` conductors did not fit at true scale in the side channels (`wiringWarnings`). */
      wiringOverflow: (count: number) =>
        `${String(count)} ${plural(count, {
          one: "przewód nie zmieścił się",
          few: "przewody nie zmieściły się",
          many: "przewodów nie zmieściło się",
        })} w prawdziwej skali w kanałach bocznych szafki i ${plural(count, {
          one: "jest narysowany",
          few: "są narysowane",
          many: "jest narysowanych",
        })} w drugiej warstwie, za końcami szyn DIN. To uproszczenie rysunku, a nie błąd — układ i wycena nie są blokowane.`,
      catalogBarsNote:
        "Szafka nie ma wbudowanych szyn PE/N — szyny dobrane z katalogu aparatów stoją na szynie DIN i są w zestawieniu materiału.",
    },
    /**
     * Keyed by `LayoutIssueCode` (camelCased): why a layout — a refused drop in the editor — breaks the
     * invariants. See `layoutIssueMessage` in `src/lib/cabinet-layout.ts`; names come in unquoted.
     */
    issues: {
      deviceNotPlaced: (device: string) => `Aparat „${device}” nie ma miejsca w układzie.`,
      devicePlacedTwice: (device: string) => `Aparat „${device}” występuje w układzie więcej niż raz.`,
      unknownDevice: (device: string) => `Układ zawiera aparat „${device}”, którego nie ma w doborze aparatów.`,
      outsideRail: (device: string) => `Aparat „${device}” wystaje poza szynę DIN.`,
      overlapsDevice: (device: string, other: string) => `Aparat „${device}” nachodzi na aparat „${other}”.`,
      outsideInterior: (device: string) => `Aparat „${device}” wystaje poza wnętrze szafki.`,
      overlapsBar: (device: string) => `Aparat „${device}” nachodzi na szynę PE/N.`,
      overlapsOtherRailDevice: (device: string, other: string) =>
        `Aparat „${device}” nachodzi na aparat „${other}” na sąsiedniej szynie DIN.`,
      groupNotContiguous: (group: string) =>
        `Aparaty grupy „${group}” muszą stać obok siebie na jednej szynie DIN — między nie nie może wejść inny aparat.`,
      rcboNotAlone: (group: string) => `Wyłącznik RCBO grupy „${group}” musi być jedynym aparatem w tej grupie.`,
    },
    /** The layout editor island (S-06), `src/components/projects/LayoutEditor.tsx`. */
    editor: {
      label: "Edytor układu aparatów w szafce",
      hint: "Przeciągnij aparat albo całą grupę (za jej etykietę), żeby go przesunąć. Pozycje przeskakują co pół modułu (0,5 TE). Układ zapisze się dopiero po kliknięciu „Zapisz układ”.",
      instructions:
        "Aby podnieść aparat albo grupę, zaznacz go klawiszem Tab i naciśnij spację lub Enter. Strzałkami w lewo i w prawo przesuwasz o pół modułu, strzałkami w górę i w dół — na sąsiednią szynę DIN. Enter lub spacja upuszcza, Escape anuluje. Ctrl+Z cofa, Ctrl+Shift+Z albo Ctrl+Y ponawia.",
      deviceLabel: (name: string, rail: number, position: string) =>
        `Aparat „${name}”, szyna DIN ${String(rail)}, pozycja ${position} TE`,
      groupLabel: (group: string, rail: number, position: string) =>
        `Grupa „${group}”, szyna DIN ${String(rail)}, pozycja ${position} TE`,
      /** Screen-reader announcements; `subject` is "aparat „B16 Oświetlenie”" or "grupę „Kuchnia”". */
      deviceSubject: (name: string) => `aparat „${name}”`,
      groupSubject: (group: string) => `grupę „${group}”`,
      pickedUp: (subject: string) => `Podniesiono ${subject}.`,
      movedTo: (subject: string, rail: number, position: string) =>
        `Przesunięto ${subject} na szynę DIN ${String(rail)}, pozycja ${position} TE.`,
      dropped: (subject: string, rail: number, position: string) =>
        `Upuszczono ${subject} na szynie DIN ${String(rail)}, pozycja ${position} TE.`,
      droppedInPlace: (subject: string) => `Upuszczono ${subject} w tym samym miejscu.`,
      refused: (subject: string, reason: string) => `Nie można upuścić: ${subject}. ${reason}`,
      refusedSnapBack: (subject: string, reason: string) => `${reason} Przywrócono ${subject} na poprzednie miejsce.`,
      cancelled: (subject: string) => `Anulowano przenoszenie. Przywrócono ${subject} na poprzednie miejsce.`,
      undone: "Cofnięto ostatnią zmianę układu.",
      redone: "Ponowiono zmianę układu.",
      discarded: "Odrzucono niezapisane zmiany układu.",
      refusalTitle: "Nie można tak ustawić aparatu",
      save: "Zapisz układ",
      saving: "Zapisywanie...",
      cancel: "Anuluj",
      undo: "Cofnij",
      redo: "Ponów",
      unsaved: "Masz niezapisane zmiany układu.",
      wiresAfterSave: "Przewody zostaną przeliczone po zapisaniu",
      repropose: "Zaproponuj układ od nowa",
      reproposeTitle: "Zaproponować układ od nowa?",
      reproposeDescription:
        "System zastąpi obecny układ nową propozycją. Ręczne poprawki oraz niezapisane zmiany zostaną utracone.",
      reproposeConfirm: "Zaproponuj od nowa",
      reproposeKeep: "Zostaw mój układ",
    },
    /** Keyed by `LayoutFailure["code"]` (camelCased). */
    failures: {
      doesNotFit: (requiredModules: number, availableModules: number, blockLabel: string) =>
        `Dobrane aparaty nie mieszczą się na szynach DIN tej szafki: potrzeba ${formatNumber(requiredModules)} TE, a szyny mają łącznie ${formatNumber(availableModules)} TE. Pierwszy blok, który się nie zmieścił: ${blockLabel}. Wybierz większą szafkę albo zmniejsz liczbę obwodów.`,
    },
  },

  /** Development-only pages (never reachable in a production build). */
  devTools: {
    kitchenSink: {
      title: "Katalog stanów interfejsu",
      description:
        "Strona deweloperska: każdy element systemu wizualnego w każdym stanie. Służy do kontroli zrzutami ekranu i nie istnieje w buildzie produkcyjnym.",
      sections: {
        tokens: "Tokeny",
        type: "Typografia",
        buttons: "Przyciski",
        forms: "Pola formularzy",
        feedback: "Komunikaty i kontenery",
        drawing: "Rysunek szafki",
        circuits: "Obwody i dobór aparatów",
        layout: "Układ w szafce",
        quote: "Wycena",
        printout: "Wydruk wyceny",
        businessProfile: "Dane firmy do wyceny",
        brand: "Marka",
      },
      tokenGroups: {
        surfaces: "Powierzchnie i tekst",
        accent: "Akcent",
        status: "Statusy",
        wires: "Kolory przewodów (PN-EN 60445)",
        drawing: "Rysunek",
        hero: "Rejestr hero",
      },
      type: {
        h1: "Rozdzielnica dla domu jednorodzinnego",
        h2: "Przyłącze i WLZ",
        h3: "Grupa różnicowoprądowa 1",
        body: "Zabezpieczenie przedlicznikowe, wyłącznik różnicowoprądowy, szyna PE i szyna N — zażółć gęślą jaźń.",
        muted: "Tekst pomocniczy: podpowiedzi pól, opisy sekcji i daty.",
        mono: "B16 1P · 6 kA · 2,5 mm² · 30 mA · 1 234,50 zł",
      },
      buttonVariants: {
        default: "Główny",
        secondary: "Drugorzędny",
        outline: "Obrys",
        ghost: "Przezroczysty",
        destructive: "Usuwający",
        link: "Link",
      },
      states: {
        normal: "Zwykły",
        disabled: "Wyłączony",
        pending: "W toku",
        focus: "Fokus",
        empty: "Pusty",
        filled: "Wypełniony",
        withHint: "Z podpowiedzią",
        invalid: "Błędny",
        checked: "Zaznaczony",
        unchecked: "Niezaznaczony",
      },
      buttonCaption: "Zapisz",
      buttonPendingCaption: "Zapisywanie...",
      smallButton: "Mały",
      controls: {
        input: "Pole tekstowe",
        select: "Lista wyboru",
        checkbox: "Pole wyboru",
        radioCard: "Karta wyboru",
        toggle: "Przełącznik (strona zacisku N)",
      },
      inputLabel: "Nazwa projektu",
      inputPlaceholder: "np. Dom Kowalskich",
      inputValue: "Dom Kowalskich",
      inputHint: "Widoczna tylko dla Ciebie.",
      inputError: "Podaj nazwę projektu",
      selectLabel: "Układ sieci",
      selectError: "Wybierz układ sieci",
      checkboxLabel: "Potwierdzam usunięcie projektu",
      radioOptions: {
        small: "Szafka natynkowa, 1 rząd",
        smallHint: "12 modułów, wprowadzenie od góry",
        large: "Szafka podtynkowa, 3 rzędy",
        largeHint: "36 modułów, wprowadzenia od góry i od dołu",
      },
      alerts: {
        default: { title: "Informacja", description: "Neutralny komunikat na karcie." },
        destructive: { title: "Nie udało się zapisać", description: "Formularz zawiera nieprawidłowe dane." },
        success: { title: "Zapisano", description: "Parametry przyłącza zostały zapisane." },
        warning: { title: "Uwaga", description: "Nie uzupełniono jeszcze parametrów przyłącza." },
        info: { title: "Wskazówka", description: "Projekt przechowuje kopię szafki z chwili jej wybrania." },
      },
      badges: {
        default: "Główny",
        secondary: "Drugorzędny",
        outline: "Obrys",
        destructive: "Błąd",
        success: "Skonfigurowane",
        warning: "Przyłącze nieuzupełnione",
      },
      card: {
        title: "Karta sekcji",
        description: "Nagłówek, opis i treść na białej powierzchni z cienką ramką.",
        content: "Treść karty. Liczby w kolumnach są tabelaryczne, więc wyrównują się w pionie.",
        action: "Edytuj",
      },
      table: {
        caption: "Przykładowe aparaty",
        device: "Aparat",
        parameters: "Parametry",
        price: "Cena",
      },
      emptyState: {
        title: "Brak projektów",
        description: "Załóż pierwszy projekt, aby zaplanować rozdzielnicę.",
        action: "Nowy projekt",
      },
      banners: {
        info: "Baner informacyjny w pasku strony.",
        warning: "Baner ostrzegawczy w pasku strony.",
        error: "Baner błędu w pasku strony.",
        success: "Baner potwierdzenia w pasku strony.",
      },
      drawingStates: {
        plain: "Bez zaznaczenia",
        highlight: "Zaznaczony element (szyna DIN 2)",
        invalid: "Błędne elementy (wprowadzenie 1, szyna N)",
      },
      brandSurfaces: {
        paper: "Na papierze",
        hero: "Na tle hero",
        mono: "Monochromatycznie",
      },
      brandSize: (px: number) => `${String(px)} px`,
      circuitGrid: "Wzór tła: siatka z torem obwodu",
      heroButtons: "Przyciski na tle hero",
      draftingSheet: "Arkusz rysunkowy z układem aparatów i przewodami",
      circuitEditorTitle: "Edytor obwodów",
      matchResultTitle: "Wynik doboru aparatów",
      layoutTitle: "Sekcja „Układ w szafce”",
      editorDrawingsTitle: "Rysunek edytora: stany interakcji",
      businessProfileTitle: "Karta „Dane firmy do wyceny”",
      businessProfileStates: {
        empty: "Pusta — firma jeszcze nie uzupełniona",
        filled: "Wypełniona i zapisana (z komunikatem o zapisie)",
        invalid: "Nieprawidłowy NIP — komunikat o błędzie tylko na tej karcie",
      },
      quoteTitle: "Sekcja „Wycena”",
      printTitle: "Dokument wyceny (dwie strony A4)",
      /** Captions for the printout states; each is computed by the real `computePrintView`. */
      printStates: {
        full: "Gotowy dokument z pełnym nagłówkiem firmy",
        fallback: "Bez danych firmy — nagłówek z imienia i emaila, uwagi widoczne tylko na ekranie",
        grayscale: "Ten sam dokument w skali szarości (kontrola wydruku czarno-białego)",
        blocked: "Blokada wydruku — wszystkie trzy powody, każdy z linkiem naprawczym",
        busbars:
          "Dokument z listwami zasilającymi — jedna pozycja „Listwa zasilająca” liczona od sztuk, rysunek z listwami przy aparatach grup",
      },
      /** Captions for the quote section states; each is computed by the real `computeQuoteView`. */
      quoteStates: {
        noProfile: "Brak parametrów wyceny — blokada z linkiem do profilu, bez kwot",
        notCurrent: "Dobór nieaktualny — blokada z linkiem do doboru, bez kwot",
        ready: "Gotowa wycena z estymowanym czasem",
        override: "Czas nadpisany (4 h 30 min)",
        outdated: "Nadpisany czas nieaktualny — ostrzeżenie z nową estymacją",
        rateWarning: "Stawka powyżej 500 zł/h — ostrzeżenie o literówce",
        catalogBars: "Szafka bez wbudowanych szyn PE/N — szyny z katalogu liczone jak aparaty",
        busbars:
          "Listwy zasilające: odcinki dwóch grup z jednej kupionej sztuki — sztuka wyceniona raz, każdy odcinek liczony jak aparat w robociźnie",
      },
      /** Captions for the layout section states; each is computed by the real `computeLayoutView`. */
      layoutStates: {
        placedMedium:
          "Rozmieszczony z przewodami, widok realistyczny (przełącznik w pozycji „realistyczny”) — szafka średnia (trzy rzędy, PE i N pionowo)",
        placedLarge: "Rozmieszczony z przewodami, widok realistyczny — szafka duża (pięć szyn, PE i N poziomo)",
        placedMediumSchematic:
          "Rozmieszczony z przewodami, widok schematyczny (przełącznik w pozycji „schematyczny”) — szafka średnia",
        placedOverflow:
          "Rozmieszczony z przewodami — przewody nie mieszczą się w kanałach bocznych (dwanaście obwodów 16 mm² od lewej, szafka duża): ostrzeżenie pod rysunkiem",
        placedTnC: "Rozmieszczony z przewodami — układ TN-C (PEN zamiast N i PE, obwody bez RCD)",
        placedNoBars:
          "Rozmieszczony z przewodami — szafka bez wbudowanych szyn PE/N (szyny PE i N dobrane z katalogu i umieszczone na szynie DIN)",
        placedBusbars:
          "Rozmieszczony z listwami zasilającymi 1F, widok realistyczny — dwie grupy zasilane z jednej sztuki, bez przewodów fazowych między RCD a MCB",
        placedBusbarsSchematic: "Rozmieszczony z listwami zasilającymi 1F, widok schematyczny",
        placedBusbarsThreePhase:
          "Rozmieszczony z listwą zasilającą 3F, widok realistyczny — grupa z RCD 4P, MCB 1P na fazach L1, L2 i L3 oraz MCB 3P",
        placedBusbarsThreePhaseSchematic: "Rozmieszczony z listwą zasilającą 3F, widok schematyczny",
        missing: "Nie zaproponowany",
        doesNotFit: "Nie mieści się",
        outdated: "Nieaktualny (zapisane aparaty nachodzą na siebie)",
        notCurrent: "Dobór nieaktualny — brak układu",
        editorManual: "Edytor: układ poprawiony ręcznie (znaczek „Poprawiony ręcznie”)",
        editorDirty: "Edytor: niezapisane zmiany — przewody i długości ukryte, przyciski zapisu aktywne",
        editorSelected: "Rysunek edytora: zaznaczony aparat (fokus)",
        editorLifted: "Rysunek edytora: podniesiony aparat (przenoszenie)",
        editorRefused: "Rysunek edytora: podniesiony aparat, upuszczenie odrzucone",
      },
      /** Fixture data and state captions for the circuit section; see `src/lib/kitchen-sink-circuits.ts`. */
      circuitFixtures: {
        manufacturer: "Przykładowy producent",
        cabinet: "Szafka przykładowa",
        circuits: {
          kitchen: "Gniazda kuchnia",
          living: "Gniazda salon",
          bathroom: "Łazienka",
          lighting: "Oświetlenie",
          oven: "Piekarnik",
          heater: "Podgrzewacz wody",
        },
        editorStates: {
          empty: "Pusty (brak obwodów)",
          filled: "Wypełniony: dwie grupy RCD i obwód bez grupy",
          singleCircuitGroup: "Grupa z jednym obwodem (podpowiedź RCBO)",
          invalidRow: "Błędny wiersz (pusta nazwa obwodu)",
          entrySideMissing: "Strona wprowadzenia, której szafka nie ma (lewo)",
        },
        matchStates: {
          matched: "Dobrane aparaty (z zamiennikiem RCD + MCB zamiast RCBO)",
          gaps: "Luki w katalogu",
          blockedSupply: "Zablokowane: brak parametrów przyłącza",
          blockedTnC: "Zablokowane: układ TN-C z grupą RCD",
          stale: "Nieaktualny zapisany dobór",
          warnings: "Ostrzeżenia obwodów (przekrój, strona wprowadzenia, brak szyn PE/N) i niezapisany podgląd",
          barGap: "Luka w katalogu: szafka bez szyn PE/N, a w katalogu brak pasującej szyny N",
          busbars:
            "Listwy zasilające: dwie grupy 1F cięte z jednej sztuki (wspólna cena sztuki), RCD + MCB zamiast RCBO",
          busbarsThreePhase: "Listwa zasilająca 3F: grupa z RCD 4P, MCB 1P i MCB 3P",
          busbarMissing:
            "Brak listwy w katalogu: grupa zachowuje przewody między RCD a MCB — informacja, nie luka w katalogu",
        },
      },
    },
  },

  config: {
    supabaseMissing: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    supabaseDocsLabel: "Zobacz instrukcję konfiguracji",
  },
};

export type Messages = typeof pl;
