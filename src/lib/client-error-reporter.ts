import { buildClientErrorReport, type ClientErrorSource } from "@/lib/client-errors";

/** Browser-only: sends error reports to `POST /api/client-errors`. Pure logic is `createReportGate`. */

export const CLIENT_ERRORS_PATH = "/api/client-errors";
export const MAX_REPORTS_PER_PAGE = 5;

const PROJECT_PATH = /^\/dashboard\/projects\/([^/]+)/;

/**
 * Decides whether a report may be sent: one per distinct `source + message`, and at most `max` in total.
 * Each call that returns true consumes a slot.
 */
export function createReportGate(max: number = MAX_REPORTS_PER_PAGE): (source: string, message: string) => boolean {
  const seen = new Set<string>();
  return (source, message) => {
    const key = `${source}\u0000${message}`;
    if (seen.has(key) || seen.size >= max) return false;
    seen.add(key);
    return true;
  };
}

const allow = createReportGate();

function send(body: string): void {
  if (typeof navigator.sendBeacon === "function") {
    if (navigator.sendBeacon(CLIENT_ERRORS_PATH, new Blob([body], { type: "application/json" }))) return;
  }
  void fetch(CLIENT_ERRORS_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Reports a caught browser error. Never throws and never reports the same error twice in one page
 * load. `path` and `projectId` default to the current location.
 */
export function reportClientError(
  source: ClientErrorSource,
  error: unknown,
  extra: { path?: string; projectId?: string | null; component?: string } = {},
): void {
  try {
    const path = extra.path ?? window.location.pathname;
    const projectId = extra.projectId ?? PROJECT_PATH.exec(path)?.[1] ?? null;
    const report = buildClientErrorReport(source, error, { ...extra, path, projectId });
    if (!allow(report.source, report.message)) return;
    send(JSON.stringify(report));
  } catch {
    // Reporting must never raise a second error.
  }
}

let installed = false;

/** Installs the `window` `error` and `unhandledrejection` listeners once. Call on signed-in pages only. */
export function installClientErrorHandlers(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (event) => {
    reportClientError("window", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError("rejection", event.reason);
  });
}
