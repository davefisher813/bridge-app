-- Make discarding an applied document actually undo it.
--
-- The gap, recorded in docs/ROADMAP.md on 2026-09-16: applying a
-- transcript writes course rows, a GPA, a gpa_verified flag, a date of
-- birth and sometimes a shared grading scale. `discardDocument` set a
-- status and left every one of those in place, and there was no path in
-- the app to remove them. So a document applied to the wrong athlete, or
-- read wrong, could be marked discarded while its data stayed on the
-- record permanently and looked exactly like data somebody typed in.
--
-- An undo needs to know two things, and neither can be recovered after
-- the fact: what the fields held BEFORE, and what this document wrote.
-- Both, because restoring blindly is its own bug. If someone corrected
-- the GPA by hand after the apply, the undo must leave their correction
-- alone rather than reverting to a value from before the document
-- existed. So each field is restored only when its current value still
-- matches what this document put there.

alter table documents add column applied_changes jsonb;

comment on column documents.applied_changes is
  'What applying this document changed, recorded so it can be undone. Shape: { athleteId, athleteFields: { <column>: { before, after } }, gradingScaleId }. Written by applyExtractionToAthlete, consumed by discardDocument. Course rows are not listed here: they carry document_id and are found by query.';

-- What the undo actually did, in plain language, kept on the row so the
-- screen can still say it after a reload. A discard is not always a
-- clean reversal: course rows from an earlier transcript for the same
-- school were already replaced and are gone, a field corrected by hand
-- since the apply is deliberately left alone, and a grading scale
-- somebody has confirmed is not this document's to delete. All of that
-- has to be visible, not just computed and thrown away.
alter table documents add column undo_note text;
