import { t } from "@/lib/i18n";
import type { UserRole } from "@/lib/roles";
import { ROLE_HOME } from "@/lib/route-access";

export interface RoleHomeLink {
  href: string;
  label: string;
}

/**
 * The signed-in role's own home, as a navigation link — shared by the app header bar and the landing
 * page. Each role links at its own home: pointing everyone at /dashboard would give an admin a
 * dead-end link, because the route gate refuses it and bounces them straight back to /admin. A user
 * with no recognised role gets no link at all, because no gated route will let them in.
 */
export function roleHomeLink(role: UserRole | null): RoleHomeLink | null {
  if (role === null) return null;
  return { href: ROLE_HOME[role], label: role === "admin" ? t.nav.admin : t.nav.dashboard };
}
