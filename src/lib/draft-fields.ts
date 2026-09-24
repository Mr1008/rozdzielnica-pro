import { z } from "zod";

/**
 * Helpers shared by the admin editors' drafts (cabinets, devices): numbers are kept as the string
 * the admin typed, so a half-typed or emptied field never snaps to 0, and list items carry a
 * client-side key for React.
 */

let nextKey = 0;

/**
 * A client-side identity for a list item (a rail, an entry, a terminal group …), used as its React
 * `key` so a removal does not hand one item's DOM node (and focus) to the next. Never submitted.
 */
export function newDraftKey(): string {
  nextKey += 1;
  return `d${String(nextKey)}`;
}

/**
 * The key of a restored draft item. Every restored item is re-keyed: the counter restarts on each
 * page load, so a stored key could collide with one minted later, and a draft stored before keys
 * existed has none.
 */
export const draftKeySchema = z
  .string()
  .optional()
  .transform(() => newDraftKey());

const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

/**
 * A typed field to a number: `","` and `"."` both mark decimals; anything else — empty, `1e3`,
 * `12 mm` — is `NaN`, which the validators report as an issue on that field.
 */
export function numberFromField(value: string): number {
  const trimmed = value.trim();
  return PLAIN_NUMBER.test(trimmed) ? Number(trimmed.replace(",", ".")) : Number.NaN;
}

/** Decimals are shown with a comma, like everywhere else in the Polish UI. */
export function fieldFromNumber(value: number): string {
  return String(value).replace(".", ",");
}
