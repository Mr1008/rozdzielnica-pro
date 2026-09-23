-- Device catalog (roadmap S-01).
--
-- The admin-maintained catalog of devices the matcher (S-04) picks from: the closed MVP set of kinds
-- (PRD `## Non-Goals`), each with its identity, price, dimensions and exactly the electrical
-- parameters its kind needs. Electricians read active rows; only an admin writes. Rows are archived,
-- never deleted, so a project that picked a device never loses it.
--
-- The per-kind CHECK below mirrors `src/lib/device-spec.ts` (`POLES_BY_KIND`, `PARAMETERS_BY_KIND`,
-- the decimal scales). Change one, change the other — `tests/integration/rls-devices.test.ts`
-- exercises every branch.
--
-- Every statement is written to be re-runnable, like the earlier migrations: `wrangler rollback`
-- reverts code only, so a migration may legitimately be replayed.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $do$
begin
  create type public.device_kind as enum ('switch_disconnector', 'rcd', 'rcbo', 'mcb_b', 'pe_bar', 'n_bar');
exception
  when duplicate_object then null;
end
$do$;

do $do$
begin
  create type public.pole_config as enum ('1P', '1P+N', '2P', '3P', '3P+N', '4P');
exception
  when duplicate_object then null;
end
$do$;

do $do$
begin
  create type public.rcd_type as enum ('AC', 'A', 'F', 'B');
exception
  when duplicate_object then null;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. Devices table
-- ---------------------------------------------------------------------------

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  kind public.device_kind not null,
  name text not null check (length(trim(name)) > 0),
  manufacturer text not null check (length(trim(manufacturer)) > 0),
  model text not null check (length(trim(model)) > 0),
  -- Money is integer grosze; formatting to PLN happens at the edge, via `formatMoney`.
  price_grosze integer not null check (price_grosze > 0),
  -- Width takes two decimals so half DIN modules (1.5 TE = 26.25 mm) are exact; the other
  -- decimals take one. `device-spec.ts` rejects extra places instead of letting `numeric` round.
  width_mm numeric(6, 2) not null check (width_mm > 0),
  height_mm numeric(6, 1) not null check (height_mm > 0),
  depth_mm numeric(6, 1) not null check (depth_mm > 0),
  -- Kind-specific parameters. Which of them a row must carry, and which it must leave null, is
  -- decided by `devices_parameters_match_kind` below.
  poles public.pole_config,
  rated_current_a integer check (rated_current_a > 0),
  residual_current_ma integer check (residual_current_ma > 0),
  rcd_type public.rcd_type,
  breaking_capacity_ka numeric(4, 1) check (breaking_capacity_ka > 0),
  -- The database checks only the envelope; each group's shape is enforced by `parseDeviceSpec`.
  terminal_groups jsonb check (
    jsonb_typeof(terminal_groups) = 'array' and jsonb_array_length(terminal_groups) >= 1
  ),
  archived_at timestamptz,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Each branch names every parameter: required ones `is not null`, foreign ones `is null`, and the
-- pole configuration restricted to the kind's set. `coalesce(…, false)` matters: a CHECK passes on
-- NULL, so an `in (…)` over a null column must never be allowed to decide the result.
alter table public.devices drop constraint if exists devices_parameters_match_kind;
alter table public.devices add constraint devices_parameters_match_kind check (
  coalesce(
    case kind
      when 'switch_disconnector' then
        poles is not null and poles in ('1P', '2P', '3P', '4P')
        and rated_current_a is not null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is null
        and terminal_groups is null
      when 'rcd' then
        poles is not null and poles in ('2P', '4P')
        and rated_current_a is not null
        and residual_current_ma is not null
        and rcd_type is not null
        and breaking_capacity_ka is null
        and terminal_groups is null
      when 'rcbo' then
        poles is not null and poles in ('1P+N', '2P', '3P+N', '4P')
        and rated_current_a is not null
        and residual_current_ma is not null
        and rcd_type is not null
        and breaking_capacity_ka is not null
        and terminal_groups is null
      when 'mcb_b' then
        poles is not null and poles in ('1P', '1P+N', '2P', '3P', '3P+N', '4P')
        and rated_current_a is not null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is not null
        and terminal_groups is null
      when 'pe_bar' then
        poles is null
        and rated_current_a is null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is null
        and terminal_groups is not null
      when 'n_bar' then
        poles is null
        and rated_current_a is null
        and residual_current_ma is null
        and rcd_type is null
        and breaking_capacity_ka is null
        and terminal_groups is not null
      else false
    end,
    false
  )
);

-- One catalog entry per product, regardless of how the admin capitalised it.
create unique index if not exists devices_manufacturer_model_key
  on public.devices (lower(manufacturer), lower(model));

-- The matcher (S-04) always filters by kind first.
create index if not exists devices_kind_idx on public.devices (kind);

drop trigger if exists devices_touch_updated_at on public.devices;
create trigger devices_touch_updated_at
  before update on public.devices
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Privileges
-- ---------------------------------------------------------------------------

alter table public.devices enable row level security;

-- The REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new `public`
-- tables to anon/authenticated, while the cloud project does not. Revoking everything first — not
-- just DELETE — also strips the auto-granted TRUNCATE, which bypasses RLS entirely.
revoke all on public.devices from anon;
revoke all on public.devices from authenticated;
grant select, insert, update on public.devices to authenticated;
-- Already covered by `revoke all` above; kept explicit so the "no delete, ever" rule is greppable.
revoke delete on public.devices from authenticated;

-- ---------------------------------------------------------------------------
-- 4. Row level security policies (granular, per operation, per role)
-- ---------------------------------------------------------------------------

drop policy if exists "devices_select_active" on public.devices;
create policy "devices_select_active" on public.devices
  for select to authenticated
  using (archived_at is null);

drop policy if exists "devices_select_admin" on public.devices;
create policy "devices_select_admin" on public.devices
  for select to authenticated
  using (public.is_admin());

drop policy if exists "devices_insert_admin" on public.devices;
create policy "devices_insert_admin" on public.devices
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists "devices_update_admin" on public.devices;
create policy "devices_update_admin" on public.devices
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- No delete policy, and no delete grant: a device is archived (`archived_at`), never deleted.
