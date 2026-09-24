import type { APIRoute } from "astro";
import type { TablesInsert } from "@/lib/database.types";
import { DEVICES_PATH, deviceFormErrorPath } from "@/lib/device-catalog";
import { DEVICE_ERROR, deviceErrorFromPostgrest } from "@/lib/device-errors";
import { parseDeviceForm } from "@/lib/device-form";
import { createClient } from "@/lib/supabase";

/**
 * Creates a device from the editor's form. The row is written only after `parseDeviceForm` has run
 * it through `parseDeviceSpec`; the `devices_parameters_match_kind` CHECK is the last line behind
 * it. `/api/admin` is admin-gated in `src/lib/route-access.ts`; RLS is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const back = (code: string) => context.redirect(deviceFormErrorPath(null, code));

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseDeviceForm(form, "create");
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(DEVICE_ERROR.notConfigured);

  // Widened to the table's insert type: the client's excess-property check cannot take the spec's
  // per-kind union directly.
  const row: TablesInsert<"devices"> = parsed.value;
  // Unlike an update, an insert RLS refuses does come back as an error (42501).
  const { error } = await supabase.from("devices").insert(row);
  if (error) return back(deviceErrorFromPostgrest(error));

  return context.redirect(DEVICES_PATH);
};
