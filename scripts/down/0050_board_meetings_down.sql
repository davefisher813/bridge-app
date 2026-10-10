-- Reverses 0050. Drops the meetings and their links; no document is touched.
drop table if exists board_meeting_documents;
drop table if exists board_meetings;
drop function if exists private.board_meeting_documents_same_org();
drop function if exists private.board_meetings_board_same_org();
