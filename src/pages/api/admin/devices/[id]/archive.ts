import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { DEVICES_PATH, devicesErrorPath } from "@/lib/device-catalog";
import { DEVICE_ERROR, deviceErrorFromPostgrest } from "@/lib/device-errors";
import { createClient } from "@/lib/supabase";

/**
 * Archives a device: it stays in the catalog for the admin, but device matching no longer offers
 * it. Nothing is ever hard-deleted. `/api/admin` is admin-gated in `src/lib/route-access.ts`; RLS is
 * still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  if (!isUuid(id)) return context.redirect(devicesErrorPath(DEVICE_ERROR.notFound));

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return context.redirect(devicesErrorPath(DEVICE_ERROR.notConfigured));

  const { data, error } = await supabase
    .from("devices")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");

  if (error) return context.redirect(devicesErrorPath(deviceErrorFromPostgrest(error)));
  // RLS refuses an update by matching zero rows, with no error. The route gate has already turned
  // non-admins away, so here zero rows means the id names no device.
  if (data.length === 0) return context.redirect(devicesErrorPath(DEVICE_ERROR.notFound));

  return context.redirect(DEVICES_PATH);
};
