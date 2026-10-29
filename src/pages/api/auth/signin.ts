import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { authErrorRecord, isAuthInfraError, NOT_CONFIGURED } from "@/lib/auth-errors";
import { resolveUserRole } from "@/lib/roles";
import { signInLanding } from "@/lib/route-access";
import { logServerError, logServerWarn } from "@/lib/server-log";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => new FormData());
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${NOT_CONFIGURED}`);
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Only an Auth failure is logged; a wrong password or unconfirmed email is the user's, not ours.
    if (isAuthInfraError(error)) {
      const record = authErrorRecord(error);
      logServerError("auth.signin", record, { status: record.status, path: context.url.pathname });
    }
    // Redirect with the error *code*, not Supabase's English message — the page
    // turns it into Polish via `authErrorMessage`.
    return context.redirect(`/auth/signin?error=${encodeURIComponent(error.code ?? "unknown")}`);
  }

  // Read the role off the token that was just issued, so each role lands straight on its own panel.
  // An unreadable or unknown claim resolves to `null`, which lands on `/`.
  const { data: claims } = await supabase.auth.getClaims(data.session.access_token);
  const role = resolveUserRole(claims?.claims);
  if (role === null) {
    logServerWarn("auth.claims missing", {
      userId: data.user.id,
      hasUserRoleClaim: claims?.claims && "user_role" in claims.claims ? 1 : 0,
      path: context.url.pathname,
    });
  }

  return context.redirect(signInLanding(role));
};
