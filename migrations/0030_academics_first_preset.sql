-- A fourth scoring preset, Academics First (50 / 30 / 20), the mirror
-- of Baseball First. Dave, 2026-09-21: "This should have academics
-- first as well." The check constraint from 0021 listed the presets by
-- name, so it is widened here; the weights live in
-- src/lib/fit/contract.ts and docs/MATCHING_CONTRACT.md.

alter table orgs drop constraint if exists orgs_scoring_preset_check;
alter table orgs add constraint orgs_scoring_preset_check
  check (scoring_preset in ('money_first', 'academics_first', 'balanced', 'baseball_first'));
