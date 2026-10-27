import type { APIRoute } from "astro";
import { parseClientErrorReport } from "@/lib/client-errors";
import { logServerError } from "@/lib/server-log";

/** The most of a beacon body that is read; a real report is well under 4 KB. */
const MAX_BODY_BYTES = 8 * 1024;

/** The body as text, or null when it is longer than `MAX_BODY_BYTES`. Never throws. */
async function readCappedText(request: Request): Promise<string | null> {
  try {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
    if (!request.body) return "";
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch {
    return null;
  }
}

/**
 * Receives a browser error report (`navigator.sendBeacon`, a `text/plain` or `application/json` Blob)
 * and writes it to Workers Logs as `client.<source>`. Always answers 204: a malformed, oversized or
 * hostile body is dropped silently, and the browser never retries or shows anything.
 * `/api/client-errors` is gated to signed-in users in `src/lib/route-access.ts`.
 */
export const POST: APIRoute = async (context) => {
  const done = new Response(null, { status: 204 });
  const text = await readCappedText(context.request);
  if (text === null) return done;

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return done;
  }
  const parsed = parseClientErrorReport(body);
  if (!parsed.ok) return done;

  const { report } = parsed;
  // The browser's message and stack are plain data, not an `Error` of this runtime, so they ride as
  // context fields; `serverErrorRecord` only takes a `stack` from a real `Error` instance.
  logServerError(
    `client.${report.source}`,
    { name: "ClientError", message: report.message },
    {
      userId: context.locals.user?.id ?? null,
      projectId: report.projectId ?? null,
      path: report.path,
      stack: report.stack === "" ? undefined : report.stack,
      component: report.component,
    },
  );
  return done;
};
