-- BRANCH ONLY (kqvxkqqyojnnvkfkevhe). Never run this in the production SQL editor.
-- Batch 3 of 7: 0063 to 0073. Paste all of it, run once, read the last result grid.


-- ======== 0063_family_reads_columns_not_rows.sql ========
-- 0063: an Athlete login reads the columns its screens show, not whole
-- rows (role audit, 2026-10-13). Part one: the functions. Part two, the
-- read policies, is 0065, applied after the app reads through these.
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


-- ======== 0064_member_giving_follows_module.sql ========
-- 0064: the Viewer's giving summary follows the Fundraising module
-- (role audit, 2026-10-13).
--
-- member_giving (0031) checked who was asking but not whether the org
-- runs Fundraising at all. The Giving screen is not there when the module
-- is off, but the function still answered a direct call with the org's
-- gifts, pledges, campaigns and seats. Same function, one more check:
-- with the module off it returns null, as it does for a stranger.

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
    -- The Fundraising module is off: nothing to show, the same as the
    -- Giving screen, which is not there.
    if not coalesce((select (o.modules->>'donor_fundraising')::boolean from orgs o where o.id = p_org), false) then
      return null;
    end if;

    select * into my_seat from board_members
      where org_id = p_org and user_id = auth.uid()
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

revoke execute on function public.member_giving(uuid) from public, anon;
grant execute on function public.member_giving(uuid) to authenticated;


-- ======== 0065_family_reads_policies.sql ========
-- 0065: the family clause comes off the read policies of documents,
-- recruiting_targets and target_visits (role audit, 2026-10-13). Part
-- two of 0063, which added the functions an Athlete login now reads
-- through; see 0063 for why. Applied after the app that uses those
-- functions is live, so no Athlete screen goes blank in between.

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


-- ======== 0066_family_sends_document.sql ========
-- 0066: an Athlete login sends a document for its own athlete, outside
-- any assignment (Doc AI rebuild, Piece 5, 2026-10-13).
--
-- Until now the one family write to documents was submit_assignment
-- (0046): a file goes in only as an assignment's answer. This adds a
-- second path, the same in every way that matters:
--
--   - the file is filed (status filed, source parent, lifecycle Needs
--     Review), shown to staff as an Athlete Upload, never applied and
--     never read on its own. No Doc AI runs from an Athlete login; an
--     Admin can Read Again it from the document screen, which charges the
--     org's reading budget as any reading does;
--   - the caller must be linked to the athlete right now
--     (private._family_athlete_ids()), and the athlete not removed;
--   - the file sits at <org>/family/<athlete>_<request>/<file> in the
--     documents bucket, was put there by the caller, is a PDF, JPG or
--     PNG within the bucket's limits, and is not filed already;
--   - the same bytes already filed for one of the caller's athletes are
--     refused (the rule family_document_twin answers in the app).
--
-- A photo may carry a second object, the copy the phone scaled down for
-- the reader (the staff uploader's reader copy), in the same folder. The
-- original is kept untouched in original_paths either way.
--
-- What it adds:
--   1. documents.family_note, the optional note sent with the file. It
--      never reaches the activity log.
--   2. public.family_send_document(...), SECURITY DEFINER, the only
--      write. It files the row and one activity_log line, "Uploaded a
--      document", a literal, signed as the caller.
--   3. The family folder's insert policy, tightened: the request folder
--      must start with the id of an athlete the login is linked to. A
--      login could write anywhere under <org>/family/ before; now only
--      under a folder it can name a reason for. The assignment upload
--      builds its folder the same way (AssignmentSubmitForm), so deploy
--      the app before applying this, or an older page's assignment
--      upload is refused by the bucket.
--
-- Down: scripts/down/0066_family_sends_document_down.sql.

-- ── 1. The note ──────────────────────────────────────────────────────
alter table documents add column if not exists family_note text
  check (family_note is null or length(family_note) <= 4000);

comment on column documents.family_note is
  'The note an Athlete login sent with a document (family_send_document, 0066). Shown to staff on the document screen; never logged.';

-- ── 2. The log helper and the function ──────────────────────────────
-- The log line is written by a helper whose only parameter is the new
-- document's id and whose summary is a literal, the shape every function
-- that writes the log keeps (src/laws/activityLaws.test.ts), so no note,
-- file name or athlete name can reach the log.
create or replace function private.log_family_document_sent(p_document uuid) returns void
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  d public.documents%rowtype;
begin
  select * into d from public.documents x where x.id = p_document;
  if not found then
    raise exception 'log_family_document_sent: no such document' using errcode = 'check_violation';
  end if;
  insert into public.activity_log (org_id, athlete_id, actor_id, action, subject_type, subject_id, summary)
    values (d.org_id, d.athlete_id, auth.uid(), 'document_uploaded', 'document', d.id, 'Uploaded a document');
end $$;

create or replace function public.family_send_document(
  p_athlete uuid,
  p_file_name text,
  p_file_size int,
  p_media_type text,
  p_storage_path text,
  p_content_hash text default null,
  p_note text default null,
  p_type text default null,
  p_reader_path text default null
) returns uuid
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  athlete_org uuid;
  athlete_gone timestamptz;
  clean_note text := nullif(btrim(coalesce(p_note, '')), '');
  clean_file text := btrim(coalesce(p_file_name, ''));
  clean_hash text := nullif(btrim(coalesce(p_content_hash, '')), '');
  clean_type text := nullif(btrim(coalesce(p_type, '')), '');
  folder_shape text;
  doc_format text;
  size_limit bigint;
  allowed_types text[];
  doc_id uuid;
begin
  if caller is null then
    raise exception 'family_send_document: sign in first' using errcode = 'insufficient_privilege';
  end if;

  -- 1. The caller's link to the athlete. One message for an athlete that
  -- does not exist, one removed and one not theirs, so the answer does
  -- not say which athletes exist.
  if p_athlete is null or p_athlete not in (select private._family_athlete_ids()) then
    raise exception 'family_send_document: not linked to that athlete' using errcode = 'insufficient_privilege';
  end if;
  select a.org_id, a.deleted_at into athlete_org, athlete_gone from public.athletes a where a.id = p_athlete;
  if athlete_org is null or athlete_gone is not null then
    raise exception 'family_send_document: not linked to that athlete' using errcode = 'insufficient_privilege';
  end if;

  -- 2. The note and the type.
  if length(coalesce(p_note, '')) > 4000 then
    raise exception 'family_send_document: a note is 4,000 characters or fewer' using errcode = 'check_violation';
  end if;
  -- The reader types a family can name. Board Document is an org's, not
  -- an athlete's, so it is not one of them.
  if clean_type is not null and clean_type not in ('transcript', 'test_scores', 'offer_letter', 'recommendation', 'financial_aid', 'metrics', 'athlete_profile', 'other') then
    raise exception 'family_send_document: that is not a document type' using errcode = 'check_violation';
  end if;

  -- 3. The file: under this athlete's folder in the org's family folder,
  -- put there by the caller, a PDF, JPG or PNG within the bucket's limits.
  folder_shape := '^' || athlete_org::text || '/family/' || p_athlete::text || '_[A-Za-z0-9_-]+/[A-Za-z0-9._-]+$';
  if p_storage_path is null or p_storage_path !~ folder_shape or p_storage_path ~ '/\.\.?$' then
    raise exception 'family_send_document: a file must be under this athlete''s family folder' using errcode = 'check_violation';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'documents' and o.name = p_storage_path and o.owner = caller
  ) then
    raise exception 'family_send_document: that file was not uploaded by you' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.documents d where p_storage_path = any (d.storage_paths) or p_storage_path = any (d.original_paths)) then
    raise exception 'family_send_document: that file is already filed' using errcode = 'check_violation';
  end if;
  if clean_file = '' or length(clean_file) > 200 or coalesce(p_file_size, 0) <= 0 then
    raise exception 'family_send_document: a file needs a name, a size and a type' using errcode = 'check_violation';
  end if;
  doc_format := case p_media_type when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' else null end;
  if doc_format is null then
    raise exception 'family_send_document: send a PDF, JPG or PNG' using errcode = 'check_violation';
  end if;
  select b.file_size_limit, b.allowed_mime_types into size_limit, allowed_types from storage.buckets b where b.id = 'documents';
  if size_limit is not null and p_file_size > size_limit then
    raise exception 'family_send_document: that file is over the size limit' using errcode = 'check_violation';
  end if;
  if allowed_types is not null and not (p_media_type = any (allowed_types)) then
    raise exception 'family_send_document: that file type is not accepted' using errcode = 'check_violation';
  end if;

  -- The reader's copy of a photo: beside the original, the caller's, not
  -- filed. A PDF is its own reader copy and carries none.
  if p_reader_path is not null then
    if doc_format = 'pdf'
       or p_reader_path = p_storage_path
       or p_reader_path !~ folder_shape or p_reader_path ~ '/\.\.?$'
       or regexp_replace(p_reader_path, '/[^/]+$', '') <> regexp_replace(p_storage_path, '/[^/]+$', '') then
      raise exception 'family_send_document: the reader copy must sit beside the photo' using errcode = 'check_violation';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'documents' and o.name = p_reader_path and o.owner = caller
    ) then
      raise exception 'family_send_document: that file was not uploaded by you' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.documents d where p_reader_path = any (d.storage_paths) or p_reader_path = any (d.original_paths)) then
      raise exception 'family_send_document: that file is already filed' using errcode = 'check_violation';
    end if;
  end if;

  -- 4. The same bytes twice is the same document twice, among the
  -- documents this login may see (family_document_twin's rule).
  if clean_hash is not null and exists (
    select 1 from public.documents d
    where d.org_id = athlete_org
      and d.content_hash = clean_hash
      and d.status <> 'discarded'
      and d.athlete_id in (select private._family_athlete_ids())
  ) then
    raise exception 'family_send_document: this exact file was already sent' using errcode = 'check_violation';
  end if;

  -- 5. The row. Filed and in Needs Review: no reader picks it up.
  insert into public.documents (
    org_id, athlete_id, linked_athlete_id, file_name, file_size, media_type, format, source_role, status, lifecycle,
    requested_category, uploaded_by, storage_paths, original_paths, content_hash, family_note
  ) values (
    athlete_org, p_athlete, p_athlete, clean_file, p_file_size, p_media_type, doc_format, 'parent', 'filed', 'needs_review',
    clean_type::public.doc_category, caller, array[coalesce(p_reader_path, p_storage_path)], array[p_storage_path], clean_hash, clean_note
  ) returning id into doc_id;

  -- 6. The log line, in the same transaction, signed as the caller.
  perform private.log_family_document_sent(doc_id);

  return doc_id;
end $$;

comment on function public.family_send_document(uuid, text, int, text, text, text, text, text, text) is
  'Files a document an Athlete login sent for its own athlete (status filed, lifecycle needs_review, never read) and logs "Uploaded a document". Refuses a caller not linked to the athlete, a file outside <org>/family/<athlete>_<request>/, a file not the caller''s, and the same bytes sent twice.';

-- ── 3. The family folder, tightened ─────────────────────────────────
-- 0048's policy plus one line: the request folder starts with the id of
-- an athlete this login is linked to, then an underscore.
drop policy if exists documents_bucket_family_insert on storage.objects;
create policy documents_bucket_family_insert on storage.objects
  for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id(org_id))
    and (storage.foldername(name))[2] = 'family'
    and array_length(storage.foldername(name), 1) = 3
    and split_part((storage.foldername(name))[3], '_', 1) in (select athlete_id::text from private._family_athlete_ids() as athlete_id(athlete_id))
    and lower(name) ~ '\.(pdf|jpe?g|png)$'
  );

-- ── Grants ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;

-- `from public` drops the default grant every new function gets, `from
-- anon` the one Supabase's default privileges add in this schema.
revoke execute on function public.family_send_document(uuid, text, int, text, text, text, text, text, text) from public, anon;
grant execute on function public.family_send_document(uuid, text, int, text, text, text, text, text, text) to authenticated;

-- The log helper is for family_send_document alone, which runs as its owner.
revoke execute on function private.log_family_document_sent(uuid) from public, anon, authenticated;


-- ======== 0067_doc_approvers.sql ========
-- 0067: document approvers (Doc AI piece 7, docs/ROADMAP.md: "Approver
-- roles for Pieces 7 and 8, names unassigned").
--
-- Three areas sign a document off before it is treated as final:
-- academic (transcripts, recommendations), eligibility (test scores) and
-- financial (aid letters, offers). Per org, each area is held by at most
-- one Admin, set by an Admin in Organization Settings, logged, undoable.
-- Nobody is named yet, and with nobody named nothing changes: any Admin
-- marks a document Ready with one tap, as before.
--
-- 1. doc_approvers: one row per org and area while somebody holds it.
--    No row is "Nobody Yet". The person must be an Admin (owner, or a
--    leftover staff row) of the same org, checked by a trigger the way
--    0039 checks an advisor. Admins read and write it; nobody else sees
--    it. The app clears a row when its person is demoted or removed and
--    logs it; the gate below ignores a row whose person is no longer an
--    Admin, so a stale row never blocks a document.
-- 2. documents.approved_by and approved_at: who marked it Ready, and
--    when. Stamped by the database from the signed-in caller on a move
--    to Ready, cleared on a move back to Needs Review, Processing or
--    Uploaded, and never changed otherwise.
-- 3. The gate: a signed-in caller moving a document of an area with a
--    named approver to Ready must be that approver. The server action
--    refuses first with a sentence; this is the backstop. The type to
--    area map is the same as src/lib/documents/approvers.ts, and
--    src/laws/docApproverLaws.test.ts holds the two equal.
-- 4. Two activity actions: doc_approver_set and doc_approver_cleared.
--
-- Additive: one table, two nullable columns, one index each, triggers,
-- enum values. No row changes.

-- ── 1. Who holds each area ───────────────────────────────────────────
create table doc_approvers (
  org_id     uuid not null references orgs(id) on delete cascade,
  area       text not null check (area in ('academic', 'eligibility', 'financial')),
  user_id    uuid not null references users(id) on delete cascade,
  set_by     uuid references users(id) on delete set null,
  set_at     timestamptz not null default now(),
  primary key (org_id, area)
);

create index doc_approvers_user_idx on doc_approvers (user_id);
create index doc_approvers_set_by_idx on doc_approvers (set_by);

comment on table doc_approvers is
  'Who signs off each document area (academic, eligibility, financial) in an org. No row means nobody is named and any Admin marks Ready.';

create or replace function private.doc_approver_is_admin() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
begin
  if not exists (
    select 1 from public.org_members m
    where m.user_id = new.user_id and m.org_id = new.org_id and m.role in ('owner', 'staff')
  ) then
    raise exception 'doc_approvers: % is not an Admin of org %', new.user_id, new.org_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger doc_approvers_is_admin
  before insert or update of user_id, org_id on doc_approvers
  for each row execute function private.doc_approver_is_admin();

alter table doc_approvers enable row level security;

create policy doc_approvers_read on doc_approvers for select
  using (org_id in (select private._staff_org_ids()));
create policy doc_approvers_insert on doc_approvers for insert
  with check (org_id in (select private._staff_org_ids()));
create policy doc_approvers_update on doc_approvers for update
  using (org_id in (select private._staff_org_ids()))
  with check (org_id in (select private._staff_org_ids()));
create policy doc_approvers_delete on doc_approvers for delete
  using (org_id in (select private._staff_org_ids()));

-- ── 2. Who approved a document ───────────────────────────────────────
alter table documents add column approved_by uuid references users(id) on delete set null;
alter table documents add column approved_at timestamptz;

create index documents_approved_by_idx on documents (approved_by) where approved_by is not null;

comment on column documents.approved_by is
  'Who marked this document Ready. Stamped on the move to Ready, cleared on a move back to Needs Review.';

-- ── 3. The gate ──────────────────────────────────────────────────────
-- The same map as APPROVER_AREAS in src/lib/documents/approvers.ts.
create or replace function private.doc_approval_area(p_category text) returns text
  language sql immutable
  set search_path = ''
  as $$
  select case
    when p_category in ('transcript', 'recommendation') then 'academic'
    when p_category in ('test_scores') then 'eligibility'
    when p_category in ('financial_aid', 'offer_letter') then 'financial'
  end
$$;

create or replace function private.documents_ready_by_approver() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  v_uid uuid := auth.uid();
  v_area text;
  v_approver uuid;
begin
  if new.lifecycle is distinct from old.lifecycle then
    if new.lifecycle = 'ready' then
      v_area := private.doc_approval_area(coalesce(new.category::text, new.requested_category::text));
      -- The service role (no signed-in caller) is the server's own
      -- path and is not gated here; the app checks before it writes.
      if v_area is not null and v_uid is not null then
        select a.user_id into v_approver
        from public.doc_approvers a
        join public.org_members m on m.user_id = a.user_id and m.org_id = a.org_id and m.role in ('owner', 'staff')
        where a.org_id = new.org_id and a.area = v_area;
        if v_approver is not null and v_approver <> v_uid then
          raise exception 'documents: only the % approver can mark this document Ready', v_area
            using errcode = 'insufficient_privilege';
        end if;
      end if;
      new.approved_by := (select u.id from public.users u where u.id = v_uid);
      new.approved_at := now();
    elsif new.lifecycle in ('needs_review', 'processing', 'uploaded') then
      new.approved_by := null;
      new.approved_at := null;
    end if;
  elsif new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    -- Who approved is a record of a move, never edited on its own.
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
  end if;
  return new;
end $$;

create trigger documents_ready_by_approver
  before update on documents
  for each row execute function private.documents_ready_by_approver();

-- ── 4. On the record ─────────────────────────────────────────────────
alter type activity_action add value if not exists 'doc_approver_set';
alter type activity_action add value if not exists 'doc_approver_cleared';


-- ======== 0068_access_tightening.sql ========
-- 0068: access tightening (second access sweep, 2026-10-13).
--
-- An Athlete login's uploads go to <org>/family/<folder>/<file> in the
-- documents bucket (0046, 0048). The folder could be any name at all, so
-- a family login could write as many loose objects as it liked under its
-- org's family folder, tied to nothing (orphans that only cost storage
-- and that nobody would ever see). The folder now has to be one the
-- caller can account for:
--
--   - the id of an assignment of one of the caller's own athletes (the
--     assignment upload, AssignmentSubmitForm), or
--   - the id of one of the caller's own athletes (the family "send a
--     document" path, which writes under <org>/family/<athlete id>/).
--
-- "Own" is private._family_athlete_ids() (0026): a guardian link that
-- holds only while the family membership lives. The org of the folder
-- must be the assignment's or the athlete's own org, so a login that is
-- family in two orgs cannot file one org's id under the other's folder.
-- A removed athlete opens no folder. Everything else 0048 required stays:
-- the family role in that org, the literal 'family' folder, exactly one
-- folder below it, and a PDF, JPG or PNG name.
--
-- No data rows, no org named, no id literal (src/laws/migrationLaws.test.ts).

-- The (org, folder) pairs the caller may upload into. Security definer
-- so the storage policy does not depend on the caller's read policies on
-- assignments and athletes; it returns only the caller's own.
create or replace function private._family_upload_folders()
returns table (org_id uuid, folder text)
language sql stable security definer
set search_path = ''
as $$
  select a.org_id, a.id::text
  from public.assignments a
  join public.athletes t on t.id = a.athlete_id and t.org_id = a.org_id
  where a.athlete_id in (select private._family_athlete_ids())
    and t.deleted_at is null
  union
  select t.org_id, t.id::text
  from public.athletes t
  where t.id in (select private._family_athlete_ids())
    and t.deleted_at is null
$$;

-- Stated rather than assumed, as for every private helper (0015, 0023):
-- the schema is not exposed, and the function answers only for the
-- caller.
grant execute on function private._family_upload_folders() to public;

drop policy if exists documents_bucket_family_insert on storage.objects;
create policy documents_bucket_family_insert on storage.objects
  for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id(org_id))
    and (storage.foldername(name))[2] = 'family'
    and array_length(storage.foldername(name), 1) = 3
    and lower(name) ~ '\.(pdf|jpe?g|png)$'
    and exists (
      select 1 from private._family_upload_folders() f
      where f.org_id::text = (storage.foldername(name))[1]
        -- The folder is the assignment's or the athlete's id, alone or
        -- followed by _<request> (0066's Send a Document folder).
        and (f.folder = (storage.foldername(name))[3] or f.folder = split_part((storage.foldername(name))[3], '_', 1))
    )
  );


-- ======== 0069_document_title.sql ========
-- 0069: a document's title, set by an Admin (data cleanup, 2026-10-13).
--
-- A file's name is part of the original file record, which never changes
-- (0048, documents_original_is_immutable). But a file named
-- "updated-cert-of-inc.pdf" that is really a rejection letter needs to
-- say what it is. So a document gains its own title, separate from the
-- file: shown in place of the file name wherever the document is listed,
-- with the file name still shown beside it. Null means no title yet, and
-- the file name stands in. The original record is untouched.

alter table documents add column if not exists title text
  check (title is null or (length(btrim(title)) between 1 and 200 and title = btrim(title)));

comment on column documents.title is
  'What the document is, set by an Admin; null shows the file name. The file name itself never changes (0048).';

alter type activity_action add value if not exists 'document_renamed';


-- ======== 0070_org_master_account.sql ========
-- 0070: one master account per org, and recommendation letters kept from
-- Athlete logins (Dave, 2026-10-13).
--
-- 1. orgs.master_user_id: the one Admin who decides who has access
--    (invite, role, remove, resend). Null means nobody is set and any
--    Admin manages access, as before. The app holds the rule on every
--    access action; the database holds the two things the app must never
--    get wrong: the master is always an Admin of that org, and the master
--    cannot be demoted or removed while they hold it. Production values
--    are set separately, never here.
-- 2. activity action 'master_transferred'.
-- 3. family_documents no longer returns a recommendation letter: a
--    letter written about the athlete is for the org, not the family.

-- ── 1. The master account ──────────────────────────────────────────
alter table orgs add column if not exists master_user_id uuid references users(id) on delete set null;

create index if not exists orgs_master_user_id_idx on orgs (master_user_id);

comment on column orgs.master_user_id is
  'The Admin who alone changes who has access (0070). Null: any Admin does.';

create or replace function private.orgs_master_is_admin() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
begin
  if new.master_user_id is not null and (tg_op = 'INSERT' or new.master_user_id is distinct from old.master_user_id) then
    if not exists (
      select 1 from public.org_members m
      where m.org_id = new.id and m.user_id = new.master_user_id and m.role in ('owner', 'staff')
    ) then
      raise exception 'orgs: the master account must be an Admin of this organization'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orgs_master_is_admin on orgs;
create trigger orgs_master_is_admin
  before insert or update of master_user_id on orgs
  for each row execute function private.orgs_master_is_admin();

create or replace function private.org_members_master_stays() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
begin
  if exists (select 1 from public.orgs o where o.id = old.org_id and o.master_user_id = old.user_id) then
    if tg_op = 'DELETE' or new.role not in ('owner', 'staff') or new.user_id <> old.user_id or new.org_id <> old.org_id then
      raise exception 'the master account cannot be demoted or removed; transfer it first'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists org_members_master_stays on org_members;
create trigger org_members_master_stays
  before update or delete on org_members
  for each row execute function private.org_members_master_stays();

revoke all on function private.orgs_master_is_admin() from public, anon, authenticated;
revoke all on function private.org_members_master_stays() from public, anon, authenticated;

-- ── 2. On the record ─────────────────────────────────────────────────
alter type activity_action add value if not exists 'master_transferred';

-- ── 3. No recommendation letter for an Athlete login ─────────────────
-- The body of 0063's definition, less recommendations.
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
      and coalesce(d.category::text, d.requested_category::text, '') <> 'recommendation'
    order by d.created_at desc
  $$;

revoke all on function public.family_documents(uuid, uuid) from public, anon;
grant execute on function public.family_documents(uuid, uuid) to authenticated;


-- ======== 0071_assignments_bulk_delete.sql ========
-- Bulk actions on the Assignments list (Dave, 2026-10-13: "dozens of
-- student athletes; one-at-a-time actions are too slow"; bulk delete
-- explicitly required). Three changes, all additive or narrowing-by-one:
--
-- 1. An Admin may delete an assignment of their org. 0046 deliberately
--    gave nobody a delete policy ("Nothing is deleted through the app");
--    Dave now requires it. Keyed exactly like the update policy: staff
--    of the row's org, nobody else. A Viewer (member), another athlete's
--    login, another org and a signed-out caller delete nothing. Cancel
--    stays the soft alternative and is untouched.
-- 2. The honesty trigger from 0046 pinned athlete_id for the life of a
--    row. Reassign needs it to move, but only while the row has no
--    history on the family's side: status assigned or needs_revision and
--    no linked document. A submitted, completed or cancelled row, or one
--    carrying a file, still cannot move. The org still cannot change,
--    and the author, creation time and org checks are unchanged. The
--    coherence triggers keep the new athlete in the row's org.
-- 3. Three activity actions so the log can say what a bulk action did,
--    one line per row: assignment_deleted, assignment_reassigned and
--    assignment_due_changed (names and kinds only, as every assignment
--    line).
--
-- No data rows, no org named, no id literal (src/laws/migrationLaws.test.ts).

alter type activity_action add value if not exists 'assignment_deleted';
alter type activity_action add value if not exists 'assignment_reassigned';
alter type activity_action add value if not exists 'assignment_due_changed';

create policy assignments_delete on assignments for delete
  using (org_id in (select private._staff_org_ids()));

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
     or new.org_id is distinct from old.org_id then
    raise exception 'assignments: a row keeps its author, its creation time and its org'
      using errcode = 'check_violation';
  end if;
  -- Reassign: only a row nothing has happened to on the family's side.
  if new.athlete_id is distinct from old.athlete_id
     and (old.status not in ('assigned', 'needs_revision') or old.document_id is not null or new.document_id is not null) then
    raise exception 'assignments: only an open row with no file can move to another athlete'
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end $$;


-- ======== 0072_documents_bulk.sql ========
-- 0072: bulk actions on the Documents list (Dave, 2026-10-13).
--
-- Setting the type of several documents at once writes one activity_log
-- row per document, like every other document change. Setting a type
-- had no log entry of its own, so the log gains one kind of event for
-- it. Additive: nothing else changes.

alter type activity_action add value if not exists 'document_typed';


-- ======== 0073_document_identity_and_type.sql ========
-- 0073: who a document is about, and what kind of thing it is (Doc AI
-- rebuild, Piece 2). Suggestions, then a person's word.
--
-- At upload the app reads the file name, the type picked if any, and the
-- plain words of a Word, Excel, CSV or TXT file, and writes two
-- suggestions onto the row: a provisional type and up to three athletes
-- it may be about, each with a confidence and the reasons. No model reads
-- anything for this, and nothing is linked: subject_athlete_id is set
-- only when an Admin taps Confirm (or picks someone with Change).
--
-- Additive. No row is deleted, no column dropped, none of 0048's locks
-- touched: the new columns are not part of the frozen original record,
-- so the immutability trigger lets them change. Existing rows start with
-- no suggestion (identity_status null) until somebody taps Suggest.
-- The two Sept 26 backup tables are not read, altered or dropped.
-- A matching down script is scripts/down/0073_document_identity_and_type_down.sql.

create type doc_identity_status as enum (
  'unmatched',      -- nobody on the roster is named
  'proposed',       -- one clear candidate, waiting for a person
  'ambiguous',      -- two or more too close to call
  'confirmed',      -- a person said who it is about
  'not_an_athlete'  -- a person said it is about nobody (a guide, a form)
);

alter table documents
  add column suggested_type            text,
  add column suggested_type_confidence real,
  add column suggested_type_reasons    text[]               not null default '{}',
  add column identity_status           doc_identity_status,
  add column identity_candidates       jsonb                not null default '[]'::jsonb,
  add column suggested_at              timestamptz,
  add column identity_confirmed_at     timestamptz;

alter table documents add column subject_athlete_id uuid references athletes(id) on delete set null;
alter table documents add column identity_confirmed_by uuid references users(id) on delete set null;

alter table documents
  add constraint documents_suggested_type_confidence_check
  check (suggested_type_confidence is null or (suggested_type_confidence >= 0 and suggested_type_confidence <= 1));

alter table documents
  add constraint documents_identity_candidates_is_array
  check (jsonb_typeof(identity_candidates) = 'array');

create index documents_subject_athlete_idx on documents (subject_athlete_id);
create index documents_identity_confirmed_by_idx on documents (identity_confirmed_by);

comment on column documents.suggested_type is
  'Provisional type id from the 30-type taxonomy (src/lib/docai/suggest.ts PROVISIONAL_TYPES). A suggestion only; Piece 3 re-validates it.';
comment on column documents.identity_candidates is
  'Up to three [{athleteId, name, score, reasons}] the file may be about. Suggestions only; never a link.';
comment on column documents.subject_athlete_id is
  'Who the document is about, set only by a person (Confirm or Change). Separate from athlete_id, which the old reader sets on apply.';

-- ── The confirmed athlete is in the document's own org ──────────────
create or replace function private.document_subject_is_coherent() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  if new.subject_athlete_id is not null and not exists (
    select 1 from athletes a where a.id = new.subject_athlete_id and a.org_id = new.org_id
  ) then
    raise exception 'documents: athlete % is not in org %', new.subject_athlete_id, new.org_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger documents_subject_is_coherent
  before insert or update of subject_athlete_id, org_id on documents
  for each row execute function private.document_subject_is_coherent();

-- ── What the activity log can say ───────────────────────────────────
alter type activity_action add value if not exists 'document_identity_confirmed';
alter type activity_action add value if not exists 'document_identity_cleared';


-- CHECK 3: expect every value true
select exists(select 1 from pg_proc where proname='family_send_document') as family_send_document,
       exists(select 1 from pg_proc where proname='member_giving') as member_giving,
       exists(select 1 from pg_class where relname='doc_approvers') as doc_approvers,
       exists(select 1 from pg_trigger where tgname='documents_ready_by_approver') as approver_trigger,
       exists(select 1 from information_schema.columns where table_name='orgs' and column_name='master_user_id') as master_user_id,
       exists(select 1 from pg_trigger where tgname='orgs_master_is_admin') as master_trigger,
       exists(select 1 from pg_trigger where tgname='documents_subject_is_coherent') as subject_trigger,
       exists(select 1 from information_schema.columns where table_name='documents' and column_name='subject_athlete_id') as subject_athlete_id;
