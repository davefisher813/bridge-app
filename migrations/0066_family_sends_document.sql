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
