-- BRANCH ONLY (kqvxkqqyojnnvkfkevhe). Never run this in the production SQL editor.
-- Batch 5 of 7: 0075 to 0077. Paste all of it, run once, read the last result grid.


-- ======== 0075_document_suggestion_before.sql ========
-- 0075: remember a document's suggestion from before it was last
-- refreshed, so a bulk Suggest can be undone in one action.
--
-- Suggest Who and What overwrites the suggestion columns (0073). The new
-- column holds what they said just before: the six suggestion fields and
-- the id of the run that replaced them (null for a single Suggest Again).
-- Undo puts those fields back for exactly the documents that run
-- touched. Additive: no row is changed by this migration, and the
-- immutability trigger of 0048 does not cover the column.
-- A matching down script is scripts/down/0075_document_suggestion_before_down.sql.

alter table documents
  add column suggestion_before jsonb;

comment on column documents.suggestion_before is
  'The suggestion this document had before its last refresh: type, confidence, reasons, identity status, candidates, suggested_at, plus run (the id of the bulk run that replaced it, or null). Written by the app with the refresh; read by Undo.';


-- ======== 0076_close_open_documents_read.sql ========
-- 0076: close a storage read policy that existed only in production.
--
-- Found 2026-10-31 while reading the bucket's policies for Punch 85 (an
-- athlete's data is visible only to the athlete, his advisor and Dave).
-- Production held a policy, documents_read_own, on storage.objects:
--   for select to authenticated using (bucket_id = 'documents')
-- It is in no migration and no document of ours, and it names no
-- organization, owner or athlete, so any signed-in account (an Athlete
-- login, a Viewer, anybody holding a session) could read or list every
-- file in the documents bucket (167 objects) straight from the storage
-- API. Every read the app makes is covered by documents_bucket_read (an
-- Admin of the file's own organization), by the Admin client behind the
-- Athlete's own routes, or by the uploader's own session, so nothing
-- depends on it. Dropped, not replaced; Punch 85 narrows the Admin read
-- itself in the next migration.
-- A matching down script is scripts/down/0076_close_open_documents_read_down.sql.

drop policy if exists documents_read_own on storage.objects;


-- ======== 0077_athlete_files_narrow_read.sql ========
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


-- CHECK 5: expect policies_removed = 0 (0076 dropped it), read_fn = 1, bucket_read = 1
select (select count(*) from pg_policies where schemaname='storage' and policyname='documents_read_own') as policies_removed,
       (select count(*) from pg_proc where proname='_can_read_document_object') as read_fn,
       (select count(*) from pg_policies where schemaname='storage' and policyname='documents_bucket_read') as bucket_read;
