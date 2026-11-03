-- OPTION B (NOT part of 0078; for Tony's decision). Tony's rule is that an
-- object with no document row is the master's alone. The proofs marked
-- BLOCKER show the cost: Supabase Storage inserts an object and returns the
-- row, and Postgres checks a returned row against the read policy. A
-- non-master Admin or an Athlete login uploading a file would be refused.
--
-- Option B keeps everything in 0078 and adds one thing to the storage read
-- policy: an object no document lists yet is also readable by the person
-- who uploaded it (owner or owner_id on the row itself). They already hold
-- the file; nothing of anyone else's opens. Once a document lists the
-- object, the document rule applies, and the uploader loses it if the file
-- belongs to an athlete they are not entitled to.
--
-- Apply after 0078. Down: re-create documents_bucket_read as in 0077.
create or replace function private._object_unlisted(obj text) returns boolean
  language sql stable security definer
  set search_path = ''
  as $$
    select not exists (select 1 from public.documents d where obj = any (d.storage_paths) or obj = any (d.original_paths))
  $$;
grant execute on function private._object_unlisted(text) to public;

drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select
  using (
    bucket_id = 'documents'
    and (
      private._can_read_document_object(name)
      or (auth.uid() is not null and (owner = auth.uid() or owner_id = auth.uid()::text) and private._object_unlisted(name))
    )
  );
