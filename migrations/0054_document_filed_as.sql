-- 0054: types for documents the reader does not read (Alfred, 2026-10-10:
-- 13 of the 16 prepared files had no fitting type; board documents and
-- athlete profiles went up as No Type).
--
-- The six reader types (doc_category) each have a reading schema and a
-- place their fields land on an athlete; a board's bylaws or an athlete's
-- profile sheet has neither. So they are not new reader categories: a
-- document is filed as one of these, stored as it is, never read, and the
-- type shows wherever the document does. A document the reader read keeps
-- its reader category and no filed_as. Additive: one nullable column.

alter table documents add column filed_as text
  check (filed_as is null or filed_as in ('board_document', 'athlete_profile', 'other'));

comment on column documents.filed_as is
  'A type for a document the reader does not read: board_document, athlete_profile or other. Set on upload or later on the document screen. Never read by the AI.';
