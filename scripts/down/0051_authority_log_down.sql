-- Down for 0051. Postgres cannot drop an enum value, so the six actions
-- stay (unused values are harmless). The subject check narrows back only
-- if no row uses the new kinds; otherwise it refuses, and nothing is lost.
alter table activity_log drop constraint if exists activity_log_subject_type_check;
alter table activity_log add constraint activity_log_subject_type_check
  check (subject_type in ('athlete', 'target', 'assignment', 'document', 'checkin', 'message', 'member', 'view_as'));
