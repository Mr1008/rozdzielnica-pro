/** Helpers shared by the admin catalogs (cabinets, devices) — nothing here is catalog-specific. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checked before an id reaches PostgREST: a non-UUID would fail there as SQLSTATE `22P02` and read
 * as an unknown error, when to the user it is simply a catalog row that does not exist.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}
