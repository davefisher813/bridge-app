-- Down for 0075. Removes the remembered pre-refresh suggestion; the
-- current suggestions stay as they are.
alter table documents drop column if exists suggestion_before;
