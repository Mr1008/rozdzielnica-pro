import { CABINET_ERROR, type CabinetErrorCode } from "@/lib/cabinet-errors";
import { parseCabinetGeometry, type CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Tables } from "@/lib/database.types";

/**
 * The cabinet create/edit form: the `FormData` field names the island submits and the endpoints
 * read, and the one parser both the island (for the price) and the server trust.
 */

/** A catalog row as the editor receives it. `geometry` is raw JSON: a stored row may not parse. */
export type CabinetRow = Pick<
  Tables<"cabinets">,
  "id" | "name" | "manufacturer" | "model" | "price_grosze" | "geometry"
>;

/** What an insert or update writes. `geometry` has passed `parseCabinetGeometry`. */
export interface CabinetInput {
  name: string;
  manufacturer: string;
  model: string;
  price_grosze: number;
  geometry: CabinetGeometry;
}

export const CABINET_FORM_FIELDS = {
  name: "name",
  manufacturer: "manufacturer",
  model: "model",
  price: "price",
  /** A hidden input carrying the whole geometry document as JSON. */
  geometry: "geometry",
} as const;

/** `price_grosze` is a Postgres `integer`. */
const MAX_PRICE_GROSZE = 2_147_483_647;

/** Whole złote, optionally followed by `,` or `.` and one or two digits of grosze. */
const PRICE = /^(\d+)(?:[.,](\d{1,2}))?$/;

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

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Submitted `FormData` to a validated insert/update payload. Any failure is reported as the single
 * `invalid_input` code: the island already blocks every case it can see, so reaching this branch
 * means a tampered or stale submission, not something the admin needs itemised.
 */
export function parseCabinetForm(
  form: FormData,
): { ok: true; value: CabinetInput } | { ok: false; code: CabinetErrorCode } {
  const invalid = { ok: false, code: CABINET_ERROR.invalidInput } as const;

  const name = text(form, CABINET_FORM_FIELDS.name);
  const manufacturer = text(form, CABINET_FORM_FIELDS.manufacturer);
  const model = text(form, CABINET_FORM_FIELDS.model);
  if (!name || !manufacturer || !model) return invalid;

  const priceGrosze = parsePriceGrosze(text(form, CABINET_FORM_FIELDS.price));
  if (priceGrosze === null) return invalid;

  const geometry = parseCabinetGeometry(parseJson(text(form, CABINET_FORM_FIELDS.geometry)));
  if (!geometry.ok) return invalid;

  return {
    ok: true,
    value: { name, manufacturer, model, price_grosze: priceGrosze, geometry: geometry.geometry },
  };
}
