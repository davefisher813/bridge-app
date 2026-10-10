-- 0053: a reading made up by the stand-in can never be applied (backend
-- audit F-01, critical, 2026-10-06).
--
-- Until now the rule lived in the app (applyGate in
-- src/lib/actions/documents.ts): every apply path asks it first. That is
-- convention, not construction; a new write path that forgot to ask
-- could put invented data onto a real athlete's record. The database now
-- refuses it: a document whose read_by is 'stub' cannot become 'applied',
-- on insert or update, from any client, service role included.
-- read_by = 'stub' is already permanent (migration 0040), so the two
-- together close the gap. Additive: one function, one trigger.

create or replace function private.stub_reading_never_applied() returns trigger
  language plpgsql
  set search_path = public
  as $$
begin
  if new.status = 'applied' and new.read_by = 'stub'
     and (tg_op = 'INSERT' or old.status is distinct from 'applied') then
    raise exception 'documents: a reading made by the stand-in cannot be applied to an athlete'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger documents_stub_never_applied
  before insert or update of status, read_by on documents
  for each row execute function private.stub_reading_never_applied();
