-- Down for 0077. Puts back the Admin-wide read of 0017.
drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._member_org_ids() as org_id(org_id))
  );
drop function if exists private._can_read_document_object(text);
