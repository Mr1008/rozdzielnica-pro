import { t } from "@/lib/i18n";

/**
 * Supabase returns English prose in `error.message`. Forwarding it to the UI
 * leaks untranslated text and couples our copy to their wording, so the auth
 * API routes redirect with `error.code` instead and this maps the code to our
 * own message.
 *
 * An unrecognised code still reaches the URL verbatim, which keeps it
 * diagnosable, while the user sees a generic Polish message rather than a raw
 * identifier.
 */

/** Used when `createClient()` returns null because the env vars are unset. */
export const NOT_CONFIGURED = "not_configured";

/**
 * Used when a signed-in user's token carries no recognised `user_role` claim, so the route gate in
 * `src/lib/route-access.ts` refuses every protected route. Only an admin can fix it, hence the
 * message — the account exists but has no role attached.
 */
export const NO_ROLE = "no_role";

const MESSAGES: Record<string, string> = {
  [NOT_CONFIGURED]: t.authErrors.notConfigured,
  [NO_ROLE]: t.authErrors.noRole,
  invalid_credentials: t.authErrors.invalidCredentials,
  email_not_confirmed: t.authErrors.emailNotConfirmed,
  user_already_exists: t.authErrors.userAlreadyExists,
  email_exists: t.authErrors.userAlreadyExists,
  weak_password: t.authErrors.weakPassword,
  over_request_rate_limit: t.authErrors.rateLimited,
  over_email_send_rate_limit: t.authErrors.rateLimited,
};

/** Maps an `?error=<code>` query param to display text. Returns null when absent. */
export function authErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? t.authErrors.unknown;
}

/** Supabase Auth codes that mean "the user did something wrong" — derived from `MESSAGES`, so the two cannot drift. */
const USER_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.keys(MESSAGES).filter((code) => code !== NOT_CONFIGURED && code !== NO_ROLE),
);

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readStatus(source: Record<string, unknown>): number | undefined {
  const value = source.status;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * True when Supabase Auth itself is failing (5xx, unreachable, a hook error, an unmapped code), false
 * when the user did something wrong (a mapped code) or simply has no session. Routes log only the
 * former; the middleware uses it to tell an outage from a missing session. Never throws.
 */
export function isAuthInfraError(error: unknown): boolean {
  try {
    const source: Record<string, unknown> =
      typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
    if (readString(source, "name") === "AuthSessionMissingError") return false;
    const status = readStatus(source);
    if (status !== undefined && status >= 500) return true;
    const code = readString(source, "code");
    // `AuthRetryableFetchError` (status 0/absent), `unexpected_failure`, `hook_*` and every other
    // unmapped or absent code fall through to infrastructure.
    return code === undefined || !USER_ERROR_CODES.has(code);
  } catch {
    return true;
  }
}

/** The only fields of an auth error that may be logged — never the message or the email it quotes. */
export interface AuthErrorRecord {
  code: string;
  name: string;
  status: number | null;
  [key: string]: string | number | null | undefined;
}

/** Reduces an auth error to `{ code, name, status }`; safe to pass to `logServerError`. */
export function authErrorRecord(error: unknown): AuthErrorRecord {
  try {
    const source: Record<string, unknown> =
      typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
    return {
      code: readString(source, "code") ?? "none",
      name: readString(source, "name") ?? "UnknownError",
      status: readStatus(source) ?? null,
    };
  } catch {
    return { code: "none", name: "UnknownError", status: null };
  }
}
