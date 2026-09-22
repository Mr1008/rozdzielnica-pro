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
