-- Local / CI seed data. Runs on `supabase start` and on every `supabase db reset`
-- (wired via `[db.seed] sql_paths` in config.toml), so every statement must be idempotent.
--
-- Gives local development and CI one working admin account, so admin-gated routes can be
-- exercised without manual dashboard setup.
--
--   email:    admin@example.com
--   password: admin123456
--
-- This file is LOCAL ONLY — `supabase db push` never carries it to the cloud project.

create extension if not exists pgcrypto with schema extensions;

-- The admin account. The `on_auth_user_created` trigger from the roles migration creates its
-- profile row with the default `elektryk` role; the update below promotes it.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-0000000ad301',
  'authenticated',
  'authenticated',
  'admin@example.com',
  extensions.crypt('admin123456', extensions.gen_salt('bf')),
  now(),
  now(),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '',
  '',
  '',
  ''
)
on conflict (id) do nothing;

-- GoTrue resolves an email/password sign-in through `auth.identities`, so the user row alone
-- is not enough to sign in.
insert into auth.identities (
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-0000000ad301',
  '00000000-0000-0000-0000-0000000ad301',
  '{"sub":"00000000-0000-0000-0000-0000000ad301","email":"admin@example.com","email_verified":true,"phone_verified":false}'::jsonb,
  'email',
  now(),
  now(),
  now()
)
on conflict (provider_id, provider) do nothing;

-- Belt and braces: the trigger should already have created this row.
insert into public.profiles (id)
values ('00000000-0000-0000-0000-0000000ad301')
on conflict (id) do nothing;

-- Seeding runs as `postgres` with no JWT, which the role-change guard treats as privileged.
update public.profiles
set role = 'admin',
    updated_at = now()
where id = '00000000-0000-0000-0000-0000000ad301'
  and role is distinct from 'admin';

-- Three starter cabinets (PRD FR-002). Sample data, not real products — hence the manufacturer
-- name. They differ on purpose, so the layout heuristic (S-05) visibly adapts to the geometry:
--   (a) small surface cabinet, 1 rail, one top entry, no bars;
--   (b) medium, 3 full-width rails, top and bottom entries, vertical PE and N bars at the sides;
--   (c) large, 4 rows with the last one split into two rails around a gap, bottom and left
--       entries, PE and N bars that overlap in the front view at depths 20 mm apart.
-- Every geometry must pass `parseCabinetGeometry`; `tests/integration/rls-cabinets.test.ts` checks
-- that. Keyed on the case-insensitive unique index, so re-running inserts nothing.
insert into public.cabinets (name, manufacturer, model, price_grosze, geometry)
values
  (
    'Szafka natynkowa mała, 1 rząd',
    'Przykładowy producent',
    'PRZ-S1',
    8900,
    '{"version":1,"interior":{"widthMm":250,"heightMm":200,"depthMm":90},"rails":[{"xMm":10,"yMm":80,"lengthMm":230}],"entries":[{"side":"top","offsetMm":50,"lengthMm":150}],"bars":[]}'::jsonb
  ),
  (
    'Szafka natynkowa średnia, 3 rzędy',
    'Przykładowy producent',
    'PRZ-M3',
    24900,
    '{"version":1,"interior":{"widthMm":400,"heightMm":500,"depthMm":110},"rails":[{"xMm":40,"yMm":80,"lengthMm":320},{"xMm":40,"yMm":200,"lengthMm":320},{"xMm":40,"yMm":320,"lengthMm":320}],"entries":[{"side":"top","offsetMm":50,"lengthMm":300},{"side":"bottom","offsetMm":50,"lengthMm":300}],"bars":[{"kind":"PE","orientation":"vertical","xMm":10,"yMm":50,"lengthMm":400,"heightMm":15,"zMm":20,"terminalGroups":[{"count":12,"minMm2":1.5,"maxMm2":16},{"count":2,"minMm2":6,"maxMm2":25}]},{"kind":"N","orientation":"vertical","xMm":375,"yMm":50,"lengthMm":400,"heightMm":15,"zMm":20,"terminalGroups":[{"count":12,"minMm2":1.5,"maxMm2":16},{"count":2,"minMm2":6,"maxMm2":25}]}]}'::jsonb
  ),
  (
    'Szafka natynkowa duża, 4 rzędy',
    'Przykładowy producent',
    'PRZ-L4',
    59900,
    '{"version":1,"interior":{"widthMm":600,"heightMm":800,"depthMm":130},"rails":[{"xMm":30,"yMm":100,"lengthMm":540},{"xMm":30,"yMm":250,"lengthMm":540},{"xMm":30,"yMm":400,"lengthMm":540},{"xMm":30,"yMm":550,"lengthMm":240},{"xMm":330,"yMm":550,"lengthMm":240}],"entries":[{"side":"bottom","offsetMm":100,"lengthMm":400},{"side":"left","offsetMm":200,"lengthMm":400}],"bars":[{"kind":"PE","orientation":"horizontal","xMm":50,"yMm":680,"lengthMm":500,"heightMm":15,"zMm":20,"terminalGroups":[{"count":20,"minMm2":1.5,"maxMm2":16},{"count":3,"minMm2":6,"maxMm2":35}]},{"kind":"N","orientation":"horizontal","xMm":100,"yMm":685,"lengthMm":400,"heightMm":15,"zMm":40,"terminalGroups":[{"count":16,"minMm2":1.5,"maxMm2":16},{"count":2,"minMm2":6,"maxMm2":35}]}]}'::jsonb
  )
on conflict ((lower(manufacturer)), (lower(model))) do nothing;

-- A sample device catalog (PRD FR-001), so S-04 can be developed against both matcher paths at once.
-- Sample data, not real products — hence the manufacturer names. What it deliberately contains:
--   * MCB type B, 6 kA: B6–B32 in 1P, and B16/B20/B25 in 3P;
--   * the same MCB B16 1P from two manufacturers at two prices — the cheapest-match case;
--   * RCD 40 A 30 mA in 2P and 4P, types A and AC; RCBO B10 and B16 1P+N 30 mA type A, 6 kA;
--   * fuse switch-disconnectors 1P and 3P; one PE bar and one N bar;
--   * NO B40 in any pole configuration — the catalog-gap case (a circuit needing 40 A gets the
--     "contact the admin" error, never an under-rated MCB).
-- Widths are real DIN module multiples (17.5 mm per module). Every row must pass `parseDeviceSpec`;
-- `tests/integration/rls-devices.test.ts` checks that. Keyed on the case-insensitive unique index,
-- so re-running inserts nothing.
insert into public.devices (
  kind, name, manufacturer, model, price_grosze, width_mm, height_mm, depth_mm,
  poles, rated_current_a, residual_current_ma, rcd_type, breaking_capacity_ka, terminal_groups
)
values
  ('mcb_b', 'Wyłącznik nadprądowy B6 1P', 'Przykładowy producent', 'PRZ-B6-1P', 1490, 17.5, 85, 70, '1P', 6, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B10 1P', 'Przykładowy producent', 'PRZ-B10-1P', 1490, 17.5, 85, 70, '1P', 10, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B13 1P', 'Przykładowy producent', 'PRZ-B13-1P', 1490, 17.5, 85, 70, '1P', 13, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B16 1P', 'Przykładowy producent', 'PRZ-B16-1P', 1590, 17.5, 85, 70, '1P', 16, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B20 1P', 'Przykładowy producent', 'PRZ-B20-1P', 1690, 17.5, 85, 70, '1P', 20, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B25 1P', 'Przykładowy producent', 'PRZ-B25-1P', 1790, 17.5, 85, 70, '1P', 25, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B32 1P', 'Przykładowy producent', 'PRZ-B32-1P', 1990, 17.5, 85, 70, '1P', 32, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B16 1P', 'Inny przykładowy producent', 'INN-B16-1P', 1290, 17.5, 85, 70, '1P', 16, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B16 3P', 'Przykładowy producent', 'PRZ-B16-3P', 5490, 52.5, 85, 70, '3P', 16, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B20 3P', 'Przykładowy producent', 'PRZ-B20-3P', 5690, 52.5, 85, 70, '3P', 20, null, null, 6, null),
  ('mcb_b', 'Wyłącznik nadprądowy B25 3P', 'Przykładowy producent', 'PRZ-B25-3P', 5890, 52.5, 85, 70, '3P', 25, null, null, 6, null),
  ('rcd', 'Wyłącznik różnicowoprądowy 2P 40 A 30 mA typ A', 'Przykładowy producent', 'PRZ-RCD-2P-40-30-A', 11900, 35, 85, 70, '2P', 40, 30, 'A', null, null),
  ('rcd', 'Wyłącznik różnicowoprądowy 2P 40 A 30 mA typ AC', 'Przykładowy producent', 'PRZ-RCD-2P-40-30-AC', 8900, 35, 85, 70, '2P', 40, 30, 'AC', null, null),
  ('rcd', 'Wyłącznik różnicowoprądowy 4P 40 A 30 mA typ A', 'Przykładowy producent', 'PRZ-RCD-4P-40-30-A', 19900, 70, 85, 70, '4P', 40, 30, 'A', null, null),
  ('rcd', 'Wyłącznik różnicowoprądowy 4P 40 A 30 mA typ AC', 'Przykładowy producent', 'PRZ-RCD-4P-40-30-AC', 15900, 70, 85, 70, '4P', 40, 30, 'AC', null, null),
  ('rcbo', 'Wyłącznik różnicowonadprądowy B10 1P+N 30 mA typ A', 'Przykładowy producent', 'PRZ-RCBO-B10-30-A', 16900, 35, 85, 70, '1P+N', 10, 30, 'A', 6, null),
  ('rcbo', 'Wyłącznik różnicowonadprądowy B16 1P+N 30 mA typ A', 'Przykładowy producent', 'PRZ-RCBO-B16-30-A', 16900, 35, 85, 70, '1P+N', 16, 30, 'A', 6, null),
  ('switch_disconnector', 'Rozłącznik bezpiecznikowy 1P 63 A', 'Przykładowy producent', 'PRZ-FR-1P-63', 3990, 17.5, 85, 70, '1P', 63, null, null, null, null),
  ('switch_disconnector', 'Rozłącznik bezpiecznikowy 3P 40 A', 'Przykładowy producent', 'PRZ-FR-3P-40', 9990, 52.5, 85, 70, '3P', 40, null, null, null, null),
  ('switch_disconnector', 'Rozłącznik bezpiecznikowy 3P 63 A', 'Przykładowy producent', 'PRZ-FR-3P-63', 11990, 52.5, 85, 70, '3P', 63, null, null, null, null),
  ('pe_bar', 'Szyna PE 12-torowa', 'Przykładowy producent', 'PRZ-PE-12', 2490, 70, 15, 20, null, null, null, null, null,
    '[{"count":10,"minMm2":1.5,"maxMm2":16},{"count":2,"minMm2":6,"maxMm2":25}]'::jsonb),
  ('n_bar', 'Szyna N 12-torowa', 'Przykładowy producent', 'PRZ-N-12', 2490, 70, 15, 20, null, null, null, null, null,
    '[{"count":10,"minMm2":1.5,"maxMm2":16},{"count":2,"minMm2":6,"maxMm2":25}]'::jsonb)
on conflict ((lower(manufacturer)), (lower(model))) do nothing;
