import { z } from "zod";
import { terminalGroupSchema } from "@/lib/cabinet-geometry";
import { t } from "@/lib/i18n";
import { MAX_PRICE_GROSZE } from "@/lib/price-input";

/**
 * A catalog device: the closed MVP set of kinds and every per-kind rule, mirroring the database
 * CHECK so the editor island and the server reject exactly the same things. The input and output
 * use the `devices` row shape (snake_case, numbers, `price_grosze` in integer grosze), so a stored
 * row can be re-parsed as is; a form parser turns the admin's typed strings into this shape first
 * (the price via `parsePriceGrosze`).
 *
 * The guardrail this module serves: a parameter is never silently dropped or rounded. A value
 * outside the kind's column set is rejected (`foreign_parameter`), and a decimal place beyond the
 * column's scale is rejected (`too_many_decimals`) because a `numeric` column would round it
 * silently. Width allows two places so half DIN modules (1.5 TE = 26.25 mm) are exact; every other
 * decimal allows one.
 */

/** Fixed display order: pickers and the catalog list show kinds in this order. */
export const DEVICE_KINDS = ["switch_disconnector", "rcd", "rcbo", "mcb_b", "pe_bar", "n_bar"] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const POLE_CONFIGS = ["1P", "1P+N", "2P", "3P", "3P+N", "4P"] as const;
export type PoleConfig = (typeof POLE_CONFIGS)[number];

export const RCD_TYPES = ["AC", "A", "F", "B"] as const;
export type RcdType = (typeof RCD_TYPES)[number];

/** The pole configurations each kind is made in. Bars have no poles. */
export const POLES_BY_KIND = {
  switch_disconnector: ["1P", "2P", "3P", "4P"],
  rcd: ["2P", "4P"],
  rcbo: ["1P+N", "2P", "3P+N", "4P"],
  mcb_b: ["1P", "1P+N", "2P", "3P", "3P+N", "4P"],
  pe_bar: [],
  n_bar: [],
} as const satisfies Record<DeviceKind, readonly PoleConfig[]>;

/** The kind-specific columns. Each kind requires exactly its own and must leave the rest null. */
export const DEVICE_PARAMETERS = [
  "poles",
  "rated_current_a",
  "residual_current_ma",
  "rcd_type",
  "breaking_capacity_ka",
  "terminal_groups",
] as const;
export type DeviceParameter = (typeof DEVICE_PARAMETERS)[number];

export const PARAMETERS_BY_KIND = {
  switch_disconnector: ["poles", "rated_current_a"],
  rcd: ["poles", "rated_current_a", "residual_current_ma", "rcd_type"],
  rcbo: ["poles", "rated_current_a", "residual_current_ma", "rcd_type", "breaking_capacity_ka"],
  mcb_b: ["poles", "rated_current_a", "breaking_capacity_ka"],
  pe_bar: ["terminal_groups"],
  n_bar: ["terminal_groups"],
} as const satisfies Record<DeviceKind, readonly DeviceParameter[]>;

export const DEVICE_FIELDS = [
  "kind",
  "name",
  "manufacturer",
  "model",
  "price_grosze",
  "width_mm",
  "height_mm",
  "depth_mm",
  ...DEVICE_PARAMETERS,
] as const;
export type DeviceField = (typeof DEVICE_FIELDS)[number];

/**
 * Every way a device can be rejected. Closed on purpose: the island and the server both report
 * these codes, and each one has a Polish message in `t.deviceIssues`.
 */
export const DEVICE_ISSUE_CODES = [
  "malformed",
  "required",
  "invalid_kind",
  "price_invalid",
  "not_positive",
  "not_integer",
  "too_many_decimals",
  "pole_not_allowed",
  "invalid_rcd_type",
  "no_terminal_groups",
  "terminal_count_invalid",
  "terminal_range_invalid",
  "foreign_parameter",
] as const;
export type DeviceIssueCode = (typeof DEVICE_ISSUE_CODES)[number];

export interface DeviceIssue {
  field: DeviceField;
  code: DeviceIssueCode;
}

/** Decimal places each decimal column stores — mirrors the `numeric` scales in the migration. */
export const WIDTH_DECIMAL_PLACES = 2;
export const DECIMAL_PLACES = 1;

/** At most `places` decimal places, tolerating binary noise such as `35.3 * 10 = 353.00000000000006`. */
function hasAtMostDecimals(value: number, places: number): boolean {
  const scaled = value * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-9 * Math.max(1, Math.abs(scaled));
}

const textSchema = z.string().trim().min(1);
const priceSchema = z.number().int().positive().max(MAX_PRICE_GROSZE);
const oneDecimalSchema = z
  .number()
  .positive()
  .refine((n) => hasAtMostDecimals(n, DECIMAL_PLACES));
const widthSchema = z
  .number()
  .positive()
  .refine((n) => hasAtMostDecimals(n, WIDTH_DECIMAL_PLACES));
const currentSchema = z.number().int().positive();
const rcdTypeSchema = z.enum(RCD_TYPES);
const terminalGroupsSchema = z.array(terminalGroupSchema.refine((group) => group.minMm2 <= group.maxMm2)).min(1);

const common = {
  name: textSchema,
  manufacturer: textSchema,
  model: textSchema,
  price_grosze: priceSchema,
  width_mm: widthSchema,
  height_mm: oneDecimalSchema,
  depth_mm: oneDecimalSchema,
};

/** A bar carries no poles, currents or protection parameters. */
const noProtection = {
  poles: z.null(),
  rated_current_a: z.null(),
  residual_current_ma: z.null(),
  rcd_type: z.null(),
  breaking_capacity_ka: z.null(),
};

/** The complete schema, for callers that want zod directly. Use `parseDeviceSpec` for coded issues. */
export const deviceSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("switch_disconnector"),
    ...common,
    poles: z.enum(POLES_BY_KIND.switch_disconnector),
    rated_current_a: currentSchema,
    residual_current_ma: z.null(),
    rcd_type: z.null(),
    breaking_capacity_ka: z.null(),
    terminal_groups: z.null(),
  }),
  z.object({
    kind: z.literal("rcd"),
    ...common,
    poles: z.enum(POLES_BY_KIND.rcd),
    rated_current_a: currentSchema,
    residual_current_ma: currentSchema,
    rcd_type: rcdTypeSchema,
    breaking_capacity_ka: z.null(),
    terminal_groups: z.null(),
  }),
  z.object({
    kind: z.literal("rcbo"),
    ...common,
    poles: z.enum(POLES_BY_KIND.rcbo),
    rated_current_a: currentSchema,
    residual_current_ma: currentSchema,
    rcd_type: rcdTypeSchema,
    breaking_capacity_ka: oneDecimalSchema,
    terminal_groups: z.null(),
  }),
  z.object({
    kind: z.literal("mcb_b"),
    ...common,
    poles: z.enum(POLES_BY_KIND.mcb_b),
    rated_current_a: currentSchema,
    residual_current_ma: z.null(),
    rcd_type: z.null(),
    breaking_capacity_ka: oneDecimalSchema,
    terminal_groups: z.null(),
  }),
  z.object({ kind: z.literal("pe_bar"), ...common, ...noProtection, terminal_groups: terminalGroupsSchema }),
  z.object({ kind: z.literal("n_bar"), ...common, ...noProtection, terminal_groups: terminalGroupsSchema }),
]);

export type DeviceSpec = z.infer<typeof deviceSpecSchema>;

function isKind(value: unknown): value is DeviceKind {
  return (DEVICE_KINDS as readonly unknown[]).includes(value);
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

type Check = (value: unknown) => DeviceIssueCode | null;

const checkText: Check = (value) => {
  if (typeof value !== "string") return isAbsent(value) ? "required" : "malformed";
  return value.trim() === "" ? "required" : null;
};

const checkPrice: Check = (value) => (priceSchema.safeParse(value).success ? null : "price_invalid");

function checkNumber(value: unknown, rule: (n: number) => DeviceIssueCode | null): DeviceIssueCode | null {
  if (isAbsent(value)) return "required";
  if (typeof value !== "number" || !Number.isFinite(value)) return "malformed";
  if (value <= 0) return "not_positive";
  return rule(value);
}

function checkDecimals(places: number): Check {
  return (value) => checkNumber(value, (n) => (hasAtMostDecimals(n, places) ? null : "too_many_decimals"));
}

const checkOneDecimal = checkDecimals(DECIMAL_PLACES);
const checkWidth = checkDecimals(WIDTH_DECIMAL_PLACES);

const checkCurrent: Check = (value) => checkNumber(value, (n) => (Number.isInteger(n) ? null : "not_integer"));

const checkRcdType: Check = (value) => {
  if (isAbsent(value)) return "required";
  return rcdTypeSchema.safeParse(value).success ? null : "invalid_rcd_type";
};

function checkPoles(kind: DeviceKind): Check {
  const allowed: readonly unknown[] = POLES_BY_KIND[kind];
  return (value) => {
    if (isAbsent(value)) return "required";
    return allowed.includes(value) ? null : "pole_not_allowed";
  };
}

/** Every distinct problem across the groups, in a stable order. */
function checkTerminalGroups(value: unknown): DeviceIssueCode[] {
  if (isAbsent(value)) return ["required"];
  if (!Array.isArray(value)) return ["malformed"];
  if (value.length === 0) return ["no_terminal_groups"];
  const codes = new Set<DeviceIssueCode>();
  for (const group of value) {
    const parsed = terminalGroupSchema.safeParse(group);
    if (parsed.success) {
      if (parsed.data.minMm2 > parsed.data.maxMm2) codes.add("terminal_range_invalid");
      continue;
    }
    for (const issue of parsed.error.issues) {
      const key = issue.path.at(0);
      if (key === "count") codes.add("terminal_count_invalid");
      else if (key === "minMm2" || key === "maxMm2") codes.add("terminal_range_invalid");
      else codes.add("malformed");
    }
  }
  return [...codes];
}

function parameterChecks(kind: DeviceKind): Record<DeviceParameter, (value: unknown) => DeviceIssueCode[]> {
  const one = (check: Check) => (value: unknown) => {
    const code = check(value);
    return code === null ? [] : [code];
  };
  return {
    poles: one(checkPoles(kind)),
    rated_current_a: one(checkCurrent),
    residual_current_ma: one(checkCurrent),
    rcd_type: one(checkRcdType),
    breaking_capacity_ka: one(checkOneDecimal),
    terminal_groups: checkTerminalGroups,
  };
}

const COMMON_CHECKS: [DeviceField, Check][] = [
  ["name", checkText],
  ["manufacturer", checkText],
  ["model", checkText],
  ["price_grosze", checkPrice],
  ["width_mm", checkWidth],
  ["height_mm", checkOneDecimal],
  ["depth_mm", checkOneDecimal],
];

/**
 * Never throws, and never returns zod's English text. Reports every problem at once, one issue per
 * field and code. On success the spec is trimmed and carries `null` for every parameter outside the
 * kind — ready to insert. Keys other than the device fields (`id`, `archived_at`, …) are ignored, so
 * a stored row can be passed straight in.
 */
export function parseDeviceSpec(input: unknown): { ok: true; spec: DeviceSpec } | { ok: false; issues: DeviceIssue[] } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, issues: [{ field: "kind", code: "malformed" }] };
  }
  const row = input as Partial<Record<DeviceField, unknown>>;
  const issues: DeviceIssue[] = [];

  const kind = row.kind;
  if (!isKind(kind)) issues.push({ field: "kind", code: "invalid_kind" });

  for (const [field, check] of COMMON_CHECKS) {
    const code = check(row[field]);
    if (code !== null) issues.push({ field, code });
  }

  if (isKind(kind)) {
    const own: readonly DeviceParameter[] = PARAMETERS_BY_KIND[kind];
    const checks = parameterChecks(kind);
    for (const field of DEVICE_PARAMETERS) {
      if (own.includes(field)) {
        for (const code of checks[field](row[field])) issues.push({ field, code });
      } else if (!isAbsent(row[field])) {
        issues.push({ field, code: "foreign_parameter" });
      }
    }
  }

  if (issues.length > 0 || !isKind(kind)) return { ok: false, issues };

  // The checks above already passed; the schema is the typed, normalising second opinion. If the two
  // ever disagree it is a bug here, and the device is refused rather than let through.
  const normalised = Object.fromEntries(DEVICE_FIELDS.map((field) => [field, row[field] ?? null]));
  const parsed = deviceSpecSchema.safeParse(normalised);
  if (!parsed.success) return { ok: false, issues: [{ field: "kind", code: "malformed" }] };
  return { ok: true, spec: parsed.data };
}

const KIND_LABEL_KEYS: Record<DeviceKind, keyof typeof t.devices.kinds> = {
  switch_disconnector: "switchDisconnector",
  rcd: "rcd",
  rcbo: "rcbo",
  mcb_b: "mcbB",
  pe_bar: "peBar",
  n_bar: "nBar",
};

export function deviceKindLabel(kind: DeviceKind): string {
  return t.devices.kinds[KIND_LABEL_KEYS[kind]];
}

const FIELD_LABEL_KEYS: Record<DeviceField, keyof typeof t.devices.fields> = {
  kind: "kind",
  name: "name",
  manufacturer: "manufacturer",
  model: "model",
  price_grosze: "price",
  width_mm: "width",
  height_mm: "heightMm",
  depth_mm: "depthMm",
  poles: "poles",
  rated_current_a: "ratedCurrentA",
  residual_current_ma: "residualCurrentMa",
  rcd_type: "rcdType",
  breaking_capacity_ka: "breakingCapacityKa",
  terminal_groups: "terminalGroups",
};

/** Polish text for one issue. The `Record` keeps it exhaustive over `DeviceIssueCode`. */
export function deviceIssueMessage(issue: DeviceIssue): string {
  const subject = t.devices.fields[FIELD_LABEL_KEYS[issue.field]];
  const m = t.deviceIssues;
  const messages: Record<DeviceIssueCode, () => string> = {
    malformed: () => m.malformed(subject),
    required: () => m.required(subject),
    invalid_kind: () => m.invalidKind,
    price_invalid: () => m.priceInvalid,
    not_positive: () => m.notPositive(subject),
    not_integer: () => m.notInteger(subject),
    too_many_decimals: () =>
      m.tooManyDecimals(subject, issue.field === "width_mm" ? WIDTH_DECIMAL_PLACES : DECIMAL_PLACES),
    pole_not_allowed: () => m.poleNotAllowed,
    invalid_rcd_type: () => m.invalidRcdType,
    no_terminal_groups: () => m.noTerminalGroups,
    terminal_count_invalid: () => m.terminalCountInvalid,
    terminal_range_invalid: () => m.terminalRangeInvalid,
    foreign_parameter: () => m.foreignParameter(subject),
  };
  return messages[issue.code]();
}
