-- Two holes in the family role's row rules, found by review on
-- 2026-09-21, the day it shipped.
--
-- 1. A guardian link outlived the membership. private._family_athlete_ids()
--    read athlete_guardians alone, so a parent removed from the org (the
--    org_members row deleted, the guardian row not) could still read
--    the athlete through the API with their old account. The helper now
--    honours a link only while a family membership in the same org
--    exists. removeMember deletes the links too; this is the guarantee
--    underneath it.
--
-- 2. The family clause on org_members_self checked the org and the
--    person as two independent lists. Somebody who is family in two
--    orgs could read a plain member's row in one org because that
--    person is staff in the other. The clause now matches (org_id,
--    user_id) pairs from one query.

create or replace function private._family_athlete_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select g.athlete_id
    from athlete_guardians g
    join org_members m on m.user_id = g.user_id and m.org_id = g.org_id and m.role = 'family'
    where g.user_id = auth.uid()
  $$;

-- The (org, person) pairs of every owner and staff member in the orgs
-- the caller is family in. A pair, so a person's role in one org never
-- opens their row in another.
create or replace function private._family_staff_rows() returns table (org_id uuid, user_id uuid)
  language sql stable security definer
  set search_path = public
  as $$
    select m.org_id, m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (select org_id from org_members where user_id = auth.uid() and role = 'family')
  $$;

grant execute on function private._family_staff_rows() to public;

drop policy if exists org_members_self on org_members;
create policy org_members_self on org_members for select
  using (
    user_id = (select auth.uid())
    or org_id in (select private._member_org_ids())
    or (org_id, user_id) in (select r.org_id, r.user_id from private._family_staff_rows() r)
  );
