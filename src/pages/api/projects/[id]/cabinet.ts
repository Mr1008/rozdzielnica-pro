import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { parseCabinetChoice, projectFormErrorPath, projectPath, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/**
 * Changes a project's cabinet. Only `cabinet_id` is sent: when it differs from the stored one, the
 * `projects_snapshot_cabinet` trigger re-snapshots from the new cabinet (or raises `P0002` when it
 * is archived or missing); re-selecting the same cabinet leaves the snapshot as it is.
 * `/api/projects` is elektryk-gated in `src/lib/route-access.ts`; RLS on `projects` is still the
 * real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  // A missing project goes to the list: its own page would only render a 404.
  const notFound = () => context.redirect(projectsErrorPath(PROJECT_ERROR.notFound));
  if (!isUuid(id)) return notFound();
  const back = (code: string) => context.redirect(projectFormErrorPath(id, code));

  // The route gate already refuses an anonymous request.
  if (!context.locals.user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseCabinetChoice(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  const { data, error } = await supabase
    .from("projects")
    .update({ cabinet_id: parsed.value })
    .eq("id", id)
    .select("id");

  if (error) return back(projectErrorFromPostgrest(error));
  // RLS refuses an update by matching zero rows, with no error: another electrician's project and
  // one that does not exist look the same, and both are simply not found.
  if (data.length === 0) return notFound();

  return context.redirect(`${projectPath(id)}?saved=cabinet`);
};
