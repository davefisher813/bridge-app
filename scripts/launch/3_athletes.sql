-- Decision 3: Ricky Perez and Frailyn Capellan join Bridge. Name, sport and
-- status only; everything else is entered on their profiles in the app.
-- Run only on Dave's yes.
begin;
do $$
declare
  bridge constant uuid := '25eb1763-fe05-450f-ad41-cbf79215c316';
  who text;
  new_id uuid;
begin
  foreach who in array array['Ricky Perez', 'Frailyn Capellan'] loop
    if exists (select 1 from public.athletes where org_id = bridge and lower(name) = lower(who) and deleted_at is null) then
      raise exception '% is already on the Bridge roster', who;
    end if;
    insert into public.athletes (org_id, recruit_type, name, sport, status, detail)
      values (bridge, 'hs', who, 'Baseball', 'Active', '{"kind":"hs"}')
      returning id into new_id;
    insert into public.activity_log (org_id, athlete_id, actor_id, action, subject_type, subject_id, summary)
      values (bridge, new_id, null, 'athlete_created', 'athlete', new_id, 'Added ' || who);
  end loop;
end $$;
commit;

select name, status, sport, created_at from public.athletes
where org_id = '25eb1763-fe05-450f-ad41-cbf79215c316' and name in ('Ricky Perez', 'Frailyn Capellan');
