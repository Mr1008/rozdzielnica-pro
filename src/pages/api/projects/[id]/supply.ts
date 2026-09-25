import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { PROJECTS_PATH, projectPath } from "@/lib/project";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";
import { parseSupplyForm } from "@/lib/supply-params";

/**
 * Saves a project's OSD/WLZ supply parameters — all seven at once, as the
 * `projects_supply_all_or_nothing` CHECK requires. The warnings from `supplyWarnings` are
 * informational and never block the save; the project page computes them from the stored row.
 * `/api/projects` is elektryk-gated in `src/lib/route-access.ts`; RLS on `projects` is still the
 * real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  // A missing project goes to the list: its own page would only render a 404.
  const notFound = () => context.redirect(`${PROJECTS_PATH}?error=${PROJECT_ERROR.notFound}`);
  if (!isUuid(id)) return notFound();
  const back = (code: string) => context.redirect(`${projectPath(id)}?error=${encodeURIComponent(code)}`);

  // The route gate already refuses an anonymous request.
  if (!context.locals.user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseSupplyForm(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  const { data, error } = await supabase.from("projects").update(parsed.value).eq("id", id).select("id");

  if (error) return back(projectErrorFromPostgrest(error));
  // RLS refuses an update by matching zero rows, with no error: another electrician's project and
  // one that does not exist look the same, and both are simply not found.
  if (data.length === 0) return notFound();

  return context.redirect(`${projectPath(id)}?saved=supply`);
};
