-- Core schema. Multi-org from day one (Bridge is org #1, Elite Squad is org #2),
-- per docs/DECISIONS.md. Postgres enforces ownership and isolation; the app
-- enforces shape on the jsonb detail columns (Zod), same split jarvis-core
-- uses and for the same reason: a new recruit_type or benchmark field is a
-- code change, not a migration.

create extension if not exists "uuid-ossp";

-- ── Orgs ──────────────────────────────────────────────────────────────
create table orgs (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  slug          text not null unique,
  -- What this org calls its own roles, e.g. Bridge: {"owner":"Executive Director","staff":"Coordinator"};
  -- Elite Squad: {"owner":"Owner","staff":"Coach"}. Display only, never read for auth.
  role_labels   jsonb not null default '{}'::jsonb,
  -- Feature toggles. recruiting and doc_ai are core, on for every org.
  -- board_governance and donor_fundraising exist for Bridge; off by default.
  modules       jsonb not null default '{"recruiting":true,"doc_ai":true,"board_governance":false,"donor_fundraising":false}'::jsonb,
  branding      jsonb not null default '{}'::jsonb, -- logo url, colors, fonts
  created_at    timestamptz not null default now()
);

-- ── Users and membership ─────────────────────────────────────────────
-- Profile row mirrors auth.users; keeps the same shape tucci-admin uses.
create table users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null default '',
  created_at  timestamptz not null default now()
);

create type org_role as enum ('owner', 'staff', 'member');

-- One person, many orgs (a coach who volunteers at two organizations).
-- Every row has exactly one org_id: this is the seam an athlete's,
-- school's, or benchmark's org_id all point back to.
create table org_members (
  user_id     uuid not null references users(id) on delete cascade,
  org_id      uuid not null references orgs(id) on delete cascade,
  role        org_role not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, org_id)
);

-- ── Athletes ──────────────────────────────────────────────────────────
create type recruit_type as enum ('hs', 'transfer_4to4', 'transfer_juco', 'transfer_grad');

create table athletes (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,
  recruit_type    recruit_type not null default 'hs',
  name            text not null,
  sport           text not null,
  position        text,
  gpa             numeric(3,2),
  gpa_verified    boolean not null default false,
  -- Type-specific fields (HS: grad year, course rigor, test scores;
  -- transfer: current school, portal entry date, eligibility years left,
  -- degree_completed for grad transfers). Shape validated in
  -- src/lib/fit/schema.ts, not here. See docs/ARCHITECTURE.md.
  detail          jsonb not null default '{}'::jsonb,
  measurables     jsonb not null default '{}'::jsonb,
  status          text not null default 'Active',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

-- ── Schools (shared reference data, not org-scoped) ──────────────────
-- One canonical row per school, reused by every org. An org's relationship
-- to a school (status, coach contact, notes) lives in recruiting_targets,
-- not here, so two orgs recruiting the same school never duplicate or
-- collide on the school's own facts.
create table schools (
  id                uuid primary key default uuid_generate_v4(),
  name              text not null,
  division          text not null, -- 'D1' | 'D2' | 'D3' | 'NAIA' | 'JUCO D1' | 'JUCO D2' | 'JUCO D3' | 'Prep School'
  conference        text,
  sports_sponsored  text[] not null default '{}',
  academics         jsonb not null default '{}'::jsonb, -- camelCase: gpaMin, gpaAvg, satRange, actRange, majorAvailability
  financials        jsonb not null default '{}'::jsonb, -- camelCase: athleticScholarship, avgAthleticAid, avgMeritAid, avgNeedAid, outstateTotal, instateTotal, rosterSpotsOpen
  athletics         jsonb not null default '{}'::jsonb, -- camelCase: playingTimeOutlook, positionDepth
  conflicts         jsonb not null default '[]'::jsonb,
  profile_date      timestamptz,
  created_at        timestamptz not null default now()
);

-- ── Recruiting targets (org's relationship to a school, per athlete) ──
create table recruiting_targets (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references orgs(id) on delete cascade,
  athlete_id    uuid not null references athletes(id) on delete cascade,
  school_id     uuid not null references schools(id) on delete cascade,
  status        text not null default 'Target', -- Target/In Contact/Visit/Offer/Committed/Not Interested
  coach_name    text,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (athlete_id, school_id)
);

-- ── Benchmarks (position/tier athletic standards, org-editable) ──────
-- Seeded from a shared default set; an org can fork its own without
-- affecting others. Mirrors D.fitBenchmarks in the current Bridge app.
create table benchmark_sets (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid references orgs(id) on delete cascade, -- null = shared default set
  sport       text not null,
  tiers       jsonb not null,
  positions   jsonb not null,
  created_at  timestamptz not null default now()
);

-- ── Transfer portal windows (shared NCAA reference data) ─────────────
-- These change most years by NCAA vote (see docs/BUSINESS_RULES.md).
-- Data, not code, on purpose: a rule change should never be a deploy.
create table transfer_windows (
  id            uuid primary key default uuid_generate_v4(),
  sport         text not null,
  division      text not null,
  season_year   text not null, -- e.g. '2025-26'
  window_label  text not null, -- e.g. 'undergrad primary', 'grad', 'post-July 1'
  opens_on      date not null,
  closes_on     date not null,
  source_url    text,
  created_at    timestamptz not null default now()
);

-- ── Row level security ────────────────────────────────────────────────
alter table orgs enable row level security;
alter table users enable row level security;
alter table org_members enable row level security;
alter table athletes enable row level security;
alter table schools enable row level security;
alter table recruiting_targets enable row level security;
alter table benchmark_sets enable row level security;
alter table transfer_windows enable row level security;

-- Schools and transfer_windows are shared reference data: readable by any
-- signed-in member of any org, writable only via the service role.
create policy schools_read on schools for select using (auth.role() = 'authenticated');
create policy transfer_windows_read on transfer_windows for select using (auth.role() = 'authenticated');

-- org_members's own policy (below) has to query org_members to decide who
-- can see what. Every OTHER policy that also filters through org_members
-- directly (athletes_by_org, etc.) would then recurse: evaluating their
-- USING clause evaluates org_members's policy, which queries org_members
-- again, forever ("infinite recursion detected in policy for relation
-- org_members"). Confirmed by actually running this against Postgres as a
-- non-superuser role, not just eyeballing it - a superuser-only smoke test
-- (RLS is bypassed for superusers and table owners) never triggers this.
--
-- The fix is the standard one: a SECURITY DEFINER helper, owned by the
-- migration role that owns org_members, so its internal query bypasses
-- org_members's RLS (owner bypass) instead of re-evaluating it. Every
-- other policy calls this function instead of querying org_members
-- directly. See scripts/rls_test.sql for the test that caught this.
create or replace function _member_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() $$;

-- Org-scoped tables: a row is visible only to a member of its org.
-- This is the membership-table pattern jarvis-core's architecture doc
-- describes as the future step for JARVIS; here it's the starting point,
-- because Bridge and Elite Squad exist on day one, not later.
create policy org_members_self on org_members for select
  using (user_id = auth.uid() or org_id in (select _member_org_ids()));

create policy athletes_by_org on athletes for all
  using (org_id in (select _member_org_ids()));

create policy recruiting_targets_by_org on recruiting_targets for all
  using (org_id in (select _member_org_ids()));

create policy benchmark_sets_by_org on benchmark_sets for all
  using (org_id is null or org_id in (select _member_org_ids()));

create policy users_self on users for select using (id = auth.uid());

-- orgs had RLS enabled above with no policy at all until this was
-- caught building the org-resolution page: RLS enabled + zero policies
-- means Postgres denies every row to every non-owner role by default,
-- for every command. A signed-in member couldn't even read their own
-- org's name or role_labels/modules/branding config. A member reads
-- (never writes, that stays service-role-only) any org they belong to.
create policy orgs_by_membership on orgs for select using (id in (select _member_org_ids()));
