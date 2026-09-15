-- The third RecruitingSignals field (src/lib/fit/types.ts's `offer`) has
-- never had anything real behind it: recruiting_targets.status = 'Offer'
-- is a coarser pipeline stage, not an offer type or scholarship percent,
-- and score.ts treats a scholarship/written offer very differently from
-- a verbal one. See docs/DECISIONS.md.

create type recruiting_offer_type as enum ('scholarship', 'written', 'verbal', 'preferred_walk_on', 'admission_only', 'walk_on');

alter table recruiting_targets
  add column offer_type recruiting_offer_type,
  add column offer_scholarship_percent smallint check (offer_scholarship_percent between 0 and 100);

comment on column recruiting_targets.offer_type is 'Null until an offer exists. Independent of status = Offer, which is a pipeline stage, not an offer record.';
comment on column recruiting_targets.offer_scholarship_percent is 'Only meaningful when offer_type = scholarship.';
