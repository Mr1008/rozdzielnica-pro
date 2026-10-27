import { defineMiddleware } from "astro:middleware";
import { resolveTimeZone } from "@/lib/i18n";
import { resolveUserRole } from "@/lib/roles";
import { authErrorRecord, isAuthInfraError } from "@/lib/auth-errors";
import { resolveRouteAccess, UNAVAILABLE_PATH } from "@/lib/route-access";
import { logServerError, logServerWarn } from "@/lib/server-log";
import { createClient } from "@/lib/supabase";

/**
 * True when Supabase Auth itself is down: an infra-class error that is a 5xx or a transport failure
 * (no status, or 0). A 4xx with a code (an expired or invalid JWT, a vanished session) means "this
 * cookie is no good" and stays "no session", as it was before errors were read. `AuthSessionMissingError`
 * is the normal anonymous case and is never an outage. Logs only a real outage, never the email.
 */
function isAuthOutage(source: string, error: unknown, path: string): boolean {
  if (!error || !isAuthInfraError(error)) return false;
  const record = authErrorRecord(error);
  if (record.status !== null && record.status !== 0 && record.status < 500) return false;
  logServerError(`auth.${source} failed`, record, { status: record.status, path });
  return true;
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Cloudflare attaches `cf` to the incoming request (`Astro.request.cf` since Astro 6); its `timezone`
  // is geolocated from the IP. It is absent outside the Workers runtime, which `resolveTimeZone` covers.
  const cf = (context.request as Request & { cf?: { timezone?: unknown } }).cf;
  context.locals.timeZone = resolveTimeZone(cf?.timezone);

  const supabase = createClient(context.request.headers, context.cookies);

  let authUnavailable = false;

  if (supabase) {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
    authUnavailable = isAuthOutage("getUser", userError, context.url.pathname);

    // The role travels as a `user_role` JWT claim minted by the Postgres access-token hook, so it
    // costs no extra query. `getClaims()` reports failure by returning a null `data`; every such
    // case — and every unrecognised claim value — resolves to `null` in `resolveUserRole`.
    const { data: claims, error: claimsError } = await supabase.auth.getClaims();
    context.locals.role = resolveUserRole(claims?.claims);
    if (!authUnavailable) authUnavailable = isAuthOutage("getClaims", claimsError, context.url.pathname);

    // A signed-in user with no recognised role is refused every gated route; record why, without the email.
    if (context.locals.user !== null && context.locals.role === null) {
      logServerWarn("auth.claims missing", {
        userId: context.locals.user.id,
        hasUserRoleClaim: claims?.claims && "user_role" in claims.claims ? 1 : 0,
        path: context.url.pathname,
      });
    }
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
    authUnavailable,
  });

  if (!access.allowed) {
    // A rewrite via `next(path)` does not re-run the middleware (`context.rewrite` would loop on the
    // outage) and keeps the status the page sets, which a redirect would lose.
    if ("unavailable" in access) return next(UNAVAILABLE_PATH);
    return context.redirect(access.redirectTo);
  }

  return next();
});
