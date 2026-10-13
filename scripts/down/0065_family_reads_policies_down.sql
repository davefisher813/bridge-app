-- Undo 0065: the family reads whole rows again, as 0023 and 0024 had it.
drop policy if exists documents_read on documents;
create policy documents_read on documents for select
  using (org_id in (select private._member_org_ids()) or athlete_id in (select private._family_athlete_ids()));

drop policy if exists recruiting_targets_read on recruiting_targets;
create policy recruiting_targets_read on recruiting_targets for select
  using (org_id in (select private._member_org_ids()) or athlete_id in (select private._family_athlete_ids()));

drop policy if exists target_visits_read on target_visits;
create policy target_visits_read on target_visits for select
  using (
    org_id in (select private._member_org_ids())
    or target_id in (select id from recruiting_targets where athlete_id in (select private._family_athlete_ids()))
  );
