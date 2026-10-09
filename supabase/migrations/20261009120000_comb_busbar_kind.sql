-- The comb busbar device kind (roadmap S-12, GitHub #17).
--
-- Split into its own migration on purpose: Postgres refuses to use a new enum value inside the
-- transaction that added it, and the next migration (`20261009120100_comb_busbar_parameters.sql`)
-- restates a CHECK that names 'comb_busbar'. Every migration runs in its own transaction, so the value
-- is usable there.
--
-- Re-runnable and backward-compatible: the deployed Worker drops catalog rows it cannot parse.

alter type public.device_kind add value if not exists 'comb_busbar';
