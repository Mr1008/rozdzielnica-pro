-- Circuits, RCD groups and the matched device set (roadmap S-04, PRD FR-006, FR-007).
--
-- A project's circuits and the RCD groups they share (`rcd_groups`, `circuits`), and the device set
-- the matcher picked for them (`project_devices`). All three belong to the parent project's owner
-- and are visible to them only; the admin never sees them. The matched devices are **snapshotted**
-- from the catalog — identity, price, dimensions and electrical parameters — by the
-- `project_devices_snapshot_device` trigger below, so an admin edit never shifts an existing quote
-- and an archived device never blanks one out. Whatever a client sends for the snapshot is ignored.
--
-- The value lists below mirror the exported constants in `src/lib/circuit-params.ts`
-- (`CIRCUIT_RATED_CURRENTS_A`, `CIRCUIT_PHASE_COUNTS`, `CIRCUIT_CROSS_SECTIONS_MM2`,
-- `RESIDUAL_CURRENTS_MA`, `MAX_CIRCUIT_NAME_LENGTH`, `MAX_GROUP_LABEL_LENGTH`) and `ENTRY_SIDES` in
-- `src/lib/cabinet-geometry.ts`. Change one, change the other — `tests/integration/rls-circuits.test.ts`
-- and `src/lib/circuit-params.test.ts` exercise both sides.
--
-- Writes go through `public.save_project_circuits`, which replaces a project's groups, circuits and
-- device snapshot in one transaction. It is security invoker: every statement in it runs under the
-- caller's RLS, exactly as if the client had issued it.
--
-- Every statement is written to be re-runnable, like the earlier migrations: `wrangler rollback`
-- reverts code only, so a migration may legitimately be replayed.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

do $do$
begin
  create type public.entry_side as enum ('top', 'bottom', 'left', 'right');
exception
  when duplicate_object then null;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. RCD groups
-- ---------------------------------------------------------------------------

create table if not exists public.rcd_groups (
  -- Client-supplied, so the editor can reference a group from its circuits before it is saved.
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  position smallint not null check (position >= 0),
  label text not null,
  residual_current_ma integer not null,
  min_rcd_type public.rcd_type not null,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- The target of the composite FKs below: a reference can only reach a group of its own project.
  constraint rcd_groups_project_id_id_key unique (project_id, id)
);

-- Text: stored trimmed (`[[:space:]]`, not `btrim`, as in `projects`), 1–40 code points.
alter table public.rcd_groups drop constraint if exists rcd_groups_label_valid;
alter table public.rcd_groups add constraint rcd_groups_label_valid
  check (label !~ '^[[:space:]]|[[:space:]]$' and char_length(label) between 1 and 40);

alter table public.rcd_groups drop constraint if exists rcd_groups_residual_current_valid;
alter table public.rcd_groups add constraint rcd_groups_residual_current_valid
  check (residual_current_ma in (10, 30, 100, 300));

create index if not exists rcd_groups_project_id_idx on public.rcd_groups (project_id);

drop trigger if exists rcd_groups_touch_updated_at on public.rcd_groups;
create trigger rcd_groups_touch_updated_at
  before update on public.rcd_groups
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Circuits
-- ---------------------------------------------------------------------------

create table if not exists public.circuits (
  -- Client-supplied, like the groups'.
  id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  -- Null means "in no RCD group". The composite FK below keeps a circuit inside its own project's
  -- groups; deleting the group clears only this column, never `project_id`.
  rcd_group_id uuid,
  position smallint not null check (position >= 0),
  name text not null,
  rated_current_a integer not null,
  phase_count smallint not null,
  -- `numeric(3,1)` would round a second decimal silently; `parseCircuitsPayload` rejects it first.
  cross_section_mm2 numeric(3, 1) not null,
  installation public.wlz_installation not null,
  entry_side public.entry_side not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint circuits_project_id_id_key unique (project_id, id),
  constraint circuits_rcd_group_fkey foreign key (project_id, rcd_group_id)
    references public.rcd_groups (project_id, id) on delete set null (rcd_group_id)
);

alter table public.circuits drop constraint if exists circuits_name_valid;
alter table public.circuits add constraint circuits_name_valid
  check (name !~ '^[[:space:]]|[[:space:]]$' and char_length(name) between 1 and 100);

alter table public.circuits drop constraint if exists circuits_rated_current_valid;
alter table public.circuits add constraint circuits_rated_current_valid
  check (rated_current_a in (6, 10, 13, 16, 20, 25, 32, 40, 50, 63));

alter table public.circuits drop constraint if exists circuits_phase_count_valid;
alter table public.circuits add constraint circuits_phase_count_valid
  check (phase_count in (1, 3));

alter table public.circuits drop constraint if exists circuits_cross_section_valid;
alter table public.circuits add constraint circuits_cross_section_valid
  check (cross_section_mm2 in (1.5, 2.5, 4, 6, 10, 16));

create index if not exists circuits_project_id_idx on public.circuits (project_id);
-- The composite FK is checked on every group delete; index its referencing side.
create index if not exists circuits_project_id_rcd_group_id_idx on public.circuits (project_id, rcd_group_id);

drop trigger if exists circuits_touch_updated_at on public.circuits;
create trigger circuits_touch_updated_at
  before update on public.circuits
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Project devices (the matched set, snapshotted)
-- ---------------------------------------------------------------------------

create table if not exists public.project_devices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  position smallint not null check (position >= 0),
  role text not null,
  -- What the device serves: its RCD group (an RCD, a group's RCBO) and/or its circuit (an MCB, an
  -- RCBO). Both null for the main switch. Composite FKs keep both inside the same project.
  rcd_group_id uuid,
  circuit_id uuid,
  -- Devices are archived, never deleted, so this plain FK can never block an admin action.
  device_id uuid not null references public.devices (id),
  notes text[] not null default '{}',
  -- The snapshot. The BEFORE trigger fills these columns on every insert, before `not null` is
  -- checked, so the defaults never reach a stored row — they exist only so the generated `Insert`
  -- type leaves the columns optional and a client sends just `device_id` (as `projects` does).
  kind public.device_kind not null default 'switch_disconnector',
  name text not null default '',
  manufacturer text not null default '',
  model text not null default '',
  -- Money is integer grosze; formatting to PLN happens at the edge, via `formatMoney`.
  price_grosze integer not null default 0,
  width_mm numeric(6, 2) not null default 0,
  height_mm numeric(6, 1) not null default 0,
  depth_mm numeric(6, 1) not null default 0,
  poles public.pole_config default null,
  rated_current_a integer default null,
  residual_current_ma integer default null,
  rcd_type public.rcd_type default null,
  breaking_capacity_ka numeric(4, 1) default null,
  created_at timestamptz not null default now(),
  constraint project_devices_rcd_group_fkey foreign key (project_id, rcd_group_id)
    references public.rcd_groups (project_id, id) on delete cascade,
  constraint project_devices_circuit_fkey foreign key (project_id, circuit_id)
    references public.circuits (project_id, id) on delete cascade
);

alter table public.project_devices drop constraint if exists project_devices_role_valid;
alter table public.project_devices add constraint project_devices_role_valid
  check (role in ('main_switch', 'rcd', 'rcbo', 'mcb'));

-- `<@` alone passes an array holding a NULL, so NULL elements are ruled out separately.
alter table public.project_devices drop constraint if exists project_devices_notes_valid;
alter table public.project_devices add constraint project_devices_notes_valid
  check (
    notes <@ array['rcbo_fallback', 'no_rcd']::text[]
    and array_position(notes, null) is null
  );

create index if not exists project_devices_project_id_idx on public.project_devices (project_id);
-- The composite FKs are checked on every group and circuit delete; index their referencing sides.
create index if not exists project_devices_project_id_rcd_group_id_idx
  on public.project_devices (project_id, rcd_group_id);
create index if not exists project_devices_project_id_circuit_id_idx
  on public.project_devices (project_id, circuit_id);
create index if not exists project_devices_device_id_idx on public.project_devices (device_id);

-- ---------------------------------------------------------------------------
-- 5. Device snapshot trigger
-- ---------------------------------------------------------------------------

-- The only writer of the snapshot columns. On INSERT it copies them from the active catalog device,
-- overwriting whatever the client sent — a client-sent snapshot is ignored, never trusted and never
-- rejected. There is no UPDATE grant on the table, so a stored snapshot never changes.
--
-- Security invoker on purpose: the lookup runs under the caller's RLS, so an electrician can
-- snapshot only a device they can see — an active one. `archived_at is null` is repeated here so an
-- admin (who sees archived rows) cannot snapshot one either. No match raises P0002 (no_data_found)
-- with the message `device_unavailable`, which the endpoint maps to a Polish error.
create or replace function public.project_devices_snapshot_device()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
begin
  select d.kind, d.name, d.manufacturer, d.model, d.price_grosze, d.width_mm, d.height_mm, d.depth_mm,
      d.poles, d.rated_current_a, d.residual_current_ma, d.rcd_type, d.breaking_capacity_ka
    into new.kind, new.name, new.manufacturer, new.model, new.price_grosze, new.width_mm, new.height_mm,
      new.depth_mm, new.poles, new.rated_current_a, new.residual_current_ma, new.rcd_type,
      new.breaking_capacity_ka
    from public.devices d
    where d.id = new.device_id and d.archived_at is null;
  if not found then
    raise exception 'device_unavailable'
      using errcode = 'P0002', detail = format('device %s is not an active catalog device', new.device_id);
  end if;
  return new;
end;
$func$;

drop trigger if exists project_devices_snapshot_device on public.project_devices;
create trigger project_devices_snapshot_device
  before insert on public.project_devices
  for each row execute function public.project_devices_snapshot_device();

-- ---------------------------------------------------------------------------
-- 6. Supply-change trigger on projects
-- ---------------------------------------------------------------------------

-- The main switch is matched against the supply, so a changed supply invalidates the whole matched
-- set: it is deleted, and the project shows "not matched" until the circuits are saved again. A
-- name-only (or cabinet-only) update leaves it alone. Security invoker: the delete runs under the
-- caller's RLS, and only the project's owner can update the project in the first place.
create or replace function public.projects_clear_device_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
begin
  delete from public.project_devices pd where pd.project_id = new.id;
  return null;
end;
$func$;

drop trigger if exists projects_clear_device_snapshot on public.projects;
create trigger projects_clear_device_snapshot
  after update on public.projects
  for each row
  when (
    old.premeter_protection_a is distinct from new.premeter_protection_a
    or old.earthing_system is distinct from new.earthing_system
    or old.phase_count is distinct from new.phase_count
    or old.wlz_length_m is distinct from new.wlz_length_m
    or old.wlz_cross_section_mm2 is distinct from new.wlz_cross_section_mm2
    or old.wlz_material is distinct from new.wlz_material
    or old.wlz_installation is distinct from new.wlz_installation
  )
  execute function public.projects_clear_device_snapshot();

-- ---------------------------------------------------------------------------
-- 7. Privileges
-- ---------------------------------------------------------------------------

alter table public.rcd_groups enable row level security;
alter table public.circuits enable row level security;
alter table public.project_devices enable row level security;

-- The REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new `public`
-- tables to anon/authenticated, while the cloud project does not. Revoking everything first also
-- strips the auto-granted TRUNCATE, which bypasses RLS entirely.
revoke all on public.rcd_groups from anon;
revoke all on public.rcd_groups from authenticated;
grant select, insert, update, delete on public.rcd_groups to authenticated;

revoke all on public.circuits from anon;
revoke all on public.circuits from authenticated;
grant select, insert, update, delete on public.circuits to authenticated;

revoke all on public.project_devices from anon;
revoke all on public.project_devices from authenticated;
-- No UPDATE: a snapshot row is only ever inserted (through the trigger) and deleted.
grant select, insert, delete on public.project_devices to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Row level security policies (granular, per operation, owner of the parent project only)
-- ---------------------------------------------------------------------------

-- Reads follow `projects_select_own`: the owner, whatever their claim. Writes also require the
-- `elektryk` claim — `user_role`, never the built-in `role` — like the project policies.

drop policy if exists "rcd_groups_select_own" on public.rcd_groups;
create policy "rcd_groups_select_own" on public.rcd_groups
  for select to authenticated
  using (
    exists (select 1 from public.projects p where p.id = rcd_groups.project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "rcd_groups_insert_own" on public.rcd_groups;
create policy "rcd_groups_insert_own" on public.rcd_groups
  for insert to authenticated
  with check (
    exists (select 1 from public.projects p where p.id = rcd_groups.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "rcd_groups_update_own" on public.rcd_groups;
create policy "rcd_groups_update_own" on public.rcd_groups
  for update to authenticated
  using (
    exists (select 1 from public.projects p where p.id = rcd_groups.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  )
  with check (
    exists (select 1 from public.projects p where p.id = rcd_groups.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "rcd_groups_delete_own" on public.rcd_groups;
create policy "rcd_groups_delete_own" on public.rcd_groups
  for delete to authenticated
  using (
    exists (select 1 from public.projects p where p.id = rcd_groups.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "circuits_select_own" on public.circuits;
create policy "circuits_select_own" on public.circuits
  for select to authenticated
  using (
    exists (select 1 from public.projects p where p.id = circuits.project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "circuits_insert_own" on public.circuits;
create policy "circuits_insert_own" on public.circuits
  for insert to authenticated
  with check (
    exists (select 1 from public.projects p where p.id = circuits.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "circuits_update_own" on public.circuits;
create policy "circuits_update_own" on public.circuits
  for update to authenticated
  using (
    exists (select 1 from public.projects p where p.id = circuits.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  )
  with check (
    exists (select 1 from public.projects p where p.id = circuits.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "circuits_delete_own" on public.circuits;
create policy "circuits_delete_own" on public.circuits
  for delete to authenticated
  using (
    exists (select 1 from public.projects p where p.id = circuits.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "project_devices_select_own" on public.project_devices;
create policy "project_devices_select_own" on public.project_devices
  for select to authenticated
  using (
    exists (select 1 from public.projects p where p.id = project_devices.project_id and p.user_id = (select auth.uid()))
  );

drop policy if exists "project_devices_insert_own" on public.project_devices;
create policy "project_devices_insert_own" on public.project_devices
  for insert to authenticated
  with check (
    exists (select 1 from public.projects p where p.id = project_devices.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "project_devices_delete_own" on public.project_devices;
create policy "project_devices_delete_own" on public.project_devices
  for delete to authenticated
  using (
    exists (select 1 from public.projects p where p.id = project_devices.project_id and p.user_id = (select auth.uid()))
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

-- No admin policy on any of the three: the admin maintains the catalogs and must never see or edit
-- an electrician's projects (PRD `## Access Control`). The admin owns no project, so every
-- `exists` above is false for them.

-- ---------------------------------------------------------------------------
-- 9. Save RPC
-- ---------------------------------------------------------------------------

-- Replaces a project's groups, circuits and matched device set in one transaction: upserts groups
-- and circuits by id (position = array index), deletes the ones missing from the payload, then
-- replaces the device snapshot. An empty `p_device_ids` means "catalog gap — no snapshot".
--
-- Security invoker: every statement runs under the caller's RLS. An id that belongs to another
-- owner's row hits the ON CONFLICT path on a row the UPDATE policy hides, which Postgres refuses
-- with 42501. An id that belongs to another project of the same owner is refused below with 42501
-- too, so a save never edits a row outside `p_project_id`. The snapshot trigger's P0002
-- (`device_unavailable`) propagates and rolls the whole save back.
--
-- JSON shapes (validated by `parseCircuitsPayload` and the matcher before the call; the CHECKs and
-- casts here are the second guard):
--   groups   [{id, label, residual_current_ma, min_rcd_type}]
--   circuits [{id, rcd_group_id (null allowed), name, rated_current_a, phase_count,
--              cross_section_mm2, installation, entry_side}]
--   devices  [{device_id, role, rcd_group_id, circuit_id, notes (string array; missing/null → '{}')}]
create or replace function public.save_project_circuits(
  p_project_id uuid,
  p_groups jsonb,
  p_circuits jsonb,
  p_device_ids jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  v_groups jsonb := coalesce(p_groups, '[]'::jsonb);
  v_circuits jsonb := coalesce(p_circuits, '[]'::jsonb);
  v_devices jsonb := coalesce(p_device_ids, '[]'::jsonb);
begin
  -- Not the caller's project (or the admin, who sees none): refuse before touching anything.
  perform 1 from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'project_not_found'
      using errcode = 'P0002', detail = format('project %s is not visible to the caller', p_project_id);
  end if;

  insert into public.rcd_groups as g (id, project_id, position, label, residual_current_ma, min_rcd_type)
  select
    (e.value ->> 'id')::uuid,
    p_project_id,
    (e.ordinality - 1)::smallint,
    e.value ->> 'label',
    (e.value ->> 'residual_current_ma')::integer,
    (e.value ->> 'min_rcd_type')::public.rcd_type
  from jsonb_array_elements(v_groups) with ordinality as e (value, ordinality)
  on conflict (id) do update set
    position = excluded.position,
    label = excluded.label,
    residual_current_ma = excluded.residual_current_ma,
    min_rcd_type = excluded.min_rcd_type;

  -- ON CONFLICT never moves a row between projects; a hit on the owner's other project is refused.
  if exists (
    select 1
    from jsonb_array_elements(v_groups) as e (value)
    join public.rcd_groups g on g.id = (e.value ->> 'id')::uuid
    where g.project_id <> p_project_id
  ) then
    raise exception 'group_belongs_to_another_project' using errcode = '42501';
  end if;

  insert into public.circuits as c (
    id, project_id, rcd_group_id, position, name, rated_current_a, phase_count, cross_section_mm2,
    installation, entry_side
  )
  select
    (e.value ->> 'id')::uuid,
    p_project_id,
    (e.value ->> 'rcd_group_id')::uuid,
    (e.ordinality - 1)::smallint,
    e.value ->> 'name',
    (e.value ->> 'rated_current_a')::integer,
    (e.value ->> 'phase_count')::smallint,
    (e.value ->> 'cross_section_mm2')::numeric,
    (e.value ->> 'installation')::public.wlz_installation,
    (e.value ->> 'entry_side')::public.entry_side
  from jsonb_array_elements(v_circuits) with ordinality as e (value, ordinality)
  on conflict (id) do update set
    rcd_group_id = excluded.rcd_group_id,
    position = excluded.position,
    name = excluded.name,
    rated_current_a = excluded.rated_current_a,
    phase_count = excluded.phase_count,
    cross_section_mm2 = excluded.cross_section_mm2,
    installation = excluded.installation,
    entry_side = excluded.entry_side;

  if exists (
    select 1
    from jsonb_array_elements(v_circuits) as e (value)
    join public.circuits c on c.id = (e.value ->> 'id')::uuid
    where c.project_id <> p_project_id
  ) then
    raise exception 'circuit_belongs_to_another_project' using errcode = '42501';
  end if;

  delete from public.circuits c
  where c.project_id = p_project_id
    and c.id not in (select (e.value ->> 'id')::uuid from jsonb_array_elements(v_circuits) as e (value));

  delete from public.rcd_groups g
  where g.project_id = p_project_id
    and g.id not in (select (e.value ->> 'id')::uuid from jsonb_array_elements(v_groups) as e (value));

  delete from public.project_devices pd where pd.project_id = p_project_id;

  -- The snapshot trigger fills every catalog column; only the references are sent.
  insert into public.project_devices (project_id, position, role, rcd_group_id, circuit_id, device_id, notes)
  select
    p_project_id,
    (e.ordinality - 1)::smallint,
    e.value ->> 'role',
    (e.value ->> 'rcd_group_id')::uuid,
    (e.value ->> 'circuit_id')::uuid,
    (e.value ->> 'device_id')::uuid,
    case
      when jsonb_typeof(e.value -> 'notes') = 'array'
        then array(select jsonb_array_elements_text(e.value -> 'notes'))
      else '{}'::text[]
    end
  from jsonb_array_elements(v_devices) with ordinality as e (value, ordinality)
  order by e.ordinality;
end;
$func$;

-- Supabase's default privileges grant EXECUTE on new `public` functions to anon and authenticated;
-- strip them all first, then grant the signed-in role only.
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) to authenticated;
