import { CABINET_ERROR, type CabinetErrorCode } from "@/lib/cabinet-errors";
import { parseCabinetGeometry, type CabinetGeometry } from "@/lib/cabinet-geometry";
import type { Tables } from "@/lib/database.types";
import { parsePriceGrosze } from "@/lib/price-input";

/**
 * The cabinet create/edit form: the `FormData` field names the island submits and the endpoints
 * read, and the one parser both the island (for the price) and the server trust.
 */

/** A catalog row as the editor receives it. `geometry` is raw JSON: a stored row may not parse. */
export type CabinetRow = Pick<
  Tables<"cabinets">,
  "id" | "name" | "manufacturer" | "model" | "price_grosze" | "geometry" | "mounting"
>;

/**
 * How the cabinet is mounted, a picking aid only (never snapshotted into a project). Guarded twice
 * with the `cabinets_mounting_valid` CHECK, which also admits null for rows written before the
 * column existed; the parser is stricter and always requires a value.
 */
export const CABINET_MOUNTINGS = ["surface", "flush"] as const;
export type CabinetMounting = (typeof CABINET_MOUNTINGS)[number];

/** What an insert or update writes. `geometry` has passed `parseCabinetGeometry`. */
export interface CabinetInput {
  name: string;
  manufacturer: string;
  model: string;
  price_grosze: number;
  mounting: CabinetMounting;
  geometry: CabinetGeometry;
}

export const CABINET_FORM_FIELDS = {
  name: "name",
  manufacturer: "manufacturer",
  model: "model",
  price: "price",
  mounting: "mounting",
  /** A hidden input carrying the whole geometry document as JSON. */
  geometry: "geometry",
} as const;

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

  const mountingValue = text(form, CABINET_FORM_FIELDS.mounting);
  const mounting = CABINET_MOUNTINGS.find((option) => option === mountingValue);
  if (mounting === undefined) return invalid;

  const geometry = parseCabinetGeometry(parseJson(text(form, CABINET_FORM_FIELDS.geometry)));
  if (!geometry.ok) return invalid;

  return {
    ok: true,
    value: { name, manufacturer, model, price_grosze: priceGrosze, mounting, geometry: geometry.geometry },
  };
}
