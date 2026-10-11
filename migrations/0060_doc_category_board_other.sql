-- 0060: every document is read (Dave, Oct 11). Board Document and Other
-- become reading types (a reading for a person, never applied to an
-- athlete), and a document nobody typed is read as Other. Two enum
-- values, the 0028 pattern. Rows filed as either before keep that
-- filed_as and are read as the type of the same name.

alter type doc_category add value if not exists 'board_document';
alter type doc_category add value if not exists 'other';
