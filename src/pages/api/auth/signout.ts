import type { APIRoute } from "astro";
import { authErrorRecord, isAuthInfraError } from "@/lib/auth-errors";
import { logServerError } from "@/lib/server-log";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    // Still redirect: the user asked to leave, and the local cookies are cleared either way.
    if (error && isAuthInfraError(error)) {
      const record = authErrorRecord(error);
      logServerError("auth.signout", record, { status: record.status, path: context.url.pathname });
    }
  }
  return context.redirect("/");
};
