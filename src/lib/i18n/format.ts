/**
 * Locale-aware formatting primitives.
 *
 * Intl constructors are expensive, so every formatter is built once at module
 * scope and reused. This matters on Cloudflare Workers, where each invocation
 * has a 10ms CPU ceiling.
 */

export const LOCALE = "pl-PL";
export const CURRENCY = "PLN";

const currencyFormat = new Intl.NumberFormat(LOCALE, { style: "currency", currency: CURRENCY });
const decimalFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });
const pluralRules = new Intl.PluralRules(LOCALE);

/**
 * Polish has three plural forms for integers (1 aparat / 2 aparaty / 5 aparatów)
 * plus a fourth for fractions (1,5 aparatu). `other` falls back to `many`.
 */
export interface PluralForms {
  one: string;
  few: string;
  many: string;
  other?: string;
}

export function plural(count: number, forms: PluralForms): string {
  switch (pluralRules.select(count)) {
    case "one":
      return forms.one;
    case "few":
      return forms.few;
    case "many":
      return forms.many;
    default:
      return forms.other ?? forms.many;
  }
}

/** `1234.5` -> `1234,50 zł` */
export function formatMoney(value: number): string {
  return currencyFormat.format(value);
}

/** `1234.567` -> `1234,57` */
export function formatNumber(value: number): string {
  return decimalFormat.format(value);
}

/**
 * Datetimes are stored and processed in UTC; the local timezone is applied
 * only here, at the edge of the system.
 */
export function formatDate(value: Date | string): string {
  return dateFormat.format(toDate(value));
}

export function formatDateTime(value: Date | string): string {
  return dateTimeFormat.format(toDate(value));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
