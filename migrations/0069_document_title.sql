-- 0069: a document's title, set by an Admin (data cleanup, 2026-10-13).
--
-- A file's name is part of the original file record, which never changes
-- (0048, documents_original_is_immutable). But a file named
-- "updated-cert-of-inc.pdf" that is really a rejection letter needs to
-- say what it is. So a document gains its own title, separate from the
-- file: shown in place of the file name wherever the document is listed,
-- with the file name still shown beside it. Null means no title yet, and
-- the file name stands in. The original record is untouched.

alter table documents add column if not exists title text
  check (title is null or (length(btrim(title)) between 1 and 200 and title = btrim(title)));

comment on column documents.title is
  'What the document is, set by an Admin; null shows the file name. The file name itself never changes (0048).';

alter type activity_action add value if not exists 'document_renamed';
