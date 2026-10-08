-- Electrician company details for the printed quote (roadmap S-09, PRD FR-012).
--
-- Name, NIP, address, phone and email shown in the quote's header. They live in their own table,
-- not on `public.profiles`, because `profiles` carries admin select/update policies and the PRD
-- forbids the admin any view of an electrician's business data. One row per electrician; every
-- column is nullable, and a missing row or a null column simply means "not provided".
--
-- The CHECK bounds below mirror the exported constants in `src/lib/business-profile.ts`
-- (`MAX_COMPANY_NAME_LENGTH`, `MAX_ADDRESS_LENGTH`, `MAX_PHONE_LENGTH`, `MAX_EMAIL_LENGTH`). Change
-- one, change the other. The TypeScript parser is deliberately stricter on the NIP: it also checks
-- the checksum, which SQL here does not - the safe direction (the editor refuses more than the
-- database does, never less).
--
-- Every statement is written to be re-runnable, like the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. Business profiles table
-- ---------------------------------------------------------------------------

create table if not exists public.business_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  company_name text,
  nip text,
  address text,
  phone text,
  email text,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bounds: keep in sync with `src/lib/business-profile.ts`. Each column is null or a trimmed,
-- non-empty value within its bound.
alter table public.business_profiles drop constraint if exists business_profiles_company_name_valid;
alter table public.business_profiles add constraint business_profiles_company_name_valid
  check (company_name is null or (char_length(company_name) between 1 and 200 and company_name = btrim(company_name)));

alter table public.business_profiles drop constraint if exists business_profiles_nip_valid;
alter table public.business_profiles add constraint business_profiles_nip_valid
  check (nip is null or nip ~ '^[0-9]{10}$');

alter table public.business_profiles drop constraint if exists business_profiles_address_valid;
alter table public.business_profiles add constraint business_profiles_address_valid
  check (address is null or (char_length(address) between 1 and 300 and address = btrim(address)));

alter table public.business_profiles drop constraint if exists business_profiles_phone_valid;
alter table public.business_profiles add constraint business_profiles_phone_valid
  check (
    phone is null
    or (char_length(phone) between 1 and 30 and phone = btrim(phone) and phone ~ '^[0-9 +()-]+$')
  );

alter table public.business_profiles drop constraint if exists business_profiles_email_valid;
alter table public.business_profiles add constraint business_profiles_email_valid
  check (
    email is null
    or (char_length(email) between 1 and 254 and email = btrim(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+$')
  );

drop trigger if exists business_profiles_touch_updated_at on public.business_profiles;
create trigger business_profiles_touch_updated_at
  before update on public.business_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Privileges
-- ---------------------------------------------------------------------------

alter table public.business_profiles enable row level security;

-- The REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new `public`
-- tables to anon/authenticated, while the cloud project does not. Revoking everything first - not
-- just DELETE - also strips the auto-granted TRUNCATE, which bypasses RLS entirely.
revoke all on public.business_profiles from anon;
revoke all on public.business_profiles from authenticated;
grant select, insert, update on public.business_profiles to authenticated;
-- Already covered by `revoke all` above; kept explicit so the "no delete, ever" rule is greppable.
revoke delete on public.business_profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row level security policies (granular, per operation, owner only)
-- ---------------------------------------------------------------------------

drop policy if exists "business_profiles_select_own" on public.business_profiles;
create policy "business_profiles_select_own" on public.business_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Writes also require the `elektryk` claim - `user_role`, never the built-in `role` - so an admin
-- cannot create a row even for themselves. Like `is_admin()`, this reads the token, so a role
-- change takes effect only with the user's next token.
drop policy if exists "business_profiles_insert_own" on public.business_profiles;
create policy "business_profiles_insert_own" on public.business_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "business_profiles_update_own" on public.business_profiles;
create policy "business_profiles_update_own" on public.business_profiles
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

-- No admin policy: the admin must never see or edit an electrician's company details (PRD
-- Access Control). No delete policy and no delete grant: a profile is overwritten, never removed;
-- the FK cascade from `public.profiles` handles account deletion.
