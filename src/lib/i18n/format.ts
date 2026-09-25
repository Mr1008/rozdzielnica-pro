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
/**
 * The zone used when the request carries none (local preview, tests) or an unusable one. The MVP
 * targets Polish electricians, so it is the likeliest right answer — never UTC, which on Workers is
 * the runtime default and would show a late-evening change under the next day.
 */
export const DEFAULT_TIME_ZONE = "Europe/Warsaw";
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
 * The viewer's IANA time zone from an untrusted value (Cloudflare's `request.cf.timezone`, geolocated
 * from the IP), or `DEFAULT_TIME_ZONE` when it is missing or not a zone this runtime knows.
 */
export function resolveTimeZone(raw: unknown): string {
  if (typeof raw !== "string" || raw === "") return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat(LOCALE, { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

// One formatter per zone, built on first use: a request's zone is only known at request time, and
// the set of IANA zones is finite, so the cache stays bounded.
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

function cached(cache: Map<string, Intl.DateTimeFormat>, timeZone: string, options: Intl.DateTimeFormatOptions) {
  let format = cache.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(LOCALE, { ...options, timeZone });
    cache.set(timeZone, format);
  }
  return format;
}

/**
 * Datetimes are stored and processed in UTC; the viewer's time zone is applied only here, at the
 * edge of the system. `timeZone` is required on purpose — pass `Astro.locals.timeZone`, resolved once
 * per request in `src/middleware.ts` — so no call site silently formats in the runtime's UTC.
 */
export function formatDate(value: Date | string, timeZone: string): string {
  return cached(dateFormats, timeZone, { dateStyle: "medium" }).format(toDate(value));
}

export function formatDateTime(value: Date | string, timeZone: string): string {
  return cached(dateTimeFormats, timeZone, { dateStyle: "medium", timeStyle: "short" }).format(toDate(value));
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
