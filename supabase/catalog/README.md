# Production device catalog (Eaton + Legrand)

`eaton-legrand.sql` loads 355 Eaton and Legrand modular devices (MCB B, RCD, RCBO, FR, comb busbars,
PE/N bars) into `public.devices`. It is **production-only**: no migration, `supabase db reset` or deploy
ever runs it, and it must never be moved into `supabase/migrations/` or `supabase/seed.sql` — local and
CI databases keep the sample catalog the tests rely on.

## Where it comes from

- `source/eaton.json`, `source/legrand.json` — curated catalog facts (residential series), selected from
  the manufacturers' PDFs by
  `context/changes/production-catalog-seed/extract/scripts/curate.py`. Every row names its source page
  or URL.
- `src/lib/catalog-seed.ts` — fills the gaps (default dimensions per series, N terminal on the left,
  PE/N bar terminal minimums and widths), generates Polish names and estimated net list prices, and
  validates every row with `parseDeviceSpec`.
- `eaton-legrand.sql` — the rendered output, pinned by `src/lib/catalog-seed.test.ts`. Never edit it by
  hand. After changing the generator or the source files, regenerate:

  ```bash
  npx vitest run --config vitest.config.ts src/lib/catalog-seed.test.ts -u
  ```

## Applying it

The file is one transaction with `on conflict ((lower(manufacturer)), (lower(model))) do nothing`, so a
re-run inserts nothing and never changes an existing row. Corrections to rows already applied go
through the admin editor (or a targeted SQL), not through re-running this file.

Local stack (no `psql` on the host needed):

```bash
docker exec -i supabase_db_10x-astro-starter psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/catalog/eaton-legrand.sql
```

Production: paste the file into the Supabase dashboard SQL editor (project `rozdzielnica-pro`), or run it
with `psql "<connection string from Project Settings → Database>" -v ON_ERROR_STOP=1 -f supabase/catalog/eaton-legrand.sql`.

## Verifying

```sql
select manufacturer, kind, count(*) from public.devices
where manufacturer in ('Eaton', 'Legrand') group by 1, 2 order by 1, 2;
```

Expected: Eaton 204 (FR 36, RCD 36, RCBO 44, MCB 57, comb busbar 16, PE 12, N 3) and Legrand 151 (FR 24,
RCD 53, RCBO 16, MCB 48, comb busbar 6, PE 2, N 2). The total active catalog must stay well below the
PostgREST `max_rows` (1000) — the matcher loads it unpaginated.
