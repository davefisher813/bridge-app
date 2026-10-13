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
