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

-- What migration 0017 needs from auth and storage, added 2026-09-19.
-- Supabase's auth.users carries the sign-up metadata the profile trigger
-- reads a name out of, and its storage schema owns the bucket the
-- documents policies sit on. Both are shaped just far enough here that
-- the migration applies and the policies can be exercised as app_user.
alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb;
alter table auth.users add column if not exists last_sign_in_at timestamptz;

create schema if not exists storage;
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets(id),
  name       text not null,
  owner      uuid,
  created_at timestamptz not null default now()
);
alter table storage.objects enable row level security;

-- Same contract as Supabase's: every path segment but the last.
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;
