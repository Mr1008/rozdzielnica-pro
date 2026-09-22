import { defineMiddleware } from "astro:middleware";
import { resolveUserRole } from "@/lib/roles";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;

    // The role travels as a `user_role` JWT claim minted by the Postgres access-token hook, so it
    // costs no extra query. `getClaims()` reports failure by returning a null `data`; every such
    // case — and every unrecognised claim value — resolves to `null` in `resolveUserRole`.
    const { data: claims } = await supabase.auth.getClaims();
    context.locals.role = resolveUserRole(claims?.claims);
  } else {
    // `createClient()` returns null when the Supabase env vars are unset — they are `optional: true`
    // in `astro.config.mjs`, so CI builds with no secrets and relies on this branch existing.
    context.locals.user = null;
    context.locals.role = null;
  }

  if (PROTECTED_ROUTES.some((route) => context.url.pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
