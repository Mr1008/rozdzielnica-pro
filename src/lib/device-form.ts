import type { Tables } from "@/lib/database.types";
import { DEVICE_ERROR, type DeviceErrorCode } from "@/lib/device-errors";
import {
  DEVICE_KINDS,
  PARAMETERS_BY_KIND,
  parseDeviceSpec,
  type DeviceField,
  type DeviceKind,
  type DeviceParameter,
  type DeviceSpec,
} from "@/lib/device-spec";
import { fieldFromNumber, numberFromField } from "@/lib/draft-fields";
import { parsePriceGrosze } from "@/lib/price-input";

/**
 * The device create/edit form: the `FormData` field names the island submits and the endpoints
 * read, and the one conversion from typed strings to the `devices` row shape that both the island
 * (to show issues as the admin types) and the server run before `parseDeviceSpec`.
 */

/** A catalog row as the editor receives it. `terminal_groups` is raw JSON: a stored row may not parse. */
export type DeviceRow = Pick<
  Tables<"devices">,
  | "id"
  | "kind"
  | "name"
  | "manufacturer"
  | "model"
  | "price_grosze"
  | "width_mm"
  | "height_mm"
  | "depth_mm"
  | "poles"
  | "rated_current_a"
  | "residual_current_ma"
  | "rcd_type"
  | "breaking_capacity_ka"
  | "terminal_groups"
>;

/** What an update writes: everything but `kind`, which is fixed once a device exists. */
export type DeviceUpdate = Omit<DeviceSpec, "kind">;

/** The submitted field names. They match the columns, except the price, which is typed in PLN. */
export const DEVICE_FORM_FIELDS = {
  kind: "kind",
  name: "name",
  manufacturer: "manufacturer",
  model: "model",
  price: "price",
  /** Always millimetres: the island converts a module count before submitting. */
  width_mm: "width_mm",
  height_mm: "height_mm",
  depth_mm: "depth_mm",
  poles: "poles",
  rated_current_a: "rated_current_a",
  residual_current_ma: "residual_current_ma",
  rcd_type: "rcd_type",
  breaking_capacity_ka: "breaking_capacity_ka",
  /** A hidden input carrying the bar's terminal groups as JSON. */
  terminal_groups: "terminal_groups",
} as const;

export type DeviceFormField = keyof typeof DEVICE_FORM_FIELDS;

/** Every form field as the string it is submitted as; an absent field is `""`. */
export type DeviceFormValues = Record<DeviceFormField, string>;

const FORM_FIELDS = Object.keys(DEVICE_FORM_FIELDS) as DeviceFormField[];

function isKind(value: string): value is DeviceKind {
  return (DEVICE_KINDS as readonly string[]).includes(value);
}

function textOrNull(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Empty is "not given" (`required`); anything unreadable is `NaN` (`malformed`). */
function numberOrNull(raw: string): number | null {
  return raw.trim() === "" ? null : numberFromField(raw);
}

/** Unparseable JSON is kept as the raw string, which `parseDeviceSpec` reports as `malformed`. */
function jsonOrNull(raw: string): unknown {
  if (raw.trim() === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Typed strings to a `parseDeviceSpec` input. Only the chosen kind's parameters are read — any other
 * kind's field in the form becomes `null` — so a stale or foreign input can never reach the row.
 */
export function deviceCandidate(values: DeviceFormValues): Record<DeviceField, unknown> {
  const kind = values.kind.trim();
  const own: readonly DeviceParameter[] = isKind(kind) ? PARAMETERS_BY_KIND[kind] : [];
  const param = (field: DeviceParameter, read: () => unknown) => (own.includes(field) ? read() : null);

  return {
    kind,
    name: values.name,
    manufacturer: values.manufacturer,
    model: values.model,
    price_grosze: parsePriceGrosze(values.price),
    width_mm: numberOrNull(values.width_mm),
    height_mm: numberOrNull(values.height_mm),
    depth_mm: numberOrNull(values.depth_mm),
    poles: param("poles", () => textOrNull(values.poles)),
    rated_current_a: param("rated_current_a", () => numberOrNull(values.rated_current_a)),
    residual_current_ma: param("residual_current_ma", () => numberOrNull(values.residual_current_ma)),
    rcd_type: param("rcd_type", () => textOrNull(values.rcd_type)),
    breaking_capacity_ka: param("breaking_capacity_ka", () => numberOrNull(values.breaking_capacity_ka)),
    terminal_groups: param("terminal_groups", () => jsonOrNull(values.terminal_groups)),
  };
}

function formValues(form: FormData): DeviceFormValues {
  const values = {} as DeviceFormValues;
  for (const field of FORM_FIELDS) {
    const value = form.get(DEVICE_FORM_FIELDS[field]);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

type FormResult<T> = { ok: true; value: T } | { ok: false; code: DeviceErrorCode };

/**
 * Submitted `FormData` to a validated insert/update payload. Any failure is reported as the single
 * `invalid_input` code: the island already blocks every case it can see, so reaching this branch
 * means a tampered or stale submission, not something the admin needs itemised.
 *
 * On update the posted `kind` only decides which parameter fields are read; it is never written, so
 * a device's kind cannot change. A tampered kind produces a parameter set the per-kind database
 * CHECK refuses for the stored kind (PE and N bars share one parameter set, so there it is moot).
 */
export function parseDeviceForm(form: FormData, mode: "create"): FormResult<DeviceSpec>;
export function parseDeviceForm(form: FormData, mode: "update"): FormResult<DeviceUpdate>;
export function parseDeviceForm(form: FormData, mode: "create" | "update"): FormResult<DeviceSpec | DeviceUpdate> {
  const parsed = parseDeviceSpec(deviceCandidate(formValues(form)));
  if (!parsed.ok) return { ok: false, code: DEVICE_ERROR.invalidInput };
  if (mode === "create") return { ok: true, value: parsed.spec };
  const { kind: _kind, ...update } = parsed.spec;
  return { ok: true, value: update };
}

/** `26.25` → `"26,25"`: a stored decimal as the form pre-fills it. */
export function formatDecimalInput(value: number): string {
  return fieldFromNumber(value);
}
