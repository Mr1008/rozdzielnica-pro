import { isUuid } from "@/lib/catalog";

export const CLIENT_ERROR_SOURCES = ["boundary", "window", "rejection", "wiring"] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

export const MAX_CLIENT_MESSAGE_LENGTH = 200;
export const MAX_CLIENT_STACK_LENGTH = 2048;
export const MAX_CLIENT_PATH_LENGTH = 200;
export const MAX_CLIENT_COMPONENT_LENGTH = 100;

/** A bounded browser error report: the shape the reporter sends and the endpoint logs. */
export interface ClientErrorReport {
  source: ClientErrorSource;
  message: string;
  stack: string;
  path: string;
  projectId?: string;
  /** The React island a boundary caught the error in. */
  component?: string;
}

export type ParsedClientErrorReport = { ok: true; report: ClientErrorReport } | { ok: false };

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function isSource(value: unknown): value is ClientErrorSource {
  return typeof value === "string" && (CLIENT_ERROR_SOURCES as readonly string[]).includes(value);
}

/**
 * Turns an untrusted browser report into a bounded record. Overlong strings are truncated, unknown
 * keys dropped; a non-object body, an unknown source or a non-string message/stack/path is refused.
 * `stack` and `path` are optional on input and default to an empty string.
 */
export function parseClientErrorReport(body: unknown): ParsedClientErrorReport {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false };
  const input = body as Record<string, unknown>;
  if (!isSource(input.source) || typeof input.message !== "string") return { ok: false };
  if (input.stack !== undefined && typeof input.stack !== "string") return { ok: false };
  if (input.path !== undefined && typeof input.path !== "string") return { ok: false };
  if (input.component !== undefined && typeof input.component !== "string") return { ok: false };

  const report: ClientErrorReport = {
    source: input.source,
    message: cap(input.message, MAX_CLIENT_MESSAGE_LENGTH),
    stack: cap(input.stack ?? "", MAX_CLIENT_STACK_LENGTH),
    path: cap(input.path ?? "", MAX_CLIENT_PATH_LENGTH),
  };
  if (isUuid(input.projectId)) report.projectId = input.projectId;
  if (input.component) report.component = cap(input.component, MAX_CLIENT_COMPONENT_LENGTH);
  return { ok: true, report };
}

/** Builds a report in the browser from a caught value; the result passes `parseClientErrorReport` unchanged. */
export function buildClientErrorReport(
  source: ClientErrorSource,
  error: unknown,
  extra: { path?: string; projectId?: string | null; component?: string } = {},
): ClientErrorReport {
  const isError = error instanceof Error;
  const rawMessage = isError ? error.message : typeof error === "string" ? error : "";
  const report: ClientErrorReport = {
    source,
    message: cap(rawMessage, MAX_CLIENT_MESSAGE_LENGTH),
    stack: cap(isError ? (error.stack ?? "") : "", MAX_CLIENT_STACK_LENGTH),
    path: cap(extra.path ?? "", MAX_CLIENT_PATH_LENGTH),
  };
  if (isUuid(extra.projectId)) report.projectId = extra.projectId;
  if (extra.component) report.component = cap(extra.component, MAX_CLIENT_COMPONENT_LENGTH);
  return report;
}
