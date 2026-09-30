-- Stage 5, Phase 4: assignments. Dave approved the plan 2026-09-27
-- (docs/PLAN_STAGE5.md, "Phase 4: Assignments").
--
-- An Admin (owner, and any leftover staff row) gives an athlete a piece
-- of work with a due date. The Athlete login for that athlete submits
-- it, with a file when one is asked for, through one function. An Admin
-- reviews it: Complete, or Needs Revision with a comment. A Viewer
-- (member), another athlete's login, another org and a signed-out caller
-- read nothing here.
--
-- Overdue is never stored. It is due_on in the past on a row still
-- assigned or needing revision, computed where it is shown
-- (src/lib/data/assignments.ts, computeOverdue), so it cannot go stale
-- or be set wrong. There is no in-progress status: a piece of work is
-- assigned, submitted, sent back, complete or cancelled.
--
-- Six things here:
--
-- 1. Three enums and the table. athlete_id cascades (the athlete's row
--    going takes its assignments); document_id is set null, so removing
--    a document never removes the assignment it answered. Nothing is
--    deleted through the app: Cancel is a status, and there is no delete
--    policy for anyone.
-- 2. Coherence: a row carries its athlete's org (the function from
--    0039), and a linked document is the same athlete's in the same org.
-- 3. Honesty: the server signs and dates a new row, and a row keeps its
--    author, its creation time, its athlete and its org. updated_at is
--    stamped on every update. This is the repo's first touch trigger,
--    scoped to this one table.
-- 4. Policies: Admins read, create and update their org's rows. The
--    Athlete login reads its linked athlete's rows and nothing else, and
--    writes none: the one family write is submit_assignment below.
-- 5. submit_assignment, SECURITY DEFINER: the only path from assigned or
--    needs_revision to submitted. It runs as the caller's own login,
--    checks the link to the athlete, files the document row for an
--    upload, and writes its own activity_log line through a helper that
--    takes no text and writes a literal per kind ("Submitted the upload
--    assignment"), never the note, the title or a name.
-- 6. One storage policy: an Athlete login may add a file under
--    <org>/family/<request>/<file> in the documents bucket, and nowhere
--    else. It still reads nothing back from the bucket (0017, 0024).
--
-- No data rows, no org named, no id literal (src/laws/migrationLaws.test.ts).

-- ── 1. The table ─────────────────────────────────────────────────────

create type assignment_category as enum (
  'academics', 'recruiting', 'eligibility', 'financial_aid', 'ncaa', 'applications', 'college_list', 'athletics', 'other'
);
create type assignment_kind as enum ('upload', 'complete_info', 'confirm', 'other');
create type assignment_status as enum ('assigned', 'submitted', 'needs_revision', 'complete', 'cancelled');

create table assignments (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references orgs(id) on delete cascade,
  athlete_id        uuid not null references athletes(id) on delete cascade,
  title             text not null check (length(btrim(title)) between 1 and 200),
  instructions      text check (instructions is null or length(instructions) <= 4000),
  category          assignment_category not null default 'other',
  kind              assignment_kind not null default 'other',
  due_on            date,
  status            assignment_status not null default 'assigned',
  -- The file an upload assignment was answered with. Set only by
  -- submit_assignment; set null if the document row is ever removed.
  document_id       uuid references documents(id) on delete set null,
  -- What the family wrote back, and what the reviewer wrote. Neither
  -- ever reaches the activity log.
  family_note       text check (family_note is null or length(family_note) <= 4000),
  reviewer_comment  text check (reviewer_comment is null or length(reviewer_comment) <= 4000),
  created_by        uuid references users(id) on delete set null,
  reviewed_by       uuid references users(id) on delete set null,
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index assignments_athlete_idx on assignments (athlete_id, status, due_on);
create index assignments_org_idx on assignments (org_id, status, due_on);
create index assignments_document_idx on assignments (document_id);
create index assignments_created_by_idx on assignments (created_by);
create index assignments_reviewed_by_idx on assignments (reviewed_by);

comment on table assignments is
  'Work an Admin gives an athlete, with a due date. Overdue is computed from due_on and status and is never stored. Read by Admins and by the athlete''s own login only.';

-- ── 2. Coherence ─────────────────────────────────────────────────────
-- The family read clause admits a row by athlete_id, so without this a
-- row could name any org_id it liked on an athlete of another org.

create trigger assignments_coherent
  before insert or update on assignments
  for each row execute function private.athlete_row_is_coherent();

-- A linked document belongs to the same athlete in the same org, so an
-- assignment cannot point an athlete's family at another family's file.
create or replace function private.assignment_document_is_coherent() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  if new.document_id is not null and not exists (
    select 1 from documents d
    where d.id = new.document_id and d.org_id = new.org_id and d.athlete_id = new.athlete_id
  ) then
    raise exception 'assignments: document % is not this athlete''s in this org', new.document_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger assignments_document_coherent
  before insert or update on assignments
  for each row execute function private.assignment_document_is_coherent();

-- ── 3. Honesty ───────────────────────────────────────────────────────
-- On insert the clock is the server's, and for an ordinary signed-in
-- session the author is the session itself, so a row cannot be signed in
-- someone else's name or dated into the past or the future. The service
-- role (auth.uid() is null) keeps the author it names.
--
-- On update the row keeps its author, its creation time, its athlete and
-- its org. created_by going null is the foreign key's own on delete set
-- null when the author's account is gone, and is let through. Every
-- update stamps updated_at.
create or replace function private.assignment_is_honest() returns trigger
  language plpgsql
  set search_path = public
  as $$
declare
  session_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if session_uid is not null then
      new.created_by := session_uid;
    end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  if (new.created_by is not null and new.created_by is distinct from old.created_by)
     or new.created_at is distinct from old.created_at
     or new.athlete_id is distinct from old.athlete_id
     or new.org_id is distinct from old.org_id then
    raise exception 'assignments: a row keeps its author, its creation time, its athlete and its org'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;

create trigger assignments_honest
  before insert or update on assignments
  for each row execute function private.assignment_is_honest();

-- ── 4. Policies ──────────────────────────────────────────────────────
-- Read is keyed off private._staff_org_ids(), not _member_org_ids(), so
-- the intent (Admins only, plus the athlete's own login) survives if the
-- member helper is ever widened again the way 0031 narrowed it. A
-- Viewer reads nothing. There is no delete policy for anyone, and no
-- family insert or update policy: Cancel is a status, and the family's
-- one write is submit_assignment.

alter table assignments enable row level security;

create policy assignments_read on assignments for select
  using (org_id in (select private._staff_org_ids()) or (athlete_id in (select private._family_athlete_ids()) and status <> 'cancelled'));

-- Signed by the session, on the session's own org. The honesty trigger
-- rewrites created_by to the session first, so an insert naming somebody
-- else lands as the caller; the created_by clause here is the second
-- lock on the same door.
create policy assignments_insert on assignments for insert
  with check (org_id in (select private._staff_org_ids()) and created_by = (select auth.uid()));

create policy assignments_update on assignments for update
  using (org_id in (select private._staff_org_ids()))
  with check (org_id in (select private._staff_org_ids()));

-- ── 5. Submit an assignment ─────────────────────────────────────────
-- First the log line it writes, then the function.

-- The log line for a submission. Its only parameter is the assignment's
-- id, and each summary is a literal for one kind, so nothing a caller
-- sends can reach it. The words match src/lib/data/activity.ts
-- (ASSIGNMENT_KIND_LOG_WORD). Called only from submit_assignment, which
-- has already checked the caller's link, so it is not granted to anyone.
create or replace function private.log_assignment_submitted(p_assignment uuid) returns void
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  a public.assignments%rowtype;
begin
  select * into a from public.assignments x where x.id = p_assignment;
  if not found then
    raise exception 'log_assignment_submitted: no such assignment' using errcode = 'check_violation';
  end if;
  if a.kind = 'upload' then
    insert into public.activity_log (org_id, athlete_id, actor_id, action, subject_type, subject_id, summary)
      values (a.org_id, a.athlete_id, caller, 'assignment_submitted', 'assignment', a.id, 'Submitted the upload assignment');
  elsif a.kind = 'complete_info' then
    insert into public.activity_log (org_id, athlete_id, actor_id, action, subject_type, subject_id, summary)
      values (a.org_id, a.athlete_id, caller, 'assignment_submitted', 'assignment', a.id, 'Submitted the information assignment');
  elsif a.kind = 'confirm' then
    insert into public.activity_log (org_id, athlete_id, actor_id, action, subject_type, subject_id, summary)
      values (a.org_id, a.athlete_id, caller, 'assignment_submitted', 'assignment', a.id, 'Submitted the confirmation assignment');
  else
    insert into public.activity_log (org_id, athlete_id, actor_id, action, subject_type, subject_id, summary)
      values (a.org_id, a.athlete_id, caller, 'assignment_submitted', 'assignment', a.id, 'Submitted the general assignment');
  end if;
end $$;

-- SECURITY DEFINER because the family has no write policy on the table
-- and none on documents, and must not be given one. What it accepts is
-- narrow on purpose:
--
--   - the caller is linked to the assignment's athlete right now
--     (private._family_athlete_ids(), which honours a link only while
--     the family membership lives), and the athlete is not removed;
--   - the row is assigned or needs_revision, nothing else;
--   - an upload assignment carries a file (or already has one from an
--     earlier submission that was sent back);
--   - a file, when there is one, sits at <org>/family/<request>/<file>
--     in the documents bucket, was put there by the caller, matches the
--     bucket's own size and type limits, and has not been filed before.
--
-- The org comes off the assignment, never from the caller. A file is
-- filed as a documents row with status 'filed' (never read by Doc AI,
-- never in Needs Review). p_content_hash is the hash the action computed
-- from the bytes it read back; the function cannot read bytes itself.
-- The activity line is written by private.log_assignment_submitted, whose
-- only parameter is the assignment's id and whose summaries are literals,
-- one per kind, so no note, title or name can reach the log (the same
-- line log_family_message holds in 0044).
--
-- Returns the assignment's id.

create or replace function public.submit_assignment(
  p_assignment uuid,
  p_note text,
  p_file_name text,
  p_file_size int,
  p_media_type text,
  p_storage_path text,
  p_content_hash text default null
) returns uuid
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  a public.assignments%rowtype;
  athlete_gone timestamptz;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  clean_file text := btrim(coalesce(p_file_name, ''));
  doc_id uuid;
  size_limit bigint;
  allowed_types text[];
begin
  if caller is null then
    raise exception 'submit_assignment: sign in first' using errcode = 'insufficient_privilege';
  end if;

  -- 1. The row, and the caller's link to its athlete. One message for a
  -- missing row and for a row that is not theirs, so the answer does not
  -- say which assignments exist.
  select * into a from public.assignments x where x.id = p_assignment for update;
  if not found or a.athlete_id not in (select private._family_athlete_ids()) then
    raise exception 'submit_assignment: not linked to that assignment' using errcode = 'insufficient_privilege';
  end if;
  select t.deleted_at into athlete_gone from public.athletes t where t.id = a.athlete_id;
  if athlete_gone is not null then
    raise exception 'submit_assignment: not linked to that assignment' using errcode = 'insufficient_privilege';
  end if;

  -- 2. Only work still open on the family's side.
  if a.status not in ('assigned', 'needs_revision') then
    raise exception 'submit_assignment: this assignment is not open for submission' using errcode = 'check_violation';
  end if;
  if length(coalesce(p_note, '')) > 4000 then
    raise exception 'submit_assignment: a note is 4,000 characters or fewer' using errcode = 'check_violation';
  end if;

  -- An upload assignment is answered with a file: this one, or the one an
  -- earlier submission attached before it was sent back.
  if a.kind = 'upload' and p_storage_path is null and a.document_id is null then
    raise exception 'submit_assignment: an upload assignment needs a file' using errcode = 'check_violation';
  end if;

  -- 3. A file, when there is one.
  if p_storage_path is not null then
    if p_storage_path !~ ('^' || a.org_id::text || '/family/[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$') or p_storage_path ~ '/\.\.?$' then
      raise exception 'submit_assignment: a file must be under this organization''s family folder' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'documents' and o.name = p_storage_path and o.owner = caller
    ) then
      raise exception 'submit_assignment: that file was not uploaded by you' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.documents d where p_storage_path = any (d.storage_paths)) then
      raise exception 'submit_assignment: that file is already filed' using errcode = 'check_violation';
    end if;
    if clean_file = '' or length(clean_file) > 200 or coalesce(p_file_size, 0) <= 0 or btrim(coalesce(p_media_type, '')) = '' then
      raise exception 'submit_assignment: a file needs a name, a size and a type' using errcode = 'check_violation';
    end if;
    select b.file_size_limit, b.allowed_mime_types into size_limit, allowed_types from storage.buckets b where b.id = 'documents';
    if size_limit is not null and p_file_size > size_limit then
      raise exception 'submit_assignment: that file is over the size limit' using errcode = 'check_violation';
    end if;
    if allowed_types is not null and not (p_media_type = any (allowed_types)) then
      raise exception 'submit_assignment: that file type is not accepted' using errcode = 'check_violation';
    end if;

    insert into public.documents (org_id, athlete_id, file_name, file_size, media_type, source_role, status, storage_paths, content_hash)
      values (a.org_id, a.athlete_id, clean_file, p_file_size, p_media_type, 'parent', 'filed', array[p_storage_path], nullif(btrim(coalesce(p_content_hash, '')), ''))
      returning id into doc_id;
  end if;

  -- 4. The state change. A resubmission without a new file keeps the
  -- earlier document.
  update public.assignments
    set status = 'submitted',
        family_note = clean_note,
        submitted_at = now(),
        document_id = coalesce(doc_id, a.document_id)
    where id = a.id;

  -- 5. The log line, in the same transaction, signed as the caller.
  perform private.log_assignment_submitted(a.id);

  return a.id;
end $$;

comment on function public.submit_assignment(uuid, text, text, int, text, text, text) is
  'Moves an assigned or needs_revision assignment to submitted for the calling Athlete login, filing the uploaded file as a document with status filed, and logs "Submitted the ... assignment". Refuses a caller not linked to the athlete. The note never reaches the log.';

-- ── 6. A family login may add a file under its org's family folder ───
-- One new policy, no existing policy changes. The second folder being
-- 'family' is load-bearing: without it a family login could drop a file
-- into a staff upload's request folder, which the document reader would
-- later read back as its own. A family login reads nothing back from
-- the bucket, its own upload included (0017, 0024), and deletes nothing.

drop policy if exists documents_bucket_family_insert on storage.objects;
create policy documents_bucket_family_insert on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id)
    and (storage.foldername(name))[2] = 'family'
    -- Exactly <org>/family/<request>/<file>: the two folders above and a
    -- file, nothing flatter (a name that would read as a staff request's
    -- own path) and nothing deeper. submit_assignment holds the same shape.
    and array_length(storage.foldername(name), 1) = 3
  );

-- ── Grants ───────────────────────────────────────────────────────────
-- The local RLS harness has neither Supabase role until 0033 creates
-- them; created here too so this file applies on its own.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

-- Nothing here is for a signed-out caller.
revoke all on public.assignments from anon;

-- Two revokes, as in 0033: `from public` drops the default grant every
-- new function gets, `from anon` drops the one Supabase's default
-- privileges add in this schema.
revoke execute on function public.submit_assignment(uuid, text, text, int, text, text, text) from public, anon;
grant execute on function public.submit_assignment(uuid, text, text, int, text, text, text) to authenticated;

-- The log helper is for submit_assignment alone, which runs as its owner.
revoke execute on function private.log_assignment_submitted(uuid) from public, anon, authenticated;
