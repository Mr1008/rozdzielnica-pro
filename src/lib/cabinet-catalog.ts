/** The admin catalog list — where every cabinet write redirects back to. */
export const CABINETS_PATH = "/admin/cabinets";

export function cabinetEditPath(id: string): string {
  return `${CABINETS_PATH}/${id}`;
}

export const NEW_CABINET_PATH = `${CABINETS_PATH}/new`;

/** The list page with an `?error=<code>` banner. */
export function cabinetsErrorPath(code: string): string {
  return `${CABINETS_PATH}?error=${encodeURIComponent(code)}`;
}

/** Where the create form posts. */
export const CABINETS_API_PATH = "/api/admin/cabinets";

/** Where the edit form posts. */
export function cabinetApiPath(id: string): string {
  return `${CABINETS_API_PATH}/${id}`;
}

/** Where the list's archive button posts. */
export function cabinetArchivePath(id: string): string {
  return `${cabinetApiPath(id)}/archive`;
}

/** Where the list's restore button posts. */
export function cabinetRestorePath(id: string): string {
  return `${cabinetApiPath(id)}/restore`;
}

/**
 * The create (`id` null) or edit form with an `?error=<code>`: the editor restores the admin's
 * draft from `sessionStorage` only when this parameter is present.
 */
export function cabinetFormErrorPath(id: string | null, code: string): string {
  return `${id === null ? NEW_CABINET_PATH : cabinetEditPath(id)}?error=${encodeURIComponent(code)}`;
}
