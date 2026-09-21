import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { NOT_CONFIGURED } from "@/lib/auth-errors";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signup?error=${NOT_CONFIGURED}`);
  }
  const { error } = await supabase.auth.signUp({ email, password });

  if (error) {
    // Redirect with the error *code*, not Supabase's English message — the page
    // turns it into Polish via `authErrorMessage`.
    return context.redirect(`/auth/signup?error=${encodeURIComponent(error.code ?? "unknown")}`);
  }

  return context.redirect("/auth/confirm-email");
};
