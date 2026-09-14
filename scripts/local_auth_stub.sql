-- Local-Postgres stand-in for Supabase's auth schema, extended (beyond
-- migrations/0001_core_schema.sql's original smoke-test stub) so RLS can
-- actually be exercised as a non-superuser role, not just parsed.
--
-- auth.uid() reads a session GUC (app.current_uid) instead of always
-- returning null, so a single psql session can impersonate different
-- users by calling set_test_user() between statements. This is a test
-- harness only; a real Supabase project supplies auth.uid() from the
-- verified JWT and none of this file applies there.

create extension if not exists pgcrypto;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);

create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('app.current_role', true), ''), 'authenticated')
$$;

-- Call as: select set_test_user('<uuid>'); or select set_test_user(null) for anonymous.
create or replace function set_test_user(u uuid) returns void language sql as $$
  select set_config('app.current_uid', coalesce(u::text, ''), false)
$$;
