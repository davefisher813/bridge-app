-- Stage 3: an advisor and the athlete's family connected.
--
-- Dave's brief, 2026-09-26, paraphrased: every athlete has one person on
-- staff who checks in with them; staff log those check-ins; staff and
-- the athlete's family talk through the app instead of around it; and a
-- board member never sees any of it.
--
-- Four things here:
--
-- 1. athletes.advisor_id: the owner or staff member who checks in with
--    this athlete. Display and reminders only, never permissions. A
--    trigger holds it to owner or staff of the athlete's own org,
--    because the anon key ships to the browser and an app-only check is
--    one PostgREST call from being skipped.
-- 2. athlete_checkins: the check-in log. STAFF ONLY, read and write.
--    These athletes are minors and a call note is written for staff; row
--    level security cannot hide a column, so the family gets no row at
--    all rather than a page that leaves the notes out. A board member
--    reads nothing either, since private._member_org_ids() admits only
--    owner and staff (migration 0031).
-- 3. athlete_messages: one flat thread per athlete between staff and
--    that athlete's family. This is the FIRST table a family login may
--    write: exactly one kind of row, a message they author, on an
--    athlete they are linked to. Update and delete stay with staff.
-- 4. athlete_message_reads: one watermark per person per thread, which
--    is what an unread count is computed from. A family writes their own.
--
-- Every row in the three tables carries a denormalised org_id (the rule
-- in 0004), and a coherence trigger keeps it equal to the athlete's org.
-- Without that, somebody who is family in two orgs could file a Bridge
-- athlete's message under Elite Squad's org_id, where Elite's staff
-- would read it.

-- ── 1. The advisor ───────────────────────────────────────────────────

alter table athletes add column advisor_id uuid references users(id) on delete set null;

create index athletes_advisor_idx on athletes (advisor_id);

comment on column athletes.advisor_id is
  'The owner or staff member who checks in with this athlete. Null until someone is picked on the Edit screen. Display and reminders only, never permissions.';

-- A member (Bridge: Board) or a family login cannot advise, and neither
-- can somebody from another org. Same shape and errcode as the guardian
-- trigger in 0023. Fires only when the advisor or the org changes, so
-- an ordinary edit of an athlete never re-checks it.
create or replace function private.advisor_is_staff() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  if new.advisor_id is not null and not exists (
    select 1 from org_members m
    where m.user_id = new.advisor_id and m.org_id = new.org_id and m.role in ('owner', 'staff')
  ) then
    raise exception 'athletes: advisor % is not owner or staff of org %', new.advisor_id, new.org_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger athletes_advisor_is_staff
  before insert or update of advisor_id, org_id on athletes
  for each row execute function private.advisor_is_staff();

-- ── 2. The check-in log ──────────────────────────────────────────────

create type athlete_checkin_kind as enum ('call', 'meeting', 'text', 'other');

create table athlete_checkins (
  id           uuid primary key default uuid_generate_v4(),
  org_id       uuid not null references orgs(id) on delete cascade,
  athlete_id   uuid not null references athletes(id) on delete cascade,
  -- Who checked in. Kept as history if they leave.
  advisor_id   uuid references users(id) on delete set null,
  kind         athlete_checkin_kind not null,
  occurred_on  date not null default current_date,
  -- Staff only. Never read by the family (see the header).
  notes        text,
  created_at   timestamptz not null default now()
);

create index athlete_checkins_athlete_idx on athlete_checkins (athlete_id, occurred_on desc);
create index athlete_checkins_org_idx on athlete_checkins (org_id);
create index athlete_checkins_advisor_idx on athlete_checkins (advisor_id);

-- ── 3. The thread ────────────────────────────────────────────────────

create table athlete_messages (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references orgs(id) on delete cascade,
  athlete_id  uuid not null references athletes(id) on delete cascade,
  -- Set null, not cascade: a departed person's messages stay in the record.
  author_id   uuid references users(id) on delete set null,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);

create index athlete_messages_athlete_idx on athlete_messages (athlete_id, created_at);
create index athlete_messages_org_idx on athlete_messages (org_id);
create index athlete_messages_author_idx on athlete_messages (author_id);

-- ── 4. Read markers ──────────────────────────────────────────────────
-- One row per person per thread, upserted when the thread is opened.
-- Messages by others newer than read_at are the unread count.

create table athlete_message_reads (
  org_id      uuid not null references orgs(id) on delete cascade,
  athlete_id  uuid not null references athletes(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  read_at     timestamptz not null default now(),
  primary key (athlete_id, user_id)
);

create index athlete_message_reads_org_idx on athlete_message_reads (org_id);
create index athlete_message_reads_user_idx on athlete_message_reads (user_id);

-- ── Coherence: a row's org is its athlete's org ──────────────────────
-- One function for all three tables. The family insert policies below
-- admit a row by athlete_id, so without this a family login could name
-- any org_id it liked on a row about its own athlete.
create or replace function private.athlete_row_is_coherent() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  if not exists (select 1 from athletes a where a.id = new.athlete_id and a.org_id = new.org_id) then
    raise exception '%: athlete % is not in org %', tg_table_name, new.athlete_id, new.org_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger athlete_checkins_coherent
  before insert or update on athlete_checkins
  for each row execute function private.athlete_row_is_coherent();

create trigger athlete_messages_coherent
  before insert or update on athlete_messages
  for each row execute function private.athlete_row_is_coherent();

create trigger athlete_message_reads_coherent
  before insert or update on athlete_message_reads
  for each row execute function private.athlete_row_is_coherent();

-- ── A message says who wrote it and when, and nobody rewrites either ─
-- The insert policy holds author_id to the caller, but the columns are
-- otherwise the caller's to fill: a family login could date a message
-- 2099 (unread for staff forever, last in the thread) or backdate one,
-- and staff, who may update, could insert as themselves and then re-sign
-- the row as the parent. So the clock is the server's on insert, and an
-- update may change neither the author nor the time. The one exception
-- is author_id going null, which is the foreign key's on delete set null
-- when the author's account is deleted.
create or replace function private.athlete_message_is_honest() returns trigger
  language plpgsql
  set search_path = public
  as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
  elsif (new.author_id is not null and new.author_id is distinct from old.author_id)
     or new.created_at is distinct from old.created_at
     or new.body is distinct from old.body
     or new.athlete_id is distinct from old.athlete_id then
    raise exception 'athlete_messages: a message keeps its author, its time, its words and its thread'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger athlete_messages_honest
  before insert or update on athlete_messages
  for each row execute function private.athlete_message_is_honest();

-- ── Policies ─────────────────────────────────────────────────────────
-- The standard four per table, helpers by their private names, no
-- `for all`. private._member_org_ids() is owner and staff only since
-- 0031, so a member reads nothing from any of the three.

alter table athlete_checkins enable row level security;
alter table athlete_messages enable row level security;
alter table athlete_message_reads enable row level security;

-- Check-ins: staff only. No family clause, on purpose (see the header).
create policy athlete_checkins_read on athlete_checkins for select
  using (org_id in (select private._member_org_ids()));
-- A check-in is signed by whoever logs it, never in someone else's name.
create policy athlete_checkins_insert on athlete_checkins for insert
  with check (org_id in (select private._staff_org_ids()) and (advisor_id is null or advisor_id = (select auth.uid())));
create policy athlete_checkins_update on athlete_checkins for update
  using (org_id in (select private._staff_org_ids()))
  with check (org_id in (select private._staff_org_ids()) and (advisor_id is null or advisor_id = (select auth.uid())));
create policy athlete_checkins_delete on athlete_checkins for delete
  using (org_id in (select private._staff_org_ids()));

-- Messages: staff and the athlete's family read the thread; either may
-- add to it, only as themselves. Nobody rewrites a message once sent
-- (the honesty trigger); only staff remove one.
create policy athlete_messages_read on athlete_messages for select
  using (org_id in (select private._member_org_ids()) or athlete_id in (select private._family_athlete_ids()));
create policy athlete_messages_insert on athlete_messages for insert
  with check (
    author_id = (select auth.uid())
    and (org_id in (select private._staff_org_ids()) or athlete_id in (select private._family_athlete_ids()))
  );
create policy athlete_messages_update on athlete_messages for update
  using (org_id in (select private._staff_org_ids()))
  with check (org_id in (select private._staff_org_ids()));
create policy athlete_messages_delete on athlete_messages for delete
  using (org_id in (select private._staff_org_ids()));

-- Read markers: your own, on a thread you may read. Staff see the org's
-- markers; a family login sees only its own.
create policy athlete_message_reads_read on athlete_message_reads for select
  using (user_id = (select auth.uid()) or org_id in (select private._member_org_ids()));
create policy athlete_message_reads_insert on athlete_message_reads for insert
  with check (
    user_id = (select auth.uid())
    and (org_id in (select private._staff_org_ids()) or athlete_id in (select private._family_athlete_ids()))
  );
create policy athlete_message_reads_update on athlete_message_reads for update
  using (
    user_id = (select auth.uid())
    and (org_id in (select private._staff_org_ids()) or athlete_id in (select private._family_athlete_ids()))
  )
  with check (
    user_id = (select auth.uid())
    and (org_id in (select private._staff_org_ids()) or athlete_id in (select private._family_athlete_ids()))
  );
create policy athlete_message_reads_delete on athlete_message_reads for delete
  using (org_id in (select private._staff_org_ids()));
