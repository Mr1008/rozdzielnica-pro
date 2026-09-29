import { ENTRY_SIDES } from "@/lib/cabinet-geometry";
import { isUuid } from "@/lib/catalog";
import type { Enums } from "@/lib/database.types";
import { RCD_TYPES, type RcdType } from "@/lib/device-spec";
import { t } from "@/lib/i18n";
import { WLZ_INSTALLATIONS, type WlzInstallation } from "@/lib/supply-params";

/**
 * A project's circuits and RCD groups (FR-006): the single TypeScript source of their value lists,
 * and the parser for the circuit editor's hidden JSON field. The lists mirror the CHECKs on the
 * `rcd_groups` and `circuits` tables — change one, change the other: the island and the server must
 * reject exactly what the database rejects.
 *
 * Like `parseDeviceSpec`, the parser never throws and never returns zod's English text: it reports
 * every problem at once as a coded issue on a group, a circuit or the payload itself. A circuit's
 * position is its index in the array; a circuit with `rcd_group_id: null` belongs to no group.
 */

export const CIRCUIT_RATED_CURRENTS_A = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63] as const;
export type CircuitRatedCurrentA = (typeof CIRCUIT_RATED_CURRENTS_A)[number];

export const CIRCUIT_PHASE_COUNTS = [1, 3] as const;
export type CircuitPhaseCount = (typeof CIRCUIT_PHASE_COUNTS)[number];

/** Every value is exact at one decimal place, like the `numeric` column. */
export const CIRCUIT_CROSS_SECTIONS_MM2 = [1.5, 2.5, 4, 6, 10, 16] as const;
export type CircuitCrossSectionMm2 = (typeof CIRCUIT_CROSS_SECTIONS_MM2)[number];

export const RESIDUAL_CURRENTS_MA = [10, 30, 100, 300] as const;
export type ResidualCurrentMa = (typeof RESIDUAL_CURRENTS_MA)[number];

/** What a new RCD group starts with in the editor. */
export const DEFAULT_RESIDUAL_CURRENT_MA: ResidualCurrentMa = 30;
export const DEFAULT_MIN_RCD_TYPE: RcdType = "A";

export const MAX_CIRCUITS = 60;
export const MAX_GROUPS = 20;
/** Both lengths count code points of the trimmed text, mirroring `char_length` in the CHECKs. */
export const MAX_CIRCUIT_NAME_LENGTH = 100;
export const MAX_GROUP_LABEL_LENGTH = 40;

export type EntrySide = (typeof ENTRY_SIDES)[number];

/**
 * The entry-side union must equal the `entry_side` database enum, so a migration that adds or drops a
 * side without `ENTRY_SIDES` (or the reverse) fails `astro check` instead of drifting silently.
 */
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type AssertTrue<T extends true> = T;
type _EntrySideInSync = AssertTrue<Equals<EntrySide, Enums<"entry_side">>>;

export interface RcdGroupInput {
  id: string;
  label: string;
  residual_current_ma: ResidualCurrentMa;
  min_rcd_type: RcdType;
}

export interface CircuitInput {
  id: string;
  rcd_group_id: string | null;
  name: string;
  rated_current_a: CircuitRatedCurrentA;
  phase_count: CircuitPhaseCount;
  cross_section_mm2: CircuitCrossSectionMm2;
  installation: WlzInstallation;
  entry_side: EntrySide;
}

export interface CircuitsPayload {
  groups: RcdGroupInput[];
  circuits: CircuitInput[];
}

/** The editor's hidden field, shared by the island and the endpoint. */
export const CIRCUIT_FORM_FIELDS = { payload: "circuits_payload" } as const;

/**
 * Every way the payload can be rejected. Closed on purpose: the island and the server both report
 * these codes, and each one has a Polish message in `t.circuitIssues`.
 */
export const CIRCUIT_ISSUE_CODES = [
  "malformed",
  "required",
  "not_in_list",
  "too_long",
  "unknown_group",
  "duplicate_id",
  "too_many",
] as const;
export type CircuitIssueCode = (typeof CIRCUIT_ISSUE_CODES)[number];

export const GROUP_FIELDS = ["id", "label", "residual_current_ma", "min_rcd_type"] as const;
export const CIRCUIT_FIELDS = [
  "id",
  "rcd_group_id",
  "name",
  "rated_current_a",
  "phase_count",
  "cross_section_mm2",
  "installation",
  "entry_side",
] as const;
export type CircuitField = (typeof GROUP_FIELDS)[number] | (typeof CIRCUIT_FIELDS)[number];

/**
 * `scope` names what the issue is on. `index` is the group's or circuit's position in its array, or
 * null for an issue on a whole list (`too_many`, a list that is not an array) or on the payload.
 * `id` is the item's id when it has a valid one, so the island can attach the issue to its row.
 */
export interface CircuitIssue {
  scope: "group" | "circuit" | "payload";
  index: number | null;
  id: string | null;
  field: CircuitField | null;
  code: CircuitIssueCode;
}

export type CircuitsPayloadResult = { ok: true; value: CircuitsPayload } | { ok: false; issues: CircuitIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbsent(value: unknown): boolean {
  return value === null || value === undefined;
}

/** Code points on purpose, not graphemes: Postgres `char_length` counts code points too. */
function codePointLength(text: string): number {
  let count = 0;
  for (const _codePoint of text) count += 1;
  return count;
}

type Check = (value: unknown) => CircuitIssueCode | null;

const checkId: Check = (value) => {
  if (isAbsent(value)) return "required";
  return isUuid(value) ? null : "malformed";
};

function checkText(maxLength: number): Check {
  return (value) => {
    if (typeof value !== "string") return isAbsent(value) ? "required" : "malformed";
    const trimmed = value.trim();
    if (trimmed === "") return "required";
    return codePointLength(trimmed) > maxLength ? "too_long" : null;
  };
}

function checkList(list: readonly unknown[]): Check {
  return (value) => {
    if (isAbsent(value)) return "required";
    return list.includes(value) ? null : "not_in_list";
  };
}

/** `null` (or absent) means "no group"; a present value must be a UUID. Membership is checked later. */
const checkGroupRef: Check = (value) => (isAbsent(value) || isUuid(value) ? null : "malformed");

const GROUP_CHECKS: Record<(typeof GROUP_FIELDS)[number], Check> = {
  id: checkId,
  label: checkText(MAX_GROUP_LABEL_LENGTH),
  residual_current_ma: checkList(RESIDUAL_CURRENTS_MA),
  min_rcd_type: checkList(RCD_TYPES),
};

const CIRCUIT_CHECKS: Record<(typeof CIRCUIT_FIELDS)[number], Check> = {
  id: checkId,
  rcd_group_id: checkGroupRef,
  name: checkText(MAX_CIRCUIT_NAME_LENGTH),
  rated_current_a: checkList(CIRCUIT_RATED_CURRENTS_A),
  phase_count: checkList(CIRCUIT_PHASE_COUNTS),
  cross_section_mm2: checkList(CIRCUIT_CROSS_SECTIONS_MM2),
  installation: checkList(WLZ_INSTALLATIONS),
  entry_side: checkList(ENTRY_SIDES),
};

function checkItems(
  scope: "group" | "circuit",
  list: unknown,
  max: number,
  checks: Record<string, Check>,
  issues: CircuitIssue[],
): Record<string, unknown>[] | null {
  if (!Array.isArray(list)) {
    issues.push({ scope, index: null, id: null, field: null, code: isAbsent(list) ? "required" : "malformed" });
    return null;
  }
  if (list.length > max) issues.push({ scope, index: null, id: null, field: null, code: "too_many" });
  const items: Record<string, unknown>[] = [];
  list.forEach((item: unknown, index) => {
    if (!isRecord(item)) {
      issues.push({ scope, index, id: null, field: null, code: "malformed" });
      return;
    }
    const id = isUuid(item.id) ? item.id : null;
    for (const [field, check] of Object.entries(checks)) {
      const code = check(item[field]);
      if (code !== null) issues.push({ scope, index, id, field: field as CircuitField, code });
    }
    items.push(item);
  });
  return items;
}

/**
 * The parsed hidden field (the endpoint `JSON.parse`s it; this takes the result) to the row shapes.
 * Never throws. Ids are unique across groups and circuits together — the later occurrence is the
 * one reported. On success the text is trimmed and keys other than the row fields (`position`,
 * `project_id`, …) are dropped, so stored rows can be passed straight in.
 */
export function parseCircuitsPayload(raw: unknown): CircuitsPayloadResult {
  if (!isRecord(raw)) {
    return { ok: false, issues: [{ scope: "payload", index: null, id: null, field: null, code: "malformed" }] };
  }
  const issues: CircuitIssue[] = [];
  const groups = checkItems("group", raw.groups, MAX_GROUPS, GROUP_CHECKS, issues);
  const circuits = checkItems("circuit", raw.circuits, MAX_CIRCUITS, CIRCUIT_CHECKS, issues);

  const seen = new Set<string>();
  const groupIds = new Set<string>();
  const checkDuplicates = (scope: "group" | "circuit", list: unknown) => {
    if (!Array.isArray(list)) return;
    list.forEach((item: unknown, index) => {
      if (!isRecord(item) || !isUuid(item.id)) return;
      const key = item.id.toLowerCase();
      if (seen.has(key)) issues.push({ scope, index, id: item.id, field: "id", code: "duplicate_id" });
      seen.add(key);
      if (scope === "group") groupIds.add(key);
    });
  };
  checkDuplicates("group", raw.groups);
  checkDuplicates("circuit", raw.circuits);

  if (Array.isArray(raw.circuits)) {
    raw.circuits.forEach((item: unknown, index) => {
      if (!isRecord(item) || !isUuid(item.rcd_group_id)) return;
      if (!groupIds.has(item.rcd_group_id.toLowerCase())) {
        const id = isUuid(item.id) ? item.id : null;
        issues.push({ scope: "circuit", index, id, field: "rcd_group_id", code: "unknown_group" });
      }
    });
  }

  if (issues.length > 0 || groups === null || circuits === null) return { ok: false, issues };

  // Every check above passed, so each value below is known to be in its list.
  return {
    ok: true,
    value: {
      groups: groups.map((group) => ({
        id: group.id as string,
        label: (group.label as string).trim(),
        residual_current_ma: group.residual_current_ma as ResidualCurrentMa,
        min_rcd_type: group.min_rcd_type as RcdType,
      })),
      circuits: circuits.map((circuit) => ({
        id: circuit.id as string,
        rcd_group_id: isUuid(circuit.rcd_group_id) ? circuit.rcd_group_id : null,
        name: (circuit.name as string).trim(),
        rated_current_a: circuit.rated_current_a as CircuitRatedCurrentA,
        phase_count: circuit.phase_count as CircuitPhaseCount,
        cross_section_mm2: circuit.cross_section_mm2 as CircuitCrossSectionMm2,
        installation: circuit.installation as WlzInstallation,
        entry_side: circuit.entry_side as EntrySide,
      })),
    },
  };
}

const FIELD_LABEL_KEYS: Record<CircuitField, keyof typeof t.circuitIssues.fields> = {
  id: "id",
  label: "label",
  residual_current_ma: "residualCurrentMa",
  min_rcd_type: "minRcdType",
  rcd_group_id: "rcdGroupId",
  name: "name",
  rated_current_a: "ratedCurrentA",
  phase_count: "phaseCount",
  cross_section_mm2: "crossSectionMm2",
  installation: "installation",
  entry_side: "entrySide",
};

/** "Obwód 3: Prąd znamionowy", "Grupa RCD 1", "Lista obwodów" … */
function issueSubject(issue: CircuitIssue): string {
  const m = t.circuitIssues;
  let owner: string;
  if (issue.scope === "payload") owner = m.payload;
  else if (issue.index === null) owner = issue.scope === "group" ? m.groupList : m.circuitList;
  else owner = issue.scope === "group" ? m.groupNumbered(issue.index + 1) : m.circuitNumbered(issue.index + 1);
  return issue.field === null ? owner : m.subject(owner, m.fields[FIELD_LABEL_KEYS[issue.field]]);
}

/** The ceiling a `too_many` or `too_long` issue refers to. */
function limitFor(issue: CircuitIssue): number {
  if (issue.code === "too_many") return issue.scope === "group" ? MAX_GROUPS : MAX_CIRCUITS;
  return issue.field === "label" ? MAX_GROUP_LABEL_LENGTH : MAX_CIRCUIT_NAME_LENGTH;
}

/** Polish text for one issue. The `Record` keeps it exhaustive over `CircuitIssueCode`. */
export function circuitIssueMessage(issue: CircuitIssue): string {
  const subject = issueSubject(issue);
  const m = t.circuitIssues;
  const messages: Record<CircuitIssueCode, () => string> = {
    malformed: () => m.malformed(subject),
    required: () => m.required(subject),
    not_in_list: () => m.notInList(subject),
    too_long: () => m.tooLong(subject, limitFor(issue)),
    unknown_group: () => m.unknownGroup(subject),
    duplicate_id: () => m.duplicateId(subject),
    too_many: () => m.tooMany(subject, limitFor(issue)),
  };
  return messages[issue.code]();
}
