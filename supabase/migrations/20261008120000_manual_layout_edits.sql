-- Manual layout edits (roadmap S-06, PRD FR-009).
--
-- The electrician corrects the proposed layout and saves it; the saved set carries an "edited
-- manually" marker. The marker lives on each placement row, so every way the placements go — a
-- circuit save or a supply change (the device set is replaced, the placements cascade), a cabinet
-- change (`projects_clear_layout_on_cabinet_change`) — clears it with them. The page reports the
-- layout as manual when any stored row carries the flag (`computeLayoutView` in
-- `src/lib/layout-server.ts`, which still re-validates every stored set on every render).
--
-- Placements stay insert and delete only: a manual save replaces the whole set through
-- `save_project_layout`, exactly like a re-proposal, so no UPDATE grant is added.
--
-- Backward-compatible with the deployed code:
-- - the new column defaults to false, so an older writer stores a proposal, which is what it sends;
-- - `save_project_layout` gains a third parameter with a default. The deployed code calls it with the
--   two named arguments `p_project_id` / `p_placements`, which still resolve to the new function.
--   The two-argument version is dropped rather than kept beside it: two overloads would make that
--   call ambiguous for PostgREST;
-- - `save_project_circuits` keeps its signature and treats `edited_manually` in a device item as
--   optional (absent → false), so an older caller stores proposals as before.
--
-- Existing placements are proposals, so there is no backfill. Every statement is re-runnable, like
-- the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. The marker
-- ---------------------------------------------------------------------------

alter table public.project_device_placements
  add column if not exists edited_manually boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. save_project_circuits, now also storing the marker
-- ---------------------------------------------------------------------------

-- Unchanged from `20261006130000_project_device_placements.sql` except the final placement insert: a
-- placed device item may carry `edited_manually` (a manual layout carried over a re-match, see
-- `carryOverPlacements` in `src/lib/layout-editing.ts`); absent or null stores false.
--
-- JSON shapes:
--   groups   [{id, label, residual_current_ma, min_rcd_type, rcd_margin_percent}]
--   circuits [{id, rcd_group_id (null allowed), name, rated_current_a, phase_count,
--              cross_section_mm2, installation, entry_side}]
--   devices  [{device_id, role, rcd_group_id, circuit_id, notes (string array; missing/null → '{}'),
--              rail_index (optional), x_mm (optional), edited_manually (optional)}]
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
  insert into public.project_device_placements (project_device_id, project_id, rail_index, x_mm, edited_manually)
  select
    ins.id,
    p_project_id,
    (e.value ->> 'rail_index')::smallint,
    (e.value ->> 'x_mm')::numeric,
    -- Absent from an older caller, and from every proposal.
    coalesce((e.value ->> 'edited_manually')::boolean, false)
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
-- 3. save_project_layout, with the marker
-- ---------------------------------------------------------------------------

-- The two-argument version goes first: beside the new one it would make the deployed two-argument
-- call ambiguous. On a replay it is already gone, and `create or replace` below keeps the three-argument
-- one.
drop function if exists public.save_project_layout(uuid, jsonb);

-- Unchanged from `20261006130000_project_device_placements.sql` except `p_edited_manually`: true for
-- the manual save (`POST /api/projects/[id]/placements`, after `validateLayout`), false (the default)
-- for a re-proposal. Every stored row gets the same value — the marker describes the whole set.
-- Security invoker: every statement runs under the caller's RLS. A `project_device_id` that is not a
-- device of this project is refused with P0002 `project_device_unavailable` before anything changes;
-- a project the caller cannot see is refused with P0002 `project_not_found`.
--
-- JSON shape: placements [{project_device_id, rail_index, x_mm}]
create or replace function public.save_project_layout(
  p_project_id uuid,
  p_placements jsonb,
  p_edited_manually boolean default false
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

  insert into public.project_device_placements (project_device_id, project_id, rail_index, x_mm, edited_manually)
  select
    (e.value ->> 'project_device_id')::uuid,
    p_project_id,
    (e.value ->> 'rail_index')::smallint,
    (e.value ->> 'x_mm')::numeric,
    coalesce(p_edited_manually, false)
  from jsonb_array_elements(v_placements) as e (value);
end;
$func$;

-- Supabase's default privileges grant EXECUTE on new `public` functions to anon and authenticated;
-- strip them all first, then grant the signed-in role only.
revoke execute on function public.save_project_layout(uuid, jsonb, boolean) from public;
revoke execute on function public.save_project_layout(uuid, jsonb, boolean) from anon;
revoke execute on function public.save_project_layout(uuid, jsonb, boolean) from authenticated;
grant execute on function public.save_project_layout(uuid, jsonb, boolean) to authenticated;
