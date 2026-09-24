import { NOT_CONFIGURED } from "@/lib/auth-errors";
import { t } from "@/lib/i18n";

/**
 * The `?error=<code>` values the device endpoints redirect with, and their Polish text. Same shape
 * as `src/lib/cabinet-errors.ts`: the URL carries a code, never Supabase's English `error.message`,
 * and an unrecognised code still reaches the URL (so it stays diagnosable) while the user sees a
 * generic message.
 */
export const DEVICE_ERROR = {
  /** `createClient()` returned null because the Supabase env vars are unset. */
  notConfigured: NOT_CONFIGURED,
  forbidden: "forbidden",
  notFound: "not_found",
  duplicateModel: "duplicate_model",
  invalidInput: "invalid_input",
  unknown: "unknown",
} as const;

export type DeviceErrorCode = (typeof DEVICE_ERROR)[keyof typeof DEVICE_ERROR];

const MESSAGES: Record<DeviceErrorCode, string> = {
  [DEVICE_ERROR.notConfigured]: t.deviceErrors.notConfigured,
  [DEVICE_ERROR.forbidden]: t.deviceErrors.forbidden,
  [DEVICE_ERROR.notFound]: t.deviceErrors.notFound,
  [DEVICE_ERROR.duplicateModel]: t.deviceErrors.duplicateModel,
  [DEVICE_ERROR.invalidInput]: t.deviceErrors.invalidInput,
  [DEVICE_ERROR.unknown]: t.deviceErrors.unknown,
};

function isDeviceErrorCode(code: string): code is DeviceErrorCode {
  return Object.hasOwn(MESSAGES, code);
}

/** Maps an `?error=<code>` query param to display text. Returns null when absent. */
export function deviceErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return isDeviceErrorCode(code) ? MESSAGES[code] : t.deviceErrors.unknown;
}

/**
 * Maps a PostgREST error to a code by its SQLSTATE, never by its message. A write RLS silently
 * refuses is not an error at all — it affects zero rows — so callers must check the returned rows
 * too; this only covers what does come back as an error. An unmapped SQLSTATE passes through as-is,
 * so the URL stays diagnosable; `deviceErrorMessage` shows the generic text for it.
 */
export function deviceErrorFromPostgrest(error: { code?: string | null }): string {
  switch (error.code) {
    case "23505":
      return DEVICE_ERROR.duplicateModel;
    case "42501":
      return DEVICE_ERROR.forbidden;
    default:
      return error.code ?? DEVICE_ERROR.unknown;
  }
}
