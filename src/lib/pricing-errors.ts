import { NOT_CONFIGURED } from "@/lib/auth-errors";
import { t } from "@/lib/i18n";

/**
 * The `?error=<code>` values the pricing-profile endpoint redirects with, and their Polish text.
 * Same shape as `src/lib/device-errors.ts`: the URL carries a code, never Supabase's English
 * `error.message`, and an unrecognised code still reaches the URL (so it stays diagnosable) while
 * the user sees a generic message.
 */
export const PRICING_ERROR = {
  /** `createClient()` returned null because the Supabase env vars are unset. */
  notConfigured: NOT_CONFIGURED,
  forbidden: "forbidden",
  invalidInput: "invalid_input",
  unknown: "unknown",
} as const;

export type PricingErrorCode = (typeof PRICING_ERROR)[keyof typeof PRICING_ERROR];

const MESSAGES: Record<PricingErrorCode, string> = {
  [PRICING_ERROR.notConfigured]: t.pricingErrors.notConfigured,
  [PRICING_ERROR.forbidden]: t.pricingErrors.forbidden,
  [PRICING_ERROR.invalidInput]: t.pricingErrors.invalidInput,
  [PRICING_ERROR.unknown]: t.pricingErrors.unknown,
};

function isPricingErrorCode(code: string): code is PricingErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

/** Maps an `?error=<code>` query param to display text. Returns null when absent. */
export function pricingErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return isPricingErrorCode(code) ? MESSAGES[code] : t.pricingErrors.unknown;
}

/**
 * Maps a PostgREST error to a code by its SQLSTATE, never by its message. Unlike an `update`, an
 * upsert refused by the RLS `with check` comes back as `42501` rather than as zero rows, so that is
 * `forbidden`; a bounds CHECK violation (`23514`) means the parser let through something the
 * database refuses, which the user sees as invalid input. An unmapped SQLSTATE passes through as-is.
 */
export function pricingErrorFromPostgrest(error: { code?: string | null }): string {
  switch (error.code) {
    case "42501":
      return PRICING_ERROR.forbidden;
    case "23514":
      return PRICING_ERROR.invalidInput;
    default:
      return error.code ?? PRICING_ERROR.unknown;
  }
}
