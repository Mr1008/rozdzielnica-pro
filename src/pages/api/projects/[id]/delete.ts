import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { parseDeleteConfirmation, projectFormErrorPath, PROJECTS_PATH, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/**
 * Hard-deletes a project, but only when the form's confirmation checkbox is ticked — the page marks
 * it `required`, and this re-checks it for a scripted POST. `/api/projects` is elektryk-gated in
 * `src/lib/route-access.ts`; RLS on `projects` is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  const notFound = () => context.redirect(projectsErrorPath(PROJECT_ERROR.notFound));
  if (!isUuid(id)) return notFound();
  const back = (code: string) => context.redirect(projectFormErrorPath(id, code));

  // The route gate already refuses an anonymous request.
  if (!context.locals.user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const confirmed = parseDeleteConfirmation(form);
  if (!confirmed.ok) return back(confirmed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  const { data, error } = await supabase.from("projects").delete().eq("id", id).select("id");

  if (error) return back(projectErrorFromPostgrest(error));
  // RLS refuses a delete by matching zero rows, with no error: another electrician's project and one
  // that does not exist look the same, and both are simply not found.
  if (data.length === 0) return notFound();

  return context.redirect(`${PROJECTS_PATH}?deleted=1`);
};
