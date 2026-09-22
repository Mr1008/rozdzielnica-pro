import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { NOT_CONFIGURED } from "@/lib/auth-errors";
import { resolveUserRole } from "@/lib/roles";
import { signInLanding } from "@/lib/route-access";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${NOT_CONFIGURED}`);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Redirect with the error *code*, not Supabase's English message — the page
    // turns it into Polish via `authErrorMessage`.
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.code ?? "unknown")}`);
  }

  // Read the role off the token that was just issued, so an admin lands on their own panel instead
  // of a page the gate would immediately bounce them away from. An unreadable or unknown claim
  // resolves to `null`, which lands on `/` exactly as before.
  const { data: claims } = await supabase.auth.getClaims(data.session.access_token);

  return context.redirect(signInLanding(resolveUserRole(claims?.claims)));
};
