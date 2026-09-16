-- Lets an org enter a high school's grading scale itself.
--
-- The problem this solves, stated plainly: migration 0008 put
-- `high_school_grading_scales` behind the service role on purpose,
-- because it is shared across every org and a wrong conversion table
-- silently rewrites every eligibility verdict for every athlete at that
-- school, everywhere. That was the right call for shared data, but it
-- left the flagship feature unusable: Dave's real transcripts print
-- numbers, so without a table there is no core GPA for essentially any
-- Bridge athlete, and there was no way to supply one.
--
-- The way out is not to loosen the shared table. It is to notice that
-- the objection was entirely about blast radius. An org-scoped table has
-- the blast radius of one org, which is the same blast radius every
-- other thing staff already type in: an athlete's GPA, a course grade, a
-- target's offer. So a coordinator can enter a scale, it affects their
-- org and nobody else's, and the shared table stays exactly as locked
-- down as it was.
--
-- Precedence is resolved in src/lib/fit/ncaa/gradingScale.ts: a verified
-- shared row wins, an org's own row is the fallback, and the screen says
-- which one it used. An org never sees another org's entry, so no order
-- of writes lets one org's typing displace another's.

create table org_grading_scales (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,
  school_name     text not null,

  -- Same shape as the shared table: [{ "letter": "B", "min": 83, "max": 86 }].
  -- Sanity-checked by gradingScaleProblem() in the app before any write,
  -- the same function the Doc AI path uses on a scale read off a scan.
  bands           jsonb not null default '[]'::jsonb,

  -- The two conditions on the +1.00 weighted bonus that cannot be read
  -- off a transcript. Until this screen existed nothing ever set them,
  -- so every AP athlete got an understated core GPA and a warning that
  -- their school "is not on record" that nobody had been asked about.
  reports_weighted_grades      boolean not null default false,
  weighting_is_class_rank_only boolean not null default false,

  -- How much the school actually adds for a weighted course. The NCAA's
  -- 1.00 is a cap, not the value. The engine clamps this regardless.
  weight_bonus    numeric(3,2) not null default 1.00,

  -- Where the numbers came from. Required by the form, because "typed
  -- from the legend on page 2" and "the counselor confirmed it on the
  -- phone" are not the same claim and the screen says which.
  source_note     text,

  -- Who entered it, for the same reason. Nullable so a row survives the
  -- member being removed from the org.
  entered_by      uuid references auth.users(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Lookups and uniqueness run on the normalized key, never on the raw
  -- name. Matching on school_name is case-sensitive, so "Westminster
  -- School" and "westminster school" would become two rows and a scale
  -- filed under one casing would be invisible to courses recorded under
  -- the other. That exact bug was fixed on the shared table in 0008.
  school_name_key text generated always as (lower(btrim(school_name))) stored,

  unique (org_id, school_name_key)
);

create index org_grading_scales_org_idx on org_grading_scales (org_id);

alter table org_grading_scales enable row level security;

create policy org_grading_scales_by_org on org_grading_scales for all
  using (org_id in (select _member_org_ids()));
