import type { APIRoute } from "astro";
import { NEW_PROJECT_PATH, parseNewProjectForm, projectPath } from "@/lib/project";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/**
 * Creates a project from the new-project form. The client sends only `cabinet_id`: the
 * `projects_snapshot_cabinet` trigger copies the cabinet's geometry, name, manufacturer, model and
 * price, and raises `P0002` for an archived or missing cabinet. `/api/projects` is elektryk-gated in
 * `src/lib/route-access.ts`; RLS on `projects` is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const back = (code: string) => context.redirect(`${NEW_PROJECT_PATH}?error=${encodeURIComponent(code)}`);

  // The route gate already refuses an anonymous request; this only keeps `user.id` typed as present.
  const { user } = context.locals;
  if (!user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseNewProjectForm(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  // Unlike an update, an insert RLS refuses does come back as an error (42501).
  const { data, error } = await supabase
    .from("projects")
    .insert({ user_id: user.id, ...parsed.value })
    .select("id")
    .single();
  if (error) return back(projectErrorFromPostgrest(error));

  return context.redirect(`${projectPath(data.id)}?created=1`);
};
