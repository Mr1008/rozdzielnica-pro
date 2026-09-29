import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { matchDevices } from "@/lib/device-matching";
import { circuitsRpcErrorCode, loadMatchContext, saveCircuitsArgs } from "@/lib/device-matching-server";
import { projectFormErrorPath, projectPath, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/** The circuits section of the project page, where every redirect from here lands. */
const SECTION_HASH = "#circuits";

/**
 * Re-runs matching on the project's stored groups and circuits and replaces its device snapshot —
 * the "Dobierz ponownie" button after a catalog or supply change. No body fields: the groups and
 * circuits go back to `save_project_circuits` unchanged, so only the snapshot moves. A gap or a
 * blocker stores an empty snapshot, never a substitute device.
 * `/api/projects` is elektryk-gated in `src/lib/route-access.ts`; RLS is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  // A missing project goes to the list: its own page would only render a 404.
  const notFound = () => context.redirect(projectsErrorPath(PROJECT_ERROR.notFound));
  if (!isUuid(id)) return notFound();
  const back = (code: string) => context.redirect(`${projectFormErrorPath(id, code)}${SECTION_HASH}`);

  // The route gate already refuses an anonymous request.
  if (!context.locals.user) return context.redirect(SIGN_IN_PATH);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  const loaded = await loadMatchContext(supabase, id);
  if (!loaded.ok) return loaded.code === "not_found" ? notFound() : back(PROJECT_ERROR.unknown);

  const { supply, groups, circuits, catalog } = loaded.context;
  const result = matchDevices({ supply, groups, circuits }, catalog);

  const { error } = await supabase.rpc("save_project_circuits", saveCircuitsArgs(id, { groups, circuits }, result));
  if (error) {
    const code = circuitsRpcErrorCode(error);
    return code === PROJECT_ERROR.notFound ? notFound() : back(code);
  }

  return context.redirect(`${projectPath(id)}?saved=rematch${SECTION_HASH}`);
};
