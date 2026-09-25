-- Electrician projects (roadmap S-03, PRD FR-003, FR-004, FR-005).
--
-- One project = one cabinet (PRD `## Non-Goals`). A project belongs to exactly one electrician and
-- is visible to them only; the admin never sees it. The cabinet the electrician picked is
-- **snapshotted** into the project — geometry, name, manufacturer, model and price — so an admin
-- edit never shifts an existing project and an archived cabinet (which electricians can no longer
-- read, see `cabinets_select_active`) never blanks one out. The snapshot columns are written only by
-- the `projects_snapshot_cabinet` trigger below; whatever a client sends for them is ignored.
--
-- The supply (OSD/WLZ) value lists below mirror the exported constants in `src/lib/supply-params.ts`
-- (`PREMETER_PROTECTIONS_A`, `EARTHING_SYSTEMS`, `PHASE_COUNTS`, `MAX_WLZ_LENGTH_M`,
-- `WLZ_CROSS_SECTIONS_MM2`, `CONDUCTOR_MATERIALS`, `WLZ_INSTALLATIONS`), and the text limits mirror
-- `src/lib/project.ts`. Change one, change the other — `tests/integration/rls-projects.test.ts`,
-- `src/lib/supply-params.test.ts` and `src/lib/project.test.ts` exercise both sides.
--
-- Every statement is written to be re-runnable, like the earlier migrations: `wrangler rollback`
-- reverts code only, so a migration may legitimately be replayed.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $do$
begin
  create type public.earthing_system as enum ('TN-C', 'TN-S', 'TN-C-S', 'TT');
exception
  when duplicate_object then null;
end
$do$;

do $do$
begin
  create type public.conductor_material as enum ('Cu', 'Al');
exception
  when duplicate_object then null;
end
$do$;

do $do$
begin
  create type public.wlz_installation as enum ('surface', 'conduit_surface', 'conduit_flush', 'in_wall', 'in_ground');
exception
  when duplicate_object then null;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. Projects table
-- ---------------------------------------------------------------------------

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  client_name text,
  site_address text,
  -- Cabinets are archived, never deleted, so this plain FK can never block an admin action.
  cabinet_id uuid not null references public.cabinets (id),
  -- The snapshot. The BEFORE trigger fills these columns on every insert, before `not null` is
  -- checked, so the defaults never reach a stored row — they exist only so the generated `Insert`
  -- type leaves the columns optional and a client sends just `cabinet_id`. The geometry passed
  -- `parseCabinetGeometry` on its way into `public.cabinets`; the trigger copies it verbatim and
  -- nothing else writes it.
  cabinet_geometry jsonb not null default '{}'::jsonb,
  cabinet_name text not null default '',
  cabinet_manufacturer text not null default '',
  cabinet_model text not null default '',
  -- Money is integer grosze; formatting to PLN happens at the edge, via `formatMoney`.
  cabinet_price_grosze integer not null default 0,
  -- The supply (OSD/WLZ). All seven are set or all seven are null (`projects_supply_all_or_nothing`);
  -- null means "not configured", and S-04 blocks on it instead of inventing defaults.
  premeter_protection_a integer,
  earthing_system public.earthing_system,
  phase_count smallint,
  wlz_length_m numeric(4, 1),
  wlz_cross_section_mm2 numeric(3, 1),
  wlz_material public.conductor_material,
  wlz_installation public.wlz_installation,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Text: stored trimmed (no leading or trailing whitespace of any kind — `[[:space:]]`, not `btrim`,
-- which strips only the plain space), 1–200 / 1–300 code points (`char_length`, the
-- same counting as `Array.from(s).length` in `src/lib/project.ts`). The optional fields are null, never blank.
alter table public.projects drop constraint if exists projects_name_valid;
alter table public.projects add constraint projects_name_valid
  check (name !~ '^[[:space:]]|[[:space:]]$' and char_length(name) between 1 and 200);

alter table public.projects drop constraint if exists projects_client_name_valid;
alter table public.projects add constraint projects_client_name_valid
  check (client_name is null or (client_name !~ '^[[:space:]]|[[:space:]]$' and char_length(client_name) between 1 and 200));

alter table public.projects drop constraint if exists projects_site_address_valid;
alter table public.projects add constraint projects_site_address_valid
  check (site_address is null or (site_address !~ '^[[:space:]]|[[:space:]]$' and char_length(site_address) between 1 and 300));

-- Supply value lists: keep in sync with `src/lib/supply-params.ts`. Each CHECK passes on NULL; the
-- all-or-nothing CHECK decides whether a null is allowed. The three enum columns need no CHECK —
-- the type is the list.
alter table public.projects drop constraint if exists projects_premeter_protection_valid;
alter table public.projects add constraint projects_premeter_protection_valid
  check (premeter_protection_a in (16, 20, 25, 32, 40, 50, 63));

alter table public.projects drop constraint if exists projects_phase_count_valid;
alter table public.projects add constraint projects_phase_count_valid
  check (phase_count in (1, 3));

-- `numeric(4,1)` would round a second decimal silently; `parseSupplyForm` rejects it first.
alter table public.projects drop constraint if exists projects_wlz_length_valid;
alter table public.projects add constraint projects_wlz_length_valid
  check (wlz_length_m > 0 and wlz_length_m <= 500.0);

alter table public.projects drop constraint if exists projects_wlz_cross_section_valid;
alter table public.projects add constraint projects_wlz_cross_section_valid
  check (wlz_cross_section_mm2 in (2.5, 4, 6, 10, 16, 25, 35));

alter table public.projects drop constraint if exists projects_supply_all_or_nothing;
alter table public.projects add constraint projects_supply_all_or_nothing
  check (
    num_nulls(
      premeter_protection_a,
      earthing_system,
      phase_count,
      wlz_length_m,
      wlz_cross_section_mm2,
      wlz_material,
      wlz_installation
    ) in (0, 7)
  );

-- Every electrician-facing read filters by owner.
create index if not exists projects_user_id_idx on public.projects (user_id);

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Cabinet snapshot trigger
-- ---------------------------------------------------------------------------

-- The only writer of the five snapshot columns. On INSERT, or when `cabinet_id` changes, it copies
-- them from the active cabinet; on any other UPDATE it restores their old values. A client-sent
-- snapshot is therefore ignored, never trusted and never rejected.
--
-- Security invoker on purpose: the lookup runs under the caller's RLS, so an electrician can
-- snapshot only a cabinet they can see — an active one. `archived_at is null` is repeated here so an
-- admin (who sees archived rows) cannot snapshot one either. No match raises P0002 (no_data_found).
create or replace function public.projects_snapshot_cabinet()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
begin
  if tg_op = 'INSERT' or new.cabinet_id is distinct from old.cabinet_id then
    select c.geometry, c.name, c.manufacturer, c.model, c.price_grosze
      into new.cabinet_geometry, new.cabinet_name, new.cabinet_manufacturer, new.cabinet_model,
        new.cabinet_price_grosze
      from public.cabinets c
      where c.id = new.cabinet_id and c.archived_at is null;
    if not found then
      raise exception 'cabinet % is not an active catalog cabinet', new.cabinet_id
        using errcode = 'P0002';
    end if;
  else
    new.cabinet_geometry := old.cabinet_geometry;
    new.cabinet_name := old.cabinet_name;
    new.cabinet_manufacturer := old.cabinet_manufacturer;
    new.cabinet_model := old.cabinet_model;
    new.cabinet_price_grosze := old.cabinet_price_grosze;
  end if;
  return new;
end;
$func$;

drop trigger if exists projects_snapshot_cabinet on public.projects;
create trigger projects_snapshot_cabinet
  before insert or update on public.projects
  for each row execute function public.projects_snapshot_cabinet();

-- ---------------------------------------------------------------------------
-- 4. Privileges
-- ---------------------------------------------------------------------------

alter table public.projects enable row level security;

-- The REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new `public`
-- tables to anon/authenticated, while the cloud project does not. Revoking everything first also
-- strips the auto-granted TRUNCATE, which bypasses RLS entirely.
revoke all on public.projects from anon;
revoke all on public.projects from authenticated;
-- Unlike the catalogs, a project is hard-deleted by its owner (behind a confirmation in the UI).
grant select, insert, update, delete on public.projects to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Row level security policies (granular, per operation, owner only)
-- ---------------------------------------------------------------------------

drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own" on public.projects
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Writes also require the `elektryk` claim — `user_role`, never the built-in `role` — so an admin
-- cannot create a project even for themselves. Like `is_admin()`, this reads the token, so a role
-- change takes effect only with the user's next token.
drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own" on public.projects
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own" on public.projects
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own" on public.projects
  for delete to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

-- No admin policy: the admin maintains the catalogs and must never see or edit an electrician's
-- projects or their clients' data (PRD `## Access Control`). The admin's own uid matches no project,
-- and the `elektryk` claim keeps them from creating one.
