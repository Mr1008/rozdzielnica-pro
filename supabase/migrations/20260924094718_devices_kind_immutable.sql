-- A device's kind is fixed once the row exists (S-01 impl-review F3).
--
-- The editor locks the kind and the update endpoint never writes it, but `grant update` covers every
-- column, so any client holding an admin token could PATCH `kind` straight through PostgREST. The
-- per-kind CHECK catches most such changes, yet not `pe_bar` <-> `n_bar`, which share one parameter
-- set. S-04 matches and snapshots devices by kind, so the rule belongs in the schema: a different
-- kind is a different product — archive the row and create a new one.
--
-- A trigger rather than a column-level grant: a column list would have to be kept in step with
-- every future column, and forgetting one would silently break updates. `check_violation` rather
-- than `insufficient_privilege`: this is a data rule nobody may break, not a permission, and the
-- device endpoints map 42501 to "you lack permission", which would mislead.
--
-- Re-runnable and forward-compatible: the deployed code never sends `kind` on update.

create or replace function public.enforce_device_kind_immutable()
returns trigger
language plpgsql
set search_path = ''
as $func$
begin
  if new.kind is distinct from old.kind then
    raise exception 'A device kind cannot be changed; archive it and create a new device'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$func$;

drop trigger if exists devices_guard_kind_change on public.devices;
create trigger devices_guard_kind_change
  before update on public.devices
  for each row execute function public.enforce_device_kind_immutable();
