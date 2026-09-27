-- Three access levels and a Title per person.
--
-- Dave, 2026-09-27: "Admin, athlete, viewer. I control access of all
-- that. Within admin I can set board, title, role, whatever." One Admin
-- level (every Admin can do everything), and yes to a free-text Title
-- per person.
--
-- The org_role enum is NOT renamed and no policy or guard changes. The
-- app shows owner as Admin, member as Viewer and family as Athlete
-- (src/lib/org/roleLabels.ts). Two things here:
--
-- 1. staff is retired. Every staff membership becomes owner, so every
--    Admin can do everything. Production had four memberships, all
--    owner, when this was written, so there it changes nothing; on an
--    empty install it changes nothing. The enum value stays (dropping a
--    Postgres enum value means rebuilding the type and every policy that
--    names it), and the app refuses to assign it.
-- 2. org_members.title: what a person is called here (Head Coach, Board
--    Chair). Display only, never read by a policy. Null means none; when
--    set it is 1 to 80 characters after trimming. It is written only by
--    the service role behind the app's Admin check, because org_members
--    still has no update policy: a member or athlete session updating it
--    changes no row. Nothing is backfilled.
--
-- Safe to run twice.

-- ── 1. staff becomes owner ──────────────────────────────────────────
update org_members set role = 'owner' where role = 'staff';

-- ── 2. A Title per person ───────────────────────────────────────────
alter table org_members add column if not exists title text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_members_title_length' and conrelid = 'public.org_members'::regclass) then
    alter table org_members add constraint org_members_title_length check (title is null or length(btrim(title)) between 1 and 80);
  end if;
end $$;

comment on column org_members.title is 'What this person is called in this org. Display only; set by an Admin through the app.';
