-- Bulk actions on the Assignments list (Dave, 2026-10-13: "dozens of
-- student athletes; one-at-a-time actions are too slow"; bulk delete
-- explicitly required). Three changes, all additive or narrowing-by-one:
--
-- 1. An Admin may delete an assignment of their org. 0046 deliberately
--    gave nobody a delete policy ("Nothing is deleted through the app");
--    Dave now requires it. Keyed exactly like the update policy: staff
--    of the row's org, nobody else. A Viewer (member), another athlete's
--    login, another org and a signed-out caller delete nothing. Cancel
--    stays the soft alternative and is untouched.
-- 2. The honesty trigger from 0046 pinned athlete_id for the life of a
--    row. Reassign needs it to move, but only while the row has no
--    history on the family's side: status assigned or needs_revision and
--    no linked document. A submitted, completed or cancelled row, or one
--    carrying a file, still cannot move. The org still cannot change,
--    and the author, creation time and org checks are unchanged. The
--    coherence triggers keep the new athlete in the row's org.
-- 3. Three activity actions so the log can say what a bulk action did,
--    one line per row: assignment_deleted, assignment_reassigned and
--    assignment_due_changed (names and kinds only, as every assignment
--    line).
--
-- No data rows, no org named, no id literal (src/laws/migrationLaws.test.ts).

alter type activity_action add value if not exists 'assignment_deleted';
alter type activity_action add value if not exists 'assignment_reassigned';
alter type activity_action add value if not exists 'assignment_due_changed';

create policy assignments_delete on assignments for delete
  using (org_id in (select private._staff_org_ids()));

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
     or new.org_id is distinct from old.org_id then
    raise exception 'assignments: a row keeps its author, its creation time and its org'
      using errcode = 'check_violation';
  end if;
  -- Reassign: only a row nothing has happened to on the family's side.
  if new.athlete_id is distinct from old.athlete_id
     and (old.status not in ('assigned', 'needs_revision') or old.document_id is not null or new.document_id is not null) then
    raise exception 'assignments: only an open row with no file can move to another athlete'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;
