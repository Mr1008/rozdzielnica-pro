import type { APIRoute } from "astro";
import { CABINETS_PATH, cabinetFormErrorPath, cabinetsErrorPath, isUuid } from "@/lib/cabinet-catalog";
import { CABINET_ERROR, cabinetErrorFromPostgrest } from "@/lib/cabinet-errors";
import { parseCabinetForm } from "@/lib/cabinet-form";
import { createClient } from "@/lib/supabase";

/**
 * Updates a cabinet from the editor's form. The geometry is written only after `parseCabinetForm`
 * has run it through `parseCabinetGeometry`. `/api/admin` is admin-gated in
 * `src/lib/route-access.ts`; RLS is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  // A missing cabinet goes to the list: its edit page would only render a 404.
  if (!isUuid(id)) return context.redirect(cabinetsErrorPath(CABINET_ERROR.notFound));
  const back = (code: string) => context.redirect(cabinetFormErrorPath(id, code));

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseCabinetForm(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(CABINET_ERROR.notConfigured);

  const { data, error } = await supabase.from("cabinets").update(parsed.value).eq("id", id).select("id");

  if (error) return back(cabinetErrorFromPostgrest(error));
  // RLS refuses an update by matching zero rows, with no error. The route gate has already turned
  // non-admins away, so here zero rows means the id names no cabinet.
  if (data.length === 0) return context.redirect(cabinetsErrorPath(CABINET_ERROR.notFound));

  return context.redirect(CABINETS_PATH);
};
