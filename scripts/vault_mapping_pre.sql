-- Before migration 0048: one document of each OLD status, with a file
-- path, so the migration's backfill can be checked against the mapping
-- table in docs/PLAN_DOCAI_PIECE1.md. Run by scripts/run_rls_test.sh
-- right before 0048 is applied, and cleaned up by the post script.
\set ON_ERROR_STOP on
insert into orgs (id, name, slug) values ('00000000-0000-0000-0000-000000048099', 'Mapping Org', 'mapping-org');
insert into documents (id, org_id, file_name, file_size, media_type, source_role, status, failure_reason, storage_paths, content_hash) values
  ('00000000-0000-0000-0000-0000000480b1', '00000000-0000-0000-0000-000000048099', 'old-processing.pdf', 10, 'application/pdf', 'coordinator', 'processing', null, array['00000000-0000-0000-0000-000000048099/r/1-old-processing.pdf'], 'h1'),
  ('00000000-0000-0000-0000-0000000480b2', '00000000-0000-0000-0000-000000048099', 'old-pending.pdf', 10, 'application/pdf', 'coordinator', 'pending', null, array['00000000-0000-0000-0000-000000048099/r/1-old-pending.pdf'], 'h2'),
  ('00000000-0000-0000-0000-0000000480b3', '00000000-0000-0000-0000-000000048099', 'old-applied.jpg', 10, 'image/jpeg', 'coordinator', 'applied', null, array['00000000-0000-0000-0000-000000048099/r/1-old-applied.jpg'], 'h3'),
  ('00000000-0000-0000-0000-0000000480b4', '00000000-0000-0000-0000-000000048099', 'old-discarded.png', 10, 'image/png', 'coordinator', 'discarded', null, array['00000000-0000-0000-0000-000000048099/r/1-old-discarded.png'], 'h4'),
  ('00000000-0000-0000-0000-0000000480b5', '00000000-0000-0000-0000-000000048099', 'old-failed.pdf', 10, 'application/pdf', 'coordinator', 'failed', 'Could not tell what this document is.', array['00000000-0000-0000-0000-000000048099/r/1-old-failed.pdf'], 'h5'),
  ('00000000-0000-0000-0000-0000000480b6', '00000000-0000-0000-0000-000000048099', 'old-filed.gif', 10, 'image/gif', 'parent', 'filed', null, array['00000000-0000-0000-0000-000000048099/family/x/old-filed.gif'], 'h6');
