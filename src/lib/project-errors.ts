import { NOT_CONFIGURED } from "@/lib/auth-errors";
import { t } from "@/lib/i18n";

/**
 * The `?error=<code>` values the project endpoints redirect with, and their Polish text. Same shape
 * as `src/lib/cabinet-errors.ts`: the URL carries a code, never Supabase's English `error.message`,
 * and an unrecognised code still reaches the URL (so it stays diagnosable) while the user sees a
 * generic message.
 */
export const PROJECT_ERROR = {
  /** `createClient()` returned null because the Supabase env vars are unset. */
  notConfigured: NOT_CONFIGURED,
  forbidden: "forbidden",
  notFound: "not_found",
  invalidInput: "invalid_input",
  /** The picked cabinet is archived or gone — the snapshot trigger found no active cabinet. */
  cabinetUnavailable: "cabinet_unavailable",
  unknown: "unknown",
} as const;

export type ProjectErrorCode = (typeof PROJECT_ERROR)[keyof typeof PROJECT_ERROR];

const MESSAGES: Record<ProjectErrorCode, string> = {
  [PROJECT_ERROR.notConfigured]: t.projectErrors.notConfigured,
  [PROJECT_ERROR.forbidden]: t.projectErrors.forbidden,
  [PROJECT_ERROR.notFound]: t.projectErrors.notFound,
  [PROJECT_ERROR.invalidInput]: t.projectErrors.invalidInput,
  [PROJECT_ERROR.cabinetUnavailable]: t.projectErrors.cabinetUnavailable,
  [PROJECT_ERROR.unknown]: t.projectErrors.unknown,
};

function isProjectErrorCode(code: string): code is ProjectErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

/** Maps an `?error=<code>` query param to display text. Returns null when absent. */
export function projectErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return isProjectErrorCode(code) ? MESSAGES[code] : t.projectErrors.unknown;
}

/**
 * Maps a PostgREST error to a code by its SQLSTATE, never by its message. An insert refused by RLS
 * raises `42501`; an update or delete RLS refuses matches zero rows instead, so callers must check
 * the returned rows too. A CHECK violation (`23514`) means the parser let through something the
 * database refuses. `P0002` is the snapshot trigger finding no active cabinet, and `23503` a
 * `cabinet_id` naming no cabinet at all — to the user both are a cabinet that is no longer
 * available. An unmapped SQLSTATE passes through as-is.
 */
export function projectErrorFromPostgrest(error: { code?: string | null }): string {
  switch (error.code) {
    case "42501":
      return PROJECT_ERROR.forbidden;
    case "23514":
      return PROJECT_ERROR.invalidInput;
    case "P0002":
    case "23503":
      return PROJECT_ERROR.cabinetUnavailable;
    default:
      return error.code ?? PROJECT_ERROR.unknown;
  }
}
