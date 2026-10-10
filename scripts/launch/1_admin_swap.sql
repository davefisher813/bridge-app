-- Decision 1: dave@bffsa.org becomes Bridge's Admin; davefisher813@gmail.com
-- leaves Bridge. Run only on Dave's yes. Elite Squad memberships untouched.
begin;
do $$
declare
  bridge  constant uuid := '25eb1763-fe05-450f-ad41-cbf79215c316';
  keep    constant uuid := 'c47ea52f-6805-47c0-8703-9ed71fa39a74'; -- dave@bffsa.org
  leaving constant uuid := '67a129b2-c846-4de4-ab11-3cdfc5265b84'; -- davefisher813@gmail.com
begin
  if (select email from public.users where id = keep) <> 'dave@bffsa.org' then raise exception 'keep id is not dave@bffsa.org'; end if;
  if (select email from public.users where id = leaving) <> 'davefisher813@gmail.com' then raise exception 'leaving id is not davefisher813@gmail.com'; end if;
  insert into public.org_members (user_id, org_id, role) values (keep, bridge, 'owner')
    on conflict do nothing;
  if not exists (select 1 from public.org_members where user_id = keep and org_id = bridge and role = 'owner') then
    raise exception 'dave@bffsa.org is not an owner of Bridge after the insert; nothing removed';
  end if;
  -- Anything still pointing at the leaving account on Bridge would be stranded.
  if exists (select 1 from public.athletes where org_id = bridge and advisor_id = leaving) then
    raise exception 'davefisher813@gmail.com is still an advisor on a Bridge athlete';
  end if;
  delete from public.org_members where user_id = leaving and org_id = bridge;
  if (select count(*) from public.org_members where org_id = bridge and role = 'owner') < 1 then
    raise exception 'Bridge would have no Admin';
  end if;
end $$;
commit;

select o.slug, u.email, m.role from public.org_members m
join public.orgs o on o.id = m.org_id join public.users u on u.id = m.user_id
order by 1, 2;
