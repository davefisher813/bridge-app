-- Net cost on a stored match.
--
-- Stage 5, Phase 1 (Dave approved the plan 2026-09-27). The Matches
-- screen sorts by Net Cost, and docs/MATCHING_CONTRACT.md says a screen
-- reads rows and never scores, so the number the engine already works
-- out in the financial dimension is stored on the row instead of living
-- only inside a reason sentence.
--
-- One nullable integer: whole dollars a year, the cost of attendance for
-- this athlete less the aid they could expect, or the award letter's
-- number when one is applied. Null when the school carries no cost.
-- Written by the app's recompute (src/lib/data/fits.ts) under the
-- existing staff write policies; read under the existing read policy,
-- which is the athlete's org for an Admin and the athlete's own family
-- login. A Viewer reads no fit row today and none after this.
--
-- The engine version is bumped in the same change, so every row is
-- recomputed on the next Recalculate All and the column fills itself.
-- No rows are written here. Safe to run twice.

alter table athlete_school_fits add column if not exists net_cost integer;

comment on column athlete_school_fits.net_cost is 'Estimated net cost a year in whole dollars for this athlete at this school, after likely aid or an applied award letter. Null when the school has no cost on file. Written by the fit recompute.';
