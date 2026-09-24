-- Electrician pricing profile (roadmap S-07, PRD FR-010).
--
-- The three quote parameters an electrician calibrates for their own pace of work: hourly rate,
-- average mount time per device and a fixed per-project overhead. They live in their own table,
-- not on `public.profiles`, because `profiles` carries admin select/update policies and the PRD
-- forbids the admin any view of an electrician's business data. One row per electrician; a missing
-- row means "not configured" — there are no defaults, and S-08 blocks instead of inventing them.
--
-- The CHECK bounds below mirror the exported constants in `src/lib/pricing-profile.ts`
-- (`MIN_/MAX_MOUNT_MINUTES`, `MIN_/MAX_OVERHEAD_MINUTES`, and `MAX_PRICE_GROSZE` from
-- `src/lib/price-input.ts`). Change one, change the other — `tests/integration/rls-pricing-profiles.test.ts`
-- and `src/lib/pricing-profile.test.ts` exercise both sides.
--
-- Every statement is written to be re-runnable, like the earlier migrations: `wrangler rollback`
-- reverts code only, so a migration may legitimately be replayed.

-- ---------------------------------------------------------------------------
-- 1. Pricing profiles table
-- ---------------------------------------------------------------------------

create table if not exists public.pricing_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Money is integer grosze; formatting to PLN happens at the edge, via `formatMoney`.
  hourly_rate_grosze integer not null,
  -- Whole minutes, so the quote arithmetic in S-08 never rounds a float.
  mount_minutes_per_device integer not null,
  project_overhead_minutes integer not null,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bounds: keep in sync with `src/lib/pricing-profile.ts`. The rate's upper bound is the integer
-- ceiling itself (`MAX_PRICE_GROSZE`), so only its lower bound needs a CHECK.
alter table public.pricing_profiles drop constraint if exists pricing_profiles_hourly_rate_positive;
alter table public.pricing_profiles add constraint pricing_profiles_hourly_rate_positive
  check (hourly_rate_grosze >= 1);

alter table public.pricing_profiles drop constraint if exists pricing_profiles_mount_minutes_range;
alter table public.pricing_profiles add constraint pricing_profiles_mount_minutes_range
  check (mount_minutes_per_device between 1 and 600);

alter table public.pricing_profiles drop constraint if exists pricing_profiles_overhead_minutes_range;
alter table public.pricing_profiles add constraint pricing_profiles_overhead_minutes_range
  check (project_overhead_minutes between 0 and 6000);

drop trigger if exists pricing_profiles_touch_updated_at on public.pricing_profiles;
create trigger pricing_profiles_touch_updated_at
  before update on public.pricing_profiles
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Privileges
-- ---------------------------------------------------------------------------

alter table public.pricing_profiles enable row level security;

-- The REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new `public`
-- tables to anon/authenticated, while the cloud project does not. Revoking everything first — not
-- just DELETE — also strips the auto-granted TRUNCATE, which bypasses RLS entirely.
revoke all on public.pricing_profiles from anon;
revoke all on public.pricing_profiles from authenticated;
grant select, insert, update on public.pricing_profiles to authenticated;
-- Already covered by `revoke all` above; kept explicit so the "no delete, ever" rule is greppable.
revoke delete on public.pricing_profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row level security policies (granular, per operation, owner only)
-- ---------------------------------------------------------------------------

drop policy if exists "pricing_profiles_select_own" on public.pricing_profiles;
create policy "pricing_profiles_select_own" on public.pricing_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Writes also require the `elektryk` claim — `user_role`, never the built-in `role` — so an admin
-- cannot create a pricing row even for themselves. Like `is_admin()`, this reads the token, so a
-- role change takes effect only with the user's next token.
drop policy if exists "pricing_profiles_insert_own" on public.pricing_profiles;
create policy "pricing_profiles_insert_own" on public.pricing_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "pricing_profiles_update_own" on public.pricing_profiles;
create policy "pricing_profiles_update_own" on public.pricing_profiles
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

-- No admin policy: the admin must never see or edit an electrician's pricing (PRD `## Access
-- Control`). No delete policy and no delete grant: a pricing profile is overwritten, never removed;
-- the FK cascade from `public.profiles` handles account deletion.
