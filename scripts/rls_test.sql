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
  ('00000000-0000-0000-0000-000000000002', 'user2@elitesquad.example');
insert into users (id, email, full_name) values
  ('00000000-0000-0000-0000-000000000001', 'user1@bridge.example', 'User One'),
  ('00000000-0000-0000-0000-000000000002', 'user2@elitesquad.example', 'User Two');
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000010', 'Bridge', 'bridge'),
  ('00000000-0000-0000-0000-000000000020', 'Elite Squad', 'elite-squad');
insert into org_members (user_id, org_id, role) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010', 'owner'),
  ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000020', 'owner');
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
  select count(*) into n from org_members;
  if n <> 1 then raise exception 'FAIL: user1 saw % org_members rows, expected 1 (their own Bridge membership)', n; end if;
  raise notice 'PASS: user1 sees only Bridge''s membership row, not Elite Squad''s';
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

reset role;

\echo 'ALL RLS ASSERTIONS PASSED'
