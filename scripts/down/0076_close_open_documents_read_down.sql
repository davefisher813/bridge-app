-- Down for 0076. Puts back the open read policy exactly as production
-- had it. Only for a rollback test: it lets any signed-in account read
-- every file in the documents bucket.
drop policy if exists documents_read_own on storage.objects;
create policy documents_read_own on storage.objects for select to authenticated
  using (bucket_id = 'documents');
