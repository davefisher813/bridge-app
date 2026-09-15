-- Adds athlete-level fields that src/lib/fit/types.ts's Athlete interface
-- has always declared (isInternational, toeflScore, ieltsScore,
-- f1VisaStatus, ncaaEligibilityStatus) but 0001_core_schema.sql never
-- created columns for. Caught building the data adapter between DB rows
-- and the fit engine's plain types for the recruiting board screen: the
-- adapter had nowhere to read these from.
--
-- These are universal scalars (true for every recruit_type, unlike the
-- HS-vs-transfer fields that correctly live in the type-varying `detail`
-- jsonb), so they get real columns, same reasoning as gpa/gpa_verified
-- already having real columns instead of living in detail.

alter table athletes
  add column is_international boolean not null default false,
  add column toefl_score smallint,
  add column ielts_score numeric(2,1),
  add column f1_visa_status text,
  add column ncaa_eligibility_status text;
