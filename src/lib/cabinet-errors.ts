import { NOT_CONFIGURED } from "@/lib/auth-errors";
import { t } from "@/lib/i18n";

/**
 * The `?error=<code>` values the cabinet endpoints redirect with, and their Polish text. Same shape
 * as `src/lib/auth-errors.ts`: the URL carries a code, never Supabase's English `error.message`, and
 * an unrecognised code still reaches the URL (so it stays diagnosable) while the user sees a generic
 * message.
 */
export const CABINET_ERROR = {
  /** `createClient()` returned null because the Supabase env vars are unset. */
  notConfigured: NOT_CONFIGURED,
  forbidden: "forbidden",
  notFound: "not_found",
  duplicateModel: "duplicate_model",
  invalidInput: "invalid_input",
  unknown: "unknown",
} as const;

export type CabinetErrorCode = (typeof CABINET_ERROR)[keyof typeof CABINET_ERROR];

const MESSAGES: Record<CabinetErrorCode, string> = {
  [CABINET_ERROR.notConfigured]: t.cabinetErrors.notConfigured,
  [CABINET_ERROR.forbidden]: t.cabinetErrors.forbidden,
  [CABINET_ERROR.notFound]: t.cabinetErrors.notFound,
  [CABINET_ERROR.duplicateModel]: t.cabinetErrors.duplicateModel,
  [CABINET_ERROR.invalidInput]: t.cabinetErrors.invalidInput,
  [CABINET_ERROR.unknown]: t.cabinetErrors.unknown,
};

function isCabinetErrorCode(code: string): code is CabinetErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

/** Maps an `?error=<code>` query param to display text. Returns null when absent. */
export function cabinetErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return isCabinetErrorCode(code) ? MESSAGES[code] : t.cabinetErrors.unknown;
}

/**
 * Maps a PostgREST error to a code by its SQLSTATE, never by its message. A write RLS silently
 * refuses is not an error at all — it affects zero rows — so callers must check the returned rows
 * too; this only covers what does come back as an error. An unmapped SQLSTATE passes through as-is,
 * so the URL stays diagnosable; `cabinetErrorMessage` shows the generic text for it.
 */
export function cabinetErrorFromPostgrest(error: { code?: string | null }): string {
  switch (error.code) {
    case "23505":
      return CABINET_ERROR.duplicateModel;
    case "42501":
      return CABINET_ERROR.forbidden;
    default:
      return error.code ?? CABINET_ERROR.unknown;
  }
}
