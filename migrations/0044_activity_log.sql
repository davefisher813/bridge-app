-- Stage 5, Phase 6: the activity log. Dave approved the plan 2026-09-27
-- (docs/PLAN_STAGE5.md, "Phase 6: Activity Log").
--
-- An append-only, org-scoped record of who did what to what. Every
-- listed server action writes one row after its own write succeeds;
-- Admins (owner, and any leftover staff row) read their org's rows; a
-- Viewer (member), an Athlete login (family), another org and a
-- signed-out caller read nothing and write nothing, with one exception
-- below. Nobody updates or deletes a row: there is no policy for
-- either, for anyone, and a trigger refuses an update even from the
-- service role.
--
-- A summary is a short sentence built from a fixed template per action
-- ("Moved Fixture Athlete to Committed", "Logged a call check-in",
-- "Sent a message"). It never carries the text of a check-in note, a
-- message or a document reading. The app holds that line with a branded
-- type (src/lib/data/activity.ts) and a law (src/laws/activityLaws
-- .test.ts); this file holds it for the one function that writes a row
-- on a family's behalf, whose summary is a literal in its body and
-- whose signature has no text parameter.
--
-- Five things here:
--
-- 1. activity_action: the closed list of things the log records. A new
--    kind of event is an enum addition in its own migration.
-- 2. activity_log: the table. athlete_id is set null on delete, never
--    cascaded: Remove Athlete is a soft delete, and history outlives a
--    hard delete elsewhere. actor_id likewise, so a departed person's
--    rows stay in the record.
-- 3. Coherence: a row that names an athlete carries that athlete's own
--    org (the function from 0039), fired only when athlete_id is set,
--    because member and view-as rows name no athlete.
-- 4. Honesty: the server sets the time and, for an ordinary session,
--    the actor; any update raises. The one update let through is the
--    foreign keys' own on delete set null on athlete_id or actor_id,
--    which is Postgres keeping the row when its subject or author goes.
-- 5. log_family_message(p_athlete): the one write a family login makes
--    here, through a SECURITY DEFINER function, because no insert policy
--    on this table admits a family session and none should. The caller
--    must be linked to that athlete (private._family_athlete_ids(),
--    which honours a link only while the membership lives) and must have
--    a message on it not yet logged. The org is
--    read from the athlete, the summary is the literal "Sent a message"
--    and the message body never enters the signature.
--
-- No data rows, no org named, no id literal (src/laws/migrationLaws.test.ts).

-- ── 1. What the log records ──────────────────────────────────────────

create type activity_action as enum (
  'athlete_created', 'athlete_edited', 'athlete_status_changed', 'athlete_removed',
  'advisor_set', 'advisor_cleared',
  'target_added', 'target_status_changed', 'target_removed',
  'assignment_created', 'assignment_submitted', 'assignment_reviewed', 'assignment_cancelled',
  'document_uploaded', 'document_applied', 'document_discarded',
  'checkin_logged', 'message_sent',
  'member_invited', 'member_role_changed', 'member_removed',
  'view_as_started', 'view_as_ended'
);

-- ── 2. The log ───────────────────────────────────────────────────────

create table activity_log (
  id            uuid primary key default uuid_generate_v4(),
  org_id        uuid not null references orgs(id) on delete cascade,
  -- Which athlete this is about, when it is about one. Set null, not
  -- cascade: the record outlives the row it describes.
  athlete_id    uuid references athletes(id) on delete set null,
  -- Who did it. Set by the honesty trigger from the session; kept as
  -- history if they leave.
  actor_id      uuid references users(id) on delete set null,
  action        activity_action not null,
  subject_type  text not null check (subject_type in ('athlete', 'target', 'assignment', 'document', 'checkin', 'message', 'member', 'view_as')),
  -- The row the action touched, when there is one to point at.
  subject_id    uuid,
  -- The sentence a screen shows. Built from a template, never typed.
  summary       text not null check (length(btrim(summary)) between 1 and 200),
  created_at    timestamptz not null default now()
);

create index activity_log_org_idx on activity_log (org_id, created_at desc);
create index activity_log_athlete_idx on activity_log (athlete_id, created_at desc);
create index activity_log_actor_idx on activity_log (actor_id);

comment on table activity_log is
  'Append-only record of who did what to what, per org. Read by Admins only. A summary is a template sentence and never carries note, message or document text.';

-- ── 3. Coherence: a row about an athlete carries that athlete's org ──
-- Rows about a member or a View As session name no athlete and skip it.

create trigger activity_log_coherent
  before insert or update on activity_log
  for each row when (new.athlete_id is not null)
  execute function private.athlete_row_is_coherent();

-- ── 4. Honesty: the server's clock, the session's actor, no rewrites ─
-- On insert the time is now() whatever the caller sent, and for an
-- ordinary signed-in session the actor is the session itself, so a row
-- cannot be signed in someone else's name or dated into the past or
-- the future. The service role (auth.uid() is null) keeps the actor it
-- names, which is how a server action running as the server records who
-- asked for it; the insert policy below still holds an ordinary client
-- to actor_id = auth.uid().
--
-- On update, only the foreign keys' own on delete set null passes: the
-- athlete or the actor going null with every other column unchanged.
-- Anything else raises, superuser included, so there is no path to
-- reword, redate or re-sign a row once it is in the log.
create or replace function private.activity_is_honest() returns trigger
  language plpgsql
  set search_path = public
  as $$
declare
  session_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    if session_uid is not null then
      new.actor_id := session_uid;
    end if;
    return new;
  end if;

  if (new.athlete_id is null or new.athlete_id = old.athlete_id)
     and (new.actor_id is null or new.actor_id = old.actor_id)
     and (new.athlete_id is distinct from old.athlete_id or new.actor_id is distinct from old.actor_id)
     and new.id = old.id
     and new.org_id = old.org_id
     and new.action = old.action
     and new.subject_type = old.subject_type
     and new.subject_id is not distinct from old.subject_id
     and new.summary = old.summary
     and new.created_at = old.created_at then
    return new;
  end if;

  raise exception 'activity_log: a row is never rewritten, redated or re-signed'
    using errcode = 'check_violation';
end $$;

create trigger activity_log_honest
  before insert or update on activity_log
  for each row execute function private.activity_is_honest();

-- ── Policies ─────────────────────────────────────────────────────────
-- Read and insert only. No update or delete policy exists for anyone,
-- and none is to be added: the plan's RLS suite asserts an Admin's
-- update and delete each touch 0 rows.
--
-- Read is keyed off private._staff_org_ids(), not _member_org_ids(), so
-- the intent (Admins only) survives if the member helper is ever
-- widened again the way 0031 narrowed it.

alter table activity_log enable row level security;

create policy activity_log_read on activity_log for select
  using (org_id in (select private._staff_org_ids()));

-- Signed by the session, on the session's own org. The honesty trigger
-- rewrites actor_id to the session first, so an insert naming somebody
-- else lands as the caller, never as that somebody; the actor_id clause
-- here is the second lock on the same door (the RLS suite passes with
-- either one alone, and keeps both).
create policy activity_log_insert on activity_log for insert
  with check (org_id in (select private._staff_org_ids()) and actor_id = (select auth.uid()));

-- ── 5. A family login's one write: "Sent a message" ──────────────────
-- SECURITY DEFINER, because the insert policy admits Admins only and a
-- family session must not be admitted to the table itself. The caller
-- has to be linked to the athlete right now; the org comes off the
-- athlete's row, never from the caller; the summary is a literal. There
-- is no text parameter and nothing the caller sends reaches summary.

create or replace function public.log_family_message(p_athlete uuid) returns void
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  athlete_org uuid;
begin
  if caller is null then
    raise exception 'log_family_message: sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_athlete is null or p_athlete not in (select private._family_athlete_ids()) then
    raise exception 'log_family_message: not linked to that athlete' using errcode = 'insufficient_privilege';
  end if;
  select a.org_id into athlete_org from public.athletes a where a.id = p_athlete;
  if athlete_org is null then
    raise exception 'log_family_message: not linked to that athlete' using errcode = 'insufficient_privilege';
  end if;
  -- A line is written only for a message that exists: the caller must
  -- have one on this athlete newer than their last logged one, so the
  -- function cannot be called on its own to write "Sent a message" rows
  -- with nothing behind them.
  if not exists (
    select 1 from public.athlete_messages m
    where m.athlete_id = p_athlete and m.author_id = caller
      and m.created_at > coalesce(
        (select max(l.created_at) from public.activity_log l
          where l.actor_id = caller and l.athlete_id = p_athlete and l.action = 'message_sent'),
        '-infinity'::timestamptz)
  ) then
    raise exception 'log_family_message: no unlogged message from you on that athlete' using errcode = 'insufficient_privilege';
  end if;
  insert into public.activity_log (org_id, athlete_id, actor_id, action, subject_type, subject_id, summary)
    values (athlete_org, p_athlete, caller, 'message_sent', 'message', null, 'Sent a message');
end $$;

comment on function public.log_family_message(uuid) is
  'Records "Sent a message" on an athlete''s activity log for the calling family login. Refuses a caller not linked to that athlete. Takes no text: the message body never reaches the log.';

-- ── Grants ───────────────────────────────────────────────────────────
-- The local RLS harness has neither Supabase role until 0033 creates
-- them; created here too so this file applies on its own.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

-- Nothing here is for a signed-out caller.
revoke all on public.activity_log from anon;

-- Two revokes, as in 0033: `from public` drops the default grant every
-- new function gets, `from anon` drops the one Supabase's default
-- privileges add in this schema.
revoke execute on function public.log_family_message(uuid) from public, anon;
grant execute on function public.log_family_message(uuid) to authenticated;
