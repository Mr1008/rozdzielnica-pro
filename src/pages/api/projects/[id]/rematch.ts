import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { matchDevices } from "@/lib/device-matching";
import { cabinetBarKinds, circuitsRpcErrorCode, saveCircuitsArgs } from "@/lib/device-matching-server";
import { chooseSelectionLayout, loadLayoutContext } from "@/lib/layout-server";
import { projectFormErrorPath, projectPath, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/** The circuits section of the project page, where every redirect from here lands. */
const SECTION_HASH = "#circuits";

/**
 * Re-runs matching on the project's stored groups and circuits and replaces its device snapshot —
 * the "Dobierz ponownie" button after a catalog or supply change. No body fields: the groups and
 * circuits go back to `save_project_circuits` unchanged, so only the snapshot (and its proposed
 * layout) moves. A gap or a blocker stores an empty snapshot, never a substitute device. A manual
 * layout (S-06) is kept when it still applies to the new device set as a whole and validates;
 * otherwise a fresh proposal replaces it and the redirect says so (`layout_reset=1`).
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

  // Read before the RPC, which deletes the old snapshot and its placements.
  const loaded = await loadLayoutContext(supabase, id);
  if (!loaded.ok) return loaded.code === "not_found" ? notFound() : back(PROJECT_ERROR.unknown);

  const { supply, groups, circuits, catalog, geometry, snapshot } = loaded.context;
  const result = matchDevices({ supply, groups, circuits, cabinetBarKinds: cabinetBarKinds(geometry) }, catalog);
  // A new match carries a still-valid manual layout over, or gets a new proposal, stored in the same
  // RPC (none when it does not fit).
  const choice = chooseSelectionLayout(
    { snapshot, placements: loaded.placements, editedManually: loaded.editedManually },
    result,
    catalog,
    { groups, circuits },
    geometry,
  );

  const { error } = await supabase.rpc(
    "save_project_circuits",
    saveCircuitsArgs(id, { groups, circuits }, result, choice.layout, choice.editedManually),
  );
  if (error) {
    const code = circuitsRpcErrorCode(error);
    return code === PROJECT_ERROR.notFound ? notFound() : back(code);
  }

  const reset = choice.reset ? "&layout_reset=1" : "";
  return context.redirect(`${projectPath(id)}?saved=rematch${reset}${SECTION_HASH}`);
};
