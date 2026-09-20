-- Matching and metrics: the tables and columns docs/MATCHING_CONTRACT.md
-- needs, locked 2026-09-20 from Dave's forty picks.
--
-- Three rules from that contract shape this migration:
--
--   1. Matching never calls an outside service, so nothing here holds a
--      key, a cache of a remote answer, or a retry counter.
--   2. A match is stored, not recomputed on view. athlete_school_fits is
--      the stored answer: score, tag, the dimensions that counted, the
--      reasons and warnings a family can read, a hash of the inputs it
--      was computed from and when. A screen reads rows; it never scores.
--   3. School data is ours once it is in. Shared facts stay on schools;
--      what an org knows privately about a school (its coach contact,
--      positions of need, notes) is an overlay in org_school_notes,
--      scoped to the org like everything else.
--
-- The metrics log (athlete_metrics) is the dated record behind "best
-- verified, else most recent": every entry carries its value, its date
-- and where it was measured, and the source tier is what sets the
-- athletic dimension's confidence. The columns added to athletes,
-- schools and orgs are the inputs the contract's scoring rules read:
-- the athlete's goal, family budget, home state and staff grades; the
-- school's program tier, state and majors; the org's scoring preset.
--
-- Shape lives in code, ownership lives here, same split as
-- athletes.detail: the grades jsonb and the positions_of_need jsonb are
-- validated by Zod, and the check constraints below only pin the enums
-- the contract names so a typo cannot land in the database.

-- ── Where a number came from ─────────────────────────────────────────
-- Tier 1 Premier, tier 2 PBR / Perfect Game / any showcase or event,
-- tier 3 a coach-timed practice, tier 4 self-reported. The tier to
-- confidence mapping is in src/lib/fit/contract.ts, not here.
create type metric_source as enum ('premier', 'pbr', 'perfect_game', 'event', 'coach', 'self');

-- ── The metrics log ──────────────────────────────────────────────────
create table athlete_metrics (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references orgs(id) on delete cascade,
  athlete_id    uuid not null references athletes(id) on delete cascade,
  -- The measurable's key as the engine names it: fbVelo, sixty, popTime,
  -- exitVelo, armVelo, strikePct, heightIn, weightLb.
  metric        text not null,
  value         numeric(8,2) not null,
  measured_on   date not null,
  source        metric_source not null default 'coach',
  -- The event or showcase name, or 'practice'. Free text.
  source_detail text,
  entered_by    uuid references users(id),
  created_at    timestamptz not null default now()
);

-- The read the engine makes: every entry of one metric for one athlete,
-- newest first.
create index athlete_metrics_athlete_metric_idx on athlete_metrics (athlete_id, metric, measured_on desc);
create index athlete_metrics_org_idx on athlete_metrics (org_id);
create index athlete_metrics_entered_by_idx on athlete_metrics (entered_by);

-- ── Scoring inputs on the athlete ────────────────────────────────────
alter table athletes add column goal text not null default 'balanced'
  check (goal in ('education', 'balanced', 'development'));
alter table athletes add column family_budget_cents integer;
alter table athletes add column home_state text;
alter table athletes add column grades jsonb not null default '{}'::jsonb;

comment on column athletes.goal is
  'Education First, Balanced or Development First. Shifts the org''s scoring preset per docs/MATCHING_CONTRACT.md.';
comment on column athletes.family_budget_cents is
  'What the family can pay per year, in cents. Null means the financial dimension keeps the school-only model at low confidence.';
comment on column athletes.home_state is
  'Two-letter state. In-state cost applies when it matches the school''s state.';
comment on column athletes.grades is
  'Staff grades: frame, athleticism, skill, iq, competitiveness on the 20 to 80 scale. Validated in code.';

-- ── Scoring inputs on the school ─────────────────────────────────────
alter table schools add column program_tier text
  check (program_tier in ('elite_d1', 'mid_d1', 'low_d1', 'd2_naia', 'juco'));
alter table schools add column state text;
alter table schools add column majors text[] not null default '{}';

comment on column schools.program_tier is
  'Elite D1, Mid-Major D1, Low D1, D2 D3 NAIA or JUCO. Defaults from the division in code; set by an owner.';

-- ── The org's blend ──────────────────────────────────────────────────
alter table orgs add column scoring_preset text not null default 'money_first'
  check (scoring_preset in ('money_first', 'balanced', 'baseball_first'));

comment on column orgs.scoring_preset is
  'Which academic / athletic / financial blend the org scores with. The numbers live in src/lib/fit/contract.ts.';

-- ── What an org knows privately about a school ───────────────────────
-- Head coach and email are per-org overlay fields rather than shared
-- facts, because a coach relationship belongs to the org that has it.
-- Positions of need boost a matching athlete's score for this org only.
create table org_school_notes (
  id                 uuid primary key default uuid_generate_v4(),
  org_id             uuid not null references orgs(id) on delete cascade,
  school_id          uuid not null references schools(id) on delete cascade,
  coach_name         text,
  coach_email        text,
  positions_of_need  jsonb not null default '[]'::jsonb,
  notes              text,
  updated_at         timestamptz not null default now(),
  unique (org_id, school_id)
);

comment on column org_school_notes.positions_of_need is
  'Array of {position, gradYear}. Validated in code.';

create index org_school_notes_org_idx on org_school_notes (org_id);
create index org_school_notes_school_idx on org_school_notes (school_id);

-- ── The stored match ─────────────────────────────────────────────────
-- One row per athlete by school, replaced in place when an input
-- changes (the recompute table in docs/MATCHING_CONTRACT.md). inputs_hash
-- is how the server action knows a stored row is already current.
-- partial is true when a dimension with unknown confidence was left out
-- of the blend; dimensions says which ones counted.
create table athlete_school_fits (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references orgs(id) on delete cascade,
  athlete_id    uuid not null references athletes(id) on delete cascade,
  school_id     uuid not null references schools(id) on delete cascade,
  score         smallint not null,
  tag           text not null,
  partial       boolean not null default false,
  dimensions    jsonb not null default '{}'::jsonb,
  reasons       jsonb not null default '[]'::jsonb,
  warnings      jsonb not null default '[]'::jsonb,
  inputs_hash   text not null,
  computed_at   timestamptz not null default now(),
  unique (athlete_id, school_id)
);

-- The Matches section reads one athlete's rows best first; the school
-- side is the fan-out when a school's facts change.
create index athlete_school_fits_org_athlete_score_idx on athlete_school_fits (org_id, athlete_id, score desc);
create index athlete_school_fits_school_idx on athlete_school_fits (school_id);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Same role-aware shape as everything since migration 0010: any member
-- of the org reads, only owner and staff write. A single `for all`
-- policy would let a member (a board member, at Bridge) log a metric or
-- rewrite a stored match, and scripts/rls_test.sql refuses any
-- org-scoped table that has one. The helpers are the private-schema
-- ones from 0015, called through a subselect so Postgres evaluates them
-- once per statement rather than once per row (0016).
alter table athlete_metrics enable row level security;
alter table org_school_notes enable row level security;
alter table athlete_school_fits enable row level security;

do $$
declare t text;
declare tables text[] := array['athlete_metrics', 'org_school_notes', 'athlete_school_fits'];
begin
  foreach t in array tables loop
    execute format(
      'create policy %I on %I for select using (org_id in (select private._member_org_ids()))',
      t || '_read', t);
    execute format(
      'create policy %I on %I for insert with check (org_id in (select private._staff_org_ids()))',
      t || '_insert', t);
    -- USING decides which rows may be updated, WITH CHECK decides what
    -- they may be updated TO. Both, so a row cannot be moved to another
    -- org by rewriting org_id.
    execute format(
      'create policy %I on %I for update using (org_id in (select private._staff_org_ids())) with check (org_id in (select private._staff_org_ids()))',
      t || '_update', t);
    execute format(
      'create policy %I on %I for delete using (org_id in (select private._staff_org_ids()))',
      t || '_delete', t);
  end loop;
end $$;
