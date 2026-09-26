-- schools.location, recorded.
--
-- Added in production on 2026-09-26 by SQL run outside this migration
-- history, alongside college_coaches (0036). It holds the sheet's
-- "City, ST" text. The app reads state, not location; state is filled
-- from location's two-letter suffix when the data is normalized.

alter table public.schools add column if not exists location text;
