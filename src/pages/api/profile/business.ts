import type { APIRoute } from "astro";
import { BUSINESS_ERROR, businessErrorFromPostgrest } from "@/lib/business-errors";
import { BUSINESS_PROFILE_PATH, parseBusinessForm } from "@/lib/business-profile";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/**
 * Saves the signed-in electrician's company details from the profile page's second card: one upsert
 * keyed on `user_id`, so the first save inserts and every later one overwrites (an all-empty form
 * saves nulls; a body that is not a form is refused). `/api/profile` is elektryk-gated in `src/lib/route-access.ts`; RLS on
 * `business_profiles` is still the real boundary. It reports with `businessError` / `businessSaved`,
 * apart from the pricing card's `error` / `saved`.
 */
export const POST: APIRoute = async (context) => {
  const back = (code: string) => context.redirect(`${BUSINESS_PROFILE_PATH}?businessError=${encodeURIComponent(code)}`);

  // The route gate already refuses an anonymous request; this only keeps `user.id` typed as present.
  const { user } = context.locals;
  if (!user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data is `invalid_input`, never an empty form: every field is optional,
  // so an empty form would wipe the stored details. Only a real, all-empty form clears them.
  const form = await context.request.formData().catch(() => null);
  if (form === null) return back(BUSINESS_ERROR.invalidInput);
  const parsed = parseBusinessForm(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(BUSINESS_ERROR.notConfigured);

  // An upsert refused by the RLS `with check` raises `42501` rather than matching zero rows.
  const { error } = await supabase
    .from("business_profiles")
    .upsert({ user_id: user.id, ...parsed.value }, { onConflict: "user_id" });
  if (error) return back(businessErrorFromPostgrest(error));

  return context.redirect(`${BUSINESS_PROFILE_PATH}?businessSaved=1`);
};
