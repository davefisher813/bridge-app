-- The NCAA-approved course list, per high school.
--
-- What this fixes: calculateCoreGpa() has always treated a course's
-- approval as three states, and has always warned that a GPA built on
-- unchecked courses is an estimate. Nothing ever set the flag, so every
-- core GPA in the product carried that warning, and the flagship number
-- was an estimate for every athlete. This is the missing source.
--
-- The Eligibility Center publishes one list per high school at
-- web3.ncaa.org/hsportal, keyed by CEEB code. A course on that list
-- counts toward the core GPA. A course not on it does not, and that is
-- the entire mechanism by which a 4.0 transcript becomes a 2.9 core GPA
-- and an athlete finds out in June that they are short.
--
-- Same two-table split as the grading scales in 0009, for the same
-- reason and with the same precedence. A list transcribed from the
-- portal is shared reference data: it is the same for every org with an
-- athlete at that school, and a wrong one silently rewrites every
-- eligibility verdict at that school everywhere, so it stays behind the
-- service role. An org-scoped list has the blast radius of one org,
-- which is the blast radius of everything else staff type in, so a
-- coordinator can enter one without waiting on anybody.
--
-- The one field that carries the most weight here is `is_complete`. A
-- list transcribed in full can answer the question both ways: a course
-- absent from it is not approved. A partial list can only ever confirm.
-- Treating a partial list as complete is how a real core course gets
-- silently dropped and the athlete is told they are short on credits
-- they actually have. src/lib/fit/ncaa/approvedCourses.ts enforces that
-- distinction, and refuses to accept a handful of rows as a whole
-- catalog.

-- Shared, verified, service-role only. Same posture as
-- high_school_grading_scales in 0008.
create table ncaa_approved_course_lists (
  id              uuid primary key default uuid_generate_v4(),
  school_name     text not null,

  -- The Eligibility Center's key for the school. Names collide and get
  -- retyped; the code does not, and the transcripts already carry it.
  ceeb_code       text,

  -- Whether this is the school's whole catalog. See the note above:
  -- this is the field that decides whether "absent" means "no".
  is_complete     boolean not null default false,

  -- When the list was read off the portal. An approved list changes as
  -- a school adds and drops courses, so a three-year-old copy is a
  -- different claim from one pulled this morning.
  retrieved_on    date,

  source_note     text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  school_name_key text generated always as (lower(btrim(school_name))) stored,
  unique (school_name_key)
);

create table ncaa_approved_courses (
  id              uuid primary key default uuid_generate_v4(),
  list_id         uuid not null references ncaa_approved_course_lists(id) on delete cascade,

  -- The title exactly as the Eligibility Center prints it. Matching is
  -- done on a normalized form in the app, never on this string, so this
  -- column stays faithful to the source.
  title           text not null,

  -- The subject area the NCAA files it under, which is authoritative
  -- and regularly disagrees with the transcript. A school's Computer
  -- Science may be other_academic rather than science, and the
  -- difference moves the per-subject minimums.
  subject         text not null check (subject in ('english','math','science','social_science','other_academic')),

  -- The most credit the NCAA allows, when the list states one. A school
  -- may award 1.0 for a course the NCAA caps at 0.5. Null means the
  -- list states no cap, which is not the same as a cap of zero.
  max_credit      numeric(4,2) check (max_credit is null or (max_credit > 0 and max_credit <= 2)),

  -- The list marks courses it accepts as honors or AP weighted.
  weighted        boolean not null default false,

  title_key       text generated always as (lower(btrim(title))) stored,
  -- Two rows that normalize the same make every course matching either
  -- one permanently ambiguous, which is worse than one being absent.
  unique (list_id, title_key)
);

create index ncaa_approved_courses_list_idx on ncaa_approved_courses (list_id);

alter table ncaa_approved_course_lists enable row level security;
alter table ncaa_approved_courses enable row level security;

-- Readable by any authenticated member, writable by nobody through the
-- API. Loading a real list is a service-role job, the same as seeding
-- schools and the verified grading scales.
create policy ncaa_approved_course_lists_read on ncaa_approved_course_lists for select
  using (auth.role() = 'authenticated');
create policy ncaa_approved_courses_read on ncaa_approved_courses for select
  using (auth.role() = 'authenticated');

-- The org's own copy. Ordinary RLS, read by membership and written by
-- staff, matching the role-aware policies 0010 established.
create table org_approved_course_lists (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,
  school_name     text not null,
  ceeb_code       text,
  is_complete     boolean not null default false,
  retrieved_on    date,

  -- Required by the form. "Transcribed from the portal on the 14th" and
  -- "the counselor emailed me a PDF" are different claims and the screen
  -- says which.
  source_note     text,
  entered_by      uuid references auth.users(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  school_name_key text generated always as (lower(btrim(school_name))) stored,
  unique (org_id, school_name_key)
);

create table org_approved_courses (
  id              uuid primary key default uuid_generate_v4(),
  list_id         uuid not null references org_approved_course_lists(id) on delete cascade,
  -- Denormalized so RLS on this table can be checked without a join
  -- back through the parent list on every row.
  org_id          uuid not null references orgs(id) on delete cascade,
  title           text not null,
  subject         text not null check (subject in ('english','math','science','social_science','other_academic')),
  max_credit      numeric(4,2) check (max_credit is null or (max_credit > 0 and max_credit <= 2)),
  weighted        boolean not null default false,

  title_key       text generated always as (lower(btrim(title))) stored,
  unique (list_id, title_key)
);

create index org_approved_course_lists_org_idx on org_approved_course_lists (org_id);
create index org_approved_courses_list_idx on org_approved_courses (list_id);
create index org_approved_courses_org_idx on org_approved_courses (org_id);

alter table org_approved_course_lists enable row level security;
alter table org_approved_courses enable row level security;

-- Read by membership, write by staff. Split into four policies rather
-- than one `for all`, which is what 0010 established after finding that
-- a `for all` policy let any member write.
create policy org_approved_course_lists_read on org_approved_course_lists for select
  using (org_id in (select _member_org_ids()));
create policy org_approved_course_lists_insert on org_approved_course_lists for insert
  with check (org_id in (select _staff_org_ids()));
create policy org_approved_course_lists_update on org_approved_course_lists for update
  using (org_id in (select _staff_org_ids()))
  with check (org_id in (select _staff_org_ids()));
create policy org_approved_course_lists_delete on org_approved_course_lists for delete
  using (org_id in (select _staff_org_ids()));

create policy org_approved_courses_read on org_approved_courses for select
  using (org_id in (select _member_org_ids()));
create policy org_approved_courses_insert on org_approved_courses for insert
  with check (org_id in (select _staff_org_ids()));
create policy org_approved_courses_update on org_approved_courses for update
  using (org_id in (select _staff_org_ids()))
  with check (org_id in (select _staff_org_ids()));
create policy org_approved_courses_delete on org_approved_courses for delete
  using (org_id in (select _staff_org_ids()));

-- Which list settled each course, recorded on the course itself.
-- `ncaa_approved` already exists and is what the engine reads; this says
-- where the answer came from, so a screen can tell "the portal list says
-- no" apart from "somebody ticked a box in 2024".
alter table athlete_courses
  add column approval_source text
    check (approval_source is null or approval_source in ('ncaa_portal','org','manual'));
