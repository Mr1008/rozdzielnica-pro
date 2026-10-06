import type { APIRoute } from "astro";
import { proposeLayout } from "@/lib/cabinet-layout";
import { isUuid } from "@/lib/catalog";
import { computeMatchView } from "@/lib/device-matching-server";
import { layoutRpcErrorCode, loadLayoutContext, saveLayoutArgs } from "@/lib/layout-server";
import { projectFormErrorPath, projectPath, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/** The layout section of the project page, where every redirect from here lands. */
const SECTION_HASH = "#layout";

/**
 * Re-proposes the cabinet layout from the stored device snapshot and replaces the stored placements
 * (`save_project_layout`) — the "Zaproponuj układ" button after a cabinet change or when the stored
 * layout is outdated. No body fields. Refused unless the match is `current`: a layout is only ever
 * proposed for a snapshot the page may show as matched. The device set itself never changes here.
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

  const loaded = await loadLayoutContext(supabase, id);
  if (!loaded.ok) return loaded.code === "not_found" ? notFound() : back(PROJECT_ERROR.unknown);

  const { context: match } = loaded;
  if (computeMatchView(match).state !== "current") return back(PROJECT_ERROR.layoutMatchNotCurrent);
  // Unreachable: only the cabinet trigger writes the snapshot, from a parsed geometry.
  if (match.geometry === null) return back(PROJECT_ERROR.unknown);

  const proposal = proposeLayout({
    devices: match.snapshot,
    groups: match.groups,
    circuits: match.circuits,
    geometry: match.geometry,
  });
  if (!proposal.ok) return back(PROJECT_ERROR.layoutDoesNotFit);

  const { error } = await supabase.rpc("save_project_layout", saveLayoutArgs(id, proposal.placements));
  if (error) {
    const code = layoutRpcErrorCode(error);
    return code === PROJECT_ERROR.notFound ? notFound() : back(code);
  }

  return context.redirect(`${projectPath(id)}?saved=layout${SECTION_HASH}`);
};
