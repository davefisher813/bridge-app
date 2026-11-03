-- 0077: a file of an athlete is readable only by that athlete, his advisor
-- and the org's master account (Dave's ruling, Punch 85).
--
-- documents_bucket_read let every Admin of the org read every object in
-- the documents bucket. Now the read is decided per object:
--   - the org's master account reads everything in its org;
--   - an Athlete login reads the files of its own athletes
--     (private._family_athlete_ids, the guardian link);
--   - an athlete's advisor (athletes.advisor_id) reads that athlete's files;
--   - a file that belongs to no athlete (board and org documents, strays)
--     stays readable by the org's Admins, as before. Who may read board
--     documents is a separate question held for Dave and is not changed here.
-- A file belongs to an athlete when a documents row lists the object in
-- storage_paths and carries athlete_id, linked_athlete_id or
-- subject_athlete_id. View-as keeps working: every check uses
-- private._effective_uid() and private._view_org().
-- Down: scripts/down/0077_athlete_files_narrow_read_down.sql.

create or replace function private._can_read_document_object(obj text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  with me as (select private._effective_uid() as uid, private._view_org() as vorg),
  docs as (
    select coalesce(d.athlete_id, d.linked_athlete_id, d.subject_athlete_id) as aid
    from public.documents d
    where obj = any (d.storage_paths)
      and d.org_id::text = (storage.foldername(obj))[1]
  )
  select
    exists (
      select 1 from public.orgs o, me
      where o.id::text = (storage.foldername(obj))[1]
        and o.master_user_id = me.uid
        and coalesce(me.vorg, o.id) = o.id
    )
    or exists (
      select 1 from docs, me
      where docs.aid is not null
        and (
          docs.aid in (select private._family_athlete_ids())
          or exists (
            select 1 from public.athletes a
            where a.id = docs.aid
              and a.org_id::text = (storage.foldername(obj))[1]
              and a.advisor_id = me.uid
          )
        )
    )
    or (
      (storage.foldername(obj))[1] in (select o.org_id::text from private._member_org_ids() as o(org_id))
      and not exists (select 1 from docs where docs.aid is not null)
    )
$$;

grant execute on function private._can_read_document_object(text) to public;

drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select
  using (
    bucket_id = 'documents'
    and private._can_read_document_object(name)
  );
