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
