-- Explicit privileges on public.profiles.
--
-- The F-01 migration (20260922083135_roles_and_profiles.sql) only granted. On the local stack,
-- which still auto-grants ALL on new `public` tables, that left anon and authenticated holding
-- TRUNCATE, REFERENCES and TRIGGER as well — TRUNCATE bypasses RLS entirely — while the cloud
-- project, created after Supabase dropped that default, holds none of them. Same revoke-then-grant
-- as 20260923085112_cabinets_catalog.sql: RLS stays the row boundary, and anon, which no profiles
-- policy serves, gets nothing.
--
-- Re-runnable and forward-compatible: authenticated keeps exactly the four operations its
-- policies use. supabase_auth_admin's SELECT (the access-token hook) and service_role are untouched.

revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
