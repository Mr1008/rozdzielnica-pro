import { NO_ROLE } from "@/lib/auth-errors";
import type { UserRole } from "@/lib/roles";

/**
 * Which roles may reach which paths, and where everyone else is sent.
 *
 * The decision is a pure function so it can be unit-tested directly; `src/middleware.ts` only
 * applies its verdict. Gate a new page by adding an entry to `PROTECTED_ROUTES` — never by
 * checking the role inside the page, which would leave the page reachable if someone forgets.
 */

interface ProtectedRoute {
  /** Matched with `startsWith`, so `/dashboard` also covers `/dashboard/*`. */
  readonly prefix: string;
  readonly roles: readonly UserRole[];
}

export const PROTECTED_ROUTES: readonly ProtectedRoute[] = [
  { prefix: "/dashboard", roles: ["elektryk"] },
  { prefix: "/admin", roles: ["admin"] },
  // The admin form endpoints. `/admin` does not cover them — prefixes match whole path segments —
  // so without this a non-admin POST would reach Supabase, where RLS is still the real boundary.
  { prefix: "/api/admin", roles: ["admin"] },
  // The electrician's own profile endpoints (pricing). `/dashboard` does not cover them, for the
  // same reason; RLS on `pricing_profiles` is still the real boundary.
  { prefix: "/api/profile", roles: ["elektryk"] },
];

/**
 * Where a signed-in user belongs when they ask for a route their role cannot reach.
 *
 * The invariant that keeps this loop-free: **every entry here must be a path its own role is
 * allowed to open** (or an ungated path). A redirect target that the redirected user is in turn
 * refused would bounce between two gated routes forever. `route-access.test.ts` asserts the
 * invariant over `USER_ROLES`, so a future entry that breaks it fails the unit suite.
 */
export const ROLE_HOME: Record<UserRole, string> = {
  admin: "/admin",
  elektryk: "/dashboard",
};

export const SIGN_IN_PATH = "/auth/signin";

/**
 * A signed-in user whose token carries no recognised role reaches no gated route at all. They land
 * on the public home page with an error code, which `src/pages/index.astro` turns into Polish via
 * `authErrorMessage` — the same code-not-message pattern the auth routes use.
 */
export const NO_ROLE_PATH = `/?error=${NO_ROLE}`;

export type RouteAccess = { readonly allowed: true } | { readonly allowed: false; readonly redirectTo: string };

export interface RouteRequest {
  readonly pathname: string;
  readonly isSignedIn: boolean;
  readonly role: UserRole | null;
}

const ALLOWED: RouteAccess = { allowed: true };

/**
 * A prefix matches its own path and its subtree, and nothing else.
 *
 * A bare `startsWith` would also swallow same-prefix siblings: `/administrator` starts with
 * `/admin`, so it would be admin-gated by accident. That direction fails closed rather than open,
 * which is why it is a correctness trap and not a hole — the next `/admin`-prefixed page would be
 * silently misgated, with a redirect that looks like the gate working correctly.
 */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Fails closed: anything other than "signed in, with a role the route names" is a redirect.
 */
export function resolveRouteAccess({ pathname, isSignedIn, role }: RouteRequest): RouteAccess {
  const route = PROTECTED_ROUTES.find((candidate) => matchesPrefix(pathname, candidate.prefix));
  if (!route) return ALLOWED;

  if (!isSignedIn) return { allowed: false, redirectTo: SIGN_IN_PATH };
  if (role === null) return { allowed: false, redirectTo: NO_ROLE_PATH };
  if (route.roles.includes(role)) return ALLOWED;

  return { allowed: false, redirectTo: ROLE_HOME[role] };
}

/**
 * Where a freshly signed-in user lands.
 *
 * Deliberately *not* `ROLE_HOME`: an electrician keeps landing on the public home page, which is
 * what the app has always done, while `ROLE_HOME` is only about bouncing a wrong-role request back
 * somewhere useful. An admin is the one role with its own destination.
 */
export function signInLanding(role: UserRole | null): string {
  return role === "admin" ? ROLE_HOME.admin : "/";
}
