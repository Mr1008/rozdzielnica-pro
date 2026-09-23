import { plural } from "./format";

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

  config: {
    supabaseMissing: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    supabaseDocsLabel: "Zobacz instrukcję konfiguracji",
  },
};

export type Messages = typeof pl;
