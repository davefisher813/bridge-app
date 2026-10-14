-- Undo 0071. Postgres cannot drop an enum value; an unused
-- assignment_deleted, assignment_reassigned or assignment_due_changed is
-- harmless. Rows already deleted stay deleted.
drop policy if exists assignments_delete on assignments;

create or replace function private.assignment_is_honest() returns trigger
  language plpgsql
  set search_path = public
  as $$
declare
  session_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if session_uid is not null then
      new.created_by := session_uid;
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if (new.created_by is not null and new.created_by is distinct from old.created_by)
     or new.created_at is distinct from old.created_at
     or new.athlete_id is distinct from old.athlete_id
     or new.org_id is distinct from old.org_id then
    raise exception 'assignments: a row keeps its author, its creation time, its athlete and its org'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
