-- 0059: Athlete Profile is a reading type (Oct 11 live test: six profile
-- sheets were filed as a type the reader never read, and Read Again
-- stayed off on every one). One enum value, the 0028 pattern. Rows
-- filed as athlete_profile before this keep that filed_as; the app reads
-- them as this type and moves them over when they are read.

alter type doc_category add value if not exists 'athlete_profile';
