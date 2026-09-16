-- Storage for an NCAA core-course GPA.
--
-- The engine (src/lib/fit/ncaa/) has been built, tested and law-bound
-- since before this existed, and like the Doc AI pipeline it is pure: it
-- takes a course list and returns a verdict, and never persists
-- anything. These two tables are what feeds it.
--
-- Why a per-course table rather than more columns on `athletes`: an NCAA
-- core GPA cannot be derived from a transcript GPA. It is total quality
-- points over total core units, counting only NCAA-approved courses and
-- only the best grades among them, on a scale with no plus or minus. A
-- single `gpa` column cannot express any of that, which is exactly why
-- the app was quietly reporting the wrong number before. See the
-- calculation rules and their NCAA sources in docs/BUSINESS_RULES.md.

-- The subject areas as the NCAA groups them on its own DI/DII
-- worksheet, plus `non_academic` for the PE and elective rows that are
-- read off a transcript and deliberately excluded. Those rows are stored
-- rather than dropped, because "these six courses are not counted, and
-- here they are" is the single most useful thing the screen can say to a
-- parent looking at a good transcript and a bad core GPA.
create type core_subject as enum (
  'english',
  'math',
  'science',
  'social_science',
  'other_academic',
  'non_academic'
);

-- ── School grading scales ────────────────────────────────────────────
-- Shared reference data keyed to a high school name, not org-scoped, for
-- the same reason `schools` is not: two orgs with an athlete at the same
-- high school should not each maintain their own copy of that school's
-- conversion table.
--
-- This table exists because of a rule that is easy to get wrong: the
-- NCAA converts a numeric grade using the HIGH SCHOOL'S OWN published
-- scale, not a generic curve. Dave's real transcripts are numeric
-- (Westminster reports an 86.2, Cardinal Hayes reports course grades
-- like 87 and 102), so without the school's table there is no honest way
-- to turn those into quality points, and the engine refuses to guess.
create table high_school_grading_scales (
  id              uuid primary key default uuid_generate_v4(),
  school_name     text not null,
  -- Bands as the school prints them: [{ "letter": "B", "min": 83, "max": 86 }].
  -- Shape validated in the app (src/lib/fit/ncaa/fromTranscript.ts), not
  -- here, same split as athletes.detail.
  bands           jsonb not null default '[]'::jsonb,
  -- Whether the school has told the NCAA Eligibility Center that it
  -- awards weighted grades, and whether that weighting feeds the real
  -- GPA or only class rank. Both are conditions on the +1.00 quality
  -- point bonus, and neither can be inferred from a transcript.
  reports_weighted_grades     boolean not null default false,
  weighting_is_class_rank_only boolean not null default false,
  -- How many bonus quality points this school actually adds to a
  -- weighted course. Stored rather than assumed, because the NCAA's
  -- 1.00 is a CAP, not the value: a school that adds 0.5 would have
  -- every AP student's core GPA overstated if the cap were used as the
  -- amount. The engine clamps this to 1.00 regardless of what is here.
  weight_bonus                numeric(3,2) not null default 1.00,
  -- Where this came from, so nobody has to wonder whether it was typed
  -- from a transcript or confirmed with a counselor.
  source_note     text,
  verified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Lookups and uniqueness both run on this, not on school_name.
  -- Matching on the raw name is case-sensitive, so "Westminster School"
  -- and "westminster school" became two rows, and a scale filed under
  -- one casing was invisible to courses recorded under the other: the
  -- screen said the school had no grading scale while the row sat in the
  -- table.
  school_name_key text generated always as (lower(btrim(school_name))) stored,
  unique (school_name_key)
);

-- ── Core courses ─────────────────────────────────────────────────────
-- Org-scoped, because it is an athlete's record.
create table athlete_courses (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,
  athlete_id      uuid not null references athletes(id) on delete cascade,
  -- Which document this row was read off, when it came from Doc AI.
  -- Null for a row someone typed in by hand.
  document_id     uuid references documents(id) on delete set null,

  title           text not null,
  subject         core_subject not null,
  credit          numeric(4,2) not null,
  -- Stored as text, exactly as the transcript printed it. A letter, a
  -- number, or a marker like W, P or CR. Coercing this to a number or a
  -- letter on the way in would lose the difference between a C and a
  -- credit-only course, which is a real distinction: one carries two
  -- quality points and the other carries none.
  grade           text not null,
  -- The school year or term as printed, for the human reading the list.
  term            text,
  -- The high school this course was taken at. A transfer student's
  -- transcript legitimately carries two schools, and they may convert
  -- numeric grades differently, so the scale is looked up per course
  -- rather than per athlete.
  school_name     text,

  -- True only when the course TITLE says honors, AP, IB or advanced.
  -- Not enough on its own to earn the weighted bonus; the school's
  -- grading-scale row carries the other two conditions.
  weighted        boolean not null default false,

  -- Whether this course is on the school's NCAA-approved course list.
  -- NULL means nobody has checked, which is deliberately different from
  -- false, and is surfaced as "this GPA is an estimate until they are".
  ncaa_approved   boolean,

  -- Set when this row repeats or duplicates the content of another. Only
  -- the higher grade counts. Left null by the extractor on purpose: a
  -- repeated course and a year-long course split into two same-titled
  -- semester rows are indistinguishable from the title alone, and
  -- merging them automatically destroys half the credit of the second
  -- case. A human resolves it.
  duplicate_of    uuid references athlete_courses(id) on delete set null,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index athlete_courses_athlete_idx on athlete_courses (athlete_id);
create index athlete_courses_org_idx on athlete_courses (org_id);
create index athlete_courses_document_idx on athlete_courses (document_id);

-- ── RLS ──────────────────────────────────────────────────────────────
alter table athlete_courses enable row level security;

create policy athlete_courses_by_org on athlete_courses for all
  using (org_id in (select _member_org_ids()));

-- Grading scales are shared reference data, readable by any signed-in
-- member and writable only by the service role, exactly like `schools`.
-- A coordinator entering a wrong conversion table would silently change
-- every eligibility verdict for every athlete at that school, in every
-- org, so that write stays behind the service role until there is a
-- reason to loosen it.
alter table high_school_grading_scales enable row level security;

create policy grading_scales_readable on high_school_grading_scales for select
  using (auth.uid() is not null);

-- ── Date of birth ────────────────────────────────────────────────────
-- Needed by the age-based eligibility clock, which since mid-2026 can
-- start five years of eligibility running at the academic year after an
-- athlete's 19th birthday, whether or not they have enrolled anywhere.
-- Transcripts print it, so Doc AI can fill it.
alter table athletes add column date_of_birth date;

-- When the athlete first enrolled full time at any college, and when
-- they intend to. The clock starts at whichever of first enrollment and
-- the age trigger comes first, so both matter, and for a high school
-- recruit the second is the one that says how much eligibility is left
-- by the time they arrive.
alter table athletes add column first_full_time_enrollment date;
alter table athletes add column intended_enrollment date;
