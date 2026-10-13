-- 0065: the family clause comes off the read policies of documents,
-- recruiting_targets and target_visits (role audit, 2026-10-13). Part
-- two of 0063, which added the functions an Athlete login now reads
-- through; see 0063 for why. Applied after the app that uses those
-- functions is live, so no Athlete screen goes blank in between.

-- ── The policies: staff only ───────────────────────────────────────────
drop policy if exists documents_read on documents;
create policy documents_read on documents for select
  using (org_id in (select private._member_org_ids()));

drop policy if exists recruiting_targets_read on recruiting_targets;
create policy recruiting_targets_read on recruiting_targets for select
  using (org_id in (select private._member_org_ids()));

drop policy if exists target_visits_read on target_visits;
create policy target_visits_read on target_visits for select
  using (org_id in (select private._member_org_ids()));
