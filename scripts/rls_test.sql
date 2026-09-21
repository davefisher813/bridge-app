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
insert into board_members (id, org_id, board_id, name, donor_id, status, commitment_amount) values
  ('00000000-0000-0000-0000-000000000430', '00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000410', 'Example Board Member', '00000000-0000-0000-0000-000000000310', 'active', 10000.00),
  ('00000000-0000-0000-0000-000000000440', '00000000-0000-0000-0000-000000000020', '00000000-0000-0000-0000-000000000420', 'Elite Board Member', '00000000-0000-0000-0000-000000000320', 'active', 1000.00);

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

-- ── The member pass. user3 belongs to Bridge with role `member`, which
-- in this app means read-only: every write path in the application goes
-- through requireRole(..., STAFF_ROLES). Before migration 0010 the
-- database did not know that, and since the anon key ships to the
-- browser, a member could write to any org-scoped table in their own org
-- straight through PostgREST with their own token.
--
-- Reads should behave exactly like an owner's. Writes should all fail. ──
select set_test_user('00000000-0000-0000-0000-000000000003');

do $$
declare n int;
begin
  -- user3 belongs to both orgs, as a member of Bridge and staff of Elite
  -- Squad, so the totals are checked per org rather than overall.
  select count(*) into n from athletes where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 2 then raise exception 'FAIL: a member saw % Bridge athletes, expected 2 (same as an owner)', n; end if;
  raise notice 'PASS: a member reads their org exactly like an owner does';
end $$;

-- Donor records specifically: a member reads them and cannot change one.
do $$
declare n int;
begin
  select count(*) into n from donors where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 1 then raise exception 'FAIL: a member saw % Bridge donors, expected 1', n; end if;
  update donors set email = 'member@example.com' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % donor records', n; end if;
  raise notice 'PASS: a member reads donors and cannot change one';
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
  if n <> 2 then raise exception 'FAIL: a member saw % Bridge grading scales, expected 2 (the seeded one plus the one the owner entered earlier in this file)', n; end if;
  raise notice 'PASS: a member reads their org''s grading scales';
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
    array['athlete_school_fits', 'insert into athlete_school_fits (org_id, athlete_id, school_id, score, tag, inputs_hash) values (%L, ''00000000-0000-0000-0000-000000000111'', ''00000000-0000-0000-0000-000000000130'', 50, ''Fit'', ''member'')']
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
  raise notice 'PASS: a member cannot update an athlete they can read';
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

-- The metrics log and the stored matches: a member reads them exactly
-- like an owner (the contract says students and families see their own
-- scores) and cannot change a number or remove a match.
do $$
declare n int;
begin
  select count(*) into n from athlete_metrics where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 1 then raise exception 'FAIL: a member saw % Bridge metric entries, expected 1', n; end if;
  select count(*) into n from athlete_school_fits where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 1 then raise exception 'FAIL: a member saw % Bridge stored matches, expected 1', n; end if;
  update athlete_metrics set value = 99 where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % metric entries', n; end if;
  update org_school_notes set coach_email = 'member@example.com' where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member rewrote % school notes', n; end if;
  delete from athlete_school_fits where org_id = '00000000-0000-0000-0000-000000000010';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: a member deleted % stored matches', n; end if;
  raise notice 'PASS: a member reads metrics and matches and cannot rewrite a number, a note or a match';
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
  if n <> 1 then raise exception 'FAIL: Bridge member saw % document object(s), expected 1', n; end if;
  raise notice 'PASS: a Bridge member can read Bridge''s uploaded documents';
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
  -- Bridge's two rows, plus Elite Squad's one: user3 is staff there.
  select count(*) into n from docai_usage;
  if n <> 3 then raise exception 'FAIL: a Bridge member who is Elite staff saw % spend rows, expected 3', n; end if;
  select count(*) into n from docai_usage where org_id = '00000000-0000-0000-0000-000000000010';
  if n <> 2 then raise exception 'FAIL: a Bridge member saw % of Bridge''s spend rows, expected 2', n; end if;
  begin
    insert into docai_usage (org_id, request_id, model, cost_cents) values
      ('00000000-0000-0000-0000-000000000010', 'req_z', 'claude-opus-5', 0.5);
    raise exception 'FAIL: a member logged Doc AI spend';
  exception when insufficient_privilege then
    raise notice 'PASS: a member reads the spend and cannot write it';
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
