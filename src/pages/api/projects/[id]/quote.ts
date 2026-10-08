import type { APIRoute } from "astro";
import { isUuid } from "@/lib/catalog";
import { computeMatchView, loadMatchContext } from "@/lib/device-matching-server";
import { projectFormErrorPath, projectPath, projectsErrorPath } from "@/lib/project";
import { PROJECT_ERROR, projectErrorFromPostgrest } from "@/lib/project-errors";
import { computeQuoteView, parseLabourOverrideForm } from "@/lib/quote";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/** The quote section of the project page, where every redirect from here lands. */
const SECTION_HASH = "#quote";

/** The project columns the quote needs: what `loadMatchContext` reads, plus the cabinet line. */
const PROJECT_COLUMNS =
  "premeter_protection_a, earthing_system, phase_count, wlz_length_m, wlz_cross_section_mm2, wlz_material, wlz_installation, cabinet_geometry, cabinet_name, cabinet_price_grosze";

/**
 * Sets or clears the electrician's labour-time override on the quote (FR-011). On `set` the estimate
 * the override is measured against is recomputed here, from the same `computeQuoteView` the page
 * uses, and stored as `labour_override_base_minutes` — the client never supplies it. Setting is
 * refused unless the quote is `ready` (a pricing profile and a `current` match); clearing has no
 * precondition, so a stale override can always be cleared. Totals are never stored.
 * `/api/projects` is elektryk-gated in `src/lib/route-access.ts`; RLS on `projects` is still the
 * real boundary.
 */
export const POST: APIRoute = async (context) => {
  const { id } = context.params;
  // A missing project goes to the list: its own page would only render a 404.
  const notFound = () => context.redirect(projectsErrorPath(PROJECT_ERROR.notFound));
  if (!isUuid(id)) return notFound();
  const back = (code: string) => context.redirect(`${projectFormErrorPath(id, code)}${SECTION_HASH}`);

  // The route gate already refuses an anonymous request.
  const { user } = context.locals;
  if (!user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parseLabourOverrideForm(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PROJECT_ERROR.notConfigured);

  let patch: { labour_minutes_override: number | null; labour_override_base_minutes: number | null };
  if (parsed.intent === "clear") {
    patch = { labour_minutes_override: null, labour_override_base_minutes: null };
  } else {
    const [project, profile] = await Promise.all([
      supabase.from("projects").select(PROJECT_COLUMNS).eq("id", id).maybeSingle(),
      supabase
        .from("pricing_profiles")
        .select("hourly_rate_grosze, mount_minutes_per_device, project_overhead_minutes")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
    for (const [what, error] of [
      ["projects", project.error],
      ["pricing_profiles", profile.error],
    ] as const) {
      if (error !== null) {
        // Only the SQLSTATE / PostgREST code — never Supabase's message text.
        // eslint-disable-next-line no-console
        console.error(`quote override load failed: ${what}`, error.code);
        return back(PROJECT_ERROR.unknown);
      }
    }
    // RLS hides another electrician's project: it reads as missing, like one that does not exist.
    if (project.data === null) return notFound();

    const loaded = await loadMatchContext(supabase, id, project.data);
    if (!loaded.ok) return loaded.code === "not_found" ? notFound() : back(PROJECT_ERROR.unknown);

    const view = computeQuoteView({
      matchView: computeMatchView(loaded.context),
      cabinet: { name: project.data.cabinet_name, priceGrosze: project.data.cabinet_price_grosze },
      profile: profile.data,
      override: null,
    });
    if (view.state === "no_profile") return back(PROJECT_ERROR.quotePricingNotConfigured);
    if (view.state === "not_current") return back(PROJECT_ERROR.quoteMatchNotCurrent);

    // The base is today's estimate, recomputed here — never the client's. Accepted gap (impl-review
    // F3, 2026-10-08): an estimate that moved between the page render and this POST (a re-match in
    // another tab) becomes the base, so the override is not flagged outdated against a number the
    // electrician never saw. Rare with one user per account; a hidden "displayed estimate" field
    // compared here would close it.
    patch = { labour_minutes_override: parsed.minutes, labour_override_base_minutes: view.estimateMinutes };
  }

  const { data, error } = await supabase.from("projects").update(patch).eq("id", id).select("id");

  if (error) return back(projectErrorFromPostgrest(error));
  // RLS refuses an update by matching zero rows, with no error: another electrician's project and
  // one that does not exist look the same, and both are simply not found.
  if (data.length === 0) return notFound();

  return context.redirect(`${projectPath(id)}?saved=quote${SECTION_HASH}`);
};
