-- BRANCH ONLY (kqvxkqqyojnnvkfkevhe). Synthetic data, roles only. No production data.
-- Run AFTER batch 6, and AFTER creating three users in the branch dashboard
-- (Authentication, Add user, tick Auto Confirm User):
--   stg-master@example.test   (the master account, an owner)
--   stg-admin@example.test    (a second owner, NOT the master)
--   stg-athlete@example.test  (the Athlete login)
-- Use a different strong password for each; do not reuse a real one.
-- Paste, run once. The last grid prints ORG_ID and ASSIGNMENT_ID for the script.

do $$
declare
  m uuid := (select id from auth.users where email = 'stg-master@example.test');
  a uuid := (select id from auth.users where email = 'stg-admin@example.test');
  f uuid := (select id from auth.users where email = 'stg-athlete@example.test');
  o uuid := '5c5c0000-0000-0000-0000-000000000001';
  ath uuid := 'b0000000-0000-0000-0000-00000000000a';
begin
  if m is null or a is null or f is null then
    raise exception 'Create the three dashboard users first (master, admin, athlete). Missing: master=%, admin=%, athlete=%', m, a, f;
  end if;
  insert into public.orgs (id, name, slug) values (o, 'Staging Test Org', 'staging-test-org');
  insert into public.org_members (user_id, org_id, role) values (m, o, 'owner'), (a, o, 'owner'), (f, o, 'family');
  update public.orgs set master_user_id = m where id = o;
  insert into public.athletes (id, org_id, name, sport, advisor_id) values (ath, o, 'STAGING Athlete A', 'baseball', m);
  insert into public.athlete_guardians (org_id, athlete_id, user_id) values (o, ath, f);
  insert into public.assignments (id, org_id, athlete_id, title, kind)
    values ('e1000000-0000-0000-0000-00000000000a', o, ath, 'STAGING upload assignment', 'upload');
end $$;

select o.id as "ORG_ID", asg.id as "ASSIGNMENT_ID", o.master_user_id is not null as master_set,
       (select count(*) from public.org_members where org_id = o.id) as members_3
from public.orgs o join public.assignments asg on asg.org_id = o.id
where o.id = '5c5c0000-0000-0000-0000-000000000001';
