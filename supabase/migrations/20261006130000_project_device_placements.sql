-- Where each matched device sits in the cabinet (roadmap S-05, PRD FR-008).
--
-- One row per placed `project_devices` row: the rail (`rail_index`, an index into the project's
-- `cabinet_geometry` snapshot rails) and the offset from the rail's start (`x_mm`). Placements are a
-- snapshot like the device set they belong to: inserted and deleted, never updated (an UPDATE grant
-- is S-06's decision, when manual editing arrives). They are written only by
-- `save_project_circuits` (together with the match, in one transaction) and `save_project_layout`
-- (the "Zaproponuj układ" action), and read only through `computeLayoutView` in
-- `src/lib/layout-server.ts`, which re-validates them on every render — a stored placement is not
-- proof of a valid layout.
--
-- Lifetime: keyed to `project_devices.id`, so every circuit save (which replaces the device set) and
-- every supply change (which deletes it) drops the placements by cascade. A cabinet change does not
-- touch the device set, so `projects_clear_layout_on_cabinet_change` below deletes the placements.
--
-- Backward-compatible with the deployed code: `save_project_circuits` keeps its signature and treats
-- `rail_index` / `x_mm` in a device item as optional, so an older caller simply stores no placements.
--
-- Every statement is re-runnable, like the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. The composite-FK target on project_devices
-- ---------------------------------------------------------------------------

-- The same pattern as `rcd_groups_project_id_id_key` / `circuits_project_id_id_key`: a placement can
-- only reference a device of its own project. Added only when absent — once the FK below depends on
-- it, a drop-and-recreate would fail on a replay.
do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'project_devices_project_id_id_key' and conrelid = 'public.project_devices'::regclass
  ) then
    alter table public.project_devices
      add constraint project_devices_project_id_id_key unique (project_id, id);
  end if;
end
$do$;

-- ---------------------------------------------------------------------------
-- 2. Placements
-- ---------------------------------------------------------------------------

create table if not exists public.project_device_placements (
  project_device_id uuid primary key,
  project_id uuid not null references public.projects (id) on delete cascade,
  rail_index smallint not null,
  -- From the rail's start, in millimetres; `proposeLayout` rounds to 2 decimals.
  x_mm numeric(7, 2) not null,
  -- Datetimes are stored and processed in UTC; local time is applied at the edge, for the user.
  created_at timestamptz not null default now(),
  constraint project_device_placements_device_fkey foreign key (project_id, project_device_id)
    references public.project_devices (project_id, id) on delete cascade
);

alter table public.project_device_placements drop constraint if exists project_device_placements_rail_index_valid;
alter table public.project_device_placements add constraint project_device_placements_rail_index_valid
  check (rail_index >= 0);

alter table public.project_device_placements drop constraint if exists project_device_placements_x_mm_valid;
alter table public.project_device_placements add constraint project_device_placements_x_mm_valid
  check (x_mm >= 0);

create index if not exists project_device_placements_project_id_idx
  on public.project_device_placements (project_id);

-- ---------------------------------------------------------------------------
-- 3. Cabinet-change trigger on projects
-- ---------------------------------------------------------------------------

-- A new cabinet snapshot invalidates the layout but not the match: the devices stay, the placements
-- go, and the page reports "no layout" until the electrician proposes one. Security invoker: the
-- delete runs under the caller's RLS, and only the project's owner can update the project.
create or replace function public.projects_clear_layout()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
begin
  delete from public.project_device_placements pl where pl.project_id = new.id;
  return null;
end;
$func$;

drop trigger if exists projects_clear_layout_on_cabinet_change on public.projects;
create trigger projects_clear_layout_on_cabinet_change
  after update on public.projects
  for each row
  when (old.cabinet_id is distinct from new.cabinet_id)
  execute function public.projects_clear_layout();

-- ---------------------------------------------------------------------------
-- 4. Privileges and row level security
-- ---------------------------------------------------------------------------

alter table public.project_device_placements enable row level security;

-- The REVOKEs are required, not stylistic: the local stack still auto-grants ALL on new `public`
-- tables to anon/authenticated (including TRUNCATE, which bypasses RLS), while the cloud does not.
revoke all on public.project_device_placements from anon;
revoke all on public.project_device_placements from authenticated;
-- No UPDATE: a placement is only ever inserted and deleted (S-06 decides on editing).
grant select, insert, delete on public.project_device_placements to authenticated;

-- Mirrors `project_devices`: reads for the owner of the parent project, writes also need the
-- `elektryk` claim (`user_role`, never the built-in `role`). No admin policy — the admin owns no
-- project, so every `exists` is false for them.
drop policy if exists "project_device_placements_select_own" on public.project_device_placements;
create policy "project_device_placements_select_own" on public.project_device_placements
  for select to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_device_placements.project_id and p.user_id = (select auth.uid())
    )
  );

drop policy if exists "project_device_placements_insert_own" on public.project_device_placements;
create policy "project_device_placements_insert_own" on public.project_device_placements
  for insert to authenticated
  with check (
    exists (
      select 1 from public.projects p
      where p.id = project_device_placements.project_id and p.user_id = (select auth.uid())
    )
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

drop policy if exists "project_device_placements_delete_own" on public.project_device_placements;
create policy "project_device_placements_delete_own" on public.project_device_placements
  for delete to authenticated
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_device_placements.project_id and p.user_id = (select auth.uid())
    )
    and coalesce((select auth.jwt()) ->> 'user_role', '') = 'elektryk'
  );

-- ---------------------------------------------------------------------------
-- 5. save_project_circuits, now also storing placements
-- ---------------------------------------------------------------------------

-- Unchanged from `20260930120000_rcd_group_margin.sql` except the final device insert: a device item
-- may carry `rail_index` and `x_mm`, and the rows inserted for items carrying both get a placement
-- in the same statement. Items without them (an older caller, or a match whose layout does not fit)
-- store no placement. See `20260929120000_circuits_and_device_matching.sql` for the contract.
--
-- JSON shapes:
--   groups   [{id, label, residual_current_ma, min_rcd_type, rcd_margin_percent}]
--   circuits [{id, rcd_group_id (null allowed), name, rated_current_a, phase_count,
--              cross_section_mm2, installation, entry_side}]
--   devices  [{device_id, role, rcd_group_id, circuit_id, notes (string array; missing/null → '{}'),
--              rail_index (optional), x_mm (optional)}]
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

  insert into public.rcd_groups as g (
    id, project_id, position, label, residual_current_ma, min_rcd_type, rcd_margin_percent
  )
  select
    (e.value ->> 'id')::uuid,
    p_project_id,
    (e.ordinality - 1)::smallint,
    e.value ->> 'label',
    (e.value ->> 'residual_current_ma')::integer,
    (e.value ->> 'min_rcd_type')::public.rcd_type,
    -- Absent only from a caller that predates the column.
    coalesce((e.value ->> 'rcd_margin_percent')::smallint, 15)
  from jsonb_array_elements(v_groups) with ordinality as e (value, ordinality)
  on conflict (id) do update set
    position = excluded.position,
    label = excluded.label,
    residual_current_ma = excluded.residual_current_ma,
    min_rcd_type = excluded.min_rcd_type,
    rcd_margin_percent = excluded.rcd_margin_percent;

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

  -- Cascades to the placements.
  delete from public.project_devices pd where pd.project_id = p_project_id;

  -- The snapshot trigger fills every catalog column; only the references are sent. The placements
  -- are joined back to the inserted rows by position (= array index), never by RETURNING order.
  with ins as (
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
    order by e.ordinality
    returning id, position
  )
  insert into public.project_device_placements (project_device_id, project_id, rail_index, x_mm)
  select
    ins.id,
    p_project_id,
    (e.value ->> 'rail_index')::smallint,
    (e.value ->> 'x_mm')::numeric
  from ins
  join jsonb_array_elements(v_devices) with ordinality as e (value, ordinality)
    on ins.position = e.ordinality - 1
  where e.value ->> 'rail_index' is not null
    and e.value ->> 'x_mm' is not null;
end;
$func$;

-- `create or replace` keeps the existing grants; repeated so the migration stands on its own.
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. save_project_layout — re-propose from the stored snapshot
-- ---------------------------------------------------------------------------

-- Replaces a project's placements in one transaction, leaving the device set alone. Security
-- invoker: every statement runs under the caller's RLS. A `project_device_id` that is not a device of
-- this project (another project's, a deleted one — e.g. a circuit save raced the call) is refused
-- with P0002 `project_device_unavailable` before anything changes; a project the caller cannot see is
-- refused with P0002 `project_not_found`, like `save_project_circuits`.
--
-- JSON shape: placements [{project_device_id, rail_index, x_mm}]
create or replace function public.save_project_layout(
  p_project_id uuid,
  p_placements jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $func$
declare
  v_placements jsonb := coalesce(p_placements, '[]'::jsonb);
begin
  perform 1 from public.projects p where p.id = p_project_id;
  if not found then
    raise exception 'project_not_found'
      using errcode = 'P0002', detail = format('project %s is not visible to the caller', p_project_id);
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_placements) as e (value)
    where not exists (
      select 1 from public.project_devices pd
      where pd.id = (e.value ->> 'project_device_id')::uuid and pd.project_id = p_project_id
    )
  ) then
    raise exception 'project_device_unavailable'
      using errcode = 'P0002', detail = format('a placement names no device of project %s', p_project_id);
  end if;

  delete from public.project_device_placements pl where pl.project_id = p_project_id;

  insert into public.project_device_placements (project_device_id, project_id, rail_index, x_mm)
  select
    (e.value ->> 'project_device_id')::uuid,
    p_project_id,
    (e.value ->> 'rail_index')::smallint,
    (e.value ->> 'x_mm')::numeric
  from jsonb_array_elements(v_placements) as e (value);
end;
$func$;

-- Supabase's default privileges grant EXECUTE on new `public` functions to anon and authenticated;
-- strip them all first, then grant the signed-in role only.
revoke execute on function public.save_project_layout(uuid, jsonb) from public;
revoke execute on function public.save_project_layout(uuid, jsonb) from anon;
revoke execute on function public.save_project_layout(uuid, jsonb) from authenticated;
grant execute on function public.save_project_layout(uuid, jsonb) to authenticated;
