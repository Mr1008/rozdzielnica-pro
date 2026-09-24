import type { APIRoute } from "astro";
import { PRICING_ERROR, pricingErrorFromPostgrest } from "@/lib/pricing-errors";
import { PRICING_PROFILE_PATH, parsePricingForm } from "@/lib/pricing-profile";
import { SIGN_IN_PATH } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

/**
 * Saves the signed-in electrician's pricing profile from the profile page's form: one upsert keyed
 * on `user_id`, so the first save inserts and every later one overwrites. `/api/profile` is
 * elektryk-gated in `src/lib/route-access.ts`; RLS on `pricing_profiles` is still the real boundary.
 */
export const POST: APIRoute = async (context) => {
  const back = (code: string) => context.redirect(`${PRICING_PROFILE_PATH}?error=${encodeURIComponent(code)}`);

  // The route gate already refuses an anonymous request; this only keeps `user.id` typed as present.
  const { user } = context.locals;
  if (!user) return context.redirect(SIGN_IN_PATH);

  // A body that is not form data parses as an empty form, and so as `invalid_input`.
  const form = await context.request.formData().catch(() => new FormData());
  const parsed = parsePricingForm(form);
  if (!parsed.ok) return back(parsed.code);

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) return back(PRICING_ERROR.notConfigured);

  // An upsert refused by the RLS `with check` raises `42501` rather than matching zero rows, so the
  // error branch covers it; there is no zero-rows case to check here.
  const { error } = await supabase
    .from("pricing_profiles")
    .upsert({ user_id: user.id, ...parsed.value }, { onConflict: "user_id" });
  if (error) return back(pricingErrorFromPostgrest(error));

  return context.redirect(`${PRICING_PROFILE_PATH}?saved=1`);
};
