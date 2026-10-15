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
