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
