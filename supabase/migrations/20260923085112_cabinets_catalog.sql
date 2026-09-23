-- Cabinet catalog (roadmap S-02).
--
-- The admin-maintained catalog of switchboard cabinets: identity, price and the front-view geometry
-- the layout heuristic places devices on. Electricians read active rows; only an admin writes.
-- Rows are archived, never deleted, so a project that picked a cabinet never loses it.
--
-- Every statement is written to be re-runnable, like the F-01 migration: `wrangler rollback`
-- reverts code only, so a migration may legitimately be replayed.

-- ---------------------------------------------------------------------------
-- 1. Reusable `updated_at` touch trigger
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
  new.updated_at := now();
  return new;
end;
$func$;

-- ---------------------------------------------------------------------------
-- 2. Cabinets table
-- ---------------------------------------------------------------------------

create table if not exists public.cabinets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  manufacturer text not null check (length(trim(manufacturer)) > 0),
  model text not null check (length(trim(model)) > 0),
  -- Money is integer grosze; formatting to PLN happens at the edge, via `formatMoney`.
  price_grosze integer not null check (price_grosze > 0),
  -- The database checks only the envelope. Every rule inside the document is enforced by
  -- `parseCabinetGeometry` in `src/lib/cabinet-geometry.ts`, which every write must go through.
  geometry jsonb not null check (jsonb_typeof(geometry) = 'object' and geometry ->> 'version' = '1'),
  archived_at timestamptz,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One catalog entry per product, regardless of how the admin capitalised it.
create unique index if not exists cabinets_manufacturer_model_key
  on public.cabinets (lower(manufacturer), lower(model));

drop trigger if exists cabinets_touch_updated_at on public.cabinets;
create trigger cabinets_touch_updated_at
  before update on public.cabinets
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Privileges
-- ---------------------------------------------------------------------------

alter table public.cabinets enable row level security;

-- The REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new `public`
-- tables to anon/authenticated, while the cloud project (created after Supabase dropped that
-- default) does not. Without them the same migration would behave differently in the two
-- environments. Revoking everything first — not just DELETE — also strips the auto-granted
-- TRUNCATE, which bypasses RLS entirely.
revoke all on public.cabinets from anon;
revoke all on public.cabinets from authenticated;
grant select, insert, update on public.cabinets to authenticated;
-- Already covered by `revoke all` above; kept explicit so the "no delete, ever" rule is greppable.
revoke delete on public.cabinets from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row level security policies (granular, per operation, per role)
-- ---------------------------------------------------------------------------

drop policy if exists "cabinets_select_active" on public.cabinets;
create policy "cabinets_select_active" on public.cabinets
  for select to authenticated
  using (archived_at is null);

drop policy if exists "cabinets_select_admin" on public.cabinets;
create policy "cabinets_select_admin" on public.cabinets
  for select to authenticated
  using (public.is_admin());

drop policy if exists "cabinets_insert_admin" on public.cabinets;
create policy "cabinets_insert_admin" on public.cabinets
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "cabinets_update_admin" on public.cabinets;
create policy "cabinets_update_admin" on public.cabinets
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy, and no delete grant: a cabinet is archived (`archived_at`), never deleted.
