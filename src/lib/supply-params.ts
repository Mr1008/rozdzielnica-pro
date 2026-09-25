import type { Enums, Tables } from "@/lib/database.types";

/**
 * A project's supply parameters (FR-005): the OSD connection (pre-meter protection, earthing
 * system, phase count) and the WLZ (length, cross-section, material, installation method). This is
 * the single TypeScript source of their value lists, and the parser below turns the supply form into
 * the `projects` column shape.
 *
 * The lists mirror the CHECKs and enums in `supabase/migrations/20260924150000_projects.sql`. Change
 * one, change the other: the parser must reject exactly what the database rejects. The seven columns
 * are all set or all null (`projects_supply_all_or_nothing`), and null means "not configured" — the
 * contract S-04 reads: it blocks, never falls back to invented defaults.
 */

export const PREMETER_PROTECTIONS_A = [16, 20, 25, 32, 40, 50, 63] as const;
export type PremeterProtectionA = (typeof PREMETER_PROTECTIONS_A)[number];

export const EARTHING_SYSTEMS = ["TN-C", "TN-S", "TN-C-S", "TT"] as const;
export type EarthingSystem = (typeof EARTHING_SYSTEMS)[number];

export const PHASE_COUNTS = [1, 3] as const;
export type PhaseCount = (typeof PHASE_COUNTS)[number];

/** `numeric(3,1)`: every value here is exact at one decimal place. */
export const WLZ_CROSS_SECTIONS_MM2 = [2.5, 4, 6, 10, 16, 25, 35] as const;
export type WlzCrossSectionMm2 = (typeof WLZ_CROSS_SECTIONS_MM2)[number];

export const CONDUCTOR_MATERIALS = ["Cu", "Al"] as const;
export type ConductorMaterial = (typeof CONDUCTOR_MATERIALS)[number];

/**
 * `surface` natynkowo, `conduit_surface` w rurce natynkowo, `conduit_flush` w rurce podtynkowo,
 * `in_wall` bezpośrednio w ścianie/tynku, `in_ground` w gruncie.
 */
export const WLZ_INSTALLATIONS = ["surface", "conduit_surface", "conduit_flush", "in_wall", "in_ground"] as const;
export type WlzInstallation = (typeof WLZ_INSTALLATIONS)[number];

/** `wlz_length_m` is `numeric(4,1)`: 0 < L ≤ 500.0, at most one decimal place. */
export const MAX_WLZ_LENGTH_M = 500;
export const WLZ_LENGTH_DECIMAL_PLACES = 1;

/**
 * The three unions must equal the database enums, so a migration that adds or drops a value without
 * this file (or the reverse) fails `astro check` instead of drifting silently.
 */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
type _EarthingSystemInSync = AssertTrue<Equals<EarthingSystem, Enums<"earthing_system">>>;
type _ConductorMaterialInSync = AssertTrue<Equals<ConductorMaterial, Enums<"conductor_material">>>;
type _WlzInstallationInSync = AssertTrue<Equals<WlzInstallation, Enums<"wlz_installation">>>;

/** The seven supply columns, all set. */
export interface SupplyParams {
  premeter_protection_a: PremeterProtectionA;
  earthing_system: EarthingSystem;
  phase_count: PhaseCount;
  wlz_length_m: number;
  wlz_cross_section_mm2: WlzCrossSectionMm2;
  wlz_material: ConductorMaterial;
  wlz_installation: WlzInstallation;
}

export type SupplyColumn = keyof SupplyParams;

/** The form field names, shared by the page's inputs and the parser. They equal the column names. */
export const SUPPLY_FIELDS = {
  premeterProtection: "premeter_protection_a",
  earthingSystem: "earthing_system",
  phaseCount: "phase_count",
  wlzLength: "wlz_length_m",
  wlzCrossSection: "wlz_cross_section_mm2",
  wlzMaterial: "wlz_material",
  wlzInstallation: "wlz_installation",
} as const satisfies Record<string, SupplyColumn>;

export type SupplyRow = Pick<Tables<"projects">, SupplyColumn>;

export type SupplyFormResult = { ok: true; value: SupplyParams } | { ok: false; code: "invalid_input" };

export type SupplyFormDefaults = Record<SupplyColumn, string>;

function isOneOf<T>(list: readonly T[], value: unknown): value is T {
  return (list as readonly unknown[]).includes(value);
}

/**
 * The `<option value>` of a list entry: `String(value)`, so a cross-section is `"2.5"`. The labels
 * users see come from the message catalog; this is the machine value the parser matches exactly.
 */
export function supplyOptionValue(value: string | number): string {
  return String(value);
}

/** A list entry by its exact option value, or null. */
function pickOption<T extends string | number>(list: readonly T[], raw: string | null): T | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return list.find((entry) => supplyOptionValue(entry) === trimmed) ?? null;
}

/** Whole metres, optionally with `,` or `.` and exactly one decimal digit. No sign, no exponent. */
const WLZ_LENGTH = /^(\d+)(?:[.,](\d))?$/;

/**
 * The same shape as `WLZ_LENGTH`, for an `<input pattern>` (which the browser anchors itself). It
 * checks the format only — zero and the upper bound are still the parser's to refuse.
 */
export const WLZ_LENGTH_INPUT_PATTERN = String.raw`\d+(?:[.,]\d)?`;

function isValidLength(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_WLZ_LENGTH_M &&
    Number(value.toFixed(WLZ_LENGTH_DECIMAL_PLACES)) === value
  );
}

function parseLength(raw: string | null): number | null {
  if (raw === null) return null;
  const match = WLZ_LENGTH.exec(raw.trim());
  if (!match) return null;
  const [, metres, tenths = "0"] = match;
  const value = Number(`${metres}.${tenths}`);
  return isValidLength(value) ? value : null;
}

/** `12.5` → `"12,5"`: a plain decimal `parseSupplyForm` accepts, for pre-filling the form. */
export function formatWlzLengthInput(metres: number): string {
  return String(metres).replace(".", ",");
}

function readText(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === "string" ? value : null;
}

/**
 * The supply form to the column shape, or `invalid_input` when any field is missing, off-list or out
 * of range — all seven or nothing, like the database. Never throws. A single code is enough: every
 * field but the length is a `<select>`, so a server rejection means a tampered or scripted POST.
 */
export function parseSupplyForm(form: FormData): SupplyFormResult {
  const premeterProtection = pickOption(PREMETER_PROTECTIONS_A, readText(form, SUPPLY_FIELDS.premeterProtection));
  const earthingSystem = pickOption(EARTHING_SYSTEMS, readText(form, SUPPLY_FIELDS.earthingSystem));
  const phaseCount = pickOption(PHASE_COUNTS, readText(form, SUPPLY_FIELDS.phaseCount));
  const wlzLength = parseLength(readText(form, SUPPLY_FIELDS.wlzLength));
  const wlzCrossSection = pickOption(WLZ_CROSS_SECTIONS_MM2, readText(form, SUPPLY_FIELDS.wlzCrossSection));
  const wlzMaterial = pickOption(CONDUCTOR_MATERIALS, readText(form, SUPPLY_FIELDS.wlzMaterial));
  const wlzInstallation = pickOption(WLZ_INSTALLATIONS, readText(form, SUPPLY_FIELDS.wlzInstallation));

  if (
    premeterProtection === null ||
    earthingSystem === null ||
    phaseCount === null ||
    wlzLength === null ||
    wlzCrossSection === null ||
    wlzMaterial === null ||
    wlzInstallation === null
  ) {
    return { ok: false, code: "invalid_input" };
  }
  return {
    ok: true,
    value: {
      premeter_protection_a: premeterProtection,
      earthing_system: earthingSystem,
      phase_count: phaseCount,
      wlz_length_m: wlzLength,
      wlz_cross_section_mm2: wlzCrossSection,
      wlz_material: wlzMaterial,
      wlz_installation: wlzInstallation,
    },
  };
}

/**
 * A stored row's supply, or null when it is not configured. The all-or-nothing CHECK means a row has
 * either all seven or none; a value outside the lists is unreachable past the CHECKs, and is also
 * reported as null — "not configured" blocks S-04, which is the safe direction.
 */
export function supplyFromRow(row: SupplyRow): SupplyParams | null {
  const {
    premeter_protection_a,
    earthing_system,
    phase_count,
    wlz_length_m,
    wlz_cross_section_mm2,
    wlz_material,
    wlz_installation,
  } = row;
  if (
    !isOneOf(PREMETER_PROTECTIONS_A, premeter_protection_a) ||
    !isOneOf(EARTHING_SYSTEMS, earthing_system) ||
    !isOneOf(PHASE_COUNTS, phase_count) ||
    wlz_length_m === null ||
    !isValidLength(wlz_length_m) ||
    !isOneOf(WLZ_CROSS_SECTIONS_MM2, wlz_cross_section_mm2) ||
    !isOneOf(CONDUCTOR_MATERIALS, wlz_material) ||
    !isOneOf(WLZ_INSTALLATIONS, wlz_installation)
  ) {
    return null;
  }
  return {
    premeter_protection_a,
    earthing_system,
    phase_count,
    wlz_length_m,
    wlz_cross_section_mm2,
    wlz_material,
    wlz_installation,
  };
}

/**
 * The input values for the supply form: a stored supply pre-filled in a shape `parseSupplyForm`
 * accepts unchanged (the length as `"12,5"`), or empty strings when nothing is configured yet.
 */
export function supplyFormDefaults(row: SupplyRow | null): SupplyFormDefaults {
  const supply = row === null ? null : supplyFromRow(row);
  if (supply === null) {
    return {
      premeter_protection_a: "",
      earthing_system: "",
      phase_count: "",
      wlz_length_m: "",
      wlz_cross_section_mm2: "",
      wlz_material: "",
      wlz_installation: "",
    };
  }
  return {
    premeter_protection_a: supplyOptionValue(supply.premeter_protection_a),
    earthing_system: supplyOptionValue(supply.earthing_system),
    phase_count: supplyOptionValue(supply.phase_count),
    wlz_length_m: formatWlzLengthInput(supply.wlz_length_m),
    wlz_cross_section_mm2: supplyOptionValue(supply.wlz_cross_section_mm2),
    wlz_material: supplyOptionValue(supply.wlz_material),
    wlz_installation: supplyOptionValue(supply.wlz_installation),
  };
}
