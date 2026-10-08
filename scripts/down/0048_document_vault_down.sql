-- Reverses migrations/0048_document_vault.sql. Not applied anywhere by
-- hand: scripts/run_rls_test.sh applies it to the throwaway test
-- database, then applies 0048 again, to prove the migration is
-- reversible. Document rows and files are untouched; only the new
-- columns, guards and policies go.
--
-- The five activity_action values cannot be dropped from an enum and are
-- left, unused.

drop trigger if exists documents_lifecycle_transition on documents;
drop trigger if exists documents_original_is_immutable on documents;
drop trigger if exists documents_insert_guard on documents;
drop function if exists private.documents_lifecycle_transition();
drop function if exists private.documents_original_is_immutable();
drop function if exists private.documents_insert_guard();

drop policy if exists documents_bucket_family_insert on storage.objects;
create policy documents_bucket_family_insert on storage.objects
  for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id(org_id))
    and (storage.foldername(name))[2] = 'family'
    and array_length(storage.foldername(name), 1) = 3
  );

create policy documents_delete on documents
  for delete using (org_id in (select private._staff_org_ids()));
create policy documents_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._staff_org_ids() as org_id(org_id))
  );
grant delete on documents to anon, authenticated;

update storage.buckets
set allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
where id = 'documents';

drop index if exists documents_org_lifecycle_idx;
alter table documents drop constraint if exists documents_format_check;
alter table documents
  drop column if exists original_paths,
  drop column if exists review_reason,
  drop column if exists uploaded_by,
  drop column if exists format,
  drop column if exists lifecycle_changed_at,
  drop column if exists lifecycle;
drop type if exists doc_lifecycle;
