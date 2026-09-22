-- Roles and profiles baseline (roadmap F-01).
--
-- Establishes the two-role vocabulary, the profile row every account gets, the trigger that keeps
-- that invariant true, the RLS policies that isolate rows, and the access-token hook that stamps
-- the role into every issued JWT as the `user_role` claim.
--
-- Every statement is written to be re-runnable: `wrangler rollback` reverts code only, so a
-- migration can never be undone by a deploy rollback and may legitimately be replayed.

-- ---------------------------------------------------------------------------
-- 1. Role vocabulary
-- ---------------------------------------------------------------------------

-- The PRD closes the list at exactly two roles.
do $do$
begin
  create type public.user_role as enum ('admin', 'elektryk');
exception
  when duplicate_object then null;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. Profiles table
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.user_role not null default 'elektryk',
  full_name text,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Supabase's default privileges already cover this, but stating it here keeps the migration
-- self-contained: RLS, not the grant, is the boundary.
grant select, insert, update, delete on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin predicate
-- ---------------------------------------------------------------------------

-- Reads the claim minted by `custom_access_token_hook` below rather than querying `profiles`,
-- which is what keeps the policies on `profiles` from recursing into themselves.
create or replace function public.is_admin()
returns boolean language sql stable
as $func$ select coalesce(auth.jwt() ->> 'user_role', '') = 'admin' $func$;

-- ---------------------------------------------------------------------------
-- 4. Row level security policies (granular, per operation, per role)
-- ---------------------------------------------------------------------------

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles
  for select to authenticated
  using (public.is_admin());

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin" on public.profiles
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "profiles_update_admin" on public.profiles;
create policy "profiles_update_admin" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "profiles_delete_admin" on public.profiles;
create policy "profiles_delete_admin" on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Signup trigger — every account gets a profile, however it was created
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $func$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$func$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6. Role-change guard
-- ---------------------------------------------------------------------------

-- RLS grants row access, not column access, so this trigger is the only place the
-- "a user may not promote themselves" rule can live.
--
-- `auth.jwt()` is null when the caller has no token at all — migrations and `seed.sql` run as
-- `postgres` in exactly that state. Treating a null JWT as privileged is not optional: without
-- it, seeding the local admin fails.
create or replace function public.enforce_role_change_is_admin()
returns trigger
language plpgsql
as $func$
begin
  if new.role is distinct from old.role
     and auth.jwt() is not null
     and not public.is_admin() then
    raise exception 'Only an admin may change a profile role'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$func$;

drop trigger if exists profiles_guard_role_change on public.profiles;
create trigger profiles_guard_role_change
  before update on public.profiles
  for each row execute function public.enforce_role_change_is_admin();

-- ---------------------------------------------------------------------------
-- 7. Access-token hook
-- ---------------------------------------------------------------------------

-- Runs as `supabase_auth_admin`, for whom the `authenticated` policies do not apply — hence the
-- dedicated grants and permissive policy below.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $func$
declare
  found_role public.user_role;
  claims jsonb;
begin
  select p.role into found_role
  from public.profiles p
  where p.id = (event ->> 'user_id')::uuid;

  -- A missing profile row must never break token issuance.
  if found_role is null then
    return event;
  end if;

  claims := coalesce(event -> 'claims', '{}'::jsonb);
  claims := jsonb_set(claims, '{user_role}', to_jsonb(found_role::text));

  return jsonb_set(event, '{claims}', claims);
end;
$func$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on public.profiles to supabase_auth_admin;

drop policy if exists "auth_admin_reads_profiles" on public.profiles;
create policy "auth_admin_reads_profiles" on public.profiles
  for select to supabase_auth_admin using (true);

-- ---------------------------------------------------------------------------
-- 8. Backfill for accounts that predate the trigger
-- ---------------------------------------------------------------------------

-- Naturally idempotent: the anti-join yields nothing once every user has a profile.
insert into public.profiles (id)
select u.id
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
