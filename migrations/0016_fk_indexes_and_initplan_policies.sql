-- Two findings from Supabase's performance advisor, read off the live
-- project on 2026-09-19, the first day a real database existed.
--
-- 1. Nineteen foreign keys with no covering index. Every org-scoped
--    table filters by org_id on every page load AND in every RLS policy,
--    and most of those org_id columns had nothing behind them. On two
--    orgs and zero athletes it does not matter. The day Bridge's real
--    roster is in here it turns every screen into a sequential scan of
--    every table, twice: once for the query and once for the policy.
--
--    src/laws/schemaLaws.test.ts now checks that every column declared
--    with `references` is the leading column of some index, so a table
--    added later cannot quietly ship without one.
--
-- 2. Seven policies call auth.uid() or auth.role() bare, which Postgres
--    re-evaluates for every row it considers. Wrapped in a subselect it
--    is evaluated once per statement as an initplan. Same policies, same
--    semantics, one call instead of one per row. The org-scoped policies
--    were already in this shape because they go through
--    private._member_org_ids(), which is itself a subselect.
--
-- Nothing here changes what any user can see or do. The RLS suite
-- (scripts/rls_test.sql) runs unchanged against this migration to prove
-- that.

-- ── Indexes ──────────────────────────────────────────────────────────

create index if not exists athletes_org_idx on athletes (org_id);
create index if not exists recruiting_targets_org_idx on recruiting_targets (org_id);
create index if not exists recruiting_targets_school_idx on recruiting_targets (school_id);
create index if not exists org_members_org_idx on org_members (org_id);
create index if not exists benchmark_sets_org_idx on benchmark_sets (org_id);
create index if not exists target_communications_org_idx on target_communications (org_id);
create index if not exists target_visits_org_idx on target_visits (org_id);
create index if not exists contacts_org_idx on contacts (org_id);
create index if not exists contacts_school_idx on contacts (school_id);
create index if not exists documents_applied_by_idx on documents (applied_by);
create index if not exists athlete_courses_duplicate_of_idx on athlete_courses (duplicate_of);
create index if not exists org_grading_scales_entered_by_idx on org_grading_scales (entered_by);
create index if not exists org_approved_course_lists_entered_by_idx on org_approved_course_lists (entered_by);
create index if not exists donors_steward_idx on donors (steward_user_id);
create index if not exists grants_donor_idx on grants (donor_id);
create index if not exists grants_campaign_idx on grants (campaign_id);
create index if not exists pledges_campaign_idx on pledges (campaign_id);
create index if not exists gifts_grant_idx on gifts (grant_id);
create index if not exists board_members_user_idx on board_members (user_id);

-- ── Policies: one auth call per statement, not per row ───────────────
--
-- Dropped and recreated by name rather than altered, because Postgres
-- has no `alter policy ... using` that keeps the command type, and the
-- names are the ones the migrations that created them chose.

drop policy if exists users_self on users;
create policy users_self on users for select
  using (id = (select auth.uid()));

drop policy if exists org_members_self on org_members;
create policy org_members_self on org_members for select
  using (user_id = (select auth.uid()) or org_id in (select private._member_org_ids()));

drop policy if exists schools_read on schools;
create policy schools_read on schools for select
  using ((select auth.role()) = 'authenticated');

drop policy if exists transfer_windows_read on transfer_windows;
create policy transfer_windows_read on transfer_windows for select
  using ((select auth.role()) = 'authenticated');

drop policy if exists grading_scales_readable on high_school_grading_scales;
create policy grading_scales_readable on high_school_grading_scales for select
  using ((select auth.uid()) is not null);

drop policy if exists ncaa_approved_course_lists_read on ncaa_approved_course_lists;
create policy ncaa_approved_course_lists_read on ncaa_approved_course_lists for select
  using ((select auth.role()) = 'authenticated');

drop policy if exists ncaa_approved_courses_read on ncaa_approved_courses;
create policy ncaa_approved_courses_read on ncaa_approved_courses for select
  using ((select auth.role()) = 'authenticated');
