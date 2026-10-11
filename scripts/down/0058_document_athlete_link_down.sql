-- Undo 0058. The document_linked activity action stays: Postgres cannot
-- drop an enum value, and an unused one is harmless.
drop trigger if exists documents_link_coherent on documents;
drop function if exists private.documents_link_is_coherent();
drop index if exists documents_linked_athlete_idx;
alter table documents drop column if exists linked_athlete_id;
