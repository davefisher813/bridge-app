-- Real RLS enforcement test, not just a schema/relationship smoke test.
-- Run as a Postgres superuser (it seeds data, creates a non-superuser
-- role, then SET ROLEs into that role to prove policies actually deny
-- cross-org access). See scripts/README.md for how to run this.
--
-- This replaces the gap flagged in docs/CURRENT_STATE.md: the original
-- migration smoke test (migrations/0001_core_schema.sql + the old
-- /tmp/smoke_test.sql from the same session) ran entirely as superuser,
-- which bypasses RLS unconditionally, so it never actually exercised a
-- policy. This script does.

\set ON_ERROR_STOP on

-- ── Non-superuser role. NOBYPASSRLS is the default for a new role, but
-- said explicitly since the entire point of this script depends on it. ──
drop role if exists app_user;
create role app_user login nobypassrls;
grant usage on schema public to app_user;
grant select, insert, update, delete on all tables in schema public to app_user;
grant usage on schema storage to app_user;
grant select, insert, update, delete on storage.objects to app_user;
grant select on storage.buckets to app_user;
-- Migration 0033 hands the member summary functions to `authenticated`
-- rather than to everyone, which is the role a signed-in caller carries
-- in a real Supabase project. app_user stands in for that caller here,
-- so it joins the role rather than being granted each function by name.
grant authenticated to app_user;

-- ── The first org of a fresh install (migration 0040) ──────────────
-- Before anything is seeded, so orgs is truly empty: the first
-- create_org on an install with no org turns on edits_shared_directory
-- for that org, and every later one (the same owner's second org
-- included) leaves it off. Cleaned up again before the seed below.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000f1', 'first@fresh.example');
insert into users (id, email, full_name) values ('00000000-0000-0000-0000-0000000000f1', 'first@fresh.example', 'First Installer')
on conflict (id) do update set full_name = excluded.full_name;
do $$
declare n int;
begin
  select count(*) into n from orgs;
  if n <> 0 then raise exception 'FAIL: the fresh-install probe found % orgs already', n; end if;
end $$;
set role app_user;
select set_test_user('00000000-0000-0000-0000-0000000000f1');
select create_org('First Install Org', 'first-install-org');
select create_org('Second Install Org', 'second-install-org');
select set_test_user(null);
reset role;
do $$
declare first_flag boolean; second_flag boolean;
begin
  select edits_shared_directory into first_flag from orgs where slug = 'first-install-org';
  select edits_shared_directory into second_flag from orgs where slug = 'second-install-org';
  if first_flag is distinct from true then raise exception 'FAIL: the first org of a fresh install does not edit the shared directory (%)', first_flag; end if;
  if second_flag is distinct from false then raise exception 'FAIL: a second org edits the shared directory (%)', second_flag; end if;
  raise notice 'PASS: only the first org of a fresh install edits the shared directory';
end $$;
delete from orgs where slug in ('first-install-org', 'second-install-org');
delete from users where id = '00000000-0000-0000-0000-0000000000f1';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';

-- ── Seed: two orgs, two users, one membership each, athletes in both,
-- one shared school, one global benchmark set, one org1-owned set. ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user1@bridge.example'),
  ('00000000-0000-0000-0000-000000000002', 'user2@elitesquad.example'),
  ('00000000-0000-0000-0000-000000000003', 'user3@bridge.example');
insert into users (id, email, full_name) values
  ('00000000-0000-0000-0000-000000000001', 'user1@bridge.example', 'User One'),
  ('00000000-0000-0000-0000-000000000002', 'user2@elitesquad.example', 'User Two'),
  ('00000000-0000-0000-0000-000000000003', 'user3@bridge.example', 'User Three')
on conflict (id) do update set full_name = excluded.full_name;
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Bridge', 'bridge'),
  ('00000000-0000-0000-0000-000000000020', 'Elite Squad', 'elite-squad');
insert into org_members (user_id, org_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'owner'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000020', 'owner'),
  -- A Bridge MEMBER, not staff. Until 2026-09-16 every assertion in this
  -- file ran as an owner, which is exactly why the missing role check in
  -- the policies went unnoticed: the suite could not have caught it.
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000010', 'member'),
  -- The same person is STAFF in the other org. This is what proves the
  -- role check is scoped per org rather than global: every Bridge write
  -- below must still fail for them, while their Elite Squad writes
  -- succeed. A helper that forgot its org filter would pass every other
  -- assertion in this file.
  ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000020', 'staff');
insert into athletes (id, org_id, recruit_type, name, sport) values
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000010', 'hs', 'Bridge Athlete A', 'baseball'),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000010', 'hs', 'Bridge Athlete B', 'baseball'),
  ('00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000020', 'hs', 'Elite Squad Athlete', 'baseball');
insert into schools (id, name, division) values ('00000000-0000-0000-0000-000000000130', 'Shared Reference School', 'D1');
insert into recruiting_targets (id, org_id, athlete_id, school_id, status) values
  ('00000000-0000-0000-0000-000000000210', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000130', 'In Contact'),
  ('00000000-0000-0000-0000-000000000220', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000130', 'In Contact');
insert into target_communications (org_id, target_id, kind, notes) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000210', 'call', 'Bridge call log'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000220', 'call', 'Elite Squad call log');
insert into contacts (org_id, athlete_id, name, role) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', 'Bridge HS Coach', 'hs_coach'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', 'Elite Squad HS Coach', 'hs_coach');
insert into target_visits (org_id, target_id, visit_type) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000210', 'unofficial'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000220', 'unofficial');
insert into documents (org_id, file_name, file_size, media_type, source_role, status) values
  ('00000000-0000-0000-0000-000000000010', 'bridge-transcript.pdf', 1000, 'application/pdf', 'coordinator', 'pending'),
  ('00000000-0000-0000-0000-000000000020', 'elite-transcript.pdf', 1000, 'application/pdf', 'coordinator', 'pending');
insert into athlete_courses (org_id, athlete_id, title, subject, credit, grade, school_name) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', 'English 11', 'english', 1.00, 'B', 'Bridge HS'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', 'English 11', 'english', 1.00, 'A', 'Elite HS');
insert into high_school_grading_scales (school_name, bands) values
  ('Bridge HS', '[{"letter":"B","min":83,"max":86}]'::jsonb);
-- Both orgs enter their own scale for the SAME school name. That is the
-- case the org-scoped table exists to make safe: the unique constraint
-- is on (org_id, school_name_key), not on the name alone, so neither
-- org's entry can collide with or overwrite the other's.
insert into org_grading_scales (org_id, school_name, bands, source_note) values
  ('00000000-0000-0000-0000-000000000010', 'Contested HS', '[{"letter":"A","min":90,"max":100}]'::jsonb, 'Bridge typed this'),
  ('00000000-0000-0000-0000-000000000020', 'Contested HS', '[{"letter":"A","min":95,"max":100}]'::jsonb, 'Elite Squad typed this');

-- Approved-course lists, one per org for the same contested school, so
-- the same isolation the grading scales are checked for is checked here.
-- A wrong approved list does not merely change a number: it drops a
-- real core course out of the average entirely.
insert into org_approved_course_lists (id, org_id, school_name, is_complete, source_note) values
  ('00000000-0000-0000-0000-000000000910', '00000000-0000-0000-0000-000000000010', 'Contested HS', false, 'bridge typed this'),
  ('00000000-0000-0000-0000-000000000920', '00000000-0000-0000-0000-000000000020', 'Contested HS', false, 'elite typed this');

insert into org_approved_courses (list_id, org_id, title, subject) values
  ('00000000-0000-0000-0000-000000000910', '00000000-0000-0000-0000-000000000010', 'Bridge Algebra II', 'math'),
  ('00000000-0000-0000-0000-000000000920', '00000000-0000-0000-0000-000000000020', 'Elite Algebra II', 'math');

insert into ncaa_approved_course_lists (id, school_name, is_complete, source_note) values
  ('00000000-0000-0000-0000-000000000930', 'Shared HS', true, 'transcribed from the portal');
insert into ncaa_approved_courses (list_id, title, subject) values
  ('00000000-0000-0000-0000-000000000930', 'Shared English 11', 'english');
-- Fundraising. Donor names and giving histories are the most sensitive
-- rows in this database, so both orgs get one and the assertions below
-- prove neither can see the other's.
insert into donors (id, org_id, name, donor_type, email) values
  ('00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000010', 'Bridge Donor', 'individual', 'donor@bridge.example'),
  ('00000000-0000-0000-0000-000000000320', '00000000-0000-0000-0000-000000000020', 'Elite Donor', 'corporate', 'donor@elite.example');
insert into campaigns (id, org_id, name, kind, goal_amount) values
  ('00000000-0000-0000-0000-000000000330', '00000000-0000-0000-0000-000000000010', 'Bridge Invitational', 'event', 25000.00),
  ('00000000-0000-0000-0000-000000000340', '00000000-0000-0000-0000-000000000020', 'Elite Appeal', 'appeal', 5000.00);
insert into gifts (org_id, donor_id, campaign_id, amount, received_on, category, method) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000330', 200.00, '2026-08-13', 'special_event', 'stripe'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000320', '00000000-0000-0000-0000-000000000340', 500.00, '2026-08-13', 'corporate', 'check');
insert into pledges (org_id, donor_id, amount, promised_on, due_on) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000310', 5000.00, '2026-01-15', '2026-12-31'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000320', 1000.00, '2026-01-15', '2026-12-31');
insert into grants (org_id, funder_name, status, amount_requested) values
  ('00000000-0000-0000-0000-000000000010', 'Some Foundation', 'researching', 25000.00),
  ('00000000-0000-0000-0000-000000000020', 'Other Foundation', 'applied', 10000.00);
insert into fundraising_budget (org_id, fiscal_year, category, amount) values
  ('00000000-0000-0000-0000-000000000010', 2026, 'individual', 50000.00),
  ('00000000-0000-0000-0000-000000000020', 2026, 'individual', 10000.00);
insert into benchmark_sets (org_id, sport, tiers, positions) values
  (null, 'baseball', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000000010', 'baseball', '[]'::jsonb, '[]'::jsonb),
  ('00000000-0000-0000-0000-000000000020', 'baseball', '[]'::jsonb, '[]'::jsonb);

-- Board governance. Only Bridge has the module, but the tables are
-- org-scoped like everything else and the isolation is asserted the same
-- way.
insert into boards (id, org_id, name, kind, give_get_amount, min_seats, max_seats) values
  ('00000000-0000-0000-0000-000000000410', '00000000-0000-0000-0000-000000000010', 'Executive Board', 'executive', 10000.00, 1, 15),
  ('00000000-0000-0000-0000-000000000420', '00000000-0000-0000-0000-000000000020', 'Elite Board', 'general', 1000.00, 1, 10);
-- The Bridge seat is user3's: the member login, so member_giving()
-- (migration 0031) has a seat to find.
insert into board_members (id, org_id, board_id, name, donor_id, user_id, status, commitment_amount) values
  ('00000000-0000-0000-0000-000000000430', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000410', 'Example Board Member', '00000000-0000-0000-0000-000000000310', '00000000-0000-0000-0000-000000000003', 'active', 10000.00),
  ('00000000-0000-0000-0000-000000000440', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000420', 'Elite Board Member', '00000000-0000-0000-0000-000000000320', null, 'active', 1000.00);

-- Matching and metrics (migration 0021). Each org gets a metric log
-- entry on its own athlete, a private note on the SAME shared school,
-- and a stored match against it, so the isolation on all three is
-- asserted the same way as everything else. The shared school is the
-- interesting case for the note: the unique constraint is on
-- (org_id, school_id), so both orgs annotate one school without
-- colliding, and neither may read the other's coach contact.
insert into athlete_metrics (id, org_id, athlete_id, metric, value, measured_on, source, source_detail, entered_by) values
  ('00000000-0000-0000-0000-000000000510', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', 'fbVelo', 86.00, '2026-08-15', 'premier', 'Bridge Showcase', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000520', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', 'fbVelo', 84.00, '2026-08-15', 'coach', 'practice', '00000000-0000-0000-0000-000000000002');
insert into org_school_notes (id, org_id, school_id, coach_name, coach_email, positions_of_need, notes) values
  ('00000000-0000-0000-0000-000000000530', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000130', 'Bridge Coach Contact', 'coach@bridge.example', '[{"position":"MIF","gradYear":2027}]'::jsonb, 'Bridge typed this'),
  ('00000000-0000-0000-0000-000000000540', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000130', 'Elite Coach Contact', 'coach@elite.example', '[]'::jsonb, 'Elite Squad typed this');
insert into athlete_school_fits (id, org_id, athlete_id, school_id, score, tag, inputs_hash) values
  ('00000000-0000-0000-0000-000000000550', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000130', 93, 'Safety', 'seed'),
  ('00000000-0000-0000-0000-000000000560', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000130', 81, 'Safety', 'seed');

-- ── Assertions, run as app_user impersonating user1 (Bridge only). ──
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000001');

do $$
declare n int;
begin
  select count(*) into n from athletes; -- USING filters to org_id in (user1's orgs)
  if n <> 2 then raise exception 'FAIL: user1 saw % athletes, expected 2 (Bridge only)', n; end if;
  raise notice 'PASS: user1 sees exactly Bridge''s 2 athletes, not Elite Squad''s';
end $$;

do $$
declare n int;
begin
  select count(*) into n from athletes where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 0 then raise exception 'FAIL: user1 could see % Elite Squad athlete row(s) by filtering directly on org_id', n; end if;
  raise notice 'PASS: filtering directly on the foreign org_id still returns nothing';
end $$;

do $$
begin
  begin
    insert into athletes (org_id, recruit_type, name, sport)
      values ('00000000-0000-0000-0000-000000000020', 'hs', 'Sneaky Insert', 'baseball');
    raise exception 'FAIL: user1 was able to insert an athlete into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare affected int;
begin
  update athletes set status = 'Committed' where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: user1''s UPDATE touched % row(s) in Elite Squad''s org', affected; end if;
  raise notice 'PASS: UPDATE against a foreign org_id silently affects 0 rows';
end $$;

do $$
declare n int;
begin
  -- Two, not one: user1 and user3 are both Bridge members, and
  -- org_members_self deliberately lets a member see their own org's
  -- roster. The number that matters is that Elite Squad's row is not
  -- among them.
  select count(*) into n from org_members;
  if n <> 2 then raise exception 'FAIL: user1 saw % org_members rows, expected 2 (Bridge''s roster)', n; end if;
  select count(*) into n from org_members where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 0 then raise exception 'FAIL: user1 saw % of Elite Squad''s membership rows', n; end if;
  raise notice 'PASS: user1 sees Bridge''s membership rows and none of Elite Squad''s';
end $$;

do $$
declare n int;
begin
  select count(*) into n from target_communications;
  if n <> 1 then raise exception 'FAIL: user1 saw % target_communications rows, expected 1 (Bridge''s only)', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s communication log entry, not Elite Squad''s';
end $$;

do $$
begin
  begin
    insert into target_communications (org_id, target_id, kind, notes)
      values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000220', 'call', 'Sneaky log entry');
    raise exception 'FAIL: user1 was able to insert a communication into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org communication-log insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  select count(*) into n from contacts;
  if n <> 1 then raise exception 'FAIL: user1 saw % contacts rows, expected 1 (Bridge''s only)', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s contact, not Elite Squad''s';
end $$;

do $$
begin
  begin
    insert into contacts (org_id, athlete_id, name, role)
      values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', 'Sneaky Contact', 'other');
    raise exception 'FAIL: user1 was able to insert a contact into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org contact insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  select count(*) into n from target_visits;
  if n <> 1 then raise exception 'FAIL: user1 saw % target_visits rows, expected 1 (Bridge''s only)', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s visit, not Elite Squad''s';
end $$;

do $$
begin
  begin
    insert into target_visits (org_id, target_id, visit_type)
      values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000220', 'other');
    raise exception 'FAIL: user1 was able to insert a visit into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org visit insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  select count(*) into n from documents;
  if n <> 1 then raise exception 'FAIL: user1 saw % documents rows, expected 1 (Bridge''s only)', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s document, not Elite Squad''s';
end $$;

do $$
begin
  begin
    insert into documents (org_id, file_name, file_size, media_type, source_role)
      values ('00000000-0000-0000-0000-000000000020', 'sneaky.pdf', 10, 'application/pdf', 'admin');
    raise exception 'FAIL: user1 was able to insert a document into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org document insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  select count(*) into n from athlete_courses;
  if n <> 1 then raise exception 'FAIL: user1 saw % athlete_courses rows, expected 1 (Bridge''s only)', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s course rows, not Elite Squad''s';
end $$;

do $$
begin
  begin
    insert into athlete_courses (org_id, athlete_id, title, subject, credit, grade)
      values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', 'Sneaky', 'math', 1.00, 'A');
    raise exception 'FAIL: user1 was able to insert a course into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org course insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

-- Grading scales are shared reference data: readable by any signed-in
-- member, writable only by the service role.
do $$
declare n int;
begin
  select count(*) into n from high_school_grading_scales;
  if n <> 1 then raise exception 'FAIL: user1 saw % grading scales, expected 1 (shared reference data)', n; end if;
  raise notice 'PASS: user1 can read the shared grading scale';
end $$;

do $$
begin
  begin
    insert into high_school_grading_scales (school_name, bands) values ('Made Up HS', '[]'::jsonb);
    raise exception 'FAIL: user1 was able to write a grading scale, which would change every org''s eligibility verdicts';
  exception when insufficient_privilege then
    raise notice 'PASS: grading-scale write correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

-- An org's OWN grading scale is the opposite case: writable by its
-- members, invisible to every other org. This is what makes the entry
-- screen safe to build when the shared table stays locked.
do $$
declare n int;
declare bandmin numeric;
begin
  select count(*) into n from org_grading_scales;
  if n <> 1 then raise exception 'FAIL: user1 saw % org grading scales, expected 1 (Bridge''s only)', n; end if;
  select (bands->0->>'min')::numeric into bandmin from org_grading_scales;
  if bandmin <> 90 then raise exception 'FAIL: user1 saw Elite Squad''s bands for Contested HS, not Bridge''s'; end if;
  raise notice 'PASS: user1 sees only Bridge''s own scale for a school both orgs entered';
end $$;

do $$
begin
  insert into org_grading_scales (org_id, school_name, bands, source_note)
    values ('00000000-0000-0000-0000-000000000010', 'Bridge HS', '[{"letter":"A","min":90,"max":100}]'::jsonb, 'typed by a coordinator');
  raise notice 'PASS: user1 can enter a grading scale for their own org';
end $$;

do $$
begin
  begin
    insert into org_grading_scales (org_id, school_name, bands)
      values ('00000000-0000-0000-0000-000000000020', 'Sneaky HS', '[]'::jsonb);
    raise exception 'FAIL: user1 was able to write a grading scale into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org grading-scale insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  update org_grading_scales set source_note = 'tampered' where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 updated % of Elite Squad''s grading-scale rows', n; end if;
  raise notice 'PASS: user1 cannot update Elite Squad''s grading scale';
end $$;

-- The approved-course list decides whether a course counts at all, so
-- one org's copy reaching another is a worse failure than a wrong
-- conversion table: it removes credits rather than re-weighting them.
do $$
declare n int;
declare t text;
begin
  select count(*) into n from org_approved_course_lists;
  if n <> 1 then raise exception 'FAIL: user1 saw % org approved lists, expected 1 (Bridge''s only)', n; end if;
  select title into t from org_approved_courses;
  if t <> 'Bridge Algebra II' then raise exception 'FAIL: user1 saw Elite Squad''s approved course "%s", not Bridge''s', t; end if;
  raise notice 'PASS: user1 sees only Bridge''s own approved list for a school both orgs entered';
end $$;

do $$
begin
  begin
    insert into org_approved_course_lists (org_id, school_name)
      values ('00000000-0000-0000-0000-000000000020', 'Sneaky HS');
    raise exception 'FAIL: user1 was able to write an approved list into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org approved-list insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  update org_approved_courses set title = 'tampered' where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 updated % of Elite Squad''s approved courses', n; end if;
  raise notice 'PASS: user1 cannot update Elite Squad''s approved courses';
end $$;

-- The shared, verified list is readable by everyone and writable by
-- nobody through the API: a wrong row on it rewrites every eligibility
-- verdict at that school in every org at once.
do $$
declare n int;
begin
  select count(*) into n from ncaa_approved_course_lists;
  if n <> 1 then raise exception 'FAIL: user1 saw % shared approved lists, expected 1', n; end if;
  raise notice 'PASS: user1 can read the shared NCAA approved list';
end $$;

do $$
begin
  begin
    insert into ncaa_approved_course_lists (school_name) values ('Forged HS');
    raise exception 'FAIL: user1 wrote to the shared NCAA approved-list table';
  exception when insufficient_privilege then
    raise notice 'PASS: shared approved-list insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  update ncaa_approved_courses set title = 'tampered';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 updated % rows of the shared approved course table', n; end if;
  raise notice 'PASS: user1 cannot update the shared approved course table';
end $$;

do $$
declare n int;
begin
  select count(*) into n from benchmark_sets;
  if n <> 2 then raise exception 'FAIL: user1 saw % benchmark_sets, expected 2 (Bridge''s + the global default)', n; end if;
  raise notice 'PASS: user1 sees Bridge''s benchmark set plus the shared/global one, not Elite Squad''s';
end $$;

do $$
declare n int;
begin
  select count(*) into n from users;
  -- Own row plus the Bridge member's (migration 0018: colleagues see
  -- each other). Elite Squad's owner stays invisible; asserted below.
  if n <> 2 then raise exception 'FAIL: user1 saw % users rows, expected 2 (self and the Bridge member)', n; end if;
  raise notice 'PASS: profile rows are limited to the caller and their colleagues';
end $$;

do $$
declare n int;
begin
  select count(*) into n from schools;
  if n <> 1 then raise exception 'FAIL: user1 saw % schools, expected 1 (shared reference data)', n; end if;
  raise notice 'PASS: shared reference data (schools) is visible regardless of org';
end $$;

do $$
begin
  -- schools has no INSERT policy at all - deliberately (migration 0001's
  -- comment, docs/DECISIONS.md). src/lib/actions/schools.ts's createSchool
  -- is the one door in, and it goes through the service-role client after
  -- its own requireOwner() check, never through a normal RLS-scoped
  -- insert like this one - this proves that door stays the only one.
  begin
    insert into schools (name, division) values ('Sneaky School', 'D1');
    raise exception 'FAIL: an ordinary authenticated user was able to insert a school';
  exception when insufficient_privilege then
    raise notice 'PASS: schools insert correctly rejected by RLS for an ordinary user (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  -- Regression test: orgs had RLS enabled with zero policies until this
  -- was caught building the org-resolution page, which silently denied
  -- every row to every non-owner role, including a member reading their
  -- own org.
  select count(*) into n from orgs;
  if n <> 1 then raise exception 'FAIL: user1 saw % orgs, expected 1 (their own Bridge row, not Elite Squad''s)', n; end if;
  raise notice 'PASS: user1 can read their own org row, not the other org''s';
end $$;

-- ── Fundraising. Donor records are the rows whose leaking would matter
-- most, so they get the same cross-org treatment as everything else. ──
do $$
declare n int;
begin
  select count(*) into n from donors;
  if n <> 1 then raise exception 'FAIL: user1 saw % donors, expected 1 (Bridge''s only)', n; end if;
  select count(*) into n from gifts;
  if n <> 1 then raise exception 'FAIL: user1 saw % gifts, expected 1', n; end if;
  select count(*) into n from pledges;
  if n <> 1 then raise exception 'FAIL: user1 saw % pledges, expected 1', n; end if;
  select count(*) into n from grants;
  if n <> 1 then raise exception 'FAIL: user1 saw % grants, expected 1', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s donors, gifts, pledges and grants';
end $$;

do $$
begin
  begin
    insert into gifts (org_id, amount, received_on, category, method)
      values ('00000000-0000-0000-0000-000000000020', 1.00, '2026-09-16', 'individual', 'cash');
    raise exception 'FAIL: user1 booked a gift into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org gift insert correctly rejected by RLS';
  end;
end $$;

do $$
declare n int;
begin
  update donors set email = 'stolen@example.com' where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 rewrote % of Elite Squad''s donor records', n; end if;
  raise notice 'PASS: user1 cannot touch Elite Squad''s donor records';
end $$;

-- A gift must be money. A zero row is not a correction, it is a mistake,
-- and it inflates the gift count and the donor count for nothing.
do $$
begin
  begin
    insert into gifts (org_id, amount, received_on, category, method)
      values ('00000000-0000-0000-0000-000000000010', 0, '2026-09-16', 'individual', 'cash');
    raise exception 'FAIL: a gift of zero was accepted';
  exception when check_violation then
    raise notice 'PASS: a gift of zero is refused by the database';
  end;
end $$;

-- A pledge of zero or less is not a promise.
do $$
begin
  begin
    insert into pledges (org_id, donor_id, amount, promised_on)
      values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000310', -5.00, '2026-09-16');
    raise exception 'FAIL: a negative pledge was accepted';
  exception when check_violation then
    raise notice 'PASS: a negative pledge is refused by the database';
  end;
end $$;

-- Stripe delivers the same webhook more than once. Without the unique
-- index a replay books the donation twice and the year's total is wrong
-- in the direction nobody questions.
do $$
begin
  insert into gifts (org_id, amount, received_on, category, method, external_ref)
    values ('00000000-0000-0000-0000-000000000010', 200.00, '2026-08-13', 'special_event', 'stripe', 'pi_test_123');
  begin
    insert into gifts (org_id, amount, received_on, category, method, external_ref)
      values ('00000000-0000-0000-0000-000000000010', 200.00, '2026-08-13', 'special_event', 'stripe', 'pi_test_123');
    raise exception 'FAIL: the same Stripe payment was booked twice';
  exception when unique_violation then
    raise notice 'PASS: replaying a Stripe payment cannot double-book a gift';
  end;
end $$;

-- The same reference in a DIFFERENT org is a different payment and must
-- still be allowed, or one org's ids would block another's.
do $$
begin
  insert into gifts (org_id, amount, received_on, category, method, external_ref)
    values ('00000000-0000-0000-0000-000000000010', 50.00, '2026-08-13', 'individual', 'stripe', null);
  insert into gifts (org_id, amount, received_on, category, method, external_ref)
    values ('00000000-0000-0000-0000-000000000010', 50.00, '2026-08-13', 'individual', 'stripe', null);
  raise notice 'PASS: two gifts with no external reference do not collide';
end $$;

-- ── Board governance, same isolation as everything else. ──
do $$
declare n int;
begin
  select count(*) into n from boards;
  if n <> 1 then raise exception 'FAIL: user1 saw % boards, expected 1 (Bridge''s)', n; end if;
  select count(*) into n from board_members;
  if n <> 1 then raise exception 'FAIL: user1 saw % board members, expected 1', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s boards and board members';
end $$;

do $$
declare n int;
begin
  update board_members set name = 'Tampered' where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 rewrote % of Elite Squad''s board records', n; end if;
  raise notice 'PASS: user1 cannot touch the other org''s board';
end $$;

-- A sport board's seat range has to make sense. max below min would let
-- a board be simultaneously full and below its floor.
do $$
begin
  begin
    insert into boards (org_id, name, kind, min_seats, max_seats)
      values ('00000000-0000-0000-0000-000000000010', 'Impossible Board', 'sport', 5, 3);
    raise exception 'FAIL: a board with max_seats below min_seats was accepted';
  exception when check_violation then
    raise notice 'PASS: a board cannot have fewer maximum seats than minimum';
  end;
end $$;

-- A term that ends before it starts is a typo that would make every
-- date calculation downstream wrong.
do $$
begin
  begin
    insert into board_members (org_id, board_id, name, term_start, term_end)
      values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000410', 'Backwards Term', '2026-12-31', '2026-01-01');
    raise exception 'FAIL: a term ending before it starts was accepted';
  exception when check_violation then
    raise notice 'PASS: a board term cannot end before it starts';
  end;
end $$;

-- The get half: a gift can be credited to the board member who brought
-- it in, and that credit is org-scoped like the gift itself.
do $$
declare n int;
begin
  update gifts set solicited_by = '00000000-0000-0000-0000-000000000430'
    where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n < 1 then raise exception 'FAIL: could not credit a gift to a board member'; end if;
  raise notice 'PASS: a gift can be credited to the member who brought it in';
end $$;

-- ── Matching and metrics (migration 0021). A metric log entry, a
-- private note on the shared school and a stored match: user1 sees
-- Bridge's row in each and cannot write or rewrite an Elite Squad one. ──
do $$
declare n int;
begin
  select count(*) into n from athlete_metrics;
  if n <> 1 then raise exception 'FAIL: user1 saw % athlete_metrics rows, expected 1 (Bridge''s only)', n; end if;
  select count(*) into n from athlete_metrics where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 0 then raise exception 'FAIL: user1 could see % Elite Squad metric row(s) by filtering directly on org_id', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s metric log, not Elite Squad''s';
end $$;

do $$
begin
  begin
    insert into athlete_metrics (org_id, athlete_id, metric, value, measured_on)
      values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', 'fbVelo', 90.00, '2026-09-01');
    raise exception 'FAIL: user1 was able to log a metric into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org metric insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
declare who text;
begin
  select count(*) into n from org_school_notes;
  if n <> 1 then raise exception 'FAIL: user1 saw % org_school_notes rows, expected 1 (Bridge''s only)', n; end if;
  select coach_name into who from org_school_notes;
  if who <> 'Bridge Coach Contact' then raise exception 'FAIL: user1 saw Elite Squad''s coach contact "%" on a school both orgs annotated', who; end if;
  raise notice 'PASS: user1 sees only Bridge''s own note on a school both orgs annotated';
end $$;

do $$
begin
  begin
    insert into org_school_notes (org_id, school_id, coach_name)
      values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000130', 'Sneaky Coach');
    raise exception 'FAIL: user1 was able to write a school note into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org school-note insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
declare s int;
begin
  select count(*) into n from athlete_school_fits;
  if n <> 1 then raise exception 'FAIL: user1 saw % athlete_school_fits rows, expected 1 (Bridge''s only)', n; end if;
  select score into s from athlete_school_fits;
  if s <> 93 then raise exception 'FAIL: user1 saw Elite Squad''s stored match (score %), not Bridge''s', s; end if;
  raise notice 'PASS: user1 sees only Bridge''s stored match against the shared school';
end $$;

do $$
begin
  begin
    insert into athlete_school_fits (org_id, athlete_id, school_id, score, tag, inputs_hash)
      values ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000130', 99, 'Safety', 'sneaky');
    raise exception 'FAIL: user1 was able to store a match in Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: cross-org stored-match insert correctly rejected by RLS (%.)', sqlerrm;
  end;
end $$;

do $$
declare n int;
begin
  update athlete_metrics set value = 99 where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 rewrote % of Elite Squad''s metric entries', n; end if;
  update org_school_notes set notes = 'tampered' where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 rewrote % of Elite Squad''s school notes', n; end if;
  update athlete_school_fits set score = 0 where org_id = '00000000-0000-0000-0000-000000000020';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user1 rewrote % of Elite Squad''s stored matches', n; end if;
  raise notice 'PASS: user1 cannot rewrite Elite Squad''s metrics, school notes or stored matches';
end $$;

-- And the owner must still be able to write their own org's rows, or
-- the metrics screen saves nothing and reports no error.
do $$
declare n int;
begin
  insert into athlete_metrics (org_id, athlete_id, metric, value, measured_on, source, source_detail)
    values ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', 'sixty', 6.90, '2026-09-14', 'coach', 'practice');
  delete from athlete_metrics where athlete_id = '00000000-0000-0000-0000-000000000111';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an owner deleted % metric rows, expected 1', n; end if;
  update org_school_notes set notes = 'owner edited this' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an owner updated % school notes, expected 1', n; end if;
  update athlete_school_fits set computed_at = now() where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an owner updated % stored matches, expected 1', n; end if;
  raise notice 'PASS: an owner can log a metric, edit a school note and restore a stored match in their own org';
end $$;

-- ── The member pass. user3 belongs to Bridge with role `member` (Bridge
-- calls it Board). Until migration 0031 a member read every org table
-- exactly like an owner and could only be stopped from writing. Since
-- 0031 a member reads no org rows at all: what they get is the three
-- summary functions, and this pass proves both halves. Writes still
-- all fail. ──
select set_test_user('00000000-0000-0000-0000-000000000003');

do $$
declare n int;
begin
  -- user3 belongs to both orgs, as a member of Bridge and staff of Elite
  -- Squad, so the totals are checked per org rather than overall.
  select count(*) into n from athletes where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge athlete rows, expected 0 (migration 0031: summaries only)', n; end if;
  select count(*) into n from athletes where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 1 then raise exception 'FAIL: as Elite staff, user3 saw % Elite athletes, expected 1', n; end if;
  raise notice 'PASS: a member reads no athlete rows in the org where they are a member, and still reads them where they are staff';
end $$;

do $$
declare n int;
begin
  select count(*) into n from recruiting_targets where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge targets', n; end if;
  select count(*) into n from target_communications where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge call notes', n; end if;
  select count(*) into n from documents where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge documents', n; end if;
  select count(*) into n from gifts where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge gift rows', n; end if;
  raise notice 'PASS: a member reads no targets, call notes, documents or gift rows';
end $$;

-- Donor records specifically: a member reads none and cannot change one.
do $$
declare n int;
begin
  select count(*) into n from donors where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge donors, expected 0', n; end if;
  update donors set email = 'member@example.com' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % donor records', n; end if;
  raise notice 'PASS: a member reads no donors and cannot change one';
end $$;

-- What a member does get: the program as names and stages.
do $$
declare n int; st text;
begin
  select count(*) into n from member_program('00000000-0000-0000-0000-000000000010');
  if n <> 2 then raise exception 'FAIL: member_program returned % Bridge athletes, expected 2', n; end if;
  select stage into st from member_program('00000000-0000-0000-0000-000000000010') where athlete_id = '00000000-0000-0000-0000-000000000110';
  if st <> 'Targeting' then raise exception 'FAIL: the seeded athlete with an In Contact target reads as %, expected Targeting', st; end if;
  select count(*) into n from member_program_schools('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110');
  if n <> 1 then raise exception 'FAIL: member_program_schools returned % schools, expected 1', n; end if;
  raise notice 'PASS: a member reads the program as names and stages through member_program';
end $$;

-- And giving: the rows with names stripped except on their own gifts.
do $$
declare j jsonb; n int; dn text;
begin
  j := member_giving('00000000-0000-0000-0000-000000000010');
  if j is null then raise exception 'FAIL: member_giving returned null for the member''s own org'; end if;
  if (j->>'my_seat_id') <> '00000000-0000-0000-0000-000000000430' then raise exception 'FAIL: member_giving did not find the caller''s seat: %', j->>'my_seat_id'; end if;
  -- Earlier passes booked more gifts as the owner; what matters is that
  -- the seeded gift from the seat's own donor carries its donor's name
  -- and every gift not credited to the seat carries none.
  select count(*) into n from jsonb_array_elements(j->'gifts') g where g->>'donor_id' = '00000000-0000-0000-0000-000000000310' and g->>'donor_name' = 'Bridge Donor';
  if n < 1 then raise exception 'FAIL: a gift credited to the caller''s seat lost its donor name'; end if;
  select count(*) into n from jsonb_array_elements(j->'gifts') g
    where g->>'donor_name' is not null
      and not (g->>'solicited_by' = '00000000-0000-0000-0000-000000000430' or g->>'donor_id' = '00000000-0000-0000-0000-000000000310');
  if n <> 0 then raise exception 'FAIL: member_giving named the donor on % gifts not credited to the caller', n; end if;
  dn := null;
  -- Another seat's name is not.
  select count(*) into n from jsonb_array_elements(j->'seats') s where s->>'name' is not null and s->>'id' <> '00000000-0000-0000-0000-000000000430';
  if n <> 0 then raise exception 'FAIL: member_giving exposed % other seats'' names', n; end if;
  raise notice 'PASS: a member reads giving through member_giving, with names only on their own credited gifts';
end $$;

-- A member still sees who to ask: the org's owner and staff.
do $$
declare n int;
begin
  select count(*) into n from org_members where org_id = '00000000-0000-0000-0000-000000000010' and role in ('owner', 'staff');
  if n < 1 then raise exception 'FAIL: a member cannot see the owner or staff of their org (saw %)', n; end if;
  select count(*) into n from users where id = '00000000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL: a member cannot read the owner''s profile row'; end if;
  raise notice 'PASS: a member sees the org''s owner and staff, so Who to Ask has names';
end $$;

do $$
begin
  begin
    insert into gifts (org_id, amount, received_on, category, method)
      values ('00000000-0000-0000-0000-000000000010', 100.00, '2026-09-16', 'individual', 'cash');
    raise exception 'FAIL: a member booked a gift in their own org';
  exception when insufficient_privilege then
    raise notice 'PASS: a member cannot book a gift';
  end;
end $$;

do $$
declare n int;
begin
  select count(*) into n from org_grading_scales where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge grading scales, expected 0 (migration 0031)', n; end if;
  raise notice 'PASS: a member reads no grading scales';
end $$;

-- Every org-scoped table, insert. A loop rather than eight copies: the
-- failure being guarded against is one table quietly not getting the
-- same treatment, and a loop cannot skip one by typo.
do $$
declare
  t text;
  stmt text;
  org uuid := '00000000-0000-0000-0000-000000000010';
  ath uuid := '00000000-0000-0000-0000-000000000110';
  tgt uuid := '00000000-0000-0000-0000-000000000210';
  inserts text[][] := array[
    array['athletes', 'insert into athletes (org_id, recruit_type, name, sport) values (%L, ''hs'', ''Member Insert'', ''baseball'')'],
    array['recruiting_targets', 'insert into recruiting_targets (org_id, athlete_id, school_id, status) values (%L, ''00000000-0000-0000-0000-000000000110'', ''00000000-0000-0000-0000-000000000130'', ''Target'')'],
    array['target_communications', 'insert into target_communications (org_id, target_id, kind, notes) values (%L, ''00000000-0000-0000-0000-000000000210'', ''call'', ''member wrote this'')'],
    array['contacts', 'insert into contacts (org_id, athlete_id, name, role) values (%L, ''00000000-0000-0000-0000-000000000110'', ''Member Contact'', ''hs_coach'')'],
    array['target_visits', 'insert into target_visits (org_id, target_id, visit_type) values (%L, ''00000000-0000-0000-0000-000000000210'', ''unofficial'')'],
    array['documents', 'insert into documents (org_id, file_name, file_size, media_type, source_role, status) values (%L, ''m.pdf'', 10, ''application/pdf'', ''coordinator'', ''pending'')'],
    array['athlete_courses', 'insert into athlete_courses (org_id, athlete_id, title, subject, credit, grade) values (%L, ''00000000-0000-0000-0000-000000000110'', ''Member Course'', ''math'', 1.00, ''A'')'],
    array['org_grading_scales', 'insert into org_grading_scales (org_id, school_name, bands) values (%L, ''Member HS'', ''[]''::jsonb)'],
    array['org_approved_course_lists', 'insert into org_approved_course_lists (org_id, school_name) values (%L, ''Member HS'')'],
    array['org_approved_courses', 'insert into org_approved_courses (list_id, org_id, title, subject) values (''00000000-0000-0000-0000-000000000910'', %L, ''Member Course'', ''math'')'],
    array['athlete_metrics', 'insert into athlete_metrics (org_id, athlete_id, metric, value, measured_on) values (%L, ''00000000-0000-0000-0000-000000000110'', ''fbVelo'', 90.00, ''2026-09-01'')'],
    array['org_school_notes', 'insert into org_school_notes (org_id, school_id, coach_name) values (%L, ''00000000-0000-0000-0000-000000000130'', ''Member Coach'')'],
    array['athlete_school_fits', 'insert into athlete_school_fits (org_id, athlete_id, school_id, score, tag, inputs_hash) values (%L, ''00000000-0000-0000-0000-000000000111'', ''00000000-0000-0000-0000-000000000130'', 50, ''Fit'', ''member'')'],
    array['athlete_checkins', 'insert into athlete_checkins (org_id, athlete_id, kind) values (%L, ''00000000-0000-0000-0000-000000000110'', ''call'')'],
    array['athlete_messages', 'insert into athlete_messages (org_id, athlete_id, author_id, body) values (%L, ''00000000-0000-0000-0000-000000000110'', ''00000000-0000-0000-0000-000000000003'', ''member wrote this'')'],
    array['athlete_message_reads', 'insert into athlete_message_reads (org_id, athlete_id, user_id) values (%L, ''00000000-0000-0000-0000-000000000110'', ''00000000-0000-0000-0000-000000000003'')']
  ];
begin
  for i in 1 .. array_length(inserts, 1) loop
    t := inserts[i][1];
    stmt := format(inserts[i][2], org);
    begin
      execute stmt;
      raise exception 'FAIL: a member was able to insert into % in their own org', t;
    exception when insufficient_privilege then
      raise notice 'PASS: member insert into % correctly rejected by RLS', t;
    end;
  end loop;
  -- Silences the unused-variable warnings for the fixed UUIDs above,
  -- which are referenced inside the literal statements rather than as
  -- format arguments.
  perform ath, tgt;
end $$;

-- Update and delete, on rows the member can genuinely see. These are the
-- dangerous ones: a member who can UPDATE can rewrite a GPA or a grade,
-- and a member who can DELETE can remove an athlete's whole record.
do $$
declare n int;
begin
  update athletes set name = 'Tampered' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member updated % athlete rows in their own org', n; end if;
  raise notice 'PASS: a member cannot update an athlete';
end $$;

do $$
declare n int;
begin
  update athlete_courses set grade = 'A' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % course grades', n; end if;
  raise notice 'PASS: a member cannot rewrite a course grade';
end $$;

do $$
declare n int;
begin
  update org_grading_scales set bands = '[]'::jsonb where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % grading scales, changing every eligibility verdict in the org', n; end if;
  raise notice 'PASS: a member cannot rewrite a grading scale';
end $$;

do $$
declare n int;
begin
  delete from recruiting_targets where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member deleted % recruiting targets', n; end if;
  raise notice 'PASS: a member cannot delete a recruiting target';
end $$;

do $$
declare n int;
begin
  delete from documents where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member deleted % documents', n; end if;
  raise notice 'PASS: a member cannot delete a document';
end $$;

-- The metrics log and the stored matches: since migration 0031 a member
-- reads neither (a board member sees names and stages, not numbers) and
-- still cannot change a number or remove a match.
do $$
declare n int;
begin
  select count(*) into n from athlete_metrics where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge metric entries, expected 0 (migration 0031)', n; end if;
  select count(*) into n from athlete_school_fits where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a member saw % Bridge stored matches, expected 0 (migration 0031)', n; end if;
  update athlete_metrics set value = 99 where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % metric entries', n; end if;
  update org_school_notes set coach_email = 'member@example.com' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % school notes', n; end if;
  delete from athlete_school_fits where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member deleted % stored matches', n; end if;
  raise notice 'PASS: a member reads no metrics or matches and cannot rewrite a number, a note or a match';
end $$;

-- The shared benchmark set has a null org_id and belongs to nobody. The
-- old `for all using (org_id is null or ...)` policy made it writable by
-- any member of any org, which would have changed athletic scoring for
-- every organization on the platform.
do $$
declare n int;
begin
  update benchmark_sets set sport = 'tampered' where org_id is null;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote the shared benchmark set, which every org reads';
  end if;
  raise notice 'PASS: nobody can write the shared benchmark set through RLS';
end $$;

-- And an owner must still be able to do all of this, or the fix has
-- simply broken the app instead of securing it.
select set_test_user('00000000-0000-0000-0000-000000000001');

do $$
declare n int;
begin
  insert into athletes (org_id, recruit_type, name, sport)
    values ('00000000-0000-0000-0000-000000000010', 'hs', 'Owner Insert', 'baseball');
  update athletes set name = 'Owner Renamed' where name = 'Owner Insert';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an owner updated % rows, expected 1', n; end if;
  delete from athletes where name = 'Owner Renamed';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an owner deleted % rows, expected 1', n; end if;
  raise notice 'PASS: an owner can still insert, update and delete in their own org';
end $$;

do $$
declare n int;
begin
  insert into org_grading_scales (org_id, school_name, bands, source_note)
    values ('00000000-0000-0000-0000-000000000010', 'Owner HS', '[]'::jsonb, 'owner typed this');
  update org_grading_scales set source_note = 'owner edited this' where school_name = 'Owner HS';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: an owner updated % grading scales, expected 1', n; end if;
  raise notice 'PASS: an owner can still enter and correct a grading scale';
end $$;

-- A staff member, not just an owner, has to be able to write. STAFF_ROLES
-- is owner plus staff everywhere in the app, and a policy that only
-- admitted owners would break every coordinator. user3 was seeded as
-- staff in Elite Squad at the top of this file, alongside their Bridge
-- membership.
select set_test_user('00000000-0000-0000-0000-000000000003');

do $$
declare n int;
begin
  insert into athletes (org_id, recruit_type, name, sport)
    values ('00000000-0000-0000-0000-000000000020', 'hs', 'Staff Insert', 'baseball');
  delete from athletes where name = 'Staff Insert';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: staff deleted % rows, expected 1', n; end if;
  raise notice 'PASS: a staff member can write in the org where they are staff';
end $$;

do $$
begin
  -- The same person is only a MEMBER of Bridge. Being staff somewhere
  -- else must not carry over, which a helper that forgot its org filter
  -- would get wrong while passing every test above.
  begin
    insert into athletes (org_id, recruit_type, name, sport)
      values ('00000000-0000-0000-0000-000000000010', 'hs', 'Crossover', 'baseball');
    raise exception 'FAIL: being staff in one org let this user write to an org where they are only a member';
  exception when insufficient_privilege then
    raise notice 'PASS: staff in one org is still only a member in the other';
  end;
end $$;

-- ── Anonymous: no auth.uid() at all. Every org-scoped table should be
-- empty, not merely filtered down. ──
select set_test_user(null);

do $$
declare n int;
begin
  select count(*) into n from athletes;
  if n <> 0 then raise exception 'FAIL: an anonymous session (no auth.uid()) saw % athlete rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero athletes';
end $$;

do $$
declare n int;
begin
  select count(*) into n from org_members;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % org_members rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero org_members rows';
end $$;

do $$
declare n int;
begin
  select count(*) into n from target_communications;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % target_communications rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero communication-log rows';
end $$;

do $$
declare n int;
begin
  select count(*) into n from contacts;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % contacts rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero contacts rows';
end $$;

do $$
declare n int;
begin
  select count(*) into n from target_visits;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % target_visits rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero target_visits rows';
end $$;

do $$
declare n int;
begin
  select count(*) into n from documents;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % documents rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero documents rows';
end $$;

do $$
declare n int;
begin
  select count(*) into n from athlete_courses;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % athlete_courses rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero course rows';
end $$;

do $$
declare n int;
begin
  select count(*) into n from high_school_grading_scales;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % grading scales, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero grading scales';
end $$;

do $$
declare n int;
begin
  select count(*) into n from org_grading_scales;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % org grading scales, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero org grading scales';
end $$;

do $$
declare n int;
begin
  select count(*) into n from athlete_metrics;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % metric entries, expected 0', n; end if;
  select count(*) into n from org_school_notes;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % school notes, expected 0', n; end if;
  select count(*) into n from athlete_school_fits;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % stored matches, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees zero metrics, school notes or stored matches';
end $$;

reset role;

\echo 'ALL RLS ASSERTIONS PASSED'

-- ── Coverage, asked of the database rather than of the SQL text ──────
-- Added 2026-09-17. A regex over the migrations cannot see a policy
-- created in a DO loop with format(), which is how the fundraising and
-- governance tables get theirs, so the check that every org-scoped table
-- is actually guarded belongs here where the answer is authoritative.
do $$
declare
  unguarded text[] := '{}';
  t record;
begin
  for t in
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0 and not a.attisdropped
      )
  loop
    if not t.rls then
      unguarded := unguarded || (t.name || ': carries org_id with row level security OFF');
    elsif not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.name) then
      unguarded := unguarded || (t.name || ': row level security on, but no policy, so nothing is readable');
    end if;
  end loop;

  if array_length(unguarded, 1) > 0 then
    raise exception 'FAIL: % org-scoped table(s) unguarded: %', array_length(unguarded, 1), array_to_string(unguarded, '; ');
  end if;
  raise notice 'PASS: every table carrying org_id has row level security and at least one policy';
end $$;

-- "At least one policy" is weaker than it sounds, in two directions, and
-- both have already happened once in this repo.
--
-- Too few: a table with only a SELECT policy is readable and can never
-- be written by anybody through the API. A feature built on one saves
-- nothing and reports no error, which is the exact shape of the
-- grading-scale bug that produced src/laws/dataLaws.test.ts.
--
-- Too many: a single `for all` policy satisfies "has a policy" and lets
-- any MEMBER write, which is what migration 0010 was written to undo.
-- Nothing has stopped one coming back since.
do $$
declare
  problems text[] := '{}';
  t record;
  cmds text[];
  -- Tables an org genuinely cannot write through the ordinary client,
  -- each with the reason, so that adding to this list is a decision
  -- rather than a way to silence the check.
  --
  -- org_members is the one that matters and it is deliberate. Membership
  -- is what grants access to everything else, and the row carries its own
  -- `role` column, so an INSERT policy keyed off _staff_org_ids() would
  -- let any staff member write themselves a second row as owner of their
  -- own org. There is no invitation flow yet; when there is, it belongs
  -- behind the service role or a SECURITY DEFINER function that cannot be
  -- handed a role, not behind an ordinary policy.
  write_exempt text[] := array['org_members'];
begin
  for t in
    select c.relname as name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and exists (
        select 1 from pg_attribute a
        where a.attrelid = c.oid and a.attname = 'org_id' and a.attnum > 0 and not a.attisdropped
      )
    order by c.relname
  loop
    select array_agg(distinct p.cmd) into cmds
    from pg_policies p where p.schemaname = 'public' and p.tablename = t.name;

    -- ALL is never right on an org-scoped table: read is by membership
    -- and write is by staff, so one policy cannot express both.
    if 'ALL' = any(cmds) then
      problems := problems || (t.name || ': has a `for all` policy, which cannot separate read-by-member from write-by-staff');
    end if;

    if not ('SELECT' = any(cmds)) then
      problems := problems || (t.name || ': no SELECT policy, so the org cannot read its own rows');
    end if;

    if not ('INSERT' = any(cmds)) and not (t.name = any(write_exempt)) then
      problems := problems || (t.name || ': no INSERT policy, so staff cannot create a row and nothing will say so');
    end if;
  end loop;

  if array_length(problems, 1) > 0 then
    raise exception 'FAIL: % policy problem(s): %', array_length(problems, 1), array_to_string(problems, '; ');
  end if;
  raise notice 'PASS: every org-scoped table separates read-by-member from write-by-staff, with no `for all` policy';
end $$;

-- ── No membership helper is reachable over the REST API ───────────────
-- PostgREST publishes every function in an exposed schema as an RPC
-- endpoint, so a SECURITY DEFINER helper sitting in `public` answers HTTP
-- requests from anon. Supabase's own advisor found this the first time
-- these migrations ran against a real project; local Postgres cannot,
-- because there is no PostgREST in front of it. Migration 0015 moved both
-- helpers into `private`, which is not exposed. This asserts they stayed
-- there, and that no policy quietly kept pointing at the old ones.
do $$
declare
  leftover_functions text[];
  leftover_policies text[];
begin
  select coalesce(array_agg(p.proname), '{}')
    into leftover_functions
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '%\_org\_ids';

  if array_length(leftover_functions, 1) > 0 then
    raise exception 'FAIL: membership helper(s) still in the exposed public schema: %',
      array_to_string(leftover_functions, ', ');
  end if;

  select coalesce(array_agg(c.relname || '.' || pol.polname), '{}')
    into leftover_policies
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') like '%public.%org_ids()%'
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%public.%org_ids()%');

  if array_length(leftover_policies, 1) > 0 then
    raise exception 'FAIL: policy(ies) still calling a public membership helper: %',
      array_to_string(leftover_policies, ', ');
  end if;

  raise notice 'PASS: both membership helpers live in the unexposed private schema and every policy calls them there';
end $$;

-- ── Migration 0017: profile rows follow auth.users ────────────────────
-- Before this trigger, public.users was a mirror nothing wrote to. The
-- seed above still inserts explicitly (as an upsert now) so the older
-- assertions keep their names; this block proves a row shows up on its
-- own for a brand-new account, name included.
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-000000000004', 'user4@bridge.example', '{"full_name":"User Four"}'::jsonb);
do $$
declare r record;
begin
  select email, full_name into r from public.users where id = '00000000-0000-0000-0000-000000000004';
  if r is null then raise exception 'FAIL: no public.users row was created for a new auth.users row'; end if;
  if r.email <> 'user4@bridge.example' or r.full_name <> 'User Four' then
    raise exception 'FAIL: profile row created with email % and name %', r.email, r.full_name;
  end if;
  raise notice 'PASS: a new auth.users row gets its public.users profile, email and name included';
end $$;

-- ── Migration 0017: the documents bucket is org-scoped like a table ──
-- An object's first folder is the org id. Staff of that org may write
-- it, any member may read it, nobody outside the org sees it.
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000001'); -- Bridge owner

do $$
begin
  insert into storage.objects (bucket_id, name) values
    ('documents', '00000000-0000-0000-0000-000000000010/req1/transcript.pdf');
  raise notice 'PASS: Bridge staff can upload into Bridge''s folder of the documents bucket';
end $$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values
      ('documents', '00000000-0000-0000-0000-000000000020/req1/transcript.pdf');
    raise exception 'FAIL: Bridge staff uploaded into Elite Squad''s folder';
  exception when insufficient_privilege then
    raise notice 'PASS: upload into another org''s folder is rejected (%.)', sqlerrm;
  end;
end $$;

do $$
begin
  begin
    insert into storage.objects (bucket_id, name) values
      ('documents', 'loose-file-with-no-org-folder.pdf');
    raise exception 'FAIL: an upload outside any org folder was accepted';
  exception when insufficient_privilege then
    raise notice 'PASS: an upload with no org folder is rejected';
  end;
end $$;

select set_test_user('00000000-0000-0000-0000-000000000003'); -- Bridge MEMBER, Elite staff
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'documents';
  -- Since migration 0031 a member reads no documents: the bucket policy
  -- keys off the same helper as the documents table.
  if n <> 0 then raise exception 'FAIL: Bridge member saw % document object(s), expected 0 (migration 0031)', n; end if;
  raise notice 'PASS: a Bridge member reads none of Bridge''s uploaded documents';
  begin
    insert into storage.objects (bucket_id, name) values
      ('documents', '00000000-0000-0000-0000-000000000010/req2/scan.jpg');
    raise exception 'FAIL: a Bridge MEMBER uploaded into Bridge''s folder';
  exception when insufficient_privilege then
    raise notice 'PASS: a member cannot upload; only owner and staff can';
  end;
  begin
    delete from storage.objects where name like '00000000-0000-0000-0000-000000000010/%';
    if found then raise exception 'FAIL: a Bridge MEMBER deleted a Bridge document'; end if;
    raise notice 'PASS: a member''s delete of a Bridge document affects nothing';
  end;
end $$;

select set_test_user('00000000-0000-0000-0000-000000000002'); -- Elite owner
do $$
declare n int;
begin
  select count(*) into n from storage.objects where bucket_id = 'documents';
  if n <> 0 then raise exception 'FAIL: Elite Squad''s owner saw % of Bridge''s document object(s)', n; end if;
  raise notice 'PASS: another org''s owner sees none of Bridge''s documents';
end $$;

select set_test_user(null);
do $$
declare n int;
begin
  select count(*) into n from storage.objects;
  if n <> 0 then raise exception 'FAIL: anonymous session saw % document object(s)', n; end if;
  raise notice 'PASS: anonymous session sees zero document objects';
end $$;

reset role;

-- ── Migration 0018: sign-in is mirrored, and colleagues can see each other ──
reset role;
update auth.users set last_sign_in_at = now() where id = '00000000-0000-0000-0000-000000000004';
do $$
declare t timestamptz;
begin
  select last_sign_in_at into t from public.users where id = '00000000-0000-0000-0000-000000000004';
  if t is null then raise exception 'FAIL: a sign-in on auth.users did not reach public.users'; end if;
  raise notice 'PASS: last_sign_in_at follows auth.users onto the profile row';
end $$;

set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000001'); -- Bridge owner
do $$
declare n int; other int;
begin
  select count(*) into n from users;
  -- Self, plus user3 who is a Bridge member. Not user2 (Elite only) and
  -- not user4 (no org at all).
  if n <> 2 then raise exception 'FAIL: Bridge owner sees % profile rows, expected 2 (self and the Bridge member)', n; end if;
  select count(*) into other from users where id = '00000000-0000-0000-0000-000000000002';
  if other <> 0 then raise exception 'FAIL: Bridge owner can read Elite Squad''s owner profile'; end if;
  raise notice 'PASS: a member reads the profiles of people in a shared org and nobody else''s';
end $$;

do $$
declare affected int;
begin
  update users set full_name = 'Renamed By Colleague' where id = '00000000-0000-0000-0000-000000000003';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a colleague could rewrite another member''s profile'; end if;
  raise notice 'PASS: reading a colleague''s profile does not mean writing it';
end $$;
reset role;

-- ── Migrations 0022 and 0023: the family role reads one athlete and
-- nothing else. user5 is a family member of Bridge, linked to Bridge
-- Athlete A (110) and not to Bridge Athlete B (111). Every count below
-- is against a seed that has rows for both athletes. ──
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000005', 'user5@bridge.example');
insert into users (id, email, full_name) values
  ('00000000-0000-0000-0000-000000000005', 'user5@bridge.example', 'User Five')
on conflict (id) do update set full_name = excluded.full_name;
insert into org_members (user_id, org_id, role) values
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000010', 'family');
insert into athlete_guardians (org_id, athlete_id, user_id, relationship) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005', 'parent');
-- Athlete B gets a metric, a match and a target of its own so "sees only
-- A's rows" is a real assertion rather than an empty table.
insert into athlete_metrics (org_id, athlete_id, metric, value, measured_on) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', 'sixty', 7.1, '2026-09-01');
insert into athlete_school_fits (org_id, athlete_id, school_id, score, tag, inputs_hash) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000130', 60, 'Fit', 'seed-b');
insert into recruiting_targets (id, org_id, athlete_id, school_id, status) values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000130', 'In Contact');
insert into target_visits (org_id, target_id, visit_type) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000211', 'unofficial');
-- A document per athlete, so "their own files" is one row, not zero.
insert into documents (org_id, athlete_id, file_name, file_size, media_type, source_role, status) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', 'athlete-a-transcript.pdf', 1000, 'application/pdf', 'parent', 'applied'),
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', 'athlete-b-transcript.pdf', 1000, 'application/pdf', 'parent', 'applied');

-- The trigger: a guardian row cannot cross orgs or name a non-member.
do $$
begin
  begin
    insert into athlete_guardians (org_id, athlete_id, user_id) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005');
    raise exception 'FAIL: a guardian row pointed Elite Squad''s org at a Bridge athlete';
  exception when check_violation then
    raise notice 'PASS: a guardian row must name the athlete''s own org';
  end;
  begin
    insert into athlete_guardians (org_id, athlete_id, user_id) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: a guardian row named a person who is not a member of the org';
  exception when check_violation then
    raise notice 'PASS: a guardian must already be a member of the org';
  end;
end $$;

set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000005'); -- Bridge FAMILY, athlete A only
do $$
declare n int; nm text;
begin
  select count(*) into n from athletes;
  if n <> 1 then raise exception 'FAIL: family saw % athletes, expected 1 (their own)', n; end if;
  select name into nm from athletes;
  if nm <> 'Bridge Athlete A' then raise exception 'FAIL: family saw "%", not their own athlete', nm; end if;
  select count(*) into n from athletes where id = '00000000-0000-0000-0000-000000000111';
  if n <> 0 then raise exception 'FAIL: family could read another Bridge athlete by id'; end if;
  raise notice 'PASS: a family member sees exactly their own athlete';

  select count(*) into n from athlete_metrics;
  if n <> 1 then raise exception 'FAIL: family saw % metric rows, expected 1 (athlete A''s)', n; end if;
  select count(*) into n from athlete_metrics where athlete_id = '00000000-0000-0000-0000-000000000111';
  if n <> 0 then raise exception 'FAIL: family could read athlete B''s metrics by filtering on athlete_id'; end if;
  select count(*) into n from athlete_school_fits;
  if n <> 1 then raise exception 'FAIL: family saw % stored matches, expected 1 (athlete A''s)', n; end if;
  select count(*) into n from athlete_courses;
  if n <> 1 then raise exception 'FAIL: family saw % courses, expected 1 (athlete A''s)', n; end if;
  select count(*) into n from recruiting_targets;
  if n <> 1 then raise exception 'FAIL: family saw % targets, expected 1 (athlete A''s)', n; end if;
  select count(*) into n from target_visits;
  if n <> 1 then raise exception 'FAIL: family saw % visits, expected 1 (on athlete A''s target)', n; end if;
  raise notice 'PASS: a family member reads their athlete''s metrics, matches, courses, targets and visits and nobody else''s';

  select count(*) into n from target_communications;
  if n <> 0 then raise exception 'FAIL: family saw % staff communications, expected 0', n; end if;
  select count(*) into n from contacts;
  if n <> 0 then raise exception 'FAIL: family saw % contacts, expected 0', n; end if;
  select count(*) into n from documents;
  if n <> 1 then raise exception 'FAIL: family saw % documents, expected 1 (their own athlete''s)', n; end if;
  select count(*) into n from documents where athlete_id = '00000000-0000-0000-0000-000000000111';
  if n <> 0 then raise exception 'FAIL: family could read another athlete''s document'; end if;
  select count(*) into n from org_school_notes;
  if n <> 0 then raise exception 'FAIL: family saw % private school notes, expected 0', n; end if;
  select count(*) into n from donors;
  if n <> 0 then raise exception 'FAIL: family saw % donors, expected 0', n; end if;
  select count(*) into n from boards;
  if n <> 0 then raise exception 'FAIL: family saw % boards, expected 0', n; end if;
  raise notice 'PASS: a family member sees their own athlete''s documents and no communications, contacts, school notes, fundraising or governance';

  select count(*) into n from orgs;
  if n <> 1 then raise exception 'FAIL: family saw % orgs, expected 1 (Bridge)', n; end if;
  -- Their own row and the owner's (user1). Not user3, a member.
  select count(*) into n from org_members;
  if n <> 2 then raise exception 'FAIL: family saw % membership rows, expected 2 (their own and the owner''s)', n; end if;
  select count(*) into n from org_members where user_id = '00000000-0000-0000-0000-000000000003';
  if n <> 0 then raise exception 'FAIL: family could see a non-staff member''s membership row'; end if;
  select count(*) into n from athlete_guardians;
  if n <> 1 then raise exception 'FAIL: family saw % guardian rows, expected 1 (their own)', n; end if;
  -- Self plus Bridge's owner (user1). Not user3, a Bridge member, and
  -- not user4, who is in no org.
  select count(*) into n from users;
  if n <> 2 then raise exception 'FAIL: family saw % profiles, expected 2 (self and the org''s owner)', n; end if;
  select count(*) into n from users where id = '00000000-0000-0000-0000-000000000003';
  if n <> 0 then raise exception 'FAIL: family could read a non-staff member''s profile'; end if;
  select count(*) into n from org_grading_scales;
  if n < 1 then raise exception 'FAIL: family cannot read the org''s grading scales, so the eligibility screen cannot explain itself'; end if;
  raise notice 'PASS: a family member sees their org, their own membership, and the staff to ask';
end $$;

do $$
declare affected int;
begin
  begin
    insert into athlete_metrics (org_id, athlete_id, metric, value, measured_on) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', 'sixty', 6.5, '2026-09-02');
    raise exception 'FAIL: a family member logged a metric';
  exception when insufficient_privilege then
    raise notice 'PASS: a family member cannot log a metric, even for their own athlete';
  end;
  update athletes set gpa = 4.0 where id = '00000000-0000-0000-0000-000000000110';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family member rewrote their own athlete''s record'; end if;
  begin
    insert into athlete_guardians (org_id, athlete_id, user_id) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000005');
    raise exception 'FAIL: a family member granted themselves another athlete';
  exception when insufficient_privilege then
    raise notice 'PASS: a family member cannot link themselves to another athlete';
  end;
  delete from recruiting_targets where id = '00000000-0000-0000-0000-000000000210';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family member deleted a target'; end if;
  raise notice 'PASS: a family member writes nothing';
end $$;

select set_test_user('00000000-0000-0000-0000-000000000001'); -- Bridge owner
do $$
declare n int;
begin
  select count(*) into n from athlete_guardians;
  if n <> 1 then raise exception 'FAIL: Bridge''s owner saw % guardian rows, expected 1', n; end if;
  select count(*) into n from athletes;
  if n <> 2 then raise exception 'FAIL: Bridge''s owner saw % athletes after the family migration, expected 2', n; end if;
  raise notice 'PASS: staff still read the whole org, guardian rows included';
end $$;

select set_test_user('00000000-0000-0000-0000-000000000002'); -- Elite owner
do $$
declare n int;
begin
  select count(*) into n from athlete_guardians;
  if n <> 0 then raise exception 'FAIL: Elite Squad''s owner saw % of Bridge''s guardian rows', n; end if;
  select count(*) into n from users where id = '00000000-0000-0000-0000-000000000005';
  if n <> 0 then raise exception 'FAIL: Elite Squad''s owner can read a Bridge family member''s profile'; end if;
  raise notice 'PASS: another org sees nothing of a family''s membership';
end $$;
reset role;

-- ── Migration 0025: the Doc AI spend log. Staff write their org's rows,
-- members read them, nobody sees another org's, and a cap is a number
-- on the org. ──
reset role;
insert into docai_usage (org_id, request_id, model, input_tokens, output_tokens, cost_cents) values
  ('00000000-0000-0000-0000-000000000010', 'req_bridge', 'claude-opus-5', 1200, 300, 1.35),
  ('00000000-0000-0000-0000-000000000020', 'req_elite', 'claude-opus-5', 1200, 300, 1.35);

set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000001'); -- Bridge owner
do $$
declare n int; cap int;
begin
  select count(*) into n from docai_usage;
  if n <> 1 then raise exception 'FAIL: user1 saw % docai_usage rows, expected 1 (Bridge''s only)', n; end if;
  select docai_budget_cents into cap from orgs where id = '00000000-0000-0000-0000-000000000010';
  if cap <> 2000 then raise exception 'FAIL: the default Doc AI budget is % cents, expected 2000', cap; end if;
  raise notice 'PASS: an org reads its own Doc AI spend and its own cap';
  begin
    insert into docai_usage (org_id, request_id, model, cost_cents) values
      ('00000000-0000-0000-0000-000000000020', 'req_x', 'claude-opus-5', 0.5);
    raise exception 'FAIL: user1 logged Doc AI spend into Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: spend cannot be logged into another org';
  end;
  insert into docai_usage (org_id, request_id, model, cost_cents) values
    ('00000000-0000-0000-0000-000000000010', 'req_y', 'claude-haiku-4-5', 0.1);
  raise notice 'PASS: staff log their own org''s spend';
end $$;

select set_test_user('00000000-0000-0000-0000-000000000003'); -- Bridge MEMBER
do $$
declare n int;
begin
  -- Elite Squad's one row only: user3 is staff there and a member of
  -- Bridge, and a member reads no spend (migration 0031).
  select count(*) into n from docai_usage;
  if n <> 1 then raise exception 'FAIL: a Bridge member who is Elite staff saw % spend rows, expected 1 (Elite''s)', n; end if;
  select count(*) into n from docai_usage where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a Bridge member saw % of Bridge''s spend rows, expected 0', n; end if;
  begin
    insert into docai_usage (org_id, request_id, model, cost_cents) values
      ('00000000-0000-0000-0000-000000000010', 'req_z', 'claude-opus-5', 0.5);
    raise exception 'FAIL: a member logged Doc AI spend';
  exception when insufficient_privilege then
    raise notice 'PASS: a member reads no spend and cannot write it';
  end;
end $$;

select set_test_user('00000000-0000-0000-0000-000000000005'); -- Bridge FAMILY
do $$
declare n int;
begin
  select count(*) into n from docai_usage;
  if n <> 0 then raise exception 'FAIL: a family member saw % spend rows, expected 0', n; end if;
  raise notice 'PASS: a family member sees no spend';
end $$;
reset role;

-- ── Migration 0039: advisors, the thread and the check-in log ────────
-- The advisor is owner or staff of the athlete's own org, nobody else.
-- Check-ins are staff only: a family login reads none and writes none,
-- because the notes are about a minor and written for staff. The thread
-- is staff and that athlete's family, never a member, and it is the one
-- table a family login may write, only as themselves. Placed before the
-- 0026 block, while user5 is family in Bridge alone (athlete A). ──
reset role;
update athletes set advisor_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000110';
update athletes set advisor_id = '00000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-000000000120';
insert into athlete_checkins (org_id, athlete_id, advisor_id, kind, occurred_on, notes) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'call', '2026-09-20', 'Bridge staff call note'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000002', 'meeting', '2026-09-20', 'Elite staff meeting note');
insert into athlete_messages (org_id, athlete_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'Bridge message on athlete A'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000002', 'Elite message'),
  -- Athlete B's thread, so the family boundary has something to miss.
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'Bridge message on athlete B');
-- The owner's marker on athlete B's thread: a row the family must not see.
insert into athlete_message_reads (org_id, athlete_id, user_id) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001');

-- The coherence trigger, as the superuser, so RLS is not what stops it.
do $$
begin
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'cross-org');
    raise exception 'FAIL: a message filed a Bridge athlete under Elite Squad''s org';
  exception when check_violation then
    raise notice 'PASS: a message must carry its athlete''s own org';
  end;
  begin
    insert into athlete_checkins (org_id, athlete_id, kind) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000110', 'call');
    raise exception 'FAIL: a check-in filed a Bridge athlete under Elite Squad''s org';
  exception when check_violation then
    raise notice 'PASS: a check-in must carry its athlete''s own org';
  end;
  begin
    insert into athlete_message_reads (org_id, athlete_id, user_id) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: a read marker filed a Bridge athlete under Elite Squad''s org';
  exception when check_violation then
    raise notice 'PASS: a read marker must carry its athlete''s own org';
  end;
  begin
    update athlete_messages set org_id = '00000000-0000-0000-0000-000000000020' where body = 'Bridge message on athlete A';
    raise exception 'FAIL: a message was moved to another org by update';
  exception when check_violation then
    raise notice 'PASS: a message cannot be moved to another org';
  end;
end $$;

set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000001'); -- Bridge owner
do $$
declare n int; affected int;
begin
  select count(*) into n from athlete_checkins;
  if n <> 1 then raise exception 'FAIL: Bridge''s owner saw % check-ins, expected 1 (Bridge''s)', n; end if;
  select count(*) into n from athlete_messages;
  if n <> 2 then raise exception 'FAIL: Bridge''s owner saw % messages, expected 2 (athletes A and B)', n; end if;
  select count(*) into n from athlete_checkins where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 0 then raise exception 'FAIL: Bridge''s owner read % of Elite Squad''s check-ins', n; end if;
  select count(*) into n from athlete_messages where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 0 then raise exception 'FAIL: Bridge''s owner read % of Elite Squad''s messages', n; end if;
  select count(*) into n from athlete_message_reads;
  if n <> 1 then raise exception 'FAIL: Bridge''s owner saw % read markers, expected 1', n; end if;
  raise notice 'PASS: staff read their own org''s check-ins, threads and read markers and nothing of another org''s';

  insert into athlete_checkins (org_id, athlete_id, advisor_id, kind, notes) values
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'text', 'owner logged this');
  insert into athlete_messages (org_id, athlete_id, author_id, body) values
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'owner wrote this');
  insert into athlete_message_reads (org_id, athlete_id, user_id) values
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001');
  raise notice 'PASS: staff log a check-in, write to a thread and mark it read';

  begin
    insert into athlete_checkins (org_id, athlete_id, kind) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', 'call');
    raise exception 'FAIL: Bridge''s owner logged a check-in in Elite Squad''s org';
  exception when insufficient_privilege then
    raise notice 'PASS: a check-in cannot be logged in another org';
  end;
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000001', 'sneaky');
    raise exception 'FAIL: Bridge''s owner wrote into Elite Squad''s thread';
  exception when insufficient_privilege then
    raise notice 'PASS: a message cannot be written into another org''s thread';
  end;
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000003', 'written as someone else');
    raise exception 'FAIL: staff wrote a message signed as somebody else';
  exception when insufficient_privilege then
    raise notice 'PASS: staff write messages only as themselves';
  end;
  begin
    insert into athlete_message_reads (org_id, athlete_id, user_id) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000003');
    raise exception 'FAIL: staff wrote a read marker for somebody else';
  exception when insufficient_privilege then
    raise notice 'PASS: a read marker is only ever the caller''s own';
  end;

  -- The advisor: owner or staff of the athlete's org, nobody else.
  begin
    update athletes set advisor_id = '00000000-0000-0000-0000-000000000003' where id = '00000000-0000-0000-0000-000000000110';
    raise exception 'FAIL: a Bridge member (Board) was made an athlete''s advisor';
  exception when check_violation then
    raise notice 'PASS: a member cannot advise';
  end;
  begin
    update athletes set advisor_id = '00000000-0000-0000-0000-000000000005' where id = '00000000-0000-0000-0000-000000000110';
    raise exception 'FAIL: a family login was made an athlete''s advisor';
  exception when check_violation then
    raise notice 'PASS: a family login cannot advise';
  end;
  begin
    update athletes set advisor_id = '00000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-000000000110';
    raise exception 'FAIL: Elite Squad''s owner was made a Bridge athlete''s advisor';
  exception when check_violation then
    raise notice 'PASS: staff of another org cannot advise';
  end;
  begin
    insert into athletes (org_id, recruit_type, name, sport, advisor_id)
      values ('00000000-0000-0000-0000-000000000010', 'hs', 'Advised By A Member', 'baseball', '00000000-0000-0000-0000-000000000003');
    raise exception 'FAIL: an athlete was created with a member as advisor';
  exception when check_violation then
    raise notice 'PASS: the advisor rule holds on insert too';
  end;
  update athletes set advisor_id = '00000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000110';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: the owner could not be set as advisor (% rows)', affected; end if;
  update athletes set advisor_id = null where id = '00000000-0000-0000-0000-000000000111';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: an advisor could not be cleared (% rows)', affected; end if;
  raise notice 'PASS: owner or staff of the athlete''s org can be picked as advisor, and the pick can be cleared';
end $$;

select set_test_user('00000000-0000-0000-0000-000000000003'); -- Bridge MEMBER, Elite STAFF
do $$
declare n int; affected int;
begin
  select count(*) into n from athlete_checkins where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a Bridge member read % Bridge check-ins, expected 0', n; end if;
  select count(*) into n from athlete_messages where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a Bridge member read % Bridge messages, expected 0', n; end if;
  select count(*) into n from athlete_message_reads where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a Bridge member read % Bridge read markers, expected 0', n; end if;
  select count(*) into n from athlete_checkins where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 1 then raise exception 'FAIL: as Elite staff, user3 read % Elite check-ins, expected 1', n; end if;
  select count(*) into n from athlete_messages where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 1 then raise exception 'FAIL: as Elite staff, user3 read % Elite messages, expected 1', n; end if;
  raise notice 'PASS: a member never reads the thread, the log or the markers; the same person reads them where they are staff';

  update athlete_messages set body = 'member edit' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a member edited % Bridge messages', affected; end if;
  delete from athlete_checkins where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a member deleted % Bridge check-ins', affected; end if;
  raise notice 'PASS: a member edits and removes nothing in the thread or the log';

  -- Staff of Elite may advise an Elite athlete: the rule is per org.
  update athletes set advisor_id = '00000000-0000-0000-0000-000000000003' where id = '00000000-0000-0000-0000-000000000120';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: Elite staff could not be picked as an Elite athlete''s advisor (% rows)', affected; end if;
  update athletes set advisor_id = '00000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-000000000120';
  raise notice 'PASS: the advisor rule is per org: the same person advises where they are staff';
end $$;

select set_test_user('00000000-0000-0000-0000-000000000005'); -- Bridge FAMILY, athlete A only
do $$
declare n int; affected int;
begin
  select count(*) into n from athlete_checkins;
  if n <> 0 then raise exception 'FAIL: a family login read % check-ins, expected 0 (staff only)', n; end if;
  select count(*) into n from athlete_checkins where athlete_id = '00000000-0000-0000-0000-000000000110';
  if n <> 0 then raise exception 'FAIL: a family login read their own athlete''s check-in notes by filtering on athlete_id'; end if;
  raise notice 'PASS: a family login reads no check-ins, not even their own athlete''s';

  select count(*) into n from athlete_messages where athlete_id = '00000000-0000-0000-0000-000000000110';
  if n <> 2 then raise exception 'FAIL: a family login read % messages on their athlete''s thread, expected 2', n; end if;
  select count(*) into n from athlete_messages where athlete_id <> '00000000-0000-0000-0000-000000000110';
  if n <> 0 then raise exception 'FAIL: a family login read % messages on other athletes'' threads', n; end if;
  select count(*) into n from athlete_messages where athlete_id = '00000000-0000-0000-0000-000000000111';
  if n <> 0 then raise exception 'FAIL: a family login read athlete B''s thread by id'; end if;
  select count(*) into n from athlete_message_reads;
  if n <> 0 then raise exception 'FAIL: a family login read % of staff''s read markers, expected 0', n; end if;
  raise notice 'PASS: a family login reads their own athlete''s thread and nothing else';

  -- Sent with a created_at of its own, which the server replaces: dated
  -- 2099 it would read as new to staff forever and sit last in the
  -- thread; backdated it would rewrite the record.
  insert into athlete_messages (org_id, athlete_id, author_id, body, created_at) values
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005', 'family wrote this', '2099-01-01');
  raise notice 'PASS: a family login writes to their own athlete''s thread';
  select count(*) into n from athlete_messages where body = 'family wrote this' and created_at > now() + interval '1 minute';
  if n <> 0 then raise exception 'FAIL: a family login dated a message in the future'; end if;
  raise notice 'PASS: a message is stamped with the server''s time, whatever the caller sends';

  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'pretending to be staff');
    raise exception 'FAIL: a family login wrote a message signed as the owner';
  exception when insufficient_privilege then
    raise notice 'PASS: a family login writes messages only as themselves';
  end;
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000005', 'wrong athlete');
    raise exception 'FAIL: a family login wrote into another athlete''s thread';
  exception when insufficient_privilege then
    raise notice 'PASS: a family login cannot write into another athlete''s thread';
  end;
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005', 'filed under the wrong org');
    raise exception 'FAIL: a family login filed their athlete''s message under Elite Squad''s org';
  exception when check_violation or insufficient_privilege then
    raise notice 'PASS: a family login cannot file a message under another org';
  end;
  select count(*) into n from athlete_messages where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 0 then raise exception 'FAIL: a family login''s message landed in Elite Squad''s org'; end if;
  begin
    insert into athlete_checkins (org_id, athlete_id, kind, notes) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', 'call', 'family logged this');
    raise exception 'FAIL: a family login logged a check-in';
  exception when insufficient_privilege then
    raise notice 'PASS: a family login cannot log a check-in';
  end;

  insert into athlete_message_reads (org_id, athlete_id, user_id) values
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005');
  update athlete_message_reads set read_at = now()
    where athlete_id = '00000000-0000-0000-0000-000000000110' and user_id = '00000000-0000-0000-0000-000000000005';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: a family login could not move their own read marker (% rows)', affected; end if;
  select count(*) into n from athlete_message_reads;
  if n <> 1 then raise exception 'FAIL: a family login read % read markers, expected 1 (their own)', n; end if;
  raise notice 'PASS: a family login marks their own thread read';
  begin
    insert into athlete_message_reads (org_id, athlete_id, user_id) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000002');
    raise exception 'FAIL: a family login wrote a read marker for somebody else';
  exception when insufficient_privilege then
    raise notice 'PASS: a family login cannot write a read marker for somebody else';
  end;
  begin
    insert into athlete_message_reads (org_id, athlete_id, user_id) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000005');
    raise exception 'FAIL: a family login marked another athlete''s thread read';
  exception when insufficient_privilege then
    raise notice 'PASS: a family login cannot mark another athlete''s thread';
  end;
  update athlete_message_reads set read_at = now() where user_id = '00000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family login moved the owner''s read marker'; end if;

  update athlete_messages set body = 'family edit' where author_id = '00000000-0000-0000-0000-000000000005';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family login edited % messages', affected; end if;
  update athlete_messages set body = 'family edit' where author_id = '00000000-0000-0000-0000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family login edited % of staff''s messages', affected; end if;
  delete from athlete_messages where author_id = '00000000-0000-0000-0000-000000000005';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family login deleted % messages', affected; end if;
  delete from athlete_messages where athlete_id = '00000000-0000-0000-0000-000000000110';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family login deleted % messages from their thread', affected; end if;
  update athletes set advisor_id = null where id = '00000000-0000-0000-0000-000000000110';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: a family login changed their athlete''s advisor'; end if;
  raise notice 'PASS: a family login writes one thing, their own message and their own read marker, and edits or removes nothing';
end $$;

select set_test_user('00000000-0000-0000-0000-000000000001'); -- Bridge owner
do $$
declare n int;
begin
  select count(*) into n from athlete_messages where author_id = '00000000-0000-0000-0000-000000000005';
  if n <> 1 then raise exception 'FAIL: staff cannot read the family''s message (saw %)', n; end if;
  select count(*) into n from athlete_message_reads where user_id = '00000000-0000-0000-0000-000000000005';
  if n <> 1 then raise exception 'FAIL: staff cannot see the family''s read marker (saw %)', n; end if;
  raise notice 'PASS: staff read the family''s reply and whether the family has seen the thread';

  -- Staff may edit a message, never who wrote it or when: insert as
  -- yourself, then re-sign the row as the parent, is refused.
  begin
    update athlete_messages set author_id = '00000000-0000-0000-0000-000000000005' where body = 'owner wrote this';
    raise exception 'FAIL: staff re-signed their own message as the family';
  exception when check_violation then
    raise notice 'PASS: staff cannot change who wrote a message';
  end;
  begin
    update athlete_messages set created_at = '2020-01-01' where author_id = '00000000-0000-0000-0000-000000000005';
    raise exception 'FAIL: staff backdated the family''s message';
  exception when check_violation then
    raise notice 'PASS: staff cannot change when a message was written';
  end;
  begin
    update athlete_messages set body = 'rewritten' where author_id = '00000000-0000-0000-0000-000000000005';
    raise exception 'FAIL: staff rewrote what the family said';
  exception when check_violation then
    raise notice 'PASS: nobody rewrites a message once it is sent';
  end;
  begin
    update athlete_messages set athlete_id = '00000000-0000-0000-0000-000000000111' where author_id = '00000000-0000-0000-0000-000000000005';
    raise exception 'FAIL: staff moved the family''s message into another athlete''s thread';
  exception when check_violation then
    raise notice 'PASS: a message stays in the thread it was written in';
  end;
  begin
    insert into athlete_checkins (org_id, athlete_id, advisor_id, kind) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005', 'call');
    raise exception 'FAIL: staff logged a check-in in someone else''s name';
  exception when insufficient_privilege then
    raise notice 'PASS: a check-in is signed by whoever logs it';
  end;
end $$;

-- The one change the honesty trigger lets through: author_id going null
-- when the author's account is deleted (on delete set null). Without the
-- exception, deleting anyone who ever wrote a message would fail.
reset role;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000039', 'leaver@bridge.example');
insert into users (id, email) values ('00000000-0000-0000-0000-000000000039', 'leaver@bridge.example') on conflict (id) do nothing;
insert into athlete_messages (org_id, athlete_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000039', 'written by someone who leaves');
delete from auth.users where id = '00000000-0000-0000-0000-000000000039';
do $$
declare n int;
begin
  select count(*) into n from athlete_messages where body = 'written by someone who leaves' and author_id is null;
  if n <> 1 then raise exception 'FAIL: deleting an author did not keep their message with no author (% rows)', n; end if;
  delete from athlete_messages where body = 'written by someone who leaves';
  raise notice 'PASS: a deleted author''s message stays, unsigned';
end $$;
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000001'); -- Bridge owner

select set_test_user('00000000-0000-0000-0000-000000000002'); -- Elite owner
do $$
declare n int;
begin
  select count(*) into n from athlete_messages;
  if n <> 1 then raise exception 'FAIL: Elite Squad''s owner saw % messages, expected 1 (Elite''s own)', n; end if;
  select count(*) into n from athlete_checkins;
  if n <> 1 then raise exception 'FAIL: Elite Squad''s owner saw % check-ins, expected 1 (Elite''s own)', n; end if;
  select count(*) into n from athlete_message_reads;
  if n <> 0 then raise exception 'FAIL: Elite Squad''s owner saw % of Bridge''s read markers', n; end if;
  raise notice 'PASS: another org sees nothing of Bridge''s thread, log or markers';
end $$;

select set_test_user(null);
do $$
declare n int;
begin
  select (select count(*) from athlete_checkins) + (select count(*) from athlete_messages) + (select count(*) from athlete_message_reads) into n;
  if n <> 0 then raise exception 'FAIL: an anonymous session saw % thread, log or marker rows, expected 0', n; end if;
  raise notice 'PASS: anonymous session sees no check-ins, messages or read markers';
end $$;
reset role;

-- ── Migration 0026: a family link is only as alive as the membership,
-- and staff rows open per org, never across orgs. ──
reset role;
-- user5 becomes family in Elite Squad too, linked to its athlete. user3
-- is staff in Elite and a plain member in Bridge: their Elite row is
-- readable to user5, their Bridge row is not.
insert into org_members (user_id, org_id, role) values
  ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000020', 'family');
insert into athlete_guardians (org_id, athlete_id, user_id) values
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000005');

set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000005');
do $$
declare n int;
begin
  select count(*) into n from athletes;
  if n <> 2 then raise exception 'FAIL: a family member of two orgs saw % athletes, expected 2 (one in each)', n; end if;
  select count(*) into n from org_members where user_id = '00000000-0000-0000-0000-000000000003' and org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 1 then raise exception 'FAIL: family cannot see Elite Squad''s staff row for user3'; end if;
  select count(*) into n from org_members where user_id = '00000000-0000-0000-0000-000000000003' and org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: family read user3''s Bridge MEMBER row through their Elite staff role'; end if;
  raise notice 'PASS: staff rows open to a family per org, never across orgs';
end $$;

-- Migration 0039, the two-org family. user5 may now write to a thread in
-- each org, and the insert policy admits a message by athlete_id, so
-- only the coherence trigger stops Athlete A's message being filed
-- under Elite Squad's org_id, where Elite's staff would read it.
do $$
declare n int;
begin
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005', 'Bridge athlete under Elite');
    raise exception 'FAIL: a family login in two orgs filed a Bridge athlete''s message under Elite Squad';
  exception when check_violation or insufficient_privilege then
    raise notice 'PASS: a family login in two orgs cannot file a Bridge athlete''s message under Elite Squad';
  end;
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000005', 'Elite athlete under Bridge');
    raise exception 'FAIL: a family login in two orgs filed an Elite athlete''s message under Bridge';
  exception when check_violation or insufficient_privilege then
    raise notice 'PASS: a family login in two orgs cannot file an Elite athlete''s message under Bridge';
  end;
  insert into athlete_messages (org_id, athlete_id, author_id, body) values
    ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000005', 'family wrote to Elite');
  select count(*) into n from athlete_checkins;
  if n <> 0 then raise exception 'FAIL: a family login in two orgs read % check-ins, expected 0', n; end if;
  raise notice 'PASS: a family login in two orgs writes to each of their athletes'' threads in that athlete''s own org, and reads no check-ins in either';
end $$;

select set_test_user('00000000-0000-0000-0000-000000000002'); -- Elite owner
do $$
declare n int;
begin
  select count(*) into n from athlete_messages where athlete_id <> '00000000-0000-0000-0000-000000000120';
  if n <> 0 then raise exception 'FAIL: Elite Squad''s owner read % messages about a Bridge athlete', n; end if;
  select count(*) into n from athlete_messages where author_id = '00000000-0000-0000-0000-000000000005';
  if n <> 1 then raise exception 'FAIL: Elite Squad''s owner saw % of the family''s Elite messages, expected 1', n; end if;
  raise notice 'PASS: Elite Squad''s staff read the shared family''s Elite thread and nothing of Bridge''s';
end $$;

-- The Bridge membership goes, the guardian row is left behind on
-- purpose: the database must stop honouring it by itself.
reset role;
delete from org_members where user_id = '00000000-0000-0000-0000-000000000005' and org_id = '00000000-0000-0000-0000-000000000010';
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000005');
do $$
declare n int;
begin
  select count(*) into n from athletes where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 0 then raise exception 'FAIL: a removed family member still read % Bridge athlete(s) through a stale guardian row', n; end if;
  select count(*) into n from athlete_metrics where athlete_id = '00000000-0000-0000-0000-000000000110';
  if n <> 0 then raise exception 'FAIL: a removed family member still read the athlete''s metrics'; end if;
  select count(*) into n from documents where athlete_id = '00000000-0000-0000-0000-000000000110';
  if n <> 0 then raise exception 'FAIL: a removed family member still read the athlete''s documents'; end if;
  select count(*) into n from athlete_messages where athlete_id = '00000000-0000-0000-0000-000000000110';
  if n <> 0 then raise exception 'FAIL: a removed family member still read the athlete''s thread (migration 0039)'; end if;
  begin
    insert into athlete_messages (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000005', 'after removal');
    raise exception 'FAIL: a removed family member still wrote to the athlete''s thread (migration 0039)';
  exception when insufficient_privilege then
    null;
  end;
  select count(*) into n from athletes where org_id = '00000000-0000-0000-0000-000000000020';
  if n <> 1 then raise exception 'FAIL: the other org''s link stopped working too'; end if;
  raise notice 'PASS: a family link dies with the membership, org by org';
end $$;
reset role;

-- ── Transfer windows: one row per sport, division, season and label ──
-- Migration 0032. The entry form checks for a duplicate before it
-- writes, which is a race; this is the rule that actually holds.
do $$
declare failed boolean := false;
begin
  insert into transfer_windows (sport, division, season_year, window_label, opens_on, closes_on, source_url)
  values ('baseball', 'D1', '2099-00', 'rls probe', '2099-12-01', '2099-12-15', 'https://example.test/probe');
  begin
    insert into transfer_windows (sport, division, season_year, window_label, opens_on, closes_on, source_url)
    values ('BASEBALL', 'D1', '2099-00', 'rls probe', '2099-12-02', '2099-12-16', 'https://example.test/probe-2');
  exception when unique_violation then failed := true;
  end;
  if not failed then raise exception 'FAIL: the same transfer window was accepted twice'; end if;
  -- A different label for the same season is a different window.
  insert into transfer_windows (sport, division, season_year, window_label, opens_on, closes_on, source_url)
  values ('baseball', 'D1', '2099-00', 'rls probe, second', '2099-12-20', '2099-12-28', 'https://example.test/probe-3');
  delete from transfer_windows where season_year = '2099-00';
  raise notice 'PASS: one transfer window per sport, division, season and label';
end $$;

-- ── The member summary functions are for signed-in callers only ──────
-- Migration 0033. PostgREST exposes everything in the public schema, so
-- a function granted to everyone is callable without signing in. The
-- answer was always empty (auth.uid() is null for anon), but the call
-- should not be reachable at all.
do $$
declare anon_can boolean;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  for anon_can in
    select has_function_privilege('anon', f, 'execute')
    from unnest(array['public.member_program(uuid)', 'public.member_program_schools(uuid, uuid)', 'public.member_giving(uuid)']) as f
  loop
    if anon_can then raise exception 'FAIL: an unauthenticated caller can execute a member summary function'; end if;
  end loop;
  for anon_can in
    select not has_function_privilege('authenticated', f, 'execute')
    from unnest(array['public.member_program(uuid)', 'public.member_program_schools(uuid, uuid)', 'public.member_giving(uuid)']) as f
  loop
    if anon_can then raise exception 'FAIL: a signed-in caller cannot execute a member summary function'; end if;
  end loop;
  raise notice 'PASS: the member summary functions are granted to signed-in callers and to nobody else';
end $$;

-- ── The member program names Enrolled athletes and their school ─────
-- Migration 0034. Same rule as placementOf() in src/lib/placement.ts:
-- an Enrolled athlete reads Enrolled, not Committed forever; the school
-- is the Committed target, else a transfer record's Current School.
reset role;
update athletes set status = 'Enrolled', recruit_type = 'transfer_4to4', detail = '{"kind":"transfer","currentSchool":" City College "}'::jsonb
  where id = '00000000-0000-0000-0000-000000000111';
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000003');
do $$
declare st text; sc text;
begin
  select stage, committed_school into st, sc from member_program('00000000-0000-0000-0000-000000000010') where athlete_id = '00000000-0000-0000-0000-000000000111';
  if st <> 'Enrolled' then raise exception 'FAIL: an Enrolled athlete reads as % in member_program', st; end if;
  if sc is distinct from 'City College' then raise exception 'FAIL: an athlete enrolled at their Current School reads school %', sc; end if;
  select stage into st from member_program('00000000-0000-0000-0000-000000000010') where athlete_id = '00000000-0000-0000-0000-000000000110';
  if st <> 'Targeting' then raise exception 'FAIL: an athlete still recruiting now reads as %', st; end if;
  raise notice 'PASS: member_program names an Enrolled athlete and their Current School';
end $$;
reset role;
update athletes set status = 'Committed' where id = '00000000-0000-0000-0000-000000000111';
set role app_user;
do $$
declare st text; sc text;
begin
  select stage, committed_school into st, sc from member_program('00000000-0000-0000-0000-000000000010') where athlete_id = '00000000-0000-0000-0000-000000000111';
  if st <> 'Committed' then raise exception 'FAIL: an athlete set to Committed by hand reads as %', st; end if;
  if sc is not null then raise exception 'FAIL: a Committed athlete with no Committed target borrowed the Current School %', sc; end if;
  raise notice 'PASS: Current School only names the school once they are Enrolled';
end $$;
reset role;

-- ── Graduated and Drafted (migration 0035) ───────────────────────────
reset role;
update athletes set status = 'Graduated', graduated_on = '2026-05-15' where id = '00000000-0000-0000-0000-000000000111';
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000003');
do $$
declare st text; sc text;
begin
  select stage, committed_school into st, sc from member_program('00000000-0000-0000-0000-000000000010') where athlete_id = '00000000-0000-0000-0000-000000000111';
  if st <> 'Graduated' or sc is distinct from 'City College' then raise exception 'FAIL: a Graduated athlete reads as % at %', st, sc; end if;
  raise notice 'PASS: member_program names a Graduated athlete and their school';
end $$;
reset role;
update athletes set status = 'Drafted', draft_team = 'Fixture Pros', draft_round = 5, draft_year = 2026 where id = '00000000-0000-0000-0000-000000000111';
set role app_user;
do $$
declare st text; sc text; rd int; yr int;
begin
  select stage, committed_school, draft_round, draft_year into st, sc, rd, yr from member_program('00000000-0000-0000-0000-000000000010') where athlete_id = '00000000-0000-0000-0000-000000000111';
  if st <> 'Drafted' or sc is distinct from 'Fixture Pros' or rd is distinct from 5 or yr is distinct from 2026 then
    raise exception 'FAIL: a Drafted athlete reads as % / % / % / %', st, sc, rd, yr;
  end if;
  raise notice 'PASS: member_program names the team, round and year of a Drafted athlete';
end $$;
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.member_program(uuid)', 'execute') then raise exception 'FAIL: 0035 reopened member_program to anon'; end if;
  if not has_function_privilege('authenticated', 'public.member_program(uuid)', 'execute') then raise exception 'FAIL: 0035 dropped the signed-in grant on member_program'; end if;
  begin
    update athletes set draft_round = 0 where id = '00000000-0000-0000-0000-000000000111';
    raise exception 'FAIL: a draft round of 0 was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: the recreated member_program keeps its grants, and the round is checked';
end $$;

-- ── The college coach directory (migration 0036) ────────────────────
-- Owners and staff in any org read it; a member, a family login, a
-- signed-in user with no org and a signed-out caller read nothing; and
-- nobody writes it except the service role. This table carries no
-- org_id, so the org_id coverage checks above never look at it.
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000006', 'user6@bridge.example'),
  ('00000000-0000-0000-0000-000000000007', 'user7@nowhere.example');
insert into org_members (user_id, org_id, role) values
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000010', 'member');
insert into college_coaches (school_id, school_name, name, email, phone) values
  ('00000000-0000-0000-0000-000000000130', 'Shared Reference School', 'Probe Coach', 'coach@probe.example', '555-0100');
do $$
begin
  begin
    insert into college_coaches (school_id, school_name, name) values ('00000000-0000-0000-0000-000000000130', 'Shared Reference School', 'probe coach');
    raise exception 'FAIL: the same coach was loaded twice for one school';
  exception when unique_violation then null;
  end;
  raise notice 'PASS: one row per coach per school';
end $$;
set role app_user;
do $$
declare n int;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000001');
  select count(*) into n from college_coaches;
  if n <> 1 then raise exception 'FAIL: an owner saw % coaches, expected 1', n; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000006');
  select count(*) into n from college_coaches;
  if n <> 0 then raise exception 'FAIL: a board member saw % coach rows', n; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000005');
  select count(*) into n from college_coaches;
  if n <> 0 then raise exception 'FAIL: a family login saw % coach rows', n; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000007');
  select count(*) into n from college_coaches;
  if n <> 0 then raise exception 'FAIL: a user with no org saw % coach rows', n; end if;
  perform set_test_user(null);
  select count(*) into n from college_coaches;
  if n <> 0 then raise exception 'FAIL: a signed-out caller saw % coach rows', n; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000001');
  begin
    insert into college_coaches (school_id, school_name, name) values ('00000000-0000-0000-0000-000000000130', 'Shared Reference School', 'Owner Write');
    raise exception 'FAIL: an owner wrote to the coach directory';
  exception when insufficient_privilege then null;
  end;
  update college_coaches set email = 'changed@probe.example';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: an owner changed % coach rows', n; end if;
  raise notice 'PASS: the coach directory is for owners and staff, read-only';
end $$;
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.college_coaches', 'select') then raise exception 'FAIL: anon holds select on college_coaches'; end if;
  raise notice 'PASS: anon holds no grant on the coach directory';
end $$;

-- ── The school directory for every role (Stage 2, 2026-09-26) ────────
-- A member and a family login browse the same school directory staff
-- do, so they read the shared reference table directly (schools_read,
-- migration 0016) and change none of it. user6 is a member and nothing
-- else; user3 is a Bridge member (and Elite staff); user5 is a family
-- login and nothing else. The table carries no org_id, so the org_id
-- coverage checks above never look at it.
set role app_user;
do $$
declare n int; who text;
begin
  foreach who in array array['00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005'] loop
    perform set_test_user(who::uuid);
    select count(*) into n from schools;
    if n <> 1 then raise exception 'FAIL: user % saw % schools, expected 1 (shared reference data)', who, n; end if;
    begin
      update schools set name = 'Renamed From the Directory';
      get diagnostics n = row_count;
      if n <> 0 then raise exception 'FAIL: user % changed % schools from the directory', who, n; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
  raise notice 'PASS: a member and a family login read the school directory and cannot change it';
end $$;
reset role;
do $$
declare nm text;
begin
  select name into nm from schools where id = '00000000-0000-0000-0000-000000000130';
  if nm is distinct from 'Shared Reference School' then raise exception 'FAIL: the shared school was renamed to % under a directory write', nm; end if;
  raise notice 'PASS: the shared school is unchanged after the directory writes';
end $$;

-- ── Transferring and closed_from (migration 0038) ───────────────────
-- closed_from only ever holds a status the close-out can replace;
-- Committed is never one. A Transferring athlete's leftover Committed
-- target is history: member_program reads them by their open targets,
-- and names no school. A family reads closed_from on their own athlete's
-- targets (row policies, no column policy) and writes nothing.
reset role;
do $$
begin
  begin
    insert into recruiting_targets (org_id, athlete_id, school_id, status, closed_from) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000130', 'Not Interested', 'Committed');
    raise exception 'FAIL: closed_from accepted Committed';
  exception when check_violation then
    raise notice 'PASS: closed_from holds only a status a close-out can replace';
  end;
end $$;
update recruiting_targets set status = 'Committed' where id = '00000000-0000-0000-0000-000000000211';
update athletes set status = 'Transferring', draft_team = null, draft_round = null, draft_year = null where id = '00000000-0000-0000-0000-000000000111';
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000003');
do $$
declare st text; sc text;
begin
  select stage, committed_school into st, sc from member_program('00000000-0000-0000-0000-000000000010') where athlete_id = '00000000-0000-0000-0000-000000000111';
  if st = 'Committed' then raise exception 'FAIL: a Transferring athlete with a leftover Committed target still reads as Committed'; end if;
  if st <> 'Targeting' then raise exception 'FAIL: a Transferring athlete with one open target reads as %', st; end if;
  if sc is not null then raise exception 'FAIL: a Transferring athlete is still named with the school they left, %', sc; end if;
  raise notice 'PASS: member_program reads a Transferring athlete by their open targets, not the commitment they left';
end $$;
reset role;
update recruiting_targets set status = 'In Contact' where id = '00000000-0000-0000-0000-000000000211';
update recruiting_targets set closed_from = 'Offer' where id = '00000000-0000-0000-0000-000000000220';
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000005'); -- FAMILY, by now linked to athlete 120 in the second org (0026 block above)
do $$
declare n int; cf text;
begin
  select count(*) into n from recruiting_targets where closed_from is not null;
  if n <> 1 then raise exception 'FAIL: family saw % targets with closed_from, expected 1 (their own athlete''s)', n; end if;
  select closed_from into cf from recruiting_targets where id = '00000000-0000-0000-0000-000000000220';
  if cf is distinct from 'Offer' then raise exception 'FAIL: family read closed_from as %', cf; end if;
  update recruiting_targets set closed_from = 'Visit' where id = '00000000-0000-0000-0000-000000000220';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a family member changed closed_from'; end if;
  raise notice 'PASS: a family member reads closed_from on their own athlete''s targets and cannot change it';
end $$;
reset role;
do $$
declare cf text;
begin
  select closed_from into cf from recruiting_targets where id = '00000000-0000-0000-0000-000000000220';
  if cf is distinct from 'Offer' then raise exception 'FAIL: closed_from changed under a family write to %', cf; end if;
  if has_function_privilege('anon', 'public.member_program(uuid)', 'execute') then raise exception 'FAIL: 0038 reopened member_program to anon'; end if;
  if not has_function_privilege('authenticated', 'public.member_program(uuid)', 'execute') then raise exception 'FAIL: 0038 dropped the signed-in grant on member_program'; end if;
  raise notice 'PASS: the replaced member_program keeps its grants';
end $$;

-- ── The high school directory (migration 0040) ──────────────────────
-- Shared, public, read by any signed-in user, written by nobody but the
-- service role (the NCES loader). It carries no org_id, so the coverage
-- checks above never look at it. Seeded here as the superuser, the way
-- the loader writes through the service role.
reset role;
insert into high_schools (name, city, state, nces_id, ceeb_code, source) values
  ('Probe High School', 'Hartford', 'CT', '090000000001', '070001', 'nces_ccd_probe'),
  ('  Second Probe HS ', 'Newark', 'NJ', 'P0000001', null, 'nces_pss_probe');
set role app_user;
do $$
declare n int; who text;
begin
  -- Bridge owner, Bridge member / Elite staff, a family login, a member.
  foreach who in array array['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000006'] loop
    perform set_test_user(who::uuid);
    select count(*) into n from high_schools;
    if n <> 2 then raise exception 'FAIL: user % read % high schools, expected 2', who, n; end if;
    begin
      insert into high_schools (name, city, state) values ('Typed By A User', 'Anywhere', 'CT');
      raise exception 'FAIL: user % added a high school to the shared directory', who;
    exception when insufficient_privilege then null;
    end;
    update high_schools set name = 'Renamed By A User';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user % renamed % high schools', who, n; end if;
    delete from high_schools;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: user % deleted % high schools', who, n; end if;
  end loop;
  raise notice 'PASS: every signed-in role reads the high school directory and none of them writes it';
end $$;
reset role;
do $$
declare n int; k text;
begin
  select count(*) into n from high_schools where name in ('Probe High School', '  Second Probe HS ');
  if n <> 2 then raise exception 'FAIL: the high school directory changed under user writes (% of 2 rows left as seeded)', n; end if;
  select name_key into k from high_schools where nces_id = 'P0000001';
  if k is distinct from 'second probe hs' then raise exception 'FAIL: name_key is %, expected lower(btrim(name))', k; end if;
  if exists (select 1 from high_schools where name_key <> lower(btrim(name))) then raise exception 'FAIL: a name_key differs from lower(btrim(name))'; end if;
  begin
    insert into high_schools (name, city, state) values (' PROBE high school', 'Hartford', 'CT');
    raise exception 'FAIL: the same high school in the same town was accepted twice in a different case';
  exception when unique_violation then null;
  end;
  begin
    insert into high_schools (name, city, state, nces_id) values ('Another Probe', 'Hartford', 'CT', '090000000001');
    raise exception 'FAIL: a duplicate NCES id was accepted';
  exception when unique_violation then null;
  end;
  insert into high_schools (name) values ('No Town Probe');
  begin
    insert into high_schools (name) values ('no town probe');
    raise exception 'FAIL: the same school with no town and no state was accepted twice';
  exception when unique_violation then null;
  end;
  delete from high_schools where name_key = 'no town probe';
  begin
    insert into high_schools (name, state) values ('Bad State Probe', 'Connecticut');
    raise exception 'FAIL: a state that is not two capital letters was accepted';
  exception when check_violation then null;
  end;
  if has_table_privilege('anon', 'public.high_schools', 'select') then raise exception 'FAIL: anon holds select on high_schools'; end if;
  raise notice 'PASS: one row per school per town, one per NCES id, name_key is lower(btrim(name)), and anon holds no grant';
end $$;

-- ── Staff notes on an athlete (migration 0040) ──────────────────────
-- Owner and staff of the athlete's org, and nobody else: not a member,
-- not the athlete's own family login, not someone from another org.
-- user3 is a Bridge MEMBER and Elite STAFF, which is what proves the
-- member exclusion is per org. user5 is by now family in Elite only,
-- linked to Elite's athlete (120).
reset role;
insert into athlete_notes (org_id, athlete_id, author_id, body) values
  ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', 'Bridge staff note'),
  ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000002', 'Elite staff note');
set role app_user;
do $$
declare n int;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000001');
  select count(*) into n from athlete_notes;
  if n <> 1 then raise exception 'FAIL: Bridge''s owner read % notes, expected 1', n; end if;
  select count(*) into n from athlete_notes where body = 'Bridge staff note';
  if n <> 1 then raise exception 'FAIL: Bridge''s owner cannot read Bridge''s note'; end if;

  perform set_test_user('00000000-0000-0000-0000-000000000002');
  select count(*) into n from athlete_notes;
  if n <> 1 then raise exception 'FAIL: Elite''s owner read % notes, expected 1', n; end if;
  select count(*) into n from athlete_notes where body = 'Elite staff note';
  if n <> 1 then raise exception 'FAIL: Elite''s owner cannot read Elite''s note'; end if;

  perform set_test_user('00000000-0000-0000-0000-000000000003');
  select count(*) into n from athlete_notes where body = 'Elite staff note';
  if n <> 1 then raise exception 'FAIL: Elite staff cannot read Elite''s note'; end if;
  select count(*) into n from athlete_notes where body = 'Bridge staff note';
  if n <> 0 then raise exception 'FAIL: a Bridge MEMBER read Bridge''s staff note through their Elite staff role'; end if;

  perform set_test_user('00000000-0000-0000-0000-000000000005');
  select count(*) into n from athlete_notes;
  if n <> 0 then raise exception 'FAIL: a family login read % staff notes, including on their own athlete', n; end if;

  perform set_test_user('00000000-0000-0000-0000-000000000006');
  select count(*) into n from athlete_notes;
  if n <> 0 then raise exception 'FAIL: a member read % staff notes', n; end if;

  perform set_test_user('00000000-0000-0000-0000-000000000007');
  select count(*) into n from athlete_notes;
  if n <> 0 then raise exception 'FAIL: a user in no org read % staff notes', n; end if;

  perform set_test_user(null);
  select count(*) into n from athlete_notes;
  if n <> 0 then raise exception 'FAIL: a signed-out caller read % staff notes', n; end if;
  raise notice 'PASS: staff notes are read by owner and staff of the athlete''s org and by nobody else';
end $$;

do $$
declare n int;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000005');
  begin
    insert into athlete_notes (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000005', 'family wrote a staff note');
    raise exception 'FAIL: a family login wrote a staff note on their own athlete';
  exception when insufficient_privilege then null;
  end;

  perform set_test_user('00000000-0000-0000-0000-000000000006');
  begin
    insert into athlete_notes (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000006', 'member wrote a staff note');
    raise exception 'FAIL: a member wrote a staff note';
  exception when insufficient_privilege then null;
  end;

  perform set_test_user('00000000-0000-0000-0000-000000000003');
  begin
    insert into athlete_notes (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000003', 'Bridge member wrote a staff note');
    raise exception 'FAIL: a Bridge member wrote a Bridge staff note through their Elite staff role';
  exception when insufficient_privilege then null;
  end;

  perform set_test_user('00000000-0000-0000-0000-000000000001');
  begin
    insert into athlete_notes (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000002', 'signed as someone else');
    raise exception 'FAIL: staff filed a note in someone else''s name';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into athlete_notes (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000120', '00000000-0000-0000-0000-000000000001', 'Elite athlete under Bridge');
    raise exception 'FAIL: a note about Elite''s athlete was filed under Bridge';
  exception when check_violation then null;
  end;
  begin
    insert into athlete_notes (org_id, athlete_id, author_id, body) values
      ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-000000000001', '   ');
    raise exception 'FAIL: a blank note was accepted';
  exception when check_violation then null;
  end;
  insert into athlete_notes (org_id, athlete_id, author_id, context, body) values
    ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-000000000001', 'enrolled', 'Bridge owner note on enroll');
  select count(*) into n from athlete_notes where body = 'Bridge owner note on enroll' and context = 'enrolled';
  if n <> 1 then raise exception 'FAIL: staff could not add their own note'; end if;
  update athlete_notes set body = 'rewritten';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: staff edited % notes; notes are not edited', n; end if;
  raise notice 'PASS: only owner and staff add notes, only as themselves, only on their own org''s athlete, and nobody edits one';
end $$;

do $$
declare n int;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000006');
  delete from athlete_notes;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member deleted % notes', n; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000003');
  delete from athlete_notes where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a Bridge member deleted % Bridge notes through their Elite staff role', n; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000002');
  delete from athlete_notes where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: Elite''s owner deleted % Bridge notes', n; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000001');
  delete from athlete_notes where body = 'Bridge owner note on enroll';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: Bridge''s owner could not delete Bridge''s note (% rows)', n; end if;
  raise notice 'PASS: staff delete their own org''s notes, and a member or another org deletes none';
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from athlete_notes where body in ('Bridge staff note', 'Elite staff note');
  if n <> 2 then raise exception 'FAIL: % of the 2 seeded notes survived the refused deletes', n; end if;
  if has_table_privilege('anon', 'public.athlete_notes', 'select') then raise exception 'FAIL: anon holds select on athlete_notes'; end if;
  raise notice 'PASS: the seeded notes are intact and anon holds no grant on athlete_notes';
end $$;

-- ── Transfer window notes (migration 0040) ──────────────────────────
-- Shared reference data: written by the service role (the owner's
-- action goes through it), never by an ordinary signed-in client.
reset role;
insert into transfer_windows (sport, division, season_year, window_label, opens_on, closes_on, source_url, notes)
values ('baseball', 'D1', '2099-01', 'notes probe', '2099-12-01', '2099-12-15', 'https://example.test/notes-probe', 'Seeded note');
set role app_user;
select set_test_user('00000000-0000-0000-0000-000000000001');
do $$
declare n int; t text;
begin
  select notes into t from transfer_windows where season_year = '2099-01';
  if t is distinct from 'Seeded note' then raise exception 'FAIL: an owner read the transfer window note as %', t; end if;
  update transfer_windows set notes = 'Changed by a client' where season_year = '2099-01';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: an owner changed % transfer window notes through the ordinary client', n; end if;
  raise notice 'PASS: transfer window notes are readable and not writable through the ordinary client';
end $$;
reset role;
delete from transfer_windows where season_year = '2099-01';

-- ── Which model read a document (migration 0040) ────────────────────
-- A stub reading is invented data. Once a row says 'stub' it says
-- 'stub' for good: not staff, not even the superuser, can relabel it as
-- a real model's reading and make it appliable.
reset role;
update documents set read_by = 'stub' where file_name = 'bridge-transcript.pdf';
set role app_user;
do $$
declare n int;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000001');
  select count(*) into n from documents where read_by = 'stub';
  if n <> 1 then raise exception 'FAIL: Bridge''s owner saw % stub-read documents, expected 1', n; end if;
  begin
    update documents set read_by = 'claude-opus-5' where file_name = 'bridge-transcript.pdf';
    raise exception 'FAIL: staff relabelled a stub reading as a real model''s';
  exception when check_violation then null;
  end;
  begin
    update documents set read_by = null where file_name = 'bridge-transcript.pdf';
    raise exception 'FAIL: staff cleared the stub mark off a document';
  exception when check_violation then null;
  end;
  update documents set read_by = 'claude-opus-5' where file_name = 'athlete-a-transcript.pdf';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: staff could not record the model on an unread document'; end if;
  perform set_test_user('00000000-0000-0000-0000-000000000006');
  update documents set read_by = 'claude-opus-5' where file_name = 'athlete-b-transcript.pdf';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member marked % documents as read', n; end if;
  raise notice 'PASS: a stub reading stays marked, staff record the model on their own documents, a member records nothing';
end $$;
reset role;
do $$
declare rb text;
begin
  begin
    update documents set read_by = 'claude-opus-5' where file_name = 'bridge-transcript.pdf';
    raise exception 'FAIL: the superuser relabelled a stub reading';
  exception when check_violation then null;
  end;
  select read_by into rb from documents where file_name = 'bridge-transcript.pdf';
  if rb is distinct from 'stub' then raise exception 'FAIL: the stub mark reads %', rb; end if;
  begin
    update documents set read_by = '   ' where file_name = 'athlete-b-transcript.pdf';
    raise exception 'FAIL: a blank read_by was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: the stub mark holds for every role, and read_by is never blank';
end $$;

-- ── Creating an organization (migration 0040) ───────────────────────
-- A signed-in user with no org creates one and is its owner; a taken
-- address, a blank name and a malformed address are refused; a
-- signed-out caller cannot run it. Last in the file, because user7
-- stops being "in no org" here.
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.create_org(text, text)', 'execute') then raise exception 'FAIL: anon can execute create_org'; end if;
  if not has_function_privilege('authenticated', 'public.create_org(text, text)', 'execute') then raise exception 'FAIL: a signed-in caller cannot execute create_org'; end if;
  if has_function_privilege('public', 'public.create_org(text, text)', 'execute') then raise exception 'FAIL: create_org is still granted to PUBLIC'; end if;
  raise notice 'PASS: create_org is granted to signed-in callers and to nobody else';
end $$;
set role app_user;
do $$
declare n int; new_id uuid; r text; nm text; sl text;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000007');
  select count(*) into n from orgs;
  if n <> 0 then raise exception 'FAIL: a user in no org read % orgs before creating one', n; end if;

  new_id := create_org('  Probe Organization ', ' Probe-Org ');
  select name, slug into nm, sl from orgs where id = new_id;
  if nm is distinct from 'Probe Organization' or sl is distinct from 'probe-org' then
    raise exception 'FAIL: create_org stored name % and slug %', nm, sl;
  end if;
  select role::text into r from org_members where org_id = new_id and user_id = '00000000-0000-0000-0000-000000000007';
  if r is distinct from 'owner' then raise exception 'FAIL: the creator is % of the new org, expected owner', r; end if;
  select count(*) into n from org_members where org_id = new_id;
  if n <> 1 then raise exception 'FAIL: the new org has % members, expected only its creator', n; end if;
  -- An owner in fact, not only in name: they can add to their own org.
  insert into athletes (org_id, recruit_type, name, sport) values (new_id, 'hs', 'Probe Org Athlete', 'baseball');
  select count(*) into n from athletes;
  if n <> 1 then raise exception 'FAIL: the new owner sees % athletes, expected only their own', n; end if;
  raise notice 'PASS: a signed-in user creates an organization and becomes its owner';
end $$;
do $$
declare before_count int; after_count int;
begin
  -- user4 has a profile and no org. Every refusal below must leave them
  -- with no org at all.
  perform set_test_user('00000000-0000-0000-0000-000000000004');
  select count(*) into before_count from org_members where user_id = '00000000-0000-0000-0000-000000000004';
  begin
    perform create_org('Taken Address', 'bridge');
    raise exception 'FAIL: create_org took another org''s address';
  exception when unique_violation then null;
  end;
  begin
    perform create_org('Taken Again', 'PROBE-ORG');
    raise exception 'FAIL: create_org took an address in a different case';
  exception when unique_violation then null;
  end;
  begin
    perform create_org('   ', 'blank-name-probe');
    raise exception 'FAIL: create_org accepted a blank name';
  exception when check_violation then null;
  end;
  begin
    perform create_org(null, 'null-name-probe');
    raise exception 'FAIL: create_org accepted a null name';
  exception when check_violation then null;
  end;
  begin
    perform create_org('Bad Address', 'bad address!');
    raise exception 'FAIL: create_org accepted a malformed address';
  exception when check_violation then null;
  end;
  select count(*) into after_count from org_members where user_id = '00000000-0000-0000-0000-000000000004';
  if after_count <> before_count then raise exception 'FAIL: a refused create_org still made the caller a member'; end if;

  perform set_test_user(null);
  begin
    perform create_org('Signed Out Org', 'signed-out-probe');
    raise exception 'FAIL: a signed-out caller created an org';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: create_org refuses a taken or malformed address, a blank name and a signed-out caller';
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from orgs where slug in ('blank-name-probe', 'null-name-probe', 'signed-out-probe') or name in ('Taken Address', 'Taken Again', 'Bad Address');
  if n <> 0 then raise exception 'FAIL: % refused create_org calls left an org behind', n; end if;
  select count(*) into n from orgs where slug = 'bridge' and name = 'Bridge';
  if n <> 1 then raise exception 'FAIL: the existing org changed under a create_org with its address'; end if;
  raise notice 'PASS: refused create_org calls leave nothing behind';
end $$;

-- ── Who may create an organization, and the directory flag (0040) ───
-- Anyone who holds a membership that is not owner (staff, member or
-- family, in any org) is refused with 42501 and nothing is written. A
-- person in no org, or one who owns an org, may create one, and on an
-- install that already has orgs the new org never edits the shared
-- directory. user8 is staff in Elite Squad and nothing else; user9 owns
-- Elite Squad and is staff in Bridge, to prove one non-owner row
-- anywhere is enough to refuse even an owner.
reset role;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000008', 'user8@elitesquad.example'),
  ('00000000-0000-0000-0000-000000000009', 'user9@both.example');
insert into users (id, email, full_name) values
  ('00000000-0000-0000-0000-000000000008', 'user8@elitesquad.example', 'User Eight'),
  ('00000000-0000-0000-0000-000000000009', 'user9@both.example', 'User Nine')
on conflict (id) do update set full_name = excluded.full_name;
insert into org_members (user_id, org_id, role) values
  ('00000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000020', 'staff'),
  ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000020', 'owner'),
  ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000010', 'staff');
do $$
declare r text;
begin
  select string_agg(role::text, ',' order by role::text) into r from org_members where user_id = '00000000-0000-0000-0000-000000000005';
  if r is distinct from 'family' then raise exception 'FAIL: the family probe expected user5 to be family only, found %', r; end if;
  select string_agg(role::text, ',' order by role::text) into r from org_members where user_id = '00000000-0000-0000-0000-000000000006';
  if r is distinct from 'member' then raise exception 'FAIL: the member probe expected user6 to be a member only, found %', r; end if;
end $$;
set role app_user;
do $$
declare
  who uuid;
  label text;
  before_rows int;
  after_rows int;
begin
  foreach who in array array[
    '00000000-0000-0000-0000-000000000008',  -- staff only
    '00000000-0000-0000-0000-000000000006',  -- member only
    '00000000-0000-0000-0000-000000000005',  -- a family login
    '00000000-0000-0000-0000-000000000003',  -- member in one org, staff in the other
    '00000000-0000-0000-0000-000000000009'   -- owner in one org, staff in the other
  ]::uuid[] loop
    perform set_test_user(who);
    select count(*) into before_rows from org_members where user_id = who;
    label := 'refused-probe-' || right(who::text, 1);
    begin
      perform create_org('Refused Probe', label);
      raise exception 'FAIL: % (a non-owner membership) created an org', who;
    exception when insufficient_privilege then null;
    end;
    select count(*) into after_rows from org_members where user_id = who;
    if after_rows <> before_rows then raise exception 'FAIL: a refused create_org gave % a new membership', who; end if;
  end loop;
  raise notice 'PASS: create_org refuses staff, a member, a family login, and anyone with one non-owner membership, with 42501';
end $$;
do $$
declare new_id uuid; r text;
begin
  -- An owner of an existing org (user2, Elite Squad) may start another.
  perform set_test_user('00000000-0000-0000-0000-000000000002');
  new_id := create_org('Owner Second Org', 'owner-second-org');
  select role::text into r from org_members where org_id = new_id and user_id = '00000000-0000-0000-0000-000000000002';
  if r is distinct from 'owner' then raise exception 'FAIL: an owner starting a second org is % of it', r; end if;
  -- user7 already owns the probe org from above; a second is allowed.
  perform set_test_user('00000000-0000-0000-0000-000000000007');
  perform create_org('Probe Owner Again', 'probe-owner-again');
  raise notice 'PASS: an owner, and someone in no org, may create an org';
end $$;
reset role;
do $$
declare n int;
begin
  select count(*) into n from orgs where slug like 'refused-probe-%' or name = 'Refused Probe';
  if n <> 0 then raise exception 'FAIL: % refused create_org calls left an org behind', n; end if;
  select count(*) into n from orgs where slug in ('probe-org', 'owner-second-org', 'probe-owner-again') and edits_shared_directory;
  if n <> 0 then raise exception 'FAIL: % orgs created on an install that already had orgs edit the shared directory', n; end if;
  select count(*) into n from orgs where slug in ('probe-org', 'owner-second-org', 'probe-owner-again');
  if n <> 3 then raise exception 'FAIL: expected the three allowed orgs, found %', n; end if;
  -- The seeded orgs were inserted directly, not through create_org, and
  -- keep the default.
  select count(*) into n from orgs where edits_shared_directory;
  if n <> 0 then raise exception 'FAIL: % orgs edit the shared directory without anyone turning it on', n; end if;
  raise notice 'PASS: no org created on a populated install edits the shared directory';
end $$;
-- The flag is not the org's to set: orgs has no update policy, so an
-- owner's own session cannot switch it on.
set role app_user;
do $$
declare n int;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000001');
  update orgs set edits_shared_directory = true where id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: an owner switched on edits_shared_directory for their own org'; end if;
  raise notice 'PASS: an owner cannot switch on the shared directory flag for their own org';
end $$;
reset role;
do $$
declare flag boolean;
begin
  select edits_shared_directory into flag from orgs where id = '00000000-0000-0000-0000-000000000010';
  if flag then raise exception 'FAIL: the directory flag changed under an owner''s update'; end if;
end $$;

\echo 'ALL 0040 ASSERTIONS PASSED'

-- ═══════════════════════════════════════════════════════════════════
-- Migration 0041: staff becomes owner, and a Title per person.
-- Dave, 2026-09-27: "Admin, athlete, viewer. I control access of all
-- that. Within admin I can set board, title, role, whatever."
-- ═══════════════════════════════════════════════════════════════════
reset role;

-- The staff to owner move, as the migration writes it, run against the
-- seeded staff rows inside a subtransaction that is rolled back so the
-- rest of this file still has its staff probes. The migration itself
-- ran on an empty table above, which is what production looked like too.
do $$
declare staff_before int; staff_after int; owners_after int; owners_before int;
begin
  select count(*) into staff_before from org_members where role = 'staff';
  select count(*) into owners_before from org_members where role = 'owner';
  if staff_before = 0 then raise exception 'FAIL: the 0041 probe needs seeded staff rows to move'; end if;
  begin
    update org_members set role = 'owner' where role = 'staff';
    select count(*) into staff_after from org_members where role = 'staff';
    select count(*) into owners_after from org_members where role = 'owner';
    if staff_after <> 0 then raise exception 'FAIL: % staff rows survived the 0041 update', staff_after; end if;
    if owners_after <> owners_before + staff_before then raise exception 'FAIL: expected % owners after the move, found %', owners_before + staff_before, owners_after; end if;
    raise exception using errcode = 'P0001', message = 'ROLLBACK_0041_PROBE';
  exception when others then
    if sqlerrm <> 'ROLLBACK_0041_PROBE' then raise; end if;
  end;
  select count(*) into staff_after from org_members where role = 'staff';
  if staff_after <> staff_before then raise exception 'FAIL: the 0041 probe did not roll back'; end if;
  raise notice 'PASS: 0041 moves every staff membership to owner and touches nothing else';
end $$;

-- The Title column and its length rule: null, or 1 to 80 characters
-- once trimmed. Written here as the service role would (superuser),
-- since org_members has no update policy for any session.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'org_members' and column_name = 'title' and is_nullable = 'YES') then
    raise exception 'FAIL: org_members.title is missing or not nullable';
  end if;
  update org_members set title = 'Board Chair' where user_id = '00000000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000000010';
  update org_members set title = repeat('x', 80) where user_id = '00000000-0000-0000-0000-000000000002' and org_id = '00000000-0000-0000-0000-000000000020';
  update org_members set title = null where user_id = '00000000-0000-0000-0000-000000000002' and org_id = '00000000-0000-0000-0000-000000000020';
  begin
    update org_members set title = '   ' where user_id = '00000000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000000010';
    raise exception 'FAIL: a blank Title was accepted';
  exception when check_violation then null;
  end;
  begin
    update org_members set title = repeat('x', 81) where user_id = '00000000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000000010';
    raise exception 'FAIL: an 81 character Title was accepted';
  exception when check_violation then null;
  end;
  begin
    update org_members set title = '' where user_id = '00000000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000000010';
    raise exception 'FAIL: an empty Title was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: org_members.title is null or 1 to 80 trimmed characters, and the database refuses the rest';
end $$;

-- No session sets a Title: not a Viewer (user3, a Bridge member), not an
-- Athlete login (user5, Bridge family), not the org's own Admin (user1)
-- and not the person on their own row. Every update matches 0 rows, and
-- the Title an Admin set through the service role stays as it was.
set role app_user;
do $$
declare who uuid; n int;
begin
  foreach who in array array['00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001']::uuid[] loop
    perform set_test_user(who);
    update org_members set title = 'Self Appointed' where org_id = '00000000-0000-0000-0000-000000000010';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: % changed % org_members titles in their own org', who, n; end if;
    update org_members set title = 'Self Appointed' where user_id = who;
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: % changed their own Title on % rows', who, n; end if;
    update org_members set title = 'Self Appointed';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAIL: % changed % org_members titles across the table', who, n; end if;
  end loop;
  -- The Title is still readable by a colleague, so the members list and
  -- the Your Advisor row can show it.
  perform set_test_user('00000000-0000-0000-0000-000000000003');
  select count(*) into n from org_members where user_id = '00000000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000000010' and title = 'Board Chair';
  if n <> 1 then raise exception 'FAIL: a Viewer cannot read their Admin''s Title (saw % rows)', n; end if;
  perform set_test_user(null);
  raise notice 'PASS: a Viewer, an Athlete login and an Admin session each update 0 org_members rows; the Title an Admin set stays';
end $$;
reset role;
do $$
declare t text;
begin
  select title into t from org_members where user_id = '00000000-0000-0000-0000-000000000001' and org_id = '00000000-0000-0000-0000-000000000010';
  if t is distinct from 'Board Chair' then raise exception 'FAIL: the Title changed under a session''s update (now %)', t; end if;
  if exists (select 1 from org_members where title = 'Self Appointed') then raise exception 'FAIL: a session wrote a Title'; end if;
end $$;

\echo 'ALL 0041 ASSERTIONS PASSED'

-- ── Net cost on a stored match (migration 0042) ─────────────────────
-- One nullable column on athlete_school_fits, riding the read policy
-- 0023 wrote: the athlete's org for an Admin and the athlete's own
-- family login. Nothing widens. user6 is a Bridge Viewer (member) and
-- reads no fit row at all, so no net cost; user5 is by now family in
-- Elite only, linked to Elite's athlete (120), and reads the number on
-- their own athlete's row but cannot change it. Row 560 is Elite's
-- seeded match for athlete 120.
reset role;
update athlete_school_fits set net_cost = 29000 where id = '00000000-0000-0000-0000-000000000560';
do $$
declare n int;
begin
  select count(*) into n from athlete_school_fits where id = '00000000-0000-0000-0000-000000000560' and net_cost = 29000;
  if n <> 1 then raise exception 'FAIL: the seeded Elite match did not take a net cost (% rows)', n; end if;
end $$;
set role app_user;
do $$
declare n int;
begin
  perform set_test_user('00000000-0000-0000-0000-000000000006');
  select count(*) into n from athlete_school_fits;
  if n <> 0 then raise exception 'FAIL: a Viewer read % stored matches, expected 0 (net cost rides the fit row)', n; end if;
  select count(*) into n from athlete_school_fits where net_cost is not null;
  if n <> 0 then raise exception 'FAIL: a Viewer read % net costs, expected 0', n; end if;

  perform set_test_user('00000000-0000-0000-0000-000000000005');
  select count(*) into n from athlete_school_fits where athlete_id = '00000000-0000-0000-0000-000000000120' and net_cost = 29000;
  if n <> 1 then raise exception 'FAIL: a family login read % net costs on their own athlete, expected 1', n; end if;
  select count(*) into n from athlete_school_fits where athlete_id <> '00000000-0000-0000-0000-000000000120';
  if n <> 0 then raise exception 'FAIL: a family login read % other athletes'' matches', n; end if;
  update athlete_school_fits set net_cost = 0 where athlete_id = '00000000-0000-0000-0000-000000000120';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a family login changed the net cost on % of their own athlete''s rows', n; end if;
  update athlete_school_fits set net_cost = 0;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a family login changed % net costs across the table', n; end if;

  perform set_test_user('00000000-0000-0000-0000-000000000002');
  select count(*) into n from athlete_school_fits where net_cost = 29000;
  if n <> 1 then raise exception 'FAIL: Elite''s Admin read % net costs, expected 1', n; end if;

  perform set_test_user(null);
  raise notice 'PASS: a Viewer reads no fit row and no net cost; a family login reads their own athlete''s net cost and updates 0 rows; the Admin reads it';
end $$;
reset role;
do $$
declare c int;
begin
  select net_cost into c from athlete_school_fits where id = '00000000-0000-0000-0000-000000000560';
  if c is distinct from 29000 then raise exception 'FAIL: the net cost changed under a family session''s update (now %)', c; end if;
end $$;

\echo 'ALL 0042 ASSERTIONS PASSED'
