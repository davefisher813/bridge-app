-- 0063: an Athlete login reads the columns its screens show, not whole
-- rows (role audit, 2026-10-13).
--
-- Row-level security decides which rows a login reads, never which
-- columns (the rule migration 0039 states for messages). Three family
-- read policies opened whole rows that carry staff-only columns:
--
--   documents          candidates (other athletes' names and ids, all
--                      minors), extracted, triage, failure_reason,
--                      applied_changes, uploaded_by, storage paths
--   recruiting_targets notes, coach_name
--   target_visits      notes
--
-- The family screens never selected those columns, but a family login
-- holding the anon key could. So the family clause comes off each table's
-- read policy, and the family reads through functions that return only
-- what its screens show, the way the Viewer reads through member_program
-- (0031). A view would run as its owner too, but the views law
-- (src/laws/migrationLaws.test.ts) holds every view to the caller's
-- rights; a function says out loud that it is the exception.
--
-- Each function carries the row rule the policy did: the staff of the
-- org, or a family login for its own athletes. Staff keep reading the
-- tables themselves.

-- ── The policies: staff only ───────────────────────────────────────────
drop policy if exists documents_read on documents;
create policy documents_read on documents for select
  using (org_id in (select private._member_org_ids()));

drop policy if exists recruiting_targets_read on recruiting_targets;
create policy recruiting_targets_read on recruiting_targets for select
  using (org_id in (select private._member_org_ids()));

drop policy if exists target_visits_read on target_visits;
create policy target_visits_read on target_visits for select
  using (org_id in (select private._member_org_ids()));

-- ── The targets: status and offer, with the school, no notes or coach ──
create or replace function public.family_targets(p_org uuid, p_athletes uuid[])
  returns table (
    id uuid,
    athlete_id uuid,
    school_id uuid,
    status text,
    offer_type text,
    offer_scholarship_percent int,
    closed_from text,
    created_at timestamptz,
    school_name text,
    school_division text,
    school_conference text,
    school_state text
  )
  language sql stable security definer
  set search_path = public
  as $$
    select t.id, t.athlete_id, t.school_id, t.status, t.offer_type::text, t.offer_scholarship_percent::int, t.closed_from, t.created_at,
           s.name, s.division::text, s.conference, s.state
    from recruiting_targets t
    join schools s on s.id = t.school_id
    where t.org_id = p_org
      and t.athlete_id = any (p_athletes)
      and (t.org_id in (select private._member_org_ids()) or t.athlete_id in (select private._family_athlete_ids()))
    order by t.created_at desc
  $$;

-- ── The visits: what happened, no notes ────────────────────────────────
create or replace function public.family_target_visits(p_org uuid, p_targets uuid[])
  returns table (
    id uuid,
    target_id uuid,
    visit_type text,
    visit_date date,
    impression text,
    next_step text
  )
  language sql stable security definer
  set search_path = public
  as $$
    select v.id, v.target_id, v.visit_type::text, v.visit_date, v.impression::text, v.next_step
    from target_visits v
    join recruiting_targets t on t.id = v.target_id
    where v.org_id = p_org
      and v.target_id = any (p_targets)
      and (v.org_id in (select private._member_org_ids()) or t.athlete_id in (select private._family_athlete_ids()))
    order by v.visit_date desc nulls last
  $$;

-- ── The documents: the file and where it got to, no reading ────────────
create or replace function public.family_documents(p_org uuid, p_athlete uuid)
  returns table (
    id uuid,
    file_name text,
    category text,
    status text,
    media_type text,
    file_size bigint,
    created_at timestamptz
  )
  language sql stable security definer
  set search_path = public
  as $$
    select d.id, d.file_name, d.category::text, d.status::text, d.media_type, d.file_size::bigint, d.created_at
    from documents d
    where d.org_id = p_org
      and d.athlete_id = p_athlete
      and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
    order by d.created_at desc
  $$;

-- The same bytes sent twice, for the assignment upload: the earlier
-- copy's name and date, among the documents this login may see.
create or replace function public.family_document_twin(p_org uuid, p_hash text)
  returns table (
    id uuid,
    file_name text,
    created_at timestamptz
  )
  language sql stable security definer
  set search_path = public
  as $$
    select d.id, d.file_name, d.created_at
    from documents d
    where d.org_id = p_org
      and d.content_hash = p_hash
      and d.status <> 'discarded'
      and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
    order by d.created_at desc
    limit 1
  $$;

-- Signed-in only.
revoke all on function public.family_targets(uuid, uuid[]) from public, anon;
revoke all on function public.family_target_visits(uuid, uuid[]) from public, anon;
revoke all on function public.family_documents(uuid, uuid) from public, anon;
revoke all on function public.family_document_twin(uuid, text) from public, anon;
grant execute on function public.family_targets(uuid, uuid[]) to authenticated;
grant execute on function public.family_target_visits(uuid, uuid[]) to authenticated;
grant execute on function public.family_documents(uuid, uuid) to authenticated;
grant execute on function public.family_document_twin(uuid, text) to authenticated;
