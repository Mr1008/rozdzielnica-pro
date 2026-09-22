import { z } from "zod";

/**
 * The role vocabulary, mirroring the `public.user_role` Postgres enum exactly. The PRD closes the
 * list at two, so this array is the whole vocabulary — not a starting point.
 */
export const USER_ROLES = ["admin", "elektryk"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const userRoleSchema = z.enum(USER_ROLES);

/**
 * The custom claim is `user_role`, **never** `role`: Supabase's own `role` claim is a required
 * field holding `authenticated`/`anon`, and PostgREST switches database roles on it. Reading
 * `role` here would resolve every signed-in user to "no recognised role".
 */
const roleClaimSchema = z.object({ user_role: userRoleSchema });

/**
 * Turn a claims object into a typed role.
 *
 * The argument is `unknown` on purpose: `JwtPayload` ends in `[key: string]: any`, so every claim
 * read off it is an unchecked `any` that the repo's `strictTypeChecked` lint config rejects. This
 * is the one place that narrowing happens.
 *
 * Anything that is not one of the two known roles — an absent claim, an unknown string, a value of
 * the wrong type, or no claims at all — resolves to `null` rather than throwing. A single
 * well-defined "no role" case is what lets callers fail closed without a try/catch.
 */
export function resolveUserRole(claims: unknown): UserRole | null {
  const result = roleClaimSchema.safeParse(claims);
  return result.success ? result.data.user_role : null;
}
