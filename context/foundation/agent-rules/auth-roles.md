# Auth and roles

- **The role claim is `user_role`, never `role`.** Supabase's own `role` claim is required and holds
  `authenticated`/`anon` — PostgREST switches database roles on it, so overwriting or reading it
  instead resolves every signed-in user to "no recognised role". The claim is minted by
  `public.custom_access_token_hook` and narrowed in exactly one place, `src/lib/roles.ts`.
- **A role change does not take effect until the user's next token.** `is_admin()` and the
  role-change trigger both read the `user_role` claim baked into the access token, never the live
  `profiles.role`. So a demoted admin keeps admin power — including the ability to set their own
  role back — until their token expires (`jwt_expiry`, 3600s). Accepted for now because nothing in
  the app demotes anyone: there is no user-management UI, and role changes happen by direct SQL.
  **Whoever builds one must invalidate the session** (`supabase.auth.admin.signOut(userId, 'global')`
  or equivalent) as part of the demotion, or the guard is decorative for an hour.
- **A profile's `role` is guarded by a database trigger, not by application code.**
  `public.enforce_role_change_is_admin()` (BEFORE UPDATE on `public.profiles`) raises SQLSTATE
  `42501` on any non-admin role change, because RLS grants row access but not column access. Do not
  answer a 42501 by loosening something in TypeScript.
