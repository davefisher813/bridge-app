-- Undo 0069. The enum value stays (Postgres cannot drop one; an unused
-- one is harmless).
alter table documents drop column if exists title;
