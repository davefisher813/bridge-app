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
insert into athletes (org_id, recruit_type, name, sport) values
  ('00000000-0000-0000-0000-000000000010', 'hs', 'Bridge Athlete A', 'baseball'),
  ('00000000-0000-0000-0000-000000000010', 'hs', 'Bridge Athlete B', 'baseball'),
  ('00000000-0000-0000-0000-000000000020', 'hs', 'Elite Squad Athlete', 'baseball');
insert into schools (name, division) values ('Shared Reference School', 'D1');
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

reset role;

\echo 'ALL RLS ASSERTIONS PASSED'
