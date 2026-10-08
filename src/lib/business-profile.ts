import type { Tables } from "@/lib/database.types";

/**
 * An electrician's company details (FR-012): the five fields the printed quote shows in its header,
 * as the profile form types them, and the `business_profiles` row shape they turn into. Every field
 * is optional: empty input becomes `null`.
 *
 * The bounds below mirror the named CHECKs in
 * `supabase/migrations/20261008130000_business_profiles.sql`. Change one, change the other: the
 * parser must reject everything the database rejects. The parser is deliberately STRICTER on the NIP:
 * it also verifies the checksum, which the CHECK (ten digits) does not. That is the safe direction —
 * the form refuses more than the database, never less.
 */

export const MAX_COMPANY_NAME_LENGTH = 200;
export const MAX_ADDRESS_LENGTH = 300;
export const MAX_PHONE_LENGTH = 30;
export const MAX_EMAIL_LENGTH = 254;

/** The profile page and the endpoint its company form posts to. */
export const BUSINESS_PROFILE_PATH = "/dashboard/profile";
export const BUSINESS_API_PATH = "/api/profile/business";

/** The form field names, shared by the page's inputs and the parser. They equal the column names. */
export const BUSINESS_FIELDS = {
  companyName: "company_name",
  nip: "nip",
  address: "address",
  phone: "phone",
  email: "email",
} as const;

export interface BusinessProfile {
  company_name: string | null;
  nip: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

export type BusinessFormResult = { ok: true; value: BusinessProfile } | { ok: false; code: "invalid_input" };

/** Mirrors the phone CHECK: digits, spaces and `+ ( ) -`. */
const PHONE_PATTERN = /^[0-9 +()-]+$/;
/** Mirrors the email CHECK: one `@`, no whitespace, something on both sides. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
/** NIP as typed: digits, optionally separated by spaces or dashes. */
const NIP_INPUT_PATTERN = /^[0-9 -]+$/;

const NIP_WEIGHTS = [6, 5, 7, 2, 3, 4, 5, 6, 7] as const;

/** Code points on purpose, not UTF-16 units: Postgres `char_length` counts code points too. */
function codePointLength(text: string): number {
  let count = 0;
  for (const _codePoint of text) count += 1;
  return count;
}

/**
 * Ten digits whose weighted sum (weights 6 5 7 2 3 4 5 6 7) mod 11 equals the last digit. A
 * remainder of 10 is never valid.
 */
export function isValidNip(digits: string): boolean {
  if (!/^[0-9]{10}$/.test(digits)) return false;
  const sum = NIP_WEIGHTS.reduce((total, weight, index) => total + weight * Number(digits[index]), 0);
  const check = sum % 11;
  return check !== 10 && check === Number(digits[9]);
}

function readText(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

/** `undefined` = invalid, `null` = empty, string = the trimmed value. */
function readOptional(form: FormData, name: string, accepts: (trimmed: string) => boolean): string | null | undefined {
  const raw = readText(form, name);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return accepts(trimmed) ? trimmed : undefined;
}

function parseNip(form: FormData): string | null | undefined {
  const raw = readText(form, BUSINESS_FIELDS.nip);
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!NIP_INPUT_PATTERN.test(trimmed)) return undefined;
  const digits = trimmed.replace(/[ -]/g, "");
  return isValidNip(digits) ? digits : undefined;
}

/**
 * The five form strings to the row shape, or `invalid_input` when any non-empty value is out of
 * bounds. Never throws. A single code is enough: the page's native constraints stop almost every bad
 * value before submit, so a server rejection means a tampered or scripted POST.
 */
export function parseBusinessForm(form: FormData): BusinessFormResult {
  const companyName = readOptional(
    form,
    BUSINESS_FIELDS.companyName,
    (value) => codePointLength(value) <= MAX_COMPANY_NAME_LENGTH,
  );
  const nip = parseNip(form);
  const address = readOptional(form, BUSINESS_FIELDS.address, (value) => codePointLength(value) <= MAX_ADDRESS_LENGTH);
  const phone = readOptional(
    form,
    BUSINESS_FIELDS.phone,
    (value) => codePointLength(value) <= MAX_PHONE_LENGTH && PHONE_PATTERN.test(value),
  );
  const email = readOptional(
    form,
    BUSINESS_FIELDS.email,
    (value) => codePointLength(value) <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value),
  );

  if (
    companyName === undefined ||
    nip === undefined ||
    address === undefined ||
    phone === undefined ||
    email === undefined
  ) {
    return { ok: false, code: "invalid_input" };
  }
  return { ok: true, value: { company_name: companyName, nip, address, phone, email } };
}

export interface BusinessFormDefaults {
  company_name: string;
  nip: string;
  address: string;
  phone: string;
  email: string;
}

type BusinessRow = Pick<Tables<"business_profiles">, keyof BusinessProfile>;

/**
 * The input values for the company form: a stored row pre-filled in a shape `parseBusinessForm`
 * accepts unchanged, or empty strings for a null row or null columns.
 */
export function businessFormDefaults(row: BusinessRow | null): BusinessFormDefaults {
  return {
    company_name: row?.company_name ?? "",
    nip: row?.nip ?? "",
    address: row?.address ?? "",
    phone: row?.phone ?? "",
    email: row?.email ?? "",
  };
}

/** The quote's header shows the company block only when a name is set. */
export function hasCompanyDetails(row: Pick<BusinessProfile, "company_name"> | null): boolean {
  return row !== null && row.company_name !== null;
}
