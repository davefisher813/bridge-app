-- Two things a second pass over Doc AI found.
--
-- 1. The same file uploaded twice (a parent re-sending the PDF, a
--    coordinator tapping twice) was read twice, charged twice and, for
--    a metrics report, logged twice. The bytes are hashed on the way
--    in and a document with the same hash in the same org that is not
--    discarded is refused with a pointer to the first one.
--
-- 2. A scanner's PDF at 300dpi is one to two megabytes a page, so a
--    four page transcript did not fit the 4MB cap. The cap is 10MB
--    here and in src/lib/docai/limits.ts, still well under what the
--    model takes (32MB) and what a function can hold in memory.

alter table documents add column if not exists content_hash text;

comment on column documents.content_hash is
  'SHA-256 of the uploaded bytes (every file of the upload, in order), hex. Set by processDocument before the reading starts, so a re-upload of the same file is refused rather than read and charged again.';

create index if not exists documents_org_hash_idx on documents(org_id, content_hash);

update storage.buckets set file_size_limit = 10485760 where id = 'documents';
