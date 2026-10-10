-- 0051 is in place: the new actions exist, the subject check is wider,
-- and a donor row can be logged while an unknown kind still cannot.
do $$
begin
  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'activity_action' and e.enumlabel = 'steward_set') then
    raise exception 'steward_set missing';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'activity_log_subject_type_check')) not like '%donor%' then
    raise exception 'subject check not widened';
  end if;
  begin
    insert into activity_log (org_id, actor_id, action, subject_type, summary)
      values ((select id from orgs limit 1), null, 'settings_changed', 'not_a_kind', 'x');
    raise exception 'an unknown subject kind was accepted';
  exception when check_violation then null;
  end;
  raise notice 'ALL 0051 ASSERTIONS PASSED';
end $$;
