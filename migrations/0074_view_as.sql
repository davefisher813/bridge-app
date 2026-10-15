-- Stage 5, Phase 5: View As. Dave approved the plan 2026-09-27
-- (docs/PLAN_STAGE5.md, "Phase 5: View As").
--
-- An Admin sees exactly what a chosen Athlete login, Viewer or other
-- Admin sees, read only, for at most 30 minutes. This file is the
-- database half of that. It works by changing whose identity the row
-- policies evaluate, on the Admin's own token. It mints nothing: no
-- token, no session, no credential for another person exists anywhere,
-- and nothing reads on anyone's behalf with the service role. The
-- caller's own auth.uid() never changes; a row in view_as_sessions,
-- which only the two functions below can write, says "while this row
-- is live, evaluate policies as that person". The plan's option D2.
--
-- Nine things here:
--
-- 1. view_as_sessions: one row per View As, for one Admin, one target,
--    one org, with an expiry no more than 30 minutes out. At most one
--    live row per Admin (a partial unique index). No policy admits an
--    insert, update or delete from anyone, and the grants are taken
--    away as well: the two functions in 7 are the only writers.
-- 2. Coherence, on insert: the viewer is an owner of the row's org, the
--    target is a member of that same org, the expiry is at most 30
--    minutes from now. Fired for the service role and a superuser too,
--    so no path sets the effective identity to someone outside the org.
--    On update only ended_at and end_reason may change, so a session
--    cannot be extended or pointed at someone else.
-- 3. private._view_target(), _view_org(), _effective_uid(), _viewing():
--    the effective identity. Live means not ended, not expired, the
--    viewer still an owner of the org and the target still a member of
--    it. A demoted Admin or a removed target ends the effect at once.
--    private._owner_org_ids() answers on the REAL uid, for the one
--    policy that must not follow the switch.
-- 4. The nine access helpers, re-created on _effective_uid() and,
--    while viewing, limited to the org being viewed. (The plan counted
--    seven; the catalog holds nine.) The scope is a strengthening of the
--    plan: a person who also belongs to a second org shows the Admin
--    nothing of that second org.
-- 5. The read policies that compared the caller to a column inline,
--    re-created on the effective uid, for the same reason.
-- 6. Every INSERT, UPDATE and DELETE policy in public and in
--    storage.objects gains "and not private._viewing()", found in the
--    catalog rather than listed by hand (the 0015 precedent).
--    scripts/rls_test.sql asks the catalog again and fails on any
--    write policy without it, and on any read policy still naming
--    auth.uid().
-- 7. start_view_as and end_view_as, SECURITY DEFINER, the only writers
--    of view_as_sessions and the only writes allowed while viewing.
--    Each writes its own activity_log line, signed by the real caller.
--    The sentence is a literal in the function body, one per role
--    viewed ("Started viewing as an Admin", a Viewer, an Athlete) and
--    one per way it ended: src/laws/activityLaws.test.ts holds every
--    function that writes the log to literals, no text parameter and no
--    concatenation, the same line log_family_message holds. The
--    person is the row's subject (subject_id is the session, which
--    names both people for the Admin who owns it). An expired row is
--    closed lazily by the next start or end, with its line.
-- 8. The four functions that write or read as the caller and are not
--    policies: create_org, log_family_message and submit_assignment
--    refuse while viewing (they are SECURITY DEFINER, so no policy
--    stops them), and member_giving reads the effective seat.
-- 9. Grants: nothing for anon, execute for signed-in callers only.
--
-- No data rows, no org named, no id literal (src/laws/migrationLaws.test.ts).

-- ── 1. The table ─────────────────────────────────────────────────────

create table view_as_sessions (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references orgs(id) on delete cascade,
  viewer_id   uuid not null references users(id) on delete cascade,
  target_id   uuid not null references users(id) on delete cascade,
  started_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  ended_at    timestamptz,
  end_reason  text check (end_reason in ('returned', 'expired')),
  check (viewer_id <> target_id),
  check (expires_at > started_at),
  check ((ended_at is null) = (end_reason is null))
);

create index view_as_sessions_org_idx on view_as_sessions (org_id, viewer_id);
create index view_as_sessions_viewer_idx on view_as_sessions (viewer_id);
create index view_as_sessions_target_idx on view_as_sessions (target_id);
-- One live session per Admin. "Live" here is "not ended"; an expired row
-- that nobody has closed yet still holds the slot until the next start
-- or end closes it (lazy expiry, section 7).
create unique index view_as_sessions_one_active on view_as_sessions (viewer_id) where ended_at is null;

comment on table view_as_sessions is
  'One row per View As: an Admin (viewer_id) evaluating the org''s policies as target_id for at most 30 minutes. Written only by start_view_as and end_view_as. Read by the Admin who started it.';

-- ── 2. Coherence and immutability ────────────────────────────────────

-- SECURITY DEFINER so it reads org_members whole: as the invoker it would
-- read through the caller's row policies, which while viewing answer for
-- the person being viewed, and would find no owner row for the Admin.
create or replace function private.view_as_is_coherent() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
declare
  viewer_role org_role;
  target_role org_role;
begin
  if tg_op = 'INSERT' then
    -- The server's clock, whatever the caller sent.
    new.started_at := now();
    select role into viewer_role from org_members where user_id = new.viewer_id and org_id = new.org_id;
    if viewer_role is distinct from 'owner' then
      raise exception 'view_as_sessions: only an owner of the organization can view as someone in it'
        using errcode = 'check_violation';
    end if;
    select role into target_role from org_members where user_id = new.target_id and org_id = new.org_id;
    if target_role is null then
      raise exception 'view_as_sessions: the target is not a member of that organization'
        using errcode = 'check_violation';
    end if;
    if new.expires_at > now() + interval '30 minutes' then
      raise exception 'view_as_sessions: a session lasts 30 minutes at most'
        using errcode = 'check_violation';
    end if;
    return new;
  end if;

  -- Update: a session is only ever ended. Who, where, since when and
  -- until when are fixed, and an ended session stays ended.
  if new.id = old.id
     and new.org_id = old.org_id
     and new.viewer_id = old.viewer_id
     and new.target_id = old.target_id
     and new.started_at = old.started_at
     and new.expires_at = old.expires_at
     and old.ended_at is null then
    return new;
  end if;
  raise exception 'view_as_sessions: a session can only be ended, never changed'
    using errcode = 'check_violation';
end $$;

create trigger view_as_sessions_coherent
  before insert or update on view_as_sessions
  for each row execute function private.view_as_is_coherent();

-- ── 3. The effective identity ────────────────────────────────────────
-- _view_target() answers for the REAL caller: the person they are
-- viewing as right now, or null. It is the only reader of
-- view_as_sessions for identity, and nothing the caller sends reaches
-- it: the answer is a row in a table only the two functions in 7 write.
--
-- Live means all of: not ended, not past expires_at, the viewer still an
-- owner of the org, the target still a member of it.

create or replace function private._view_target() returns uuid
  language sql stable security definer
  set search_path = ''
  as $$
    select s.target_id
    from public.view_as_sessions s
    where s.viewer_id = auth.uid()
      and s.ended_at is null
      and s.expires_at > now()
      and exists (select 1 from public.org_members v where v.user_id = s.viewer_id and v.org_id = s.org_id and v.role = 'owner')
      and exists (select 1 from public.org_members t where t.user_id = s.target_id and t.org_id = s.org_id)
    limit 1
  $$;

-- The org being viewed, or null. Every helper below limits itself to it
-- while a session is live.
create or replace function private._view_org() returns uuid
  language sql stable security definer
  set search_path = ''
  as $$
    select s.org_id
    from public.view_as_sessions s
    where s.viewer_id = auth.uid()
      and s.ended_at is null
      and s.expires_at > now()
      and exists (select 1 from public.org_members v where v.user_id = s.viewer_id and v.org_id = s.org_id and v.role = 'owner')
      and exists (select 1 from public.org_members t where t.user_id = s.target_id and t.org_id = s.org_id)
    limit 1
  $$;

-- Whose eyes every policy and helper uses: the target while a session is
-- live, the caller otherwise. For a signed-out caller both are null.
-- SECURITY DEFINER only so that reading auth.uid() needs no grant on the
-- auth schema from the caller; auth.uid() itself is the caller's, as a
-- definer function still sees the session's claims.
create or replace function private._effective_uid() returns uuid
  language sql stable security definer
  set search_path = ''
  as $$ select coalesce(private._view_target(), auth.uid()) $$;

create or replace function private._viewing() returns boolean
  language sql stable
  set search_path = ''
  as $$ select private._view_target() is not null $$;

-- The orgs the REAL caller owns. Used by the one policy that must not
-- follow the switch (view_as_sessions), so an Admin who is viewing a
-- Viewer still reads their own sessions and can end one.
create or replace function private._owner_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role = 'owner' $$;

grant execute on function private._view_target() to public;
grant execute on function private._view_org() to public;
grant execute on function private._effective_uid() to public;
grant execute on function private._viewing() to public;
grant execute on function private._owner_org_ids() to public;

-- ── 4. The nine access helpers on the effective identity ─────────────
-- Same bodies as 0023, 0031 and the rest, with auth.uid() replaced by
-- private._effective_uid() and, on every org_members read,
-- "coalesce(private._view_org(), org_id) = org_id": with no session that
-- is org_id = org_id (true); with one it is "the org being viewed".

create or replace function private._any_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select org_id from org_members
    where user_id = private._effective_uid()
      and coalesce(private._view_org(), org_id) = org_id
  $$;

create or replace function private._family_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select org_id from org_members
    where user_id = private._effective_uid() and role = 'family'
      and coalesce(private._view_org(), org_id) = org_id
  $$;

create or replace function private._member_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select org_id from org_members
    where user_id = private._effective_uid() and role in ('owner', 'staff')
      and coalesce(private._view_org(), org_id) = org_id
  $$;

create or replace function private._staff_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select org_id from org_members
    where user_id = private._effective_uid() and role in ('owner', 'staff')
      and coalesce(private._view_org(), org_id) = org_id
  $$;

create or replace function private._observer_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select org_id from org_members
    where user_id = private._effective_uid() and role = 'member'
      and coalesce(private._view_org(), org_id) = org_id
  $$;

create or replace function private._family_athlete_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select g.athlete_id
    from athlete_guardians g
    join org_members m on m.user_id = g.user_id and m.org_id = g.org_id and m.role = 'family'
    where g.user_id = private._effective_uid()
      and coalesce(private._view_org(), g.org_id) = g.org_id
  $$;

create or replace function private._family_staff_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (
        select f.org_id from org_members f
        where f.user_id = private._effective_uid() and f.role = 'family'
          and coalesce(private._view_org(), f.org_id) = f.org_id
      )
  $$;

create or replace function private._family_staff_rows() returns table (org_id uuid, user_id uuid)
  language sql stable security definer
  set search_path = public
  as $$
    select m.org_id, m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (
        select f.org_id from org_members f
        where f.user_id = private._effective_uid() and f.role = 'family'
          and coalesce(private._view_org(), f.org_id) = f.org_id
      )
  $$;

create or replace function private._observer_staff_rows() returns table (org_id uuid, user_id uuid)
  language sql stable security definer
  set search_path = public
  as $$
    select m.org_id, m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (
        select o.org_id from org_members o
        where o.user_id = private._effective_uid() and o.role = 'member'
          and coalesce(private._view_org(), o.org_id) = o.org_id
      )
  $$;

-- ── 5. The read policies that compared the caller inline ─────────────
-- Same meaning as 0031, 0039 and the grading-scale policy, on the
-- effective identity, and limited to the org being viewed where the row
-- carries an org.

alter policy org_members_self on org_members
  using (
    (user_id = (select private._effective_uid()) and coalesce(private._view_org(), org_id) = org_id)
    or org_id in (select private._member_org_ids())
    or (org_id, user_id) in (select r.org_id, r.user_id from private._family_staff_rows() r)
    or (org_id, user_id) in (select r.org_id, r.user_id from private._observer_staff_rows() r)
  );

alter policy users_self on users
  using (id = (select private._effective_uid()));

alter policy athlete_guardians_read on athlete_guardians
  using (
    org_id in (select private._member_org_ids())
    or (user_id = (select private._effective_uid()) and coalesce(private._view_org(), org_id) = org_id)
  );

alter policy athlete_message_reads_read on athlete_message_reads
  using (
    (user_id = (select private._effective_uid()) and coalesce(private._view_org(), org_id) = org_id)
    or org_id in (select private._member_org_ids())
  );

alter policy grading_scales_readable on high_school_grading_scales
  using ((select private._effective_uid()) is not null);

-- ── 6. Every write policy is refused while viewing ───────────────────
-- Discovered from the catalog, not remembered: every INSERT, UPDATE and
-- DELETE policy in public and storage gets "and not private._viewing()"
-- on the side that decides it (with check for insert, using for delete,
-- and for update using, plus with check where the policy has one, since
-- an update policy without a with check reuses its using). A policy that
-- already carries the gate is left alone, so a second run changes
-- nothing. A `for all` policy would take both sides.
--
-- For an update or delete the gate is in using, so a viewing Admin's
-- statement finds no row and affects 0; for an insert it is a policy
-- violation (42501).
--
-- The gate is written "(select private._viewing())", not bare, on purpose:
-- a bare STABLE function in a policy is called once per row (a 50,000 row
-- delete took 9 seconds that way and 21 ms with the select), while the
-- select is an initplan, evaluated once per statement (the 0016 rule for
-- auth.uid()). scripts/rls_test.sql fails any write policy that is gated
-- the bare way.
do $$
declare
  p record;
  new_qual text;
  new_check text;
  cmd text;
  gated integer := 0;
begin
  for p in
    select pol.polname as policyname,
           c.relname as tablename,
           n.nspname as schemaname,
           pol.polcmd as polcmd,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as withcheck
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'storage')
      and pol.polcmd in ('a', 'w', 'd', '*')
      and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') not like '%_viewing()%'
    order by n.nspname, c.relname, pol.polname
  loop
    new_qual := case when p.qual is not null and p.polcmd in ('w', 'd', '*')
                     then format('(%s) and not (select private._viewing())', p.qual) end;
    new_check := case when p.withcheck is not null and p.polcmd in ('a', 'w', '*')
                      then format('(%s) and not (select private._viewing())', p.withcheck) end;
    -- An insert policy carries only a with check; if one somehow has
    -- none, the gate alone would replace "always true", which is the same.
    if p.polcmd = 'a' and new_check is null then
      new_check := 'not (select private._viewing())';
    end if;

    cmd := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then cmd := cmd || format(' using (%s)', new_qual); end if;
    if new_check is not null then cmd := cmd || format(' with check (%s)', new_check); end if;
    execute cmd;
    gated := gated + 1;
  end loop;
  raise notice '0047: gated % write policies against viewing', gated;
end $$;

-- ── The table's own policy, and its grants ───────────────────────────
-- Read: the Admin who started the session, on an org they own, on their
-- REAL uid, so the row stays visible while viewing (the banner and
-- Return need it). No insert, update or delete policy exists, for
-- anyone. The grants go too, for anon and signed-in roles alike; only
-- the definer functions write.

alter table view_as_sessions enable row level security;

create policy view_as_sessions_read on view_as_sessions for select
  using (org_id in (select private._owner_org_ids()) and viewer_id = (select auth.uid()));

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

revoke all on public.view_as_sessions from anon;
revoke insert, update, delete, truncate on public.view_as_sessions from authenticated;

-- ── 7. start_view_as and end_view_as ─────────────────────────────────
-- The only writers of view_as_sessions. Both are SECURITY DEFINER and
-- both read the REAL caller (auth.uid()), never the effective one: an
-- Admin who is viewing as someone can end that, and cannot start
-- another, and nobody can start one on another person's behalf.
--
-- Start is refused for: a signed-out caller; anyone who is not an owner
-- of the org named (a Viewer, an Athlete login, a leftover staff row, a
-- member of another org, someone in no org); the caller themself; a
-- target who is not a member of that org (one answer for "no such
-- person" and "not in your org", so it does not say who exists); a
-- caller with a session already live. It writes one row and one
-- activity_log line, and returns the session id.
--
-- The line's sentence is a literal in the body, never built from a name
-- or a parameter (src/laws/activityLaws.test.ts): "Started viewing as
-- an Admin", "a Viewer" or "an Athlete", by the role of the person
-- viewed. The activity.ts templates for view_as_started and
-- view_as_ended, which take a name, are for a caller with a name to
-- hand; these two functions have none they are allowed to use.

-- One session's end, with its line. A session already ended is left as
-- it is and writes nothing. The two sentences are literals: a session
-- ended by Return, and one that ran out of time.
create or replace function private._close_view_as(p_session uuid, p_expired boolean) returns void
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  s public.view_as_sessions%rowtype;
begin
  update public.view_as_sessions
    set ended_at = now(), end_reason = case when p_expired then 'expired' else 'returned' end
    where id = p_session and ended_at is null
    returning * into s;
  if not found then
    return;
  end if;
  if p_expired then
    insert into public.activity_log (org_id, actor_id, action, subject_type, subject_id, summary)
      values (s.org_id, s.viewer_id, 'view_as_ended', 'view_as', s.id, 'Viewing as someone else ended after 30 minutes');
  else
    insert into public.activity_log (org_id, actor_id, action, subject_type, subject_id, summary)
      values (s.org_id, s.viewer_id, 'view_as_ended', 'view_as', s.id, 'Stopped viewing as someone else');
  end if;
end $$;

create or replace function public.start_view_as(p_org uuid, p_target uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  stale record;
  target_role public.org_role;
  new_id uuid;
begin
  if caller is null then
    raise exception 'start_view_as: sign in first' using errcode = 'insufficient_privilege';
  end if;

  -- Lazy expiry: a session that is no longer live and that nobody closed
  -- is closed now, with its line, before anything else is decided. No
  -- longer live is: past its time (closed as expired), or its target has
  -- left the organization, or the caller is no longer an owner of it
  -- (closed as returned). Without the second kind such a row is dead (it
  -- changes nobody's identity) yet still holds the one-live-session slot,
  -- so the Admin would be told "already viewing" with no banner and no
  -- Return on screen until the half hour ran out.
  for stale in
    select s.id, (s.expires_at <= now()) as timed_out from public.view_as_sessions s
    where s.viewer_id = caller and s.ended_at is null
      and (s.expires_at <= now()
           or not exists (select 1 from public.org_members t where t.user_id = s.target_id and t.org_id = s.org_id)
           or not exists (select 1 from public.org_members v where v.user_id = s.viewer_id and v.org_id = s.org_id and v.role = 'owner'))
  loop
    perform private._close_view_as(stale.id, stale.timed_out);
  end loop;

  if p_org is null or p_org not in (select private._owner_org_ids()) then
    raise exception 'start_view_as: only an owner of the organization can view as someone in it' using errcode = 'insufficient_privilege';
  end if;
  if p_target is null or p_target = caller then
    raise exception 'start_view_as: choose someone other than yourself' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.view_as_sessions s where s.viewer_id = caller and s.ended_at is null) then
    raise exception 'start_view_as: you are already viewing as someone; return first' using errcode = 'object_not_in_prerequisite_state';
  end if;
  select m.role into target_role from public.org_members m where m.org_id = p_org and m.user_id = p_target;
  if target_role is null then
    raise exception 'start_view_as: that person is not in this organization' using errcode = 'insufficient_privilege';
  end if;

  insert into public.view_as_sessions (org_id, viewer_id, target_id, expires_at)
    values (p_org, caller, p_target, now() + interval '30 minutes')
    returning id into new_id;

  if target_role = 'member' then
    insert into public.activity_log (org_id, actor_id, action, subject_type, subject_id, summary)
      values (p_org, caller, 'view_as_started', 'view_as', new_id, 'Started viewing as a Viewer');
  elsif target_role = 'family' then
    insert into public.activity_log (org_id, actor_id, action, subject_type, subject_id, summary)
      values (p_org, caller, 'view_as_started', 'view_as', new_id, 'Started viewing as an Athlete');
  else
    insert into public.activity_log (org_id, actor_id, action, subject_type, subject_id, summary)
      values (p_org, caller, 'view_as_started', 'view_as', new_id, 'Started viewing as an Admin');
  end if;
  return new_id;
end $$;

-- The same, when the caller does not name the org: the one org they own
-- that the target belongs to. Two shared orgs need the two-argument form.
create or replace function public.start_view_as(p_target uuid) returns uuid
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  shared uuid[];
begin
  if caller is null then
    raise exception 'start_view_as: sign in first' using errcode = 'insufficient_privilege';
  end if;
  select array_agg(o.org_id) into shared
    from public.org_members o
    join public.org_members t on t.org_id = o.org_id and t.user_id = p_target
    where o.user_id = caller and o.role = 'owner';
  if shared is null then
    raise exception 'start_view_as: only an owner of the organization can view as someone in it' using errcode = 'insufficient_privilege';
  end if;
  if array_length(shared, 1) > 1 then
    raise exception 'start_view_as: you share more than one organization with that person; name the organization' using errcode = 'check_violation';
  end if;
  return public.start_view_as(shared[1], p_target);
end $$;

-- Ends the caller's live session, if there is one, and says why it
-- ended: returned, or expired when the clock ran out first. No session
-- is not an error: Return pressed in a second tab, or after the time
-- ran out and something else closed it, has nothing left to do.
create or replace function public.end_view_as() returns void
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  live public.view_as_sessions%rowtype;
begin
  if caller is null then
    raise exception 'end_view_as: sign in first' using errcode = 'insufficient_privilege';
  end if;
  select * into live from public.view_as_sessions s
    where s.viewer_id = caller and s.ended_at is null
    for update;
  if not found then
    return;
  end if;
  perform private._close_view_as(live.id, live.expires_at <= now());
end $$;

comment on function public.start_view_as(uuid, uuid) is
  'Starts a read-only View As for the calling owner of the org, as a member of that org other than themself, for 30 minutes. Writes the session and its activity line. Refused for anyone else, for self, for a target outside the org, and while one is live.';
comment on function public.start_view_as(uuid) is
  'start_view_as for the one organization the caller owns that the target belongs to.';
comment on function public.end_view_as() is
  'Ends the caller''s live View As with reason returned, or expired when its time ran out, and writes the activity line. Nothing to end is not an error.';

-- ── 8. The functions that are not policies ───────────────────────────
-- create_org, log_family_message and submit_assignment are SECURITY
-- DEFINER, so no write policy stands in front of them; each now refuses
-- while viewing, before it reads anything. member_giving reads the
-- effective seat. Each is otherwise byte for byte the version already
-- applied (0040, 0044, 0046, 0031).

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
  if private._viewing() then
    raise exception 'create_org: read only while viewing as someone else' using errcode = 'insufficient_privilege';
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
  if private._viewing() then
    raise exception 'log_family_message: read only while viewing as someone else' using errcode = 'insufficient_privilege';
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
  if private._viewing() then
    raise exception 'submit_assignment: read only while viewing as someone else' using errcode = 'insufficient_privilege';
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

create or replace function public.member_giving(p_org uuid)
  returns jsonb
  language plpgsql stable security definer
  set search_path = public
  as $$
  declare
    my_seat board_members%rowtype;
    my_donor uuid;
    out jsonb;
  begin
    if not (p_org in (select private._member_org_ids()) or p_org in (select private._observer_org_ids())) then
      return null;
    end if;

    select * into my_seat from board_members
      where org_id = p_org and user_id = private._effective_uid()
      order by status = 'active' desc, created_at
      limit 1;
    my_donor := my_seat.donor_id;

    out := jsonb_build_object(
      'my_seat_id', my_seat.id,
      'gifts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id, 'amount', g.amount, 'received_on', g.received_on, 'category', g.category, 'method', g.method,
          'donor_id', g.donor_id, 'campaign_id', g.campaign_id, 'pledge_id', g.pledge_id, 'solicited_by', g.solicited_by,
          'donor_name', case
            when my_seat.id is not null and (g.solicited_by = my_seat.id or (my_donor is not null and g.donor_id = my_donor))
              then (select d.name from donors d where d.id = g.donor_id)
            else null end
        ) order by g.received_on desc)
        from gifts g where g.org_id = p_org
      ), '[]'::jsonb),
      'pledges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'amount', p.amount, 'promised_on', p.promised_on, 'due_on', p.due_on, 'status', p.status,
          'donor_id', p.donor_id, 'campaign_id', p.campaign_id, 'solicited_by', p.solicited_by
        ) order by p.promised_on desc)
        from pledges p where p.org_id = p_org
      ), '[]'::jsonb),
      'campaigns', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'goal_amount', c.goal_amount, 'ends_on', c.ends_on) order by c.ends_on desc)
        from campaigns c where c.org_id = p_org
      ), '[]'::jsonb),
      'budget', coalesce((
        select jsonb_agg(jsonb_build_object('fiscal_year', b.fiscal_year, 'category', b.category, 'amount', b.amount))
        from fundraising_budget b where b.org_id = p_org
      ), '[]'::jsonb),
      'boards', coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind, 'sport', b.sport, 'give_get_amount', b.give_get_amount, 'min_seats', b.min_seats, 'max_seats', b.max_seats) order by b.sort_order)
        from boards b where b.org_id = p_org
      ), '[]'::jsonb),
      'seats', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'board_id', m.board_id,
          'name', case when m.id = my_seat.id then m.name else null end,
          'role_title', case when m.id = my_seat.id then m.role_title else null end,
          'donor_id', m.donor_id, 'status', m.status, 'term_start', m.term_start, 'term_end', m.term_end,
          'commitment_amount', m.commitment_amount
        ) order by m.created_at)
        from board_members m where m.org_id = p_org
      ), '[]'::jsonb)
    );
    return out;
  end;
  $$;

-- ── 9. Grants ────────────────────────────────────────────────────────
-- Two revokes, as in 0033: `from public` drops the default grant every
-- new function gets, `from anon` drops the one Supabase's default
-- privileges add in this schema. Only a signed-in caller starts or ends
-- a View As. The two private writers are for the definer functions
-- above and for nobody else.
revoke execute on function public.start_view_as(uuid, uuid) from public, anon;
revoke execute on function public.start_view_as(uuid) from public, anon;
revoke execute on function public.end_view_as() from public, anon;
grant execute on function public.start_view_as(uuid, uuid) to authenticated;
grant execute on function public.start_view_as(uuid) to authenticated;
grant execute on function public.end_view_as() to authenticated;

revoke execute on function private._close_view_as(uuid, boolean) from public, anon, authenticated;
