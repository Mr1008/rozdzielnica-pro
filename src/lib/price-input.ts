/** The catalog price field: what the admin types in a form and how a stored price pre-fills it. */

/** `price_grosze` is a Postgres `integer`. */
export const MAX_PRICE_GROSZE = 2_147_483_647;

/** Whole złote, optionally followed by `,` or `.` and one or two digits of grosze. */
const PRICE = /^(\d+)(?:[.,](\d{1,2}))?$/;

/**
 * The same shape as `PRICE`, for an `<input pattern>` (which the browser anchors itself). It checks
 * the format only — zero and the integer ceiling are still the parser's to refuse. Keep the two in
 * step; `price-input.test.ts` asserts they agree.
 */
export const PRICE_INPUT_PATTERN = String.raw`\d+(?:[.,]\d{1,2})?`;

/**
 * A PLN amount as typed by the admin (`"249,99"`, `"249.9"`, `"12"`) to integer grosze, or null
 * when it is not a plain positive amount. Deliberately strict: no thousands separators, no currency
 * sign, no third decimal — so `formatMoney` output is rejected; pre-fill with `formatPriceInput`.
 */
export function parsePriceGrosze(raw: string): number | null {
  const match = PRICE.exec(raw.trim());
  if (!match) return null;
  const [, zlote, grosze = ""] = match;
  const value = Number(zlote) * 100 + Number(grosze.padEnd(2, "0"));
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_PRICE_GROSZE) return null;
  return value;
}

/** `123456` → `"1234,56"`: a plain decimal `parsePriceGrosze` accepts, for pre-filling the form. */
export function formatPriceInput(grosze: number): string {
  const zlote = Math.floor(grosze / 100);
  const rest = grosze % 100;
  return `${String(zlote)},${String(rest).padStart(2, "0")}`;
}
