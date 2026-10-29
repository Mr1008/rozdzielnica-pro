-- Cabinet mounting type: surface (natynkowa) or flush (podtynkowa). A picking aid for the cabinet
-- lists only — the `projects_snapshot_cabinet` trigger does not copy it, so a project never depends on
-- it.
--
-- Guarded twice: the `cabinets_mounting_valid` CHECK below and `CABINET_MOUNTINGS` in
-- `src/lib/cabinet-form.ts` encode the same values. Change one, change the other —
-- `tests/integration/check-parser-parity.test.ts` drives both from one fixture table. The parser is
-- stricter than the CHECK: it never accepts null.
--
-- Backward-compatible with the deployed code: the column is nullable, so the deployed cabinet editor,
-- which never writes it, keeps inserting cabinets during the deploy window (those rows stay null until
-- the admin sets a mounting). NOT NULL is a later migration, once no null row remains in production.
--
-- Backfill: the Karwasz catalog shipped by `20261021120000_karwasz_cabinets.sql`, keyed on `model`.
-- RN, RNH (hermetic, still surface-mounted) and UNI SYSTEM are surface cabinets; RP are flush. Only
-- null rows are touched, so a value the admin has already set is never overwritten.
--
-- Every statement is re-runnable, like the earlier migrations.

alter table public.cabinets add column if not exists mounting text default null;

alter table public.cabinets drop constraint if exists cabinets_mounting_valid;
alter table public.cabinets add constraint cabinets_mounting_valid
  check (mounting is null or mounting in ('surface', 'flush'));

update public.cabinets
set mounting = 'surface'
where manufacturer = 'Karwasz'
  and mounting is null
  and (model like 'RN-%' or model like 'RNH-%' or model like 'UNI SYSTEM %');

update public.cabinets
set mounting = 'flush'
where manufacturer = 'Karwasz'
  and mounting is null
  and model like 'RP-%';
