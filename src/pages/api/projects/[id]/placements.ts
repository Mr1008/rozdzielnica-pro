import type { APIRoute } from "astro";
import { validateLayout } from "@/lib/cabinet-layout";
import { isUuid } from "@/lib/catalog";
import { computeMatchView } from "@/lib/device-matching-server";
import { LAYOUT_FORM_FIELDS, parsePlacementsPayload } from "@/lib/layout-editing";
import { layoutRpcErrorCode, loadLayoutContext, saveLayoutArgs } from "@/lib/layout-server";
import { projectFormErrorPath, projectPath, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { logServerError, logServerWarn } from "@/lib/server-log";
import { createClient } from "@/lib/supabase";

/** The layout section of the project page, where every redirect from here lands. */
const SECTION_HASH = "#layout";

/** The hidden field's JSON, or undefined when it is missing, a file or not JSON. Never throws. */
function readPayload(form: FormData): unknown {
  const value = form.get(LAYOUT_FORM_FIELDS.placements);
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Stores the electrician's manually edited layout (S-06, FR-009) with the "edited manually" marker,
 * through `save_project_layout` — the same whole-set replace the re-proposal uses. The island only
 * submits drafts that passed `validateLayout`, but a stored layout is never trusted to the client:
 * the set is re-validated here against the stored snapshot and the cabinet snapshot, and refused
 * whole (`layout_invalid`) when it breaks any invariant. Refused unless the match is `current`, like
 * the re-proposal. The 0.5 TE grid is an editor affordance and is not enforced here.
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

  // A body that is not form data parses as an empty form, and so as `invalid_input`: the island
  // submits only drafts it built, so a rejection here means a tampered or scripted POST.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parsePlacementsPayload(readPayload(form));
  if (!parsed.ok) {
    logServerWarn("projects.placements refused", {
      projectId: id,
      userId: context.locals.user.id,
      issueCount: 1,
      issueCodes: PROJECT_ERROR.invalidInput,
    });
    return back(PROJECT_ERROR.invalidInput);
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  const loaded = await loadLayoutContext(supabase, id);
  if (!loaded.ok) return loaded.code === "not_found" ? notFound() : back(PROJECT_ERROR.unknown);

  const { context: match } = loaded;
  if (computeMatchView(match).state !== "current") return back(PROJECT_ERROR.layoutMatchNotCurrent);
  // Unreachable: only the cabinet trigger writes the snapshot, from a parsed geometry.
  if (match.geometry === null) return back(PROJECT_ERROR.unknown);

  // Coverage, rails, overlaps, bars and group contiguity — the same check as every render.
  const layoutIssues = validateLayout(match.snapshot, parsed.placements, match.geometry, match.groups);
  if (layoutIssues.length > 0) {
    logServerWarn("projects.placements refused", {
      projectId: id,
      userId: context.locals.user.id,
      issueCount: layoutIssues.length,
      issueCodes: layoutIssues
        .slice(0, 5)
        .map((issue) => issue.code)
        .join(","),
    });
    return back(PROJECT_ERROR.layoutInvalid);
  }

  const { error } = await supabase.rpc("save_project_layout", saveLayoutArgs(id, parsed.placements, true));
  if (error) {
    logServerError("projects.placements.rpc failed", error, { userId: context.locals.user.id, projectId: id });
    const code = layoutRpcErrorCode(error);
    return code === PROJECT_ERROR.notFound ? notFound() : back(code);
  }

  return context.redirect(`${projectPath(id)}?saved=layout_edited${SECTION_HASH}`);
};
