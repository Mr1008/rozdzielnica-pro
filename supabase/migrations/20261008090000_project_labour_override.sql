-- The electrician's labour-time override on a project (roadmap S-08, PRD FR-011).
--
-- The quote estimates labour time from the device snapshot and the pricing profile; the electrician
-- may replace that estimate with their own time before the quote is printed (S-09). The override is
-- stored with the estimate it was set against, so the page can flag it as outdated whenever today's
-- estimate differs — a comparison on every render, never a stored flag. Totals are never stored.
--
-- The bounds mirror `MIN_LABOUR_OVERRIDE_MINUTES` / `MAX_LABOUR_OVERRIDE_MINUTES` in
-- `src/lib/quote.ts` (59 999 min = 999 h 59 min, the largest value the hours + minutes form can
-- express). Change one, change the other — `src/lib/quote.test.ts` and
-- `tests/integration/rls-projects.test.ts` exercise both sides at the same boundary values.
--
-- No new policy: the existing owner-only `projects_update_own` policy and the table-wide UPDATE
-- grant cover the new columns, and the `projects_snapshot_cabinet` trigger touches only the
-- `cabinet_*` columns.
--
-- Backward-compatible with the deployed code: both columns are nullable with no backfill, and the
-- deployed code selects explicit columns, so it never reads or writes them.
--
-- Every statement is re-runnable, like the earlier migrations.

alter table public.projects add column if not exists labour_minutes_override integer default null;
alter table public.projects add column if not exists labour_override_base_minutes integer default null;

-- Each CHECK passes on NULL; the all-or-nothing CHECK decides whether a null is allowed.
alter table public.projects drop constraint if exists projects_labour_override_range;
alter table public.projects add constraint projects_labour_override_range
  check (labour_minutes_override between 1 and 59999);

-- The base is a computed estimate (device count × mount minutes + overhead), which may be 0.
alter table public.projects drop constraint if exists projects_labour_override_base_valid;
alter table public.projects add constraint projects_labour_override_base_valid
  check (labour_override_base_minutes >= 0);

alter table public.projects drop constraint if exists projects_labour_override_all_or_nothing;
alter table public.projects add constraint projects_labour_override_all_or_nothing
  check (num_nulls(labour_minutes_override, labour_override_base_minutes) in (0, 2));
