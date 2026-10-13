-- Undo 0066: the function goes, the family folder policy goes back to
-- 0048's, and the note column goes (with any notes sent; the documents
-- themselves stay).
drop function if exists public.family_send_document(uuid, text, int, text, text, text, text, text, text);
drop function if exists private.log_family_document_sent(uuid);

drop policy if exists documents_bucket_family_insert on storage.objects;
create policy documents_bucket_family_insert on storage.objects
  for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id(org_id))
    and (storage.foldername(name))[2] = 'family'
    and array_length(storage.foldername(name), 1) = 3
    and lower(name) ~ '\.(pdf|jpe?g|png)$'
  );

alter table documents drop column if exists family_note;
