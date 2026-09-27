-- Stage 4 and the audit of 2026-09-27: autofill, staff notes, and the
-- things a brand-new organization needs to run without hand-written SQL.
--
-- Dave, 2026-09-27: "everything should be very easy for anyone to edit
-- anything ... if somebody used this as a new app, there shouldn't be
-- pre-existing data in it." So this migration creates structure only.
-- It inserts no rows, names no org and carries no id literal; the law in
-- src/laws/migrationLaws.test.ts holds every migration from 0040 on to
-- that.
--
-- Six things here:
--
-- 1. high_schools: a shared directory of high schools, used to suggest a
--    name while typing. Created EMPTY. It is filled only from the public
--    federal NCES school files, by the one-off loader
--    scripts/load_high_schools.ts, never from any org's own records and
--    never by a migration. Read by any signed-in user, written by the
--    service role only, like schools (0016).
-- 2. athlete_notes: a dated, staff-only log of notes on an athlete. Its
--    own table, never a column on athletes: the athletes read policy
--    admits a linked family login (0023), and row level security hides
--    rows, not columns. Owner and staff read and add; a member, a family
--    login and anyone outside the org read nothing. Notes are not
--    edited, only deleted by staff.
-- 3. transfer_windows.notes: free text on the shared window row.
-- 4. documents.read_by: which model read a document, 'stub' when no AI
--    key was set. A stub reading is invented data and must never be
--    applied to a real athlete, now or after a key is added, so once a
--    row says 'stub' it says 'stub' for good (a trigger, below).
-- 5. orgs.edits_shared_directory: which organizations may write the
--    shared directory (schools, college coaches, transfer windows). Those
--    rows are read by every org, so an owner of any one org editing them
--    edits them for everybody. Off by default. create_org turns it on
--    only for the first organization of a fresh install, whose owner is
--    whoever set the install up. On an install that already has orgs it
--    is set by hand, once, by whoever runs the database; never here.
-- 6. public.create_org(name, slug): the first-run flow. A signed-in user
--    creates an organization and becomes its owner in one transaction.
--    SECURITY DEFINER because orgs and org_members stay closed to
--    ordinary writes: an insert policy on org_members would let staff
--    write themselves an owner row (see the write_exempt note in
--    scripts/rls_test.sql). The function takes no role argument; the
--    caller is always the owner of what they just created.

-- ── 1. The high school directory ─────────────────────────────────────

create table high_schools (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null check (length(btrim(name)) between 1 and 200),
  city        text,
  state       text check (state is null or state ~ '^[A-Z]{2}$'),
  country     text not null default 'US',
  -- The NCES school id (NCESSCH for public schools, PPIN for private
  -- ones). Unique, and not partial, so the loader can upsert on it.
  nces_id     text unique,
  ceeb_code   text,
  -- Where the row came from: 'nces_ccd_<year>', 'nces_pss_<year>', or
  -- 'manual' for a row the service role typed in.
  source      text not null default 'manual',
  created_at  timestamptz not null default now(),
  -- The same key as school_name_key in 0008 and nameKey() in
  -- src/lib/lookup/nameKey.ts, so a lookup matches however it was typed.
  name_key    text generated always as (lower(btrim(name))) stored,
  unique nulls not distinct (name_key, state, city)
);

create index high_schools_state_name_idx on high_schools (state, name_key text_pattern_ops);
create index high_schools_name_key_idx on high_schools (name_key);

alter table high_schools enable row level security;

-- Any signed-in user reads it; it is a list of public schools. No write
-- policy: only the service role (the loader) writes.
create policy high_schools_read on high_schools for select
  using ((select auth.role()) = 'authenticated');

comment on table high_schools is
  'Shared high school directory for suggestions. Filled only from public NCES files by scripts/load_high_schools.ts; never from org data.';

-- ── 2. Staff notes on an athlete ─────────────────────────────────────

create type athlete_note_context as enum ('general', 'enrolled', 'graduated', 'drafted', 'reopened');

create table athlete_notes (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references orgs(id) on delete cascade,
  athlete_id  uuid not null references athletes(id) on delete cascade,
  -- Who wrote it. Kept as history if they leave.
  author_id   uuid references users(id) on delete set null,
  -- Which step it was filed under: a plain note, or the note typed on
  -- Mark Enrolled, Mark Graduated, Mark Drafted or Reopen Recruiting.
  context     athlete_note_context not null default 'general',
  body        text not null check (length(btrim(body)) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index athlete_notes_athlete_idx on athlete_notes (athlete_id, created_at desc);
create index athlete_notes_org_idx on athlete_notes (org_id);
create index athlete_notes_author_idx on athlete_notes (author_id);

-- A note's org is its athlete's org (the function from 0039), so a note
-- about one org's athlete cannot be filed where another org reads it.
create trigger athlete_notes_coherent
  before insert or update on athlete_notes
  for each row execute function private.athlete_row_is_coherent();

alter table athlete_notes enable row level security;

-- Owner and staff only. private._member_org_ids() admits owner and staff
-- since 0031, so a member reads nothing, and there is no family clause
-- on purpose.
create policy athlete_notes_read on athlete_notes for select
  using (org_id in (select private._member_org_ids()));
-- Signed by whoever writes it, never in someone else's name.
create policy athlete_notes_insert on athlete_notes for insert
  with check (org_id in (select private._staff_org_ids()) and author_id = (select auth.uid()));
-- No update policy: a note is not edited. Staff may remove one.
create policy athlete_notes_delete on athlete_notes for delete
  using (org_id in (select private._staff_org_ids()));

-- ── 3. Notes on a transfer window ────────────────────────────────────

alter table transfer_windows add column notes text check (notes is null or length(notes) <= 4000);

-- ── 4. Which model read a document ───────────────────────────────────

alter table documents add column read_by text check (read_by is null or length(btrim(read_by)) between 1 and 200);

comment on column documents.read_by is
  'The model that read this document, or ''stub'' when no AI key was set. A stub reading is never applied.';

-- A stub reading stays a stub reading. Without this, one update from the
-- browser (staff may update documents) could relabel invented data as a
-- real model's and make it appliable.
create or replace function private.document_stub_is_forever() returns trigger
  language plpgsql
  set search_path = public
  as $$
begin
  if old.read_by = 'stub' and new.read_by is distinct from 'stub' then
    raise exception 'documents: a document read by the stub stays marked as read by the stub'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger documents_stub_is_forever
  before update of read_by on documents
  for each row execute function private.document_stub_is_forever();

-- ── 5. Who may write the shared directory ────────────────────────────
-- Declared before create_org, which sets it. orgs has no update policy
-- (0001), so no browser session can switch it on for its own org; the
-- app reads it in requireDirectoryEditor (src/lib/auth/guard.ts) before
-- every service-role write to schools, college_coaches and
-- transfer_windows.

alter table orgs add column edits_shared_directory boolean not null default false;

comment on column orgs.edits_shared_directory is
  'True when this organization''s owners may write the shared directory (schools, college coaches, transfer windows). Off by default; create_org sets it only for the first organization of a fresh install.';

-- ── 6. Create an organization ────────────────────────────────────────

create or replace function public.create_org(name text, slug text) returns uuid
  language plpgsql security definer
  set search_path = ''
  as $$
#variable_conflict use_column
declare
  caller uuid := auth.uid();
  clean_name text := btrim(coalesce(create_org.name, ''));
  clean_slug text := lower(btrim(coalesce(create_org.slug, '')));
  new_id uuid;
  first_org boolean;
begin
  if caller is null then
    raise exception 'create_org: sign in first' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.users u where u.id = caller) then
    raise exception 'create_org: no profile for this sign-in' using errcode = 'insufficient_privilege';
  end if;
  if clean_name = '' then
    raise exception 'create_org: a name is required' using errcode = 'check_violation';
  end if;
  if length(clean_name) > 120 then
    raise exception 'create_org: a name is 120 characters or fewer' using errcode = 'check_violation';
  end if;
  if clean_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(clean_slug) < 2 or length(clean_slug) > 48 then
    raise exception 'create_org: a web address is 2 to 48 lowercase letters, numbers and single hyphens' using errcode = 'check_violation';
  end if;
  -- Someone who works inside another org (staff, a board member, a
  -- family login) does not get to start an org of their own, which would
  -- make them an owner and put an owner's doors (the shared directory
  -- among them) one step away. Nobody with a membership that is not
  -- owner may call this; a person in no org yet, or one who already
  -- owns an org, may.
  if exists (select 1 from public.org_members m where m.user_id = caller and m.role <> 'owner') then
    raise exception 'create_org: only an owner, or someone in no organization yet, can start one' using errcode = 'insufficient_privilege';
  end if;

  -- Serialises creation, so two callers on an empty install cannot both
  -- see no org and both become directory editors. Conflicts with itself
  -- and with inserts, not with reads.
  lock table public.orgs in share row exclusive mode;
  first_org := not exists (select 1 from public.orgs);

  if exists (select 1 from public.orgs o where o.slug = clean_slug) then
    raise exception 'create_org: that web address is taken' using errcode = 'unique_violation';
  end if;

  -- orgs.slug is unique, so a race between two callers ends in a
  -- unique_violation here rather than two orgs with one address.
  insert into public.orgs (name, slug, edits_shared_directory) values (clean_name, clean_slug, first_org) returning id into new_id;
  insert into public.org_members (user_id, org_id, role) values (caller, new_id, 'owner');
  return new_id;
end $$;

comment on function public.create_org(text, text) is
  'A signed-in user creates an organization and becomes its owner. Refuses a caller with any membership that is not owner, a blank name and a taken or malformed slug. The first organization of an empty install edits the shared directory; no later one does.';

-- ── Grants ───────────────────────────────────────────────────────────
-- The local RLS harness has neither Supabase role until 0033 creates
-- them; created here too so this file applies on its own.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

-- Nothing here is for a signed-out caller.
revoke all on public.high_schools from anon;
revoke all on public.athlete_notes from anon;

-- Two revokes, as in 0033: `from public` drops the default grant every
-- new function gets, `from anon` drops the one Supabase's default
-- privileges add in this schema.
revoke execute on function public.create_org(text, text) from public, anon;
grant execute on function public.create_org(text, text) to authenticated;
