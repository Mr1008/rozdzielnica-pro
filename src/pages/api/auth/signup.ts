import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { authErrorRecord, isAuthInfraError, NOT_CONFIGURED } from "@/lib/auth-errors";
import { logServerError } from "@/lib/server-log";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData().catch(() => new FormData());
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${NOT_CONFIGURED}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    if (isAuthInfraError(error)) {
      const record = authErrorRecord(error);
      logServerError("auth.signup", record, { status: record.status, path: context.url.pathname });
    }
    // Redirect with the error *code*, not Supabase's English message — the page
    // turns it into Polish via `authErrorMessage`.
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.code ?? "unknown")}`);
  }

  return context.redirect("/auth/confirm-email");
};
