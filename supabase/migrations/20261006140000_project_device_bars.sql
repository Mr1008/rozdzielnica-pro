-- Catalog PE/N bars in the project snapshot (roadmap S-05, plan Phase 5b).
--
-- A cabinet whose snapshot has no PE bar (or no N bar) gets one from the device catalog: the matcher
-- selects the cheapest `pe_bar` / `n_bar` whose terminals take every conductor that lands on it, or
-- reports a catalog gap. The selected bar is stored in `project_devices` like any other matched
-- device, so the snapshot needs two new roles and a copy of the bar's terminal groups.
--
-- Backward-compatible with the deployed code: the old Worker's `snapshotSelections` drops a row with
-- an unknown role whole, so a project that stores catalog bars reads `stale` on the old Worker for
-- the deploy's length — never `current` over a set it does not understand. The old Worker never
-- sends the new roles, and the new column is nullable with no client writer.
--
-- Every statement is re-runnable, like the earlier migrations.

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------

alter table public.project_devices drop constraint if exists project_devices_role_valid;
alter table public.project_devices add constraint project_devices_role_valid
  check (role in ('main_switch', 'rcd', 'rcbo', 'mcb', 'pe_bar', 'n_bar'));

-- ---------------------------------------------------------------------------
-- 2. Terminal groups in the snapshot
-- ---------------------------------------------------------------------------

-- The same jsonb shape as `devices.terminal_groups` ([{count, minMm2, maxMm2}]); null for every
-- device that is not a bar. Written only by the snapshot trigger below.
alter table public.project_devices add column if not exists terminal_groups jsonb default null;

-- Unchanged from `20261006120000_device_n_terminal_side.sql` except for `terminal_groups`.
create or replace function public.project_devices_snapshot_device()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $func$
begin
  select d.kind, d.name, d.manufacturer, d.model, d.price_grosze, d.width_mm, d.height_mm, d.depth_mm,
      d.poles, d.rated_current_a, d.residual_current_ma, d.rcd_type, d.breaking_capacity_ka,
      d.n_terminal_side, d.terminal_groups
    into new.kind, new.name, new.manufacturer, new.model, new.price_grosze, new.width_mm, new.height_mm,
      new.depth_mm, new.poles, new.rated_current_a, new.residual_current_ma, new.rcd_type,
      new.breaking_capacity_ka, new.n_terminal_side, new.terminal_groups
    from public.devices d
    where d.id = new.device_id and d.archived_at is null;
  if not found then
    raise exception 'device_unavailable'
      using errcode = 'P0002', detail = format('device %s is not an active catalog device', new.device_id);
  end if;
  return new;
end;
$func$;
