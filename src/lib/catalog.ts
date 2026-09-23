import { LOCALE } from "@/lib/i18n";

/** Helpers shared by the admin catalogs (cabinets, devices) — nothing here is catalog-specific. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checked before an id reaches PostgREST: a non-UUID would fail there as SQLSTATE `22P02` and read
 * as an unknown error, when to the user it is simply a catalog row that does not exist.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Active rows first, then by name in Polish collation. Returns a new array. */
export function sortForCatalogList<T extends { name: string; archived_at: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) => Number(a.archived_at !== null) - Number(b.archived_at !== null) || a.name.localeCompare(b.name, LOCALE),
  );
}
