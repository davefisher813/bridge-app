-- The college coach directory, recorded.
--
-- On 2026-09-26 another tool created public.college_coaches and loaded
-- 240 coaches into production with SQL run outside this migration
-- history, and added public.schools.location the same way (0037). This
-- file is that table as it exists in production, so a database built
-- from migrations/ has it and the app can read it, plus four
-- corrections applied on top.
--
-- 1. Who reads it. Dave, 2026-09-26: a shared list for owners and staff
--    in any org, and nobody else. The table arrived readable by every
--    signed-in account, family and board-member logins included, which
--    reversed the narrowing in 0023 (family) and 0031 (member). Each
--    org's own coach relationship stays in its private org_school_notes
--    overlay (0021); this is a directory of public staff listings.
-- 2. A coach cannot outlive their school: on delete cascade, and
--    school_id is required (every production row carries one).
-- 3. One row per coach per school, so reloading the sheet cannot
--    duplicate anyone.
-- 4. The school_name index nothing queries is dropped.
--
-- Writes stay with the service role only: no insert, update or delete
-- policy exists.

create table if not exists college_coaches (
  id uuid primary key default uuid_generate_v4(),
  school_id uuid references schools(id) on delete cascade,
  school_name text not null,
  name text not null,
  title text,
  email text,
  phone text,
  is_recruiting_coordinator boolean not null default false,
  email_verified boolean not null default false,
  source_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.college_coaches drop constraint if exists college_coaches_school_id_fkey;
alter table public.college_coaches
  add constraint college_coaches_school_id_fkey foreign key (school_id) references public.schools(id) on delete cascade;
alter table public.college_coaches alter column school_id set not null;

create index if not exists college_coaches_school_id_idx on college_coaches (school_id);
drop index if exists public.college_coaches_school_name_idx;
create unique index if not exists college_coaches_school_person_key on college_coaches (school_id, lower(name));

alter table public.college_coaches enable row level security;

drop policy if exists college_coaches_read on public.college_coaches;
drop policy if exists college_coaches_staff_read on public.college_coaches;
create policy college_coaches_staff_read on public.college_coaches for select
  using (exists (select 1 from private._member_org_ids()));

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;
revoke all on public.college_coaches from anon;
