import type { Tables } from "@/lib/database.types";
import { formatPriceInput, parsePriceGrosze } from "@/lib/price-input";

/**
 * An electrician's pricing profile (FR-010): the three quote parameters as the profile form types
 * them, and the `pricing_profiles` row shape they turn into. Units are integers everywhere — grosze
 * and whole minutes — so nothing downstream rounds a float.
 *
 * The bounds below mirror the named CHECKs in
 * `supabase/migrations/20260924120000_pricing_profiles.sql`. Change one, change the other: the
 * parser must reject exactly what the database rejects. The rate's ceiling is `MAX_PRICE_GROSZE`,
 * enforced by `parsePriceGrosze`.
 */

export const MIN_MOUNT_MINUTES = 1;
export const MAX_MOUNT_MINUTES = 600;
export const MIN_OVERHEAD_MINUTES = 0;
export const MAX_OVERHEAD_MINUTES = 6000;

/** The profile page and the endpoint its form posts to. */
export const PRICING_PROFILE_PATH = "/dashboard/profile";
export const PRICING_API_PATH = "/api/profile/pricing";

/** The form field names, shared by the page's inputs and the parser. */
export const PRICING_FIELDS = {
  hourlyRate: "hourly_rate",
  mountMinutes: "mount_minutes_per_device",
  overheadMinutes: "project_overhead_minutes",
} as const;

export interface PricingProfile {
  hourly_rate_grosze: number;
  mount_minutes_per_device: number;
  project_overhead_minutes: number;
}

export type PricingFormResult = { ok: true; value: PricingProfile } | { ok: false; code: "invalid_input" };

/**
 * Whole minutes: digits, optionally with a zero fraction (`15.0`) because a `type="number"` input
 * submits that as typed. No sign, no comma, no exponent and no real fraction — `Number()` would
 * accept all of them.
 */
const WHOLE_MINUTES = /^\d+(?:\.0+)?$/;

function readText(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

function parseMinutes(raw: string | null, min: number, max: number): number | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!WHOLE_MINUTES.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < min || value > max) return null;
  return value;
}

/**
 * The three form strings to the row shape, or `invalid_input` when any of them is missing or out of
 * range. Never throws. A single code is enough: the page's native constraints stop almost every bad
 * value before submit, so a server rejection means a tampered or scripted POST.
 */
export function parsePricingForm(form: FormData): PricingFormResult {
  const rateRaw = readText(form, PRICING_FIELDS.hourlyRate);
  const hourlyRate = rateRaw === null ? null : parsePriceGrosze(rateRaw);
  const mountMinutes = parseMinutes(readText(form, PRICING_FIELDS.mountMinutes), MIN_MOUNT_MINUTES, MAX_MOUNT_MINUTES);
  const overheadMinutes = parseMinutes(
    readText(form, PRICING_FIELDS.overheadMinutes),
    MIN_OVERHEAD_MINUTES,
    MAX_OVERHEAD_MINUTES,
  );

  if (hourlyRate === null || mountMinutes === null || overheadMinutes === null) {
    return { ok: false, code: "invalid_input" };
  }
  return {
    ok: true,
    value: {
      hourly_rate_grosze: hourlyRate,
      mount_minutes_per_device: mountMinutes,
      project_overhead_minutes: overheadMinutes,
    },
  };
}

export interface PricingFormDefaults {
  hourly_rate: string;
  mount_minutes_per_device: string;
  project_overhead_minutes: string;
}

/**
 * The input values for the profile form: a stored row pre-filled in a shape `parsePricingForm`
 * accepts unchanged (the rate as `"120,50"`), or empty strings when nothing is configured yet.
 */
export function pricingFormDefaults(
  row: Pick<Tables<"pricing_profiles">, keyof PricingProfile> | null,
): PricingFormDefaults {
  if (row === null) {
    return { hourly_rate: "", mount_minutes_per_device: "", project_overhead_minutes: "" };
  }
  return {
    hourly_rate: formatPriceInput(row.hourly_rate_grosze),
    mount_minutes_per_device: String(row.mount_minutes_per_device),
    project_overhead_minutes: String(row.project_overhead_minutes),
  };
}
