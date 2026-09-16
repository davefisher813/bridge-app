-- Make RLS enforce the role, not just the org.
--
-- The hole, found by an adversarial audit on 2026-09-16 and recorded in
-- docs/ROADMAP.md: every org-scoped policy was
--
--   for all using (org_id in (select _member_org_ids()))
--
-- and none of them looked at org_members.role. Since the anon key ships
-- to the browser, a user with role `member` could open a console and
-- write to any org-scoped table in their own org through PostgREST with
-- their own token: change an athlete's GPA, delete a target, rewrite a
-- grading scale. `requireRole(..., STAFF_ROLES)` guards the server
-- actions, but a server action is not the only way in, so it was an
-- app-layer convenience rather than a boundary.
--
-- Cross-org isolation was always solid and is proven in
-- scripts/rls_test.sql. Intra-org role separation simply did not exist
-- at the database, and the test suite could not have caught it: every
-- assertion in it ran as an owner. That gap is closed here too.
--
-- The shape, on every org-scoped table: any member of the org may read,
-- only owner and staff may write. That mirrors the app exactly, where
-- every write path already goes through requireRole(..., STAFF_ROLES).

-- Same SECURITY DEFINER pattern, and for the same reason, as
-- _member_org_ids(): querying org_members from inside a policy that
-- org_members' own policy also guards recurses forever. See the long
-- comment in migrations/0001_core_schema.sql.
create or replace function _staff_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'staff') $$;

-- Every org-scoped table with a non-null org_id column, converted from
-- one `for all` policy into a read policy and three write policies.
--
-- Written as a loop rather than 36 hand-typed statements on purpose: the
-- failure this migration exists to fix is one table quietly not getting
-- the same treatment as the others, and a loop over an explicit list
-- cannot have that kind of typo in it.
do $$
declare
  t text;
  old_policy text;
  tables text[] := array[
    'athletes',
    'recruiting_targets',
    'target_communications',
    'contacts',
    'target_visits',
    'documents',
    'athlete_courses',
    'org_grading_scales'
  ];
begin
  foreach t in array tables loop
    -- The existing policies are named <table>_by_org, except documents
    -- which follows the same rule. Dropped by lookup rather than by
    -- assumed name so a rename does not silently leave a permissive
    -- policy in place next to the new restrictive ones.
    for old_policy in
      select policyname from pg_policies where schemaname = 'public' and tablename = t
    loop
      execute format('drop policy %I on %I', old_policy, t);
    end loop;

    execute format(
      'create policy %I on %I for select using (org_id in (select _member_org_ids()))',
      t || '_read', t);

    execute format(
      'create policy %I on %I for insert with check (org_id in (select _staff_org_ids()))',
      t || '_insert', t);

    -- USING decides which rows may be updated, WITH CHECK decides what
    -- they may be updated TO. Both are needed: USING alone would let a
    -- staff member move a row into another org by rewriting org_id.
    execute format(
      'create policy %I on %I for update using (org_id in (select _staff_org_ids())) with check (org_id in (select _staff_org_ids()))',
      t || '_update', t);

    execute format(
      'create policy %I on %I for delete using (org_id in (select _staff_org_ids()))',
      t || '_delete', t);
  end loop;
end $$;

-- benchmark_sets is the exception, because its org_id is nullable: a
-- null row is the shared default every org reads. The old policy was
-- `for all using (org_id is null or org_id in (...))`, which made that
-- shared row writable by any member of any org. Read stays open to
-- everyone; writes are staff, and never to the shared row.
drop policy if exists benchmark_sets_by_org on benchmark_sets;

create policy benchmark_sets_read on benchmark_sets for select
  using (org_id is null or org_id in (select _member_org_ids()));

create policy benchmark_sets_insert on benchmark_sets for insert
  with check (org_id in (select _staff_org_ids()));

create policy benchmark_sets_update on benchmark_sets for update
  using (org_id in (select _staff_org_ids()))
  with check (org_id in (select _staff_org_ids()));

create policy benchmark_sets_delete on benchmark_sets for delete
  using (org_id in (select _staff_org_ids()));
