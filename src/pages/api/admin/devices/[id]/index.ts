import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { DEVICES_PATH, deviceFormErrorPath, devicesErrorPath } from "@/lib/device-catalog";
import { DEVICE_ERROR, deviceErrorFromPostgrest } from "@/lib/device-errors";
import { parseDeviceForm } from "@/lib/device-form";
import { createClient } from "@/lib/supabase";

/**
 * Updates a device from the editor's form. The row is written only after `parseDeviceForm` has run
 * it through `parseDeviceSpec`, and the payload never contains `kind`, so a device's kind cannot
 * change. `/api/admin` is admin-gated in `src/lib/route-access.ts`; RLS is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  // A missing device goes to the list: its edit page would only render a 404.
  if (!isUuid(id)) return context.redirect(devicesErrorPath(DEVICE_ERROR.notFound));
  const back = (code: string) => context.redirect(deviceFormErrorPath(id, code));

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseDeviceForm(form, "update");
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(DEVICE_ERROR.notConfigured);

  const { data, error } = await supabase.from("devices").update(parsed.value).eq("id", id).select("id");

  if (error) return back(deviceErrorFromPostgrest(error));
  // RLS refuses an update by matching zero rows, with no error. The route gate has already turned
  // non-admins away, so here zero rows means the id names no device.
  if (data.length === 0) return context.redirect(devicesErrorPath(DEVICE_ERROR.notFound));

  return context.redirect(DEVICES_PATH);
};
