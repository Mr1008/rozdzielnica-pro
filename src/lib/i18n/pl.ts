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
    description: "Tu powstanie katalog aparatów i katalog szafek rozdzielnic.",
    restricted: "Ta strona jest dostępna tylko dla administratorów.",
  },

  config: {
    supabaseMissing: "Supabase nie jest skonfigurowany — funkcje uwierzytelniania są wyłączone.",
    supabaseDocsLabel: "Zobacz instrukcję konfiguracji",
  },
};

export type Messages = typeof pl;
