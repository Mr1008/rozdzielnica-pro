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
 * A class 22 message has its quoted input masked, and the hint is truncated like the message.
 * An empty code is a transport failure (`"transport"`); a missing one is `"none"`.
 */
export function serverErrorRecord(event: string, error: unknown, context: ServerLogContext = {}): ServerErrorRecord {
  const source: Record<string, unknown> =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const rawCode = stringField(source, "code");
  const hint = stringField(source, "hint");
  const rawMessage = stringField(source, "message") ?? (typeof error === "string" ? error : "");
  // Class 22 (data exception) messages quote the offending input: `invalid input syntax for type uuid: "…"`.
  const message = rawCode?.startsWith("22") ? rawMessage.replace(/"[^"]*"/g, '"…"') : rawMessage;

  const record: ServerErrorRecord = {
    event,
    code: rawCode === undefined ? "none" : rawCode === "" ? "transport" : rawCode,
    name: stringField(source, "name") ?? "UnknownError",
    message: truncate(message),
  };
  if (hint) record.hint = truncate(hint);
  if (error instanceof Error && error.stack) record.stack = error.stack;

  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined && !(key in record)) record[key] = value;
  }
  return record;
}

/**
 * Logs one structured record through `console.error` so Workers Logs keeps its fields filterable.
 * Never throws: it runs inside failure branches and `catch` blocks, where a throw would turn a
 * handled failure into a 500.
 */
export function logServerError(event: string, error: unknown, context?: ServerLogContext): void {
  let record: ServerErrorRecord;
  try {
    record = serverErrorRecord(event, error, context);
  } catch {
    record = { event, code: "none", name: "UnknownError", message: "error could not be read" };
  }
  // eslint-disable-next-line no-console
  console.error(record);
}

function logLevel(level: "warn" | "info", event: string, fields?: ServerLogContext): void {
  let record: Record<string, string | number | null | undefined>;
  try {
    record = { event, level };
    for (const [key, value] of Object.entries(fields ?? {})) {
      if (value !== undefined && !(key in record)) record[key] = typeof value === "string" ? truncate(value) : value;
    }
  } catch {
    record = { event, level };
  }
  try {
    // eslint-disable-next-line no-console
    console[level](record);
  } catch {
    // Logging must never turn a handled path into a failure.
  }
}

/** Records an expected-but-interesting event (a validation refusal, a match outcome) at warn level. Never throws. */
export function logServerWarn(event: string, fields?: ServerLogContext): void {
  logLevel("warn", event, fields);
}

/** Records a routine event at info level. Never throws. */
export function logServerInfo(event: string, fields?: ServerLogContext): void {
  logLevel("info", event, fields);
}
