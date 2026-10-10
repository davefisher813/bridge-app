-- 0051: the activity log records every authority change (Dave's standing
-- rule, 2026-10-06: every authority decision is a setting he can see,
-- change and undo in the app, and none happens silently).
--
-- Until now a Title, a board seat's sign-in, a donor's steward and the
-- org's own settings (modules, the Doc AI budget) changed without a line
-- in the log, so nobody could see who changed them or when. Six new
-- actions and three new subject kinds. Additive: enum values and a wider
-- check; no row changes.

alter type activity_action add value if not exists 'member_title_changed';
alter type activity_action add value if not exists 'seat_linked';
alter type activity_action add value if not exists 'seat_unlinked';
alter type activity_action add value if not exists 'steward_set';
alter type activity_action add value if not exists 'steward_cleared';
alter type activity_action add value if not exists 'settings_changed';

alter table activity_log drop constraint if exists activity_log_subject_type_check;
alter table activity_log add constraint activity_log_subject_type_check
  check (subject_type in ('athlete', 'target', 'assignment', 'document', 'checkin', 'message', 'member', 'view_as', 'seat', 'donor', 'org'));
