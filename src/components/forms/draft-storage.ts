import type { z } from "zod";

/**
 * Draft storage for the admin editors: a server-side rejection (e.g. a duplicate model) reloads the
 * page, so the editor stores its draft on submit and restores it only when the page comes back with
 * `?error=`. Storage can be unavailable (private mode, quota, no `window`), so every access is
 * guarded and a failure simply means the draft is not kept.
 */

/** A stored draft that does not match `schema` (stale shape, tampering) is treated as absent. */
export function readStoredDraft<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (raw === null) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStoredDraft(key: string, draft: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Without storage the draft is simply not kept across an error redirect.
  }
}

export function clearStoredDraft(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
