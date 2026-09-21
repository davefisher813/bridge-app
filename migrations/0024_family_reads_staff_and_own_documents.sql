-- Two more reads for the family role, from Dave's picks in the Family
-- Access catalog (2026-09-21).
--
-- 1. "Who to ask": the More screen lists the org's owner and staff, with
--    their emails. Their profiles were already readable (0023), but the
--    org_members rows that say WHO is staff were not: org_members_self
--    shows a family member only their own row. So the row of an owner or
--    staff member of the family's org is readable too. Never another
--    family's row, and never a member's.
--
-- 2. "Their own files, read only": a document bound to the family's
--    athlete is readable. The file itself stays behind the storage
--    policies (staff only); what a family sees is the row: the name,
--    what it was read as, and whether it was applied.

drop policy if exists org_members_self on org_members;
create policy org_members_self on org_members for select
  using (
    user_id = (select auth.uid())
    or org_id in (select private._member_org_ids())
    or (org_id in (select private._family_org_ids()) and user_id in (select private._family_staff_ids()))
  );

drop policy if exists documents_read on documents;
create policy documents_read on documents for select
  using (org_id in (select private._member_org_ids()) or athlete_id in (select private._family_athlete_ids()));
