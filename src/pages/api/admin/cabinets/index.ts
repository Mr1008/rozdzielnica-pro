import type { APIRoute } from "astro";
import { CABINETS_PATH, cabinetFormErrorPath } from "@/lib/cabinet-catalog";
import { CABINET_ERROR, cabinetErrorFromPostgrest } from "@/lib/cabinet-errors";
import { parseCabinetForm } from "@/lib/cabinet-form";
import { createClient } from "@/lib/supabase";

/**
 * Creates a cabinet from the editor's form. The geometry is written only after `parseCabinetForm`
 * has run it through `parseCabinetGeometry` — the database checks nothing inside it. `/api/admin` is
 * admin-gated in `src/lib/route-access.ts`; RLS is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const back = (code: string) => context.redirect(cabinetFormErrorPath(null, code));

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseCabinetForm(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(CABINET_ERROR.notConfigured);

  // Unlike an update, an insert RLS refuses does come back as an error (42501).
  const { error } = await supabase.from("cabinets").insert(parsed.value);
  if (error) return back(cabinetErrorFromPostgrest(error));

  return context.redirect(CABINETS_PATH);
};
