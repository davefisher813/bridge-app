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

-- ── Seed: two orgs, two users, one membership each, athletes in both,
-- one shared school, one global benchmark set, one org1-owned set. ──
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'user1@bridge.example'),
  ('00000000-0000-0000-0000-000000000002', 'user2@elitesquad.example'),
  ('00000000-0000-0000-0000-000000000003', 'user3@bridge.example');
insert into users (id, email, full_name) values
  ('00000000-0000-0000-0000-000000000001', 'user1@bridge.example', 'User One'),
  ('00000000-0000-0000-0000-000000000002', 'user2@elitesquad.example', 'User Two'),
  ('00000000-0000-0000-0000-000000000003', 'user3@bridge.example', 'User Three');
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
  if n <> 1 then raise exception 'FAIL: user1 saw % users rows via users_self, expected 1 (only their own)', n; end if;
  raise notice 'PASS: users_self restricts to the caller''s own row';
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
    array['org_grading_scales', 'insert into org_grading_scales (org_id, school_name, bands) values (%L, ''Member HS'', ''[]''::jsonb)']
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

reset role;

\echo 'ALL RLS ASSERTIONS PASSED'
