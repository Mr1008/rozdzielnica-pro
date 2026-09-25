import { isUuid } from "@/lib/catalog";

/**
 * An electrician's project (FR-003, FR-004): its paths, and the parsers for its own fields — the
 * details (name, client, site address), the cabinet choice and the delete confirmation. The supply
 * parameters have their own module, `src/lib/supply-params.ts`.
 *
 * The text limits below mirror the named CHECKs in `supabase/migrations/20260924150000_projects.sql`.
 * Change one, change the other. Both count code points: Postgres `char_length` does, and so does
 * `Array.from(s).length` here — `s.length` would count UTF-16 units and disagree on an emoji.
 */

export const PROJECTS_PATH = "/dashboard/projects";
export const NEW_PROJECT_PATH = `${PROJECTS_PATH}/new`;

export function projectPath(id: string): string {
  return `${PROJECTS_PATH}/${id}`;
}

/** The project list with an `?error=` banner — where a project that is not found lands. */
export function projectsErrorPath(code: string): string {
  return `${PROJECTS_PATH}?error=${encodeURIComponent(code)}`;
}

/** Back to the form a write came from with an `?error=` code: the new-project form when `id` is null. */
export function projectFormErrorPath(id: string | null, code: string): string {
  return `${id === null ? NEW_PROJECT_PATH : projectPath(id)}?error=${encodeURIComponent(code)}`;
}

/** The endpoints the project forms post to. */
export const PROJECTS_API_PATH = "/api/projects";

export function projectApiPath(id: string): string {
  return `${PROJECTS_API_PATH}/${id}`;
}

export function projectCabinetApiPath(id: string): string {
  return `${projectApiPath(id)}/cabinet`;
}

export function projectSupplyApiPath(id: string): string {
  return `${projectApiPath(id)}/supply`;
}

export function projectDeleteApiPath(id: string): string {
  return `${projectApiPath(id)}/delete`;
}

export const MAX_PROJECT_NAME_LENGTH = 200;
export const MAX_CLIENT_NAME_LENGTH = 200;
export const MAX_SITE_ADDRESS_LENGTH = 300;

/** The form field names, shared by the pages' inputs and the parsers. */
export const PROJECT_FIELDS = {
  name: "name",
  clientName: "client_name",
  siteAddress: "site_address",
  cabinetId: "cabinet_id",
  confirmDelete: "confirm_delete",
} as const;

export interface ProjectDetails {
  name: string;
  client_name: string | null;
  site_address: string | null;
}

export interface NewProject extends ProjectDetails {
  cabinet_id: string;
}

interface Invalid {
  ok: false;
  code: "invalid_input";
}
type Parsed<T> = { ok: true; value: T } | Invalid;

const INVALID: Invalid = { ok: false, code: "invalid_input" };

/** A missing field reads as blank; a file where text is expected is `undefined` — never valid. */
function readText(form: FormData, name: string): string | null | undefined {
  const value = form.get(name);
  if (value === null) return null;
  return typeof value === "string" ? value : undefined;
}

function codePoints(value: string): number {
  return Array.from(value).length;
}

/** Required text: trimmed, 1…max code points, or undefined. */
function requiredText(raw: string | null | undefined, max: number): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed !== "" && codePoints(trimmed) <= max ? trimmed : undefined;
}

/** Optional text: trimmed, blank becomes null, over max code points is undefined. */
function optionalText(raw: string | null | undefined, max: number): string | null | undefined {
  if (raw === undefined) return undefined;
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  return codePoints(trimmed) <= max ? trimmed : undefined;
}

/**
 * The details form to the column shape, or `invalid_input`. Never throws. A single code is enough:
 * the page's `required` and `maxlength` stop almost every bad value before submit.
 */
export function parseProjectDetailsForm(form: FormData): Parsed<ProjectDetails> {
  const name = requiredText(readText(form, PROJECT_FIELDS.name), MAX_PROJECT_NAME_LENGTH);
  const clientName = optionalText(readText(form, PROJECT_FIELDS.clientName), MAX_CLIENT_NAME_LENGTH);
  const siteAddress = optionalText(readText(form, PROJECT_FIELDS.siteAddress), MAX_SITE_ADDRESS_LENGTH);
  if (name === undefined || clientName === undefined || siteAddress === undefined) return INVALID;
  return { ok: true, value: { name, client_name: clientName, site_address: siteAddress } };
}

/**
 * The picked cabinet's id, or `invalid_input`. Checked before it reaches PostgREST, where a non-UUID
 * would fail as `22P02`. Whether the cabinet exists and is active is the snapshot trigger's call.
 */
export function parseCabinetChoice(form: FormData): Parsed<string> {
  const raw = readText(form, PROJECT_FIELDS.cabinetId);
  const id = typeof raw === "string" ? raw.trim() : raw;
  return isUuid(id) ? { ok: true, value: id } : INVALID;
}

/** The create form: the details plus the cabinet choice. */
export function parseNewProjectForm(form: FormData): Parsed<NewProject> {
  const details = parseProjectDetailsForm(form);
  const cabinet = parseCabinetChoice(form);
  if (!details.ok || !cabinet.ok) return INVALID;
  return { ok: true, value: { ...details.value, cabinet_id: cabinet.value } };
}

/** The delete form: the confirmation checkbox must be ticked, i.e. present as text. */
export function parseDeleteConfirmation(form: FormData): { ok: true } | Invalid {
  return typeof form.get(PROJECT_FIELDS.confirmDelete) === "string" ? { ok: true } : INVALID;
}
