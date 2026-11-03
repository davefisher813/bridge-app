-- 0078: a file is opened by the real signed-in person, never by whoever
-- they are viewing as (PLAN-STAGE DRAFT, not applied; gated by Tony).
--
-- Rule 1 (Dave, settled 2026-11-03): the real user decides file reads.
-- View-as keeps working for screens, but it never grants file access. The
-- master account keeps its own reach while viewing as anyone, because the
-- real user is still the master. A non-master Admin viewing as the master
-- gets nothing.
--
-- Rule 2 (Dave, settled 2026-11-03): an Admin who cannot open a file still
-- sees that the document exists, locked. The name, type and athlete are
-- masked on the server, not only in the screen. What stays: id, org_id,
-- status, lifecycle, created_at.
--
-- Also closes the gaps found while testing 0077:
--   - original_paths were not looked up, so an original file counted as
--     "no athlete" and stayed open to every org Admin;
--   - only the first of athlete_id, linked_athlete_id, subject_athlete_id
--     was used;
--   - a file with no document row fell open to every org Admin. It is now
--     readable by the org's master account only. The mid-upload window is
--     closed three ways (see the end of this header).
--
-- Who may open an athlete's file (any of the three athlete columns):
--   the org's master account; that athlete's own login (guardian link);
--   that athlete's advisor (still an owner or staff of the org).
-- A document with no athlete stays open to the org's Admins (new uploads
-- waiting to be identified). A file with no document row: master only.
--
-- The mid-upload window (an Admin uploads, reads back before a row exists):
--   1. Storage read is master-only for an object no document lists, so the
--      uploader cannot read it back through the storage API.
--   2. documents_insert_guard now lets a signed-in caller list only an
--      object they uploaded (the master may list any), inside the
--      document's own org folder, and never one another document lists.
--      So an Admin cannot claim an orphan or an athlete's file by
--      inserting a row for it.
--   3. App change shipped in the same release (src/lib/vault/readBack.ts,
--      used by documents.ts): the read-back after upload first tries the
--      caller's own session. If Storage refuses, it asks
--      public.upload_is_mine(path) (section 8): true only for an object the
--      caller uploaded that no document lists yet, in an org folder they
--      administer. Only then does it read with the service client. Until
--      the row exists nobody else can open the file.
-- Once the row exists the file follows the document rule above.
--
-- Dave's rulings (2026-11-03, relayed by Alfred): locked rows are view-only
-- (an Admin who cannot open a document cannot change it); area approvers
-- are deferred this round; the locked row is design A; the Oct 28 orphan
-- transcript stays master-only; and an Admin may link an upload to an
-- athlete they are not entitled to (public.document_link_athlete, below),
-- after which the file locks for them. Linking is the only write an
-- unentitled Admin keeps on a document, and only for a document they can
-- still open.
--
-- search_path on the four older helpers stays as it is (public); that is
-- a separate 0079, drafted by Tony after this lands.
-- Down: scripts/down/0078_files_follow_the_real_user_down.sql.

-- ── 1. Real-user helpers (auth.uid(), never the view-as target) ──────

create or replace function private._real_staff_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = ''
  as $$ select m.org_id from public.org_members m where m.user_id = auth.uid() and m.role in ('owner', 'staff') $$;

create or replace function private._real_entitled_to_athlete(p_athlete uuid, p_org uuid) returns boolean
  language sql stable security definer
  set search_path = ''
  as $$
    select auth.uid() is not null and (
      exists (select 1 from public.orgs o where o.id = p_org and o.master_user_id = auth.uid())
      or exists (
        select 1 from public.athletes a
        join public.org_members am on am.user_id = a.advisor_id and am.org_id = a.org_id and am.role in ('owner', 'staff')
        where a.id = p_athlete and a.org_id = p_org and a.advisor_id = auth.uid()
      )
      or exists (
        select 1 from public.athlete_guardians g
        join public.org_members gm on gm.user_id = g.user_id and gm.org_id = g.org_id and gm.role = 'family'
        where g.athlete_id = p_athlete and g.org_id = p_org and g.user_id = auth.uid()
      )
    )
  $$;

-- One document row: may the real signed-in person open its file?
-- A document with no athlete is open to the org's Admins. A document with
-- one or more athletes (athlete_id, linked_athlete_id, subject_athlete_id)
-- is open only to someone entitled to EVERY athlete it names, so a document
-- that names two different athletes opens for the master alone.
create or replace function private._real_can_read_doc(p_org uuid, p_a uuid, p_l uuid, p_s uuid) returns boolean
  language sql stable security definer
  set search_path = ''
  as $$
    select auth.uid() is not null and case
      when p_a is null and p_l is null and p_s is null then p_org in (select private._real_staff_org_ids())
      else (p_a is null or private._real_entitled_to_athlete(p_a, p_org))
        and (p_l is null or private._real_entitled_to_athlete(p_l, p_org))
        and (p_s is null or private._real_entitled_to_athlete(p_s, p_org))
    end
  $$;

grant execute on function private._real_staff_org_ids() to public;
grant execute on function private._real_entitled_to_athlete(uuid, uuid) to public;
grant execute on function private._real_can_read_doc(uuid, uuid, uuid, uuid) to public;

-- ── 2. The storage read, on the real user ────────────────────────────

create or replace function private._can_read_document_object(obj text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  with docs as (
    select d.org_id, d.athlete_id, d.linked_athlete_id, d.subject_athlete_id
    from public.documents d
    where d.org_id::text = (storage.foldername(obj))[1]
      and (obj = any (d.storage_paths) or obj = any (d.original_paths))
  )
  select auth.uid() is not null and (
    exists (
      select 1 from public.orgs o
      where o.id::text = (storage.foldername(obj))[1] and o.master_user_id = auth.uid()
    )
    or (
      exists (select 1 from docs)
      and not exists (select 1 from docs where not private._real_can_read_doc(org_id, athlete_id, linked_athlete_id, subject_athlete_id))
    )
  )
$$;
-- documents_bucket_read (0077) already calls this function; unchanged.

-- ── 3. The table read: the screen's rule AND the real user's right ───

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select
  using (
    org_id in (select private._member_org_ids())
    and private._real_can_read_doc(org_id, athlete_id, linked_athlete_id, subject_athlete_id)
  );

-- ── 4. The locked rows an Admin may still see ────────────────────────

create or replace function public.documents_locked(p_org uuid)
returns table (id uuid, org_id uuid, status text, lifecycle text, created_at timestamptz)
language sql stable security definer
set search_path = ''
as $$
  select d.id, d.org_id, d.status::text, d.lifecycle::text, d.created_at
  from public.documents d
  where d.org_id = p_org
    and d.org_id in (select private._member_org_ids())
    and not private._real_can_read_doc(d.org_id, d.athlete_id, d.linked_athlete_id, d.subject_athlete_id)
  order by d.created_at desc
$$;

revoke all on function public.documents_locked(uuid) from public, anon;
grant execute on function public.documents_locked(uuid) to authenticated;

comment on function public.documents_locked(uuid) is
  'The documents of an org the caller (an Admin on screen) cannot open: id, org_id, status, lifecycle and created_at only. Name, type, athlete and every other column are never returned.';

-- ── 5. family_documents and family_document_twin on the real user ────

create or replace function public.family_documents(p_org uuid, p_athlete uuid)
returns table (id uuid, file_name text, category text, status text, media_type text, file_size bigint, created_at timestamptz)
language sql stable security definer
set search_path to 'public'
as $$
  select d.id, d.file_name, d.category::text, d.status::text, d.media_type, d.file_size::bigint, d.created_at
  from documents d
  where d.org_id = p_org
    and d.athlete_id = p_athlete
    and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
    and private._real_can_read_doc(d.org_id, d.athlete_id, d.linked_athlete_id, d.subject_athlete_id)
    and coalesce(d.category::text, d.requested_category::text, '') <> 'recommendation'
  order by d.created_at desc
$$;

create or replace function public.family_document_twin(p_org uuid, p_hash text)
returns table (id uuid, file_name text, created_at timestamptz)
language sql stable security definer
set search_path to 'public'
as $$
  select d.id, d.file_name, d.created_at
  from documents d
  where d.org_id = p_org
    and d.content_hash = p_hash
    and d.status <> 'discarded'
    and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
    and private._real_can_read_doc(d.org_id, d.athlete_id, d.linked_athlete_id, d.subject_athlete_id)
  order by d.created_at desc
  limit 1
$$;

-- ── 6. A new row may list only an object its caller uploaded ─────────

create or replace function private.documents_insert_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  p text;
  caller uuid := auth.uid();
begin
  if new.lifecycle not in ('uploaded', 'needs_review') then
    raise exception 'documents: a new document starts as Uploaded, not %', new.lifecycle
      using errcode = 'check_violation';
  end if;
  foreach p in array (coalesce(new.storage_paths, '{}') || coalesce(new.original_paths, '{}')) loop
    if not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p) then
      raise exception 'documents: % is not in storage', p using errcode = 'foreign_key_violation';
    end if;
    -- The server's own service client has no signed-in caller and is
    -- checked in the app. A signed-in caller lists only what they
    -- uploaded (the org's master may list any), in this org's folder,
    -- and never an object another document already lists.
    if caller is not null then
      if (storage.foldername(p))[1] is distinct from new.org_id::text then
        raise exception 'documents: % is not in this organization''s folder', p using errcode = 'insufficient_privilege';
      end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p and (o.owner = caller or o.owner_id = caller::text))
         and not exists (select 1 from public.orgs g where g.id = new.org_id and g.master_user_id = caller) then
        raise exception 'documents: % was not uploaded by the signed-in person', p using errcode = 'insufficient_privilege';
      end if;
      if exists (select 1 from public.documents x where p = any (x.storage_paths) or p = any (x.original_paths)) then
        raise exception 'documents: % already belongs to another document', p using errcode = 'unique_violation';
      end if;
    end if;
  end loop;
  return new;
end $$;

-- ── 7. Link an unlinked document to an athlete, without needing to open it after ─
--
-- Postgres refuses a plain update that leaves the caller a row they can
-- no longer read, so an Admin who is not the athlete's advisor or the
-- master could not link an upload to that athlete. This function makes
-- that one write for them. It checks the caller can open the document as
-- it is now (so a locked document stays view-only), is a real Admin of its
-- org (never a view-as session), and that the athlete is in the same org.
-- A document that already names an athlete keeps it: this function links
-- an UNLINKED document, and is a no-op when asked for the athlete it
-- already has. It never moves a document to a different athlete and never
-- unlinks one (that would widen who may open the file). It writes
-- linked_athlete_id and updated_at, as the app's own update does; the app
-- keeps writing the activity line.
create or replace function public.document_link_athlete(p_doc uuid, p_athlete uuid) returns void
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  caller uuid := auth.uid();
  d record;
begin
  if caller is null then
    raise exception 'document_link_athlete: sign in first' using errcode = 'insufficient_privilege';
  end if;
  if private._viewing() then
    raise exception 'document_link_athlete: read only while viewing as someone else' using errcode = 'insufficient_privilege';
  end if;
  select x.id, x.org_id, x.athlete_id, x.linked_athlete_id, x.subject_athlete_id into d
    from public.documents x where x.id = p_doc;
  if not found or d.org_id not in (select private._real_staff_org_ids()) then
    raise exception 'document_link_athlete: not available' using errcode = 'insufficient_privilege';
  end if;
  if not private._real_can_read_doc(d.org_id, d.athlete_id, d.linked_athlete_id, d.subject_athlete_id) then
    raise exception 'document_link_athlete: this document is locked' using errcode = 'insufficient_privilege';
  end if;
  if d.athlete_id is not null or d.linked_athlete_id is not null or d.subject_athlete_id is not null then
    if p_athlete is null
       or (d.athlete_id is not null and d.athlete_id <> p_athlete)
       or (d.linked_athlete_id is not null and d.linked_athlete_id <> p_athlete)
       or (d.subject_athlete_id is not null and d.subject_athlete_id <> p_athlete) then
      raise exception 'document_link_athlete: this document already belongs to an athlete' using errcode = 'insufficient_privilege';
    end if;
    return;
  end if;
  if p_athlete is null then
    return;
  end if;
  if not exists (
    select 1 from public.athletes a where a.id = p_athlete and a.org_id = d.org_id and a.deleted_at is null
  ) then
    raise exception 'document_link_athlete: that athlete is not on this organization''s roster' using errcode = 'invalid_parameter_value';
  end if;
  update public.documents set linked_athlete_id = p_athlete, updated_at = now() where id = p_doc;
end $$;

revoke all on function public.document_link_athlete(uuid, uuid) from public, anon;
grant execute on function public.document_link_athlete(uuid, uuid) to authenticated;

-- ── 8. Is this object my own, not yet listed by any document? ────────
--
-- The server action that reads a file straight after upload asks this
-- before it falls back to the service client. True only for a signed-in
-- Admin (never a view-as session) of the object's org folder, for an
-- object they uploaded (owner or owner_id), that no document lists yet.
-- Once a document lists it, the file follows the document rule and this
-- is false. The app checks the folder too; nothing here opens the file.
create or replace function public.upload_is_mine(p_path text) returns boolean
  language sql stable security definer
  set search_path = ''
  as $$
    select auth.uid() is not null
      and not private._viewing()
      and (storage.foldername(p_path))[1] in (select x::text from private._real_staff_org_ids() x)
      and exists (
        select 1 from storage.objects o
        where o.bucket_id = 'documents' and o.name = p_path
          and (o.owner = auth.uid() or o.owner_id = auth.uid()::text)
      )
      and not exists (select 1 from public.documents d where p_path = any (d.storage_paths) or p_path = any (d.original_paths))
  $$;

revoke all on function public.upload_is_mine(text) from public, anon;
grant execute on function public.upload_is_mine(text) to authenticated;
