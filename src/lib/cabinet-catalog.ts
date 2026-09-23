import { LOCALE } from "@/lib/i18n";

/** The admin catalog list — where every cabinet write redirects back to. */
export const CABINETS_PATH = "/admin/cabinets";

export function cabinetEditPath(id: string): string {
  return `${CABINETS_PATH}/${id}`;
}

export const NEW_CABINET_PATH = `${CABINETS_PATH}/new`;

/** The list page with an `?error=<code>` banner. */
export function cabinetsErrorPath(code: string): string {
  return `${CABINETS_PATH}?error=${encodeURIComponent(code)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checked before an id reaches PostgREST: a non-UUID would fail there as SQLSTATE `22P02` and read
 * as an unknown error, when to the user it is simply a cabinet that does not exist.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Active cabinets first, then by name in Polish collation. Returns a new array. */
export function sortForCatalogList<T extends { name: string; archived_at: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => Number(a.archived_at !== null) - Number(b.archived_at !== null) || a.name.localeCompare(b.name, LOCALE),
  );
}
