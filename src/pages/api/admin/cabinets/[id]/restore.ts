import type { APIRoute } from "astro";
import { CABINETS_PATH, cabinetsErrorPath } from "@/lib/cabinet-catalog";
import { CABINET_ERROR, cabinetErrorFromPostgrest } from "@/lib/cabinet-errors";
import { isUuid } from "@/lib/catalog";
import { createClient } from "@/lib/supabase";

/**
 * Restores an archived cabinet, making it selectable for electricians again. `/api/admin` is
 * admin-gated in `src/lib/route-access.ts`; RLS is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  if (!isUuid(id)) return context.redirect(cabinetsErrorPath(CABINET_ERROR.notFound));

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return context.redirect(cabinetsErrorPath(CABINET_ERROR.notConfigured));

  const { data, error } = await supabase.from("cabinets").update({ archived_at: null }).eq("id", id).select("id");

  if (error) return context.redirect(cabinetsErrorPath(cabinetErrorFromPostgrest(error)));
  // RLS refuses an update by matching zero rows, with no error. The route gate has already turned
  // non-admins away, so here zero rows means the id names no cabinet.
  if (data.length === 0) return context.redirect(cabinetsErrorPath(CABINET_ERROR.notFound));

  return context.redirect(CABINETS_PATH);
};
