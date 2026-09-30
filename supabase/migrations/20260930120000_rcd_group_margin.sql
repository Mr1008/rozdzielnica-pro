-- RCD group safety margin (impl-review F5 of circuit-input-and-device-matching, 2026-09-30).
--
-- A group RCD must carry the summed rated current of its circuits plus a safety margin the
-- electrician sets per group: RCD In >= sum(circuit In) x (100 + margin) / 100. The value list
-- mirrors `RCD_MARGINS_PERCENT` in `src/lib/circuit-params.ts` — change one, change the other.
--
-- Forward-compatible with the deployed code: the column has a default, and the RPC falls back to it
-- when a group arrives without the field.

alter table public.rcd_groups add column if not exists rcd_margin_percent smallint not null default 15;

alter table public.rcd_groups drop constraint if exists rcd_groups_margin_valid;
alter table public.rcd_groups add constraint rcd_groups_margin_valid
  check (rcd_margin_percent in (0, 5, 10, 15, 20, 25, 30, 40, 50));

-- `save_project_circuits`, unchanged except that groups now carry `rcd_margin_percent`. See
-- `20260929120000_circuits_and_device_matching.sql` for the contract.
--
-- JSON shapes:
--   groups   [{id, label, residual_current_ma, min_rcd_type, rcd_margin_percent}]
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
    -- Absent only from a caller that predates the column (the deploy races this migration).
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

-- `create or replace` keeps the existing grants; repeated so the migration stands on its own.
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from public;
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from anon;
revoke execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) from authenticated;
grant execute on function public.save_project_circuits(uuid, jsonb, jsonb, jsonb) to authenticated;
