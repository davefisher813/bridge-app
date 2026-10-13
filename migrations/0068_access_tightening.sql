-- 0068: access tightening (second access sweep, 2026-10-13).
--
-- An Athlete login's uploads go to <org>/family/<folder>/<file> in the
-- documents bucket (0046, 0048). The folder could be any name at all, so
-- a family login could write as many loose objects as it liked under its
-- org's family folder, tied to nothing (orphans that only cost storage
-- and that nobody would ever see). The folder now has to be one the
-- caller can account for:
--
--   - the id of an assignment of one of the caller's own athletes (the
--     assignment upload, AssignmentSubmitForm), or
--   - the id of one of the caller's own athletes (the family "send a
--     document" path, which writes under <org>/family/<athlete id>/).
--
-- "Own" is private._family_athlete_ids() (0026): a guardian link that
-- holds only while the family membership lives. The org of the folder
-- must be the assignment's or the athlete's own org, so a login that is
-- family in two orgs cannot file one org's id under the other's folder.
-- A removed athlete opens no folder. Everything else 0048 required stays:
-- the family role in that org, the literal 'family' folder, exactly one
-- folder below it, and a PDF, JPG or PNG name.
--
-- No data rows, no org named, no id literal (src/laws/migrationLaws.test.ts).

-- The (org, folder) pairs the caller may upload into. Security definer
-- so the storage policy does not depend on the caller's read policies on
-- assignments and athletes; it returns only the caller's own.
create or replace function private._family_upload_folders()
returns table (org_id uuid, folder text)
language sql stable security definer
set search_path = ''
as $$
  select a.org_id, a.id::text
  from public.assignments a
  join public.athletes t on t.id = a.athlete_id and t.org_id = a.org_id
  where a.athlete_id in (select private._family_athlete_ids())
    and t.deleted_at is null
  union
  select t.org_id, t.id::text
  from public.athletes t
  where t.id in (select private._family_athlete_ids())
    and t.deleted_at is null
$$;

-- Stated rather than assumed, as for every private helper (0015, 0023):
-- the schema is not exposed, and the function answers only for the
-- caller.
grant execute on function private._family_upload_folders() to public;

drop policy if exists documents_bucket_family_insert on storage.objects;
create policy documents_bucket_family_insert on storage.objects
  for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id(org_id))
    and (storage.foldername(name))[2] = 'family'
    and array_length(storage.foldername(name), 1) = 3
    and lower(name) ~ '\.(pdf|jpe?g|png)$'
    and exists (
      select 1 from private._family_upload_folders() f
      where f.org_id::text = (storage.foldername(name))[1]
        and f.folder = (storage.foldername(name))[3]
    )
  );
