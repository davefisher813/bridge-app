-- Two real organizations on one database, which is the claim this whole
-- architecture makes and had never been tested with anything but
-- fixtures.
--
-- Bridge (BFFSA) is a nonprofit: it fundraises, it has a board, its
-- owner is an Executive Director and its staff are Coordinators. Elite
-- Squad is a travel baseball org: no fundraising, no board, an Owner and
-- Coaches. Same schema, same permissions, different words and different
-- modules, with no code branching on which org it is.
--
-- Run against a throwaway database (scripts/seed_smoke_test.sh), never
-- against anything real. Contains no actual athlete, donor or member
-- data: every name here is invented, because real student and donor
-- records do not belong in a repo.

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'ed@bridge.example'),
  ('00000000-0000-0000-0000-0000000000a2', 'coordinator@bridge.example'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner@elitesquad.example'),
  ('00000000-0000-0000-0000-0000000000b2', 'coach@elitesquad.example');

insert into users (id, email, full_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'ed@bridge.example', 'Example Director'),
  ('00000000-0000-0000-0000-0000000000a2', 'coordinator@bridge.example', 'Example Coordinator'),
  ('00000000-0000-0000-0000-0000000000b1', 'owner@elitesquad.example', 'Example Owner'),
  ('00000000-0000-0000-0000-0000000000b2', 'coach@elitesquad.example', 'Example Coach');

-- The two orgs differ in exactly three jsonb columns and nowhere else.
-- If anything other than role_labels, modules and branding has to differ
-- for both to work, the generic-from-day-one claim is not true.
insert into orgs (id, name, slug, role_labels, modules, branding) values
  (
    '00000000-0000-0000-0000-0000000000f1',
    'Bridge Foundation for Student Athletes',
    'bridge',
    '{"owner":"Executive Director","staff":"Coordinator","member":"Board Member"}'::jsonb,
    '{"recruiting":true,"doc_ai":true,"board_governance":true,"donor_fundraising":true}'::jsonb,
    '{}'::jsonb
  ),
  (
    '00000000-0000-0000-0000-0000000000f2',
    'Elite Squad NY',
    'elite-squad',
    '{"owner":"Owner","staff":"Coach","member":"Parent"}'::jsonb,
    -- No fundraising and no board. Both default off, so this is the
    -- shape an ordinary travel org gets without anybody configuring it.
    '{"recruiting":true,"doc_ai":true,"board_governance":false,"donor_fundraising":false}'::jsonb,
    '{}'::jsonb
  );

insert into org_members (user_id, org_id, role) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000f1', 'owner'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000f1', 'staff'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000f2', 'owner'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f2', 'staff');

-- Shared reference data, written once and read by both.
insert into schools (id, name, division, conference) values
  ('00000000-0000-0000-0000-0000000000c1', 'Example State University', 'D1', 'Example Conference'),
  ('00000000-0000-0000-0000-0000000000c2', 'Example College', 'D3', 'Example Athletic Conference');

-- A recruit in each org, with a target at the SAME school, which is the
-- ordinary case and the one that would break if anything about a school
-- were org-scoped by accident.
insert into athletes (id, org_id, recruit_type, name, sport, position, gpa) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', 'hs', 'Example Bridge Athlete', 'baseball', 'RHP', 3.10),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', 'hs', 'Example Elite Athlete', 'baseball', 'SS', 3.40);

insert into recruiting_targets (org_id, athlete_id, school_id, status) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 'In Contact'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 'Offer');

-- Fundraising exists only for Bridge. Elite Squad's rows are absent
-- rather than empty, because the module is off and nothing should ever
-- create them.
insert into donors (id, org_id, name, donor_type) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1', 'Example Donor', 'individual');
insert into gifts (org_id, donor_id, amount, received_on, category, method) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 250.00, '2026-05-01', 'individual', 'stripe');
insert into fundraising_budget (org_id, fiscal_year, category, amount) values
  ('00000000-0000-0000-0000-0000000000f1', 2026, 'individual', 60000.00);

-- ── Assertions, as a non-superuser so RLS actually applies ───────────
drop role if exists two_org_user;
create role two_org_user login nobypassrls;
grant usage on schema public to two_org_user;
grant select, insert, update, delete on all tables in schema public to two_org_user;

set role two_org_user;

-- The Bridge coordinator.
select set_test_user('00000000-0000-0000-0000-0000000000a2');

do $$
declare n int;
declare labels jsonb;
declare mods jsonb;
begin
  select count(*) into n from orgs;
  if n <> 1 then raise exception 'FAIL: a Bridge coordinator saw % orgs, expected 1', n; end if;

  select role_labels, modules into labels, mods from orgs;
  if labels->>'staff' <> 'Coordinator' then
    raise exception 'FAIL: Bridge staff label was %, expected Coordinator', labels->>'staff';
  end if;
  if (mods->>'donor_fundraising')::boolean is not true then
    raise exception 'FAIL: Bridge has fundraising off';
  end if;
  raise notice 'PASS: Bridge reads its own role labels and has fundraising on';
end $$;

do $$
declare n int;
begin
  select count(*) into n from athletes;
  if n <> 1 then raise exception 'FAIL: Bridge saw % athletes, expected its own 1', n; end if;
  select count(*) into n from gifts;
  if n <> 1 then raise exception 'FAIL: Bridge saw % gifts, expected 1', n; end if;
  raise notice 'PASS: Bridge sees its own roster and its own giving';
end $$;

-- The Elite Squad coach: same permissions, different word, no
-- fundraising, and none of Bridge's data.
select set_test_user('00000000-0000-0000-0000-0000000000b2');

do $$
declare labels jsonb;
declare mods jsonb;
begin
  select role_labels, modules into labels, mods from orgs;
  if labels->>'staff' <> 'Coach' then
    raise exception 'FAIL: Elite Squad staff label was %, expected Coach', labels->>'staff';
  end if;
  if (mods->>'donor_fundraising')::boolean is not false then
    raise exception 'FAIL: Elite Squad has fundraising on, which it should not';
  end if;
  raise notice 'PASS: the same staff permission is called Coach here and Coordinator at Bridge';
end $$;

do $$
declare n int;
begin
  select count(*) into n from athletes;
  if n <> 1 then raise exception 'FAIL: Elite Squad saw % athletes, expected its own 1', n; end if;
  select count(*) into n from gifts;
  if n <> 0 then raise exception 'FAIL: Elite Squad saw % of Bridge''s gifts', n; end if;
  select count(*) into n from donors;
  if n <> 0 then raise exception 'FAIL: Elite Squad saw % of Bridge''s donor records', n; end if;
  raise notice 'PASS: Elite Squad sees none of Bridge''s roster, donors or giving';
end $$;

-- The shared school is genuinely shared: both orgs target it, and
-- neither had to create its own copy.
do $$
declare n int;
begin
  select count(*) into n from schools;
  if n <> 2 then raise exception 'FAIL: a coach saw % schools, expected the 2 shared ones', n; end if;
  select count(*) into n from recruiting_targets;
  if n <> 1 then raise exception 'FAIL: a coach saw % targets, expected only their org''s 1', n; end if;
  raise notice 'PASS: both orgs recruit the same school from their own separate boards';
end $$;

-- A coach is staff, so they can write in their own org.
do $$
begin
  insert into athletes (org_id, recruit_type, name, sport)
    values ('00000000-0000-0000-0000-0000000000f2', 'hs', 'Example Second Athlete', 'baseball');
  raise notice 'PASS: a coach can add an athlete to their own org';
end $$;

-- And cannot write into Bridge, whatever they are called.
do $$
begin
  begin
    insert into athletes (org_id, recruit_type, name, sport)
      values ('00000000-0000-0000-0000-0000000000f1', 'hs', 'Example Crossover', 'baseball');
    raise exception 'FAIL: a coach wrote an athlete into Bridge';
  exception when insufficient_privilege then
    raise notice 'PASS: a coach cannot write into the other organization';
  end;
end $$;

reset role;

\echo 'TWO-ORG SEED VERIFIED'
