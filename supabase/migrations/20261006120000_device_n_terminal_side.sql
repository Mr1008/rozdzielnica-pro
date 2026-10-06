-- The side of a device's N terminal (roadmap S-05, GitHub #15).
--
-- Manufacturers put the N pole of a 1P+N / 2P / 3P+N / 4P device on either side, viewed from the
-- front. The layout's rule 3 (distance to the PE and N bars) and the wiring both need to know which,
-- so the catalog records it and the project snapshot carries it.
--
-- The rule is by poles, not by kind: a side is required exactly when the pole set carries N, and
-- forbidden for 1P, 3P and the bars. It mirrors `parseDeviceSpec` in `src/lib/device-spec.ts`
-- (`POLES_WITH_N`). Change one, change the other — `tests/integration/rls-devices.test.ts`
-- exercises both branches.
--
-- Not backward-compatible for the deployed editor: until the new Worker is live, the old editor
-- cannot create an N-carrying device, because it never sends a side. Accepted — admin-only, and the
-- deploy pipeline (`.github/workflows/deploy.yml`) runs the new code right after this migration.
--
-- Every statement is re-runnable, like the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. Enum and catalog column
-- ---------------------------------------------------------------------------

do $do$
begin
  create type public.n_terminal_side as enum ('left', 'right');
exception
  when duplicate_object then null;
end
$do$;

alter table public.devices add column if not exists n_terminal_side public.n_terminal_side;

-- Existing N-carrying rows get `left` before the CHECK is added back; the admin reviews them.
alter table public.devices drop constraint if exists devices_parameters_match_kind;

update public.devices
  set n_terminal_side = 'left'
  where n_terminal_side is null and poles in ('1P+N', '2P', '3P+N', '4P');

-- The S-01 per-kind branches unchanged, plus one conjunct over every kind: a side exactly when the
-- poles carry N. `coalesce(…, false)` matters for the same reason as before — a CHECK passes on NULL.
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
  and coalesce(
    (n_terminal_side is not null) = (poles is not null and poles in ('1P+N', '2P', '3P+N', '4P')),
    false
  )
);

-- ---------------------------------------------------------------------------
-- 2. Project snapshot
-- ---------------------------------------------------------------------------

-- Existing snapshots are not backfilled: production holds no projects, and a snapshot without a side
-- must be deleted (`truncate public.project_devices`) rather than guessed — the project then reads
-- "not matched" until the electrician re-matches.
alter table public.project_devices add column if not exists n_terminal_side public.n_terminal_side default null;

-- Unchanged from `20260929120000_circuits_and_device_matching.sql` except for `n_terminal_side`.
create or replace function public.project_devices_snapshot_device()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
begin
  select d.kind, d.name, d.manufacturer, d.model, d.price_grosze, d.width_mm, d.height_mm, d.depth_mm,
      d.poles, d.rated_current_a, d.residual_current_ma, d.rcd_type, d.breaking_capacity_ka,
      d.n_terminal_side
    into new.kind, new.name, new.manufacturer, new.model, new.price_grosze, new.width_mm, new.height_mm,
      new.depth_mm, new.poles, new.rated_current_a, new.residual_current_ma, new.rcd_type,
      new.breaking_capacity_ka, new.n_terminal_side
    from public.devices d
    where d.id = new.device_id and d.archived_at is null;
  if not found then
    raise exception 'device_unavailable'
      using errcode = 'P0002', detail = format('device %s is not an active catalog device', new.device_id);
  end if;
  return new;
end;
$func$;
