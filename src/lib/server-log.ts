/** Extra, non-sensitive fields attached to a log record. */
export interface ServerLogContext {
  userId?: string | null;
  projectId?: string | null;
  [key: string]: string | number | null | undefined;
}

export interface ServerErrorRecord {
  event: string;
  /** SQLSTATE / PostgREST code; `"transport"` for an empty code, `"none"` when absent. */
  code: string;
  name: string;
  hint?: string;
  message: string;
  stack?: string;
  [key: string]: string | number | null | undefined;
}

const MAX_MESSAGE_LENGTH = 200;

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function truncate(message: string): string {
  return message.length > MAX_MESSAGE_LENGTH ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…` : message;
}

/**
 * Turns any caught value into a privacy-safe, JSON-serialisable log record. Reads only `code`,
 * `name`, `hint`, `message` (truncated) and, for an `Error`, `stack`. It never reads `details` —
 * PostgREST echoes row values there (`Key (email)=(…)`) — and never spreads the error object.
 * An empty code is a transport failure (`"transport"`); a missing one is `"none"`.
 */
export function serverErrorRecord(event: string, error: unknown, context: ServerLogContext = {}): ServerErrorRecord {
  const source: Record<string, unknown> =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const rawCode = stringField(source, "code");
  const hint = stringField(source, "hint");
  const message = stringField(source, "message") ?? (typeof error === "string" ? error : "");

  const record: ServerErrorRecord = {
    event,
    code: rawCode === undefined ? "none" : rawCode === "" ? "transport" : rawCode,
    name: stringField(source, "name") ?? "UnknownError",
    message: truncate(message),
  };
  if (hint) record.hint = hint;
  if (error instanceof Error && error.stack) record.stack = error.stack;

  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && !(key in record)) record[key] = value;
  }
  return record;
}

/** Logs one structured record through `console.error` so Workers Logs keeps its fields filterable. */
export function logServerError(event: string, error: unknown, context?: ServerLogContext): void {
  // eslint-disable-next-line no-console
  console.error(serverErrorRecord(event, error, context));
}
