-- Athlete profile screen (docs/ROADMAP.md's "Athlete profile / detail
-- screen" item) needs two tables that never existed: Contacts and a
-- real Visits log, per the full-preview mock's Colleges/Contacts/Visits
-- tabs. Both were explicitly deferred past the board/communication-log
-- work until Dave scoped them. See docs/DECISIONS.md.

-- Contacts are athlete-scoped, not target-scoped: a family contact, an
-- HS/travel coach, or an advisor is the same person across every school
-- an athlete is recruiting with, unlike recruiting_targets.coach_name
-- (a single free-text field, one per target, that can't represent a
-- person shared across targets or carry an email/phone). A college
-- coach contact can optionally link to the school they coach at.
create type contact_role as enum ('hs_coach', 'travel_coach', 'parent_guardian', 'advisor', 'college_coach', 'other');

create table contacts (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references orgs(id) on delete cascade,
  athlete_id    uuid not null references athletes(id) on delete cascade,
  name          text not null,
  role          contact_role not null,
  school_id     uuid references schools(id) on delete set null,
  email         text,
  phone         text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index contacts_athlete_id_idx on contacts(athlete_id);

alter table contacts enable row level security;

create policy contacts_by_org on contacts for all
  using (org_id in (select _member_org_ids()));

-- A real visits log, distinct from both recruiting_targets.visit_date
-- (a single *scheduled* date, migration 0003) and target_communications
-- kind='visit' (a bare log entry with no type/impression/next-step,
-- migration 0004). This is the richer record the Visits tab needs:
-- multiple actual visits per target, each with a type, an impression,
-- and a next step. See docs/DECISIONS.md for how this changes where
-- RecruitingSignals.visitCount is sourced from.
create type target_visit_type as enum ('official', 'unofficial', 'junior_day', 'camp', 'other');

create table target_visits (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references orgs(id) on delete cascade,
  target_id     uuid not null references recruiting_targets(id) on delete cascade,
  visit_type    target_visit_type not null,
  visit_date    date not null default current_date,
  impression    text,
  next_step     text,
  notes         text,
  created_at    timestamptz not null default now()
);

create index target_visits_target_id_idx on target_visits(target_id);

alter table target_visits enable row level security;

create policy target_visits_by_org on target_visits for all
  using (org_id in (select _member_org_ids()));
