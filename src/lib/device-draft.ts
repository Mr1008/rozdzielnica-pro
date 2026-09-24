import { z } from "zod";
import { DEVICE_KINDS, POLE_CONFIGS, RCD_TYPES, type DeviceKind } from "@/lib/device-spec";
import { formatDecimalInput, type DeviceFormValues, type DeviceRow } from "@/lib/device-form";
import { mmFromModules, modulesFromMm } from "@/lib/din-module";
import { draftKeySchema, newDraftKey, numberFromField } from "@/lib/draft-fields";
import { formatPriceInput } from "@/lib/price-input";

/**
 * The device editor's state. Every value is kept as the string the admin typed; `formValuesFromDraft`
 * turns it into exactly the strings the form submits, which `deviceCandidate` + `parseDeviceSpec`
 * then judge — in the browser as the admin types, and again on the server. Nothing here validates,
 * except the one thing the server never sees: whether a width typed in DIN modules is a 0.5 step.
 */

export const WIDTH_UNITS = ["modules", "mm"] as const;
export type WidthUnit = (typeof WIDTH_UNITS)[number];

const field = z.string();
const orEmpty = <T extends readonly [string, ...string[]]>(values: T) => z.union([z.enum(values), z.literal("")]);

const terminalGroupDraftSchema = z.object({ key: draftKeySchema, count: field, minMm2: field, maxMm2: field });

/** Also the shape a draft stored in `sessionStorage` must have to be restored. */
export const deviceDraftSchema = z.object({
  kind: orEmpty(DEVICE_KINDS),
  name: field,
  manufacturer: field,
  model: field,
  price: field,
  /** In `widthUnit`: a module count or millimetres. */
  width: field,
  widthUnit: z.enum(WIDTH_UNITS),
  heightMm: field,
  depthMm: field,
  poles: orEmpty(POLE_CONFIGS),
  ratedCurrentA: field,
  residualCurrentMa: field,
  rcdType: orEmpty(RCD_TYPES),
  breakingCapacityKa: field,
  terminalGroups: z.array(terminalGroupDraftSchema),
});

export type DeviceDraft = z.infer<typeof deviceDraftSchema>;
export type TerminalGroupDraft = DeviceDraft["terminalGroups"][number];

export function isBarKind(kind: DeviceKind | ""): boolean {
  return kind === "pe_bar" || kind === "n_bar";
}

export function newTerminalGroupDraft(): TerminalGroupDraft {
  return { key: newDraftKey(), count: "8", minMm2: "1,5", maxMm2: "16" };
}

/** The kind-specific fields, emptied. A bar starts with one terminal group, since it needs one. */
function emptyParameters(kind: DeviceKind | "") {
  return {
    poles: "" as const,
    ratedCurrentA: "",
    residualCurrentMa: "",
    rcdType: "" as const,
    breakingCapacityKa: "",
    terminalGroups: isBarKind(kind) ? [newTerminalGroupDraft()] : [],
  };
}

function decimalField(value: number | null): string {
  return value === null ? "" : formatDecimalInput(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    : [];
}

function numberField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? formatDecimalInput(value) : "";
}

/**
 * The editor's starting state: the row being edited, or an empty new device. A stored width that is
 * a whole number of half-modules opens in modules, any other in millimetres.
 */
export function draftFromRow(row?: DeviceRow): DeviceDraft {
  if (!row) {
    return {
      kind: "",
      name: "",
      manufacturer: "",
      model: "",
      price: "",
      width: "",
      widthUnit: "modules",
      heightMm: "",
      depthMm: "",
      ...emptyParameters(""),
    };
  }
  const modules = modulesFromMm(row.width_mm);
  return {
    kind: row.kind,
    name: row.name,
    manufacturer: row.manufacturer,
    model: row.model,
    price: formatPriceInput(row.price_grosze),
    width: formatDecimalInput(modules ?? row.width_mm),
    widthUnit: modules === null ? "mm" : "modules",
    heightMm: formatDecimalInput(row.height_mm),
    depthMm: formatDecimalInput(row.depth_mm),
    poles: row.poles ?? "",
    ratedCurrentA: decimalField(row.rated_current_a),
    residualCurrentMa: decimalField(row.residual_current_ma),
    rcdType: row.rcd_type ?? "",
    breakingCapacityKa: decimalField(row.breaking_capacity_ka),
    terminalGroups: records(row.terminal_groups).map((group) => ({
      key: newDraftKey(),
      count: numberField(group, "count"),
      minMm2: numberField(group, "minMm2"),
      maxMm2: numberField(group, "maxMm2"),
    })),
  };
}

/** Choosing another kind clears every kind-specific field, so nothing of the old kind lingers. */
export function withKind(draft: DeviceDraft, kind: DeviceKind): DeviceDraft {
  if (draft.kind === kind) return draft;
  return { ...draft, kind, ...emptyParameters(kind) };
}

/**
 * The width to submit, in millimetres. In modules mode a count that is not a 0.5 step is flagged
 * (`stepInvalid`) and submits nothing; anything else unreadable is passed through for the spec
 * parser to report.
 */
export function widthMmFromDraft(draft: DeviceDraft): { mm: string; stepInvalid: boolean } {
  if (draft.widthUnit === "mm" || draft.width.trim() === "") return { mm: draft.width, stepInvalid: false };
  const modules = numberFromField(draft.width);
  if (!Number.isFinite(modules) || modules <= 0) return { mm: draft.width, stepInvalid: false };
  if (!Number.isInteger(modules * 2)) return { mm: "", stepInvalid: true };
  return { mm: formatDecimalInput(mmFromModules(modules)), stepInvalid: false };
}

/**
 * Switches the width unit, converting the typed value. A value with no exact counterpart (36 mm is
 * not a half-module multiple) is cleared rather than reinterpreted in the other unit.
 */
export function withWidthUnit(draft: DeviceDraft, unit: WidthUnit): DeviceDraft {
  if (draft.widthUnit === unit) return draft;
  if (draft.width.trim() === "") return { ...draft, widthUnit: unit };
  if (unit === "mm") {
    const { mm, stepInvalid } = widthMmFromDraft(draft);
    const valid = !stepInvalid && numberFromField(mm) > 0;
    return { ...draft, widthUnit: unit, width: valid ? mm : "" };
  }
  const modules = modulesFromMm(numberFromField(draft.width));
  return { ...draft, widthUnit: unit, width: modules === null ? "" : formatDecimalInput(modules) };
}

/**
 * The terminal groups as the hidden JSON input carries them. An unreadable number becomes `null`
 * in JSON, which the spec parser reports on the group.
 */
export function terminalGroupsJson(groups: readonly TerminalGroupDraft[]): string {
  return JSON.stringify(
    groups.map((group) => ({
      count: numberFromField(group.count),
      minMm2: numberFromField(group.minMm2),
      maxMm2: numberFromField(group.maxMm2),
    })),
  );
}

/** Exactly the strings the form submits for this draft. */
export function formValuesFromDraft(draft: DeviceDraft): DeviceFormValues {
  return {
    kind: draft.kind,
    name: draft.name,
    manufacturer: draft.manufacturer,
    model: draft.model,
    price: draft.price,
    width_mm: widthMmFromDraft(draft).mm,
    height_mm: draft.heightMm,
    depth_mm: draft.depthMm,
    poles: draft.poles,
    rated_current_a: draft.ratedCurrentA,
    residual_current_ma: draft.residualCurrentMa,
    rcd_type: draft.rcdType,
    breaking_capacity_ka: draft.breakingCapacityKa,
    terminal_groups: isBarKind(draft.kind) ? terminalGroupsJson(draft.terminalGroups) : "",
  };
}
