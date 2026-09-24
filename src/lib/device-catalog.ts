/** The admin device list — where every device write redirects back to. */
export const DEVICES_PATH = "/admin/devices";

export function deviceEditPath(id: string): string {
  return `${DEVICES_PATH}/${id}`;
}

export const NEW_DEVICE_PATH = `${DEVICES_PATH}/new`;

/** The list page with an `?error=<code>` banner. */
export function devicesErrorPath(code: string): string {
  return `${DEVICES_PATH}?error=${encodeURIComponent(code)}`;
}

/** Where the create form posts. */
export const DEVICES_API_PATH = "/api/admin/devices";

/** Where the edit form posts. */
export function deviceApiPath(id: string): string {
  return `${DEVICES_API_PATH}/${id}`;
}

/** Where the list's archive button posts. */
export function deviceArchivePath(id: string): string {
  return `${deviceApiPath(id)}/archive`;
}

/** Where the list's restore button posts. */
export function deviceRestorePath(id: string): string {
  return `${deviceApiPath(id)}/restore`;
}

/** The create (`id` null) or edit form with an `?error=<code>`. */
export function deviceFormErrorPath(id: string | null, code: string): string {
  return `${id === null ? NEW_DEVICE_PATH : deviceEditPath(id)}?error=${encodeURIComponent(code)}`;
}
