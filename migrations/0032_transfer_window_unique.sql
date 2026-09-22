-- One row per sport, division, season and label.
--
-- transfer_windows is shared reference data with no org to scope a
-- constraint to, and the entry form (an owner, under More, Reference)
-- checked for a duplicate in the action. An action check is a race and
-- a rule nothing enforces: two owners entering the same window at the
-- same moment both read nothing and both write. The same window twice
-- would double every timing answer src/lib/fit/transfer.ts gives for
-- that sport and division.
--
-- Sport is stored normalized (lower case) by the form, so the index
-- lowers it anyway rather than trusting that to hold.

create unique index if not exists transfer_windows_unique_idx
  on transfer_windows (lower(sport), division, season_year, window_label);
