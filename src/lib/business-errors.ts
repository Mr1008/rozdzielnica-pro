import { NOT_CONFIGURED } from "@/lib/auth-errors";
import { t } from "@/lib/i18n";

/**
 * The `?businessError=<code>` values the company-details endpoint redirects with, and their Polish
 * text. Same shape as `src/lib/pricing-errors.ts`: the URL carries a code, never Supabase's English
 * `error.message`, and an unrecognised code still reaches the URL (so it stays diagnosable) while
 * the user sees a generic message. The param is separate from the pricing card's `error`, so the two
 * cards on the profile page report independently.
 */
export const BUSINESS_ERROR = {
  /** `createClient()` returned null because the Supabase env vars are unset. */
  notConfigured: NOT_CONFIGURED,
  forbidden: "forbidden",
  invalidInput: "invalid_input",
  unknown: "unknown",
} as const;

export type BusinessErrorCode = (typeof BUSINESS_ERROR)[keyof typeof BUSINESS_ERROR];

const MESSAGES: Record<BusinessErrorCode, string> = {
  [BUSINESS_ERROR.notConfigured]: t.businessErrors.notConfigured,
  [BUSINESS_ERROR.forbidden]: t.businessErrors.forbidden,
  [BUSINESS_ERROR.invalidInput]: t.businessErrors.invalidInput,
  [BUSINESS_ERROR.unknown]: t.businessErrors.unknown,
};

function isBusinessErrorCode(code: string): code is BusinessErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

/** Maps a `?businessError=<code>` query param to display text. Returns null when absent. */
export function businessErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return isBusinessErrorCode(code) ? MESSAGES[code] : t.businessErrors.unknown;
}

/**
 * Maps a PostgREST error to a code by its SQLSTATE, never by its message: `42501` is an RLS refusal
 * of the upsert, `23514` a CHECK violation the parser let through (seen as invalid input). An
 * unmapped SQLSTATE passes through as-is.
 */
export function businessErrorFromPostgrest(error: { code?: string | null }): string {
  switch (error.code) {
    case "42501":
      return BUSINESS_ERROR.forbidden;
    case "23514":
      return BUSINESS_ERROR.invalidInput;
    default:
      return error.code ?? BUSINESS_ERROR.unknown;
  }
}
