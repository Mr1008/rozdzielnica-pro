import { defineMiddleware } from "astro:middleware";
import { resolveTimeZone } from "@/lib/i18n";
import { resolveUserRole } from "@/lib/roles";
import { resolveRouteAccess } from "@/lib/route-access";
import { createClient } from "@/lib/supabase";

export const onRequest = defineMiddleware(async (context, next) => {
  // Cloudflare attaches `cf` to the incoming request (`Astro.request.cf` since Astro 6); its `timezone`
  // is geolocated from the IP. It is absent outside the Workers runtime, which `resolveTimeZone` covers.
  const cf = (context.request as Request & { cf?: { timezone?: unknown } }).cf;
  context.locals.timeZone = resolveTimeZone(cf?.timezone);

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

  // Which roles may reach which paths lives in `@/lib/route-access`, as a pure function — gate a new
  // page by adding an entry there, never by checking the role inside the page.
  const access = resolveRouteAccess({
    pathname: context.url.pathname,
    isSignedIn: context.locals.user !== null,
    role: context.locals.role,
  });

  if (!access.allowed) {
    return context.redirect(access.redirectTo);
  }

  return next();
});
