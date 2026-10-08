-- 0048: the document vault (Doc AI rebuild, Piece 1).
--
-- Every upload is stored as it came, kept for good, and moves through
-- five states: Uploaded, Processing, Needs Review, Ready, Archived. This
-- migration is additive. It deletes no row, drops no column, and leaves
-- the old `status` (the reader's own state: processing, pending,
-- applied, discarded, failed, filed) exactly as it is, so the existing
-- review, apply and undo flow keeps working on the files tagged with one
-- of the six old types.
--
-- What it adds:
--   lifecycle            the new five-state field
--   lifecycle_changed_at when the state last moved (a reading stuck in
--                        Processing is told apart by this)
--   format               pdf, word, excel, csv, jpg, png or txt
--   uploaded_by          who uploaded it (the uploaded time is created_at)
--   review_reason        the one-line reason shown on a Needs Review row
--   original_paths       the untouched uploaded bytes, in storage
-- (file_name, file_size, media_type and content_hash, the SHA-256, are
-- already columns; content_hash for a one-file document is exactly that
-- file's SHA-256.)
--
-- What it enforces in the database, so a bug in the app cannot undo it:
--   - a row can only be created pointing at files that exist in storage
--   - a new row starts as Uploaded (or Needs Review, for the file an
--     Athlete login sends in with an assignment, which no reader touches)
--   - the original file record never changes after it is written
--   - the lifecycle moves only along the seven allowed paths
--   - nobody signed in can delete a document row or an original file
--   - the Athlete login's folder takes PDF, JPG and PNG only, as before,
--     even though the bucket now lists more types
--
-- Nothing here reads, alters or drops the two Sept 26 backup tables.
-- A matching down script is scripts/down/0048_document_vault_down.sql.

create type doc_lifecycle as enum ('uploaded', 'processing', 'needs_review', 'ready', 'archived');

alter table documents
  add column lifecycle            doc_lifecycle not null default 'needs_review',
  add column lifecycle_changed_at timestamptz   not null default now(),
  add column format               text,
  add column review_reason        text,
  add column original_paths       text[]        not null default '{}';

alter table documents add column uploaded_by uuid references users(id) on delete set null;
create index documents_uploaded_by_idx on documents (uploaded_by);

alter table documents
  add constraint documents_format_check
  check (format is null or format in ('pdf', 'word', 'excel', 'csv', 'jpg', 'png', 'txt'));

comment on column documents.lifecycle is
  'Where the document is in the vault: uploaded, processing, needs_review, ready, archived. Moves only along the allowed paths (trigger documents_lifecycle_transition). Ready is always a person''s tap.';
comment on column documents.review_reason is
  'The line shown on a Needs Review row: "Did not look like Transcript", the reader''s error, or why the reader was skipped.';
comment on column documents.original_paths is
  'The untouched uploaded bytes in the documents bucket. storage_paths is what the reader reads; for a PDF they are the same object, for a tagged photo storage_paths holds a shrunk reader copy.';

-- ── Existing rows: mapped, none deleted ─────────────────────────────
--   processing -> needs_review   ("Reading did not finish.")
--   pending    -> needs_review
--   applied    -> needs_review   (Ready is never automatic)
--   discarded  -> archived
--   failed     -> needs_review   (with the old failure_reason)
--   filed      -> needs_review   (a file an Athlete login sent in)
-- Runs before the guard triggers below exist, so it may fill the
-- columns those triggers will later freeze.
update documents set
  lifecycle = (case status when 'discarded' then 'archived' else 'needs_review' end)::doc_lifecycle,
  review_reason = case status
    when 'failed' then failure_reason
    when 'processing' then 'Reading did not finish.'
    else null
  end,
  original_paths = storage_paths,
  format = case media_type
    when 'application/pdf' then 'pdf'
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    else null
  end;

create index documents_org_lifecycle_idx on documents (org_id, lifecycle, created_at desc);

-- ── No row without a file; a new row starts clean ───────────────────
create function private.documents_insert_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  p text;
begin
  if new.lifecycle not in ('uploaded', 'needs_review') then
    raise exception 'documents: a new document starts as Uploaded, not %', new.lifecycle
      using errcode = 'check_violation';
  end if;
  foreach p in array (coalesce(new.storage_paths, '{}') || coalesce(new.original_paths, '{}')) loop
    if not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p) then
      raise exception 'documents: % is not in storage', p using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end $$;

create trigger documents_insert_guard
  before insert on documents
  for each row execute function private.documents_insert_guard();

-- ── The original file record never changes ──────────────────────────
create function private.documents_original_is_immutable() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.org_id         is distinct from old.org_id
  or new.file_name      is distinct from old.file_name
  or new.file_size      is distinct from old.file_size
  or new.media_type     is distinct from old.media_type
  or new.format         is distinct from old.format
  or new.content_hash   is distinct from old.content_hash
  or new.storage_paths  is distinct from old.storage_paths
  or new.original_paths is distinct from old.original_paths
  or new.uploaded_by    is distinct from old.uploaded_by
  or new.created_at     is distinct from old.created_at then
    raise exception 'documents: the original file record is never changed'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger documents_original_is_immutable
  before update on documents
  for each row execute function private.documents_original_is_immutable();

-- ── The lifecycle moves only along the allowed paths ────────────────
-- The same seven pairs as src/lib/vault/lifecycle.ts; a law test
-- compares the two.
create function private.documents_lifecycle_transition() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.lifecycle is distinct from old.lifecycle then
    if not exists (
      select 1
      from (values
        ('uploaded', 'processing'),
        ('uploaded', 'needs_review'),
        ('processing', 'needs_review'),
        ('needs_review', 'ready'),
        ('needs_review', 'archived'),
        ('ready', 'archived'),
        ('archived', 'needs_review')
      ) as allowed(f, t)
      where allowed.f = old.lifecycle::text and allowed.t = new.lifecycle::text
    ) then
      raise exception 'documents: % to % is not an allowed move', old.lifecycle, new.lifecycle
        using errcode = 'check_violation';
    end if;
    new.lifecycle_changed_at := clock_timestamp();
  end if;
  return new;
end $$;

create trigger documents_lifecycle_transition
  before update on documents
  for each row execute function private.documents_lifecycle_transition();

-- ── Originals are permanent: no delete for anyone signed in ─────────
-- With row level security on and no delete policy, a signed-in caller
-- deletes nothing. The grant goes too, so the API does not even offer it.
-- The service role keeps its own access; no app code uses it to delete a
-- document (src/laws/vaultLaws.test.ts scans for it).
drop policy if exists documents_delete on documents;
drop policy if exists documents_bucket_delete on storage.objects;
revoke delete on documents from anon, authenticated;

-- ── The Athlete login's folder keeps taking PDF, JPG and PNG only ───
-- The bucket's type list now covers more formats; the family's own
-- upload screen is unchanged, so its storage policy says so too.
drop policy if exists documents_bucket_family_insert on storage.objects;
create policy documents_bucket_family_insert on storage.objects
  for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._family_org_ids() as org_id(org_id))
    and (storage.foldername(name))[2] = 'family'
    and array_length(storage.foldername(name), 1) = 3
    and lower(name) ~ '\.(pdf|jpe?g|png)$'
  );

-- ── The bucket: seven formats. Size limit (10 MB) is not touched. ───
update storage.buckets
set allowed_mime_types = array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/plain',
  'image/jpeg',
  'image/png'
]
where id = 'documents';

-- ── What the activity log can say about a document's life ───────────
alter type activity_action add value if not exists 'document_reading';
alter type activity_action add value if not exists 'document_needs_review';
alter type activity_action add value if not exists 'document_ready';
alter type activity_action add value if not exists 'document_archived';
alter type activity_action add value if not exists 'document_unarchived';
