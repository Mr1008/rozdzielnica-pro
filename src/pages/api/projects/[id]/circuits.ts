import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { CIRCUIT_FORM_FIELDS, parseCircuitsPayload } from "@/lib/circuit-params";
import { matchDevices } from "@/lib/device-matching";
import { circuitsRpcErrorCode, loadMatchBase, saveCircuitsArgs } from "@/lib/device-matching-server";
import { projectFormErrorPath, projectPath, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR } from "@/lib/project-errors";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/** The circuits section of the project page, where every redirect from here lands. */
const SECTION_HASH = "#circuits";

/** The hidden field's JSON, or undefined when it is missing, a file or not JSON. Never throws. */
function readPayload(form: FormData): unknown {
  const value = form.get(CIRCUIT_FORM_FIELDS.payload);
  if (typeof value !== "string") return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Saves a project's RCD groups and circuits and replaces its device snapshot in one RPC
 * (`save_project_circuits`). Matching runs on the submitted set against the caller's supply and the
 * active catalog; a gap or a blocker is stored as an empty snapshot, never as a substitute device.
 * `/api/projects` is elektryk-gated in `src/lib/route-access.ts`; RLS on the circuit tables is still
 * the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  // A missing project goes to the list: its own page would only render a 404.
  const notFound = () => context.redirect(projectsErrorPath(PROJECT_ERROR.notFound));
  if (!isUuid(id)) return notFound();
  const back = (code: string) => context.redirect(`${projectFormErrorPath(id, code)}${SECTION_HASH}`);

  // The route gate already refuses an anonymous request.
  if (!context.locals.user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data parses as an empty form, and so as `circuits_invalid`. The island
  // has already shown per-field issues, so a rejection here means a tampered or scripted POST.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseCircuitsPayload(readPayload(form));
  if (!parsed.ok) return back(PROJECT_ERROR.circuitsInvalid);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  // The stored rows are not needed: the match runs on the submitted groups and circuits.
  const loaded = await loadMatchBase(supabase, id);
  if (!loaded.ok) return loaded.code === "not_found" ? notFound() : back(PROJECT_ERROR.unknown);

  const result = matchDevices(
    { supply: loaded.base.supply, groups: parsed.value.groups, circuits: parsed.value.circuits },
    loaded.base.catalog,
  );

  const { error } = await supabase.rpc("save_project_circuits", saveCircuitsArgs(id, parsed.value, result));
  if (error) {
    const code = circuitsRpcErrorCode(error);
    return code === PROJECT_ERROR.notFound ? notFound() : back(code);
  }

  return context.redirect(`${projectPath(id)}?saved=circuits${SECTION_HASH}`);
};
