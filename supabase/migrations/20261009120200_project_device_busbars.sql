-- Comb busbar segments in the project snapshot (roadmap S-12, plan `rcd-group-busbars`, Phase 2).
--
-- The matcher cuts a catalog busbar (`devices.kind = 'comb_busbar'`) into one segment per RCD group
-- (`src/lib/busbar-cutting.ts`) and appends the segments to the selections as `busbar` rows. A segment
-- is a snapshot row like any other device, but it is never placed on a DIN rail, so it has no
-- placement: `save_project_circuits` already skips an element with no `rail_index` / `x_mm`.
-- `busbar_piece` numbers the bought piece a segment is cut from (0-based within the project), so the
-- quote prices a piece once however many segments it feeds.
--
-- Also here: two informational notes on the group's RCD row (`busbar_missing`, `busbar_group_too_wide`)
-- — a busbar miss is never a catalog gap, the group keeps its wire jumpers.
--
-- Backward-compatible with the deployed code: the old Worker's `snapshotSelections` drops a row with
-- an unknown role whole, so a project that stores busbar segments reads `stale` on the old Worker for
-- the deploy's length — never `current` over a set it does not understand. The old Worker sends no
-- `busbar_piece`, which is what the CHECK requires of every row that is not a busbar. The snapshot
-- trigger needs no change: it already copies every catalog column a busbar has (kind, price, width,
-- poles, rated current).
--
-- Every statement is re-runnable, like the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. Role, piece and notes
-- ---------------------------------------------------------------------------

alter table public.project_devices drop constraint if exists project_devices_role_valid;
alter table public.project_devices add constraint project_devices_role_valid
  check (role in ('main_switch', 'rcd', 'rcbo', 'mcb', 'pe_bar', 'n_bar', 'busbar'));

-- Null for every device that is not a busbar segment. Written only through `save_project_circuits`.
alter table public.project_devices add column if not exists busbar_piece smallint default null;

alter table public.project_devices drop constraint if exists project_devices_busbar_piece_valid;
alter table public.project_devices add constraint project_devices_busbar_piece_valid
  check ((busbar_piece is not null) = (role = 'busbar') and (busbar_piece is null or busbar_piece >= 0));

-- `<@` alone passes an array holding a NULL, so NULL elements are ruled out separately.
alter table public.project_devices drop constraint if exists project_devices_notes_valid;
alter table public.project_devices add constraint project_devices_notes_valid
  check (
    notes <@ array['rcbo_fallback', 'no_rcd', 'busbar_missing', 'busbar_group_too_wide']::text[]
    and array_position(notes, null) is null
  );

-- ---------------------------------------------------------------------------
-- 2. save_project_circuits, now also storing the piece
-- ---------------------------------------------------------------------------

-- Unchanged from `20261008120000_manual_layout_edits.sql` except the `project_devices` insert, which
-- also stores `busbar_piece`.
--
-- JSON shapes:
--   groups   [{id, label, residual_current_ma, min_rcd_type, rcd_margin_percent}]
--   circuits [{id, rcd_group_id (null allowed), name, rated_current_a, phase_count,
--              cross_section_mm2, installation, entry_side}]
--   devices  [{device_id, role, rcd_group_id, circuit_id, notes (string array; missing/null → '{}'),
--              busbar_piece (optional; only a busbar), rail_index (optional), x_mm (optional),
--              edited_manually (optional)}]
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
  -- are joined back to the inserted rows by position (= array index), never by RETURNING order. A
  -- busbar segment sends no `rail_index` / `x_mm`, so it gets no placement.
  with ins as (
    insert into public.project_devices (
      project_id, position, role, rcd_group_id, circuit_id, device_id, notes, busbar_piece
    )
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
      end,
      -- Absent from an older caller, and from every row that is not a busbar segment.
      (e.value ->> 'busbar_piece')::smallint
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
