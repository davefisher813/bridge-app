-- A sixth document type: a metrics report. A PBR or Perfect Game
-- profile, a Premier report, a showcase results sheet, a screenshot of
-- a Rapsodo or TrackMan dashboard. Doc AI reads the numbers off it into
-- the athlete's metrics log with the date and the source that sets
-- their trust (docs/MATCHING_CONTRACT.md section 1), so the log fills
-- from the paper Dave already has instead of being typed twice.
--
-- On its own, because Postgres refuses to use a new enum value in the
-- transaction that added it.
alter type doc_category add value if not exists 'metrics';
