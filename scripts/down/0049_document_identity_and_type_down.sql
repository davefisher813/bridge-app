-- Down for 0049. Removes the suggestion and confirmed-identity columns.
-- The two activity_action values stay (Postgres cannot drop an enum
-- value); nothing writes them once the code is gone.
drop trigger if exists documents_subject_is_coherent on documents;
drop function if exists private.document_subject_is_coherent();
drop index if exists documents_subject_athlete_idx;
drop index if exists documents_identity_confirmed_by_idx;
alter table documents
  drop constraint if exists documents_suggested_type_confidence_check,
  drop constraint if exists documents_identity_candidates_is_array,
  drop column if exists suggested_type,
  drop column if exists suggested_type_confidence,
  drop column if exists suggested_type_reasons,
  drop column if exists identity_status,
  drop column if exists identity_candidates,
  drop column if exists suggested_at,
  drop column if exists subject_athlete_id,
  drop column if exists identity_confirmed_by,
  drop column if exists identity_confirmed_at;
drop type if exists doc_identity_status;
