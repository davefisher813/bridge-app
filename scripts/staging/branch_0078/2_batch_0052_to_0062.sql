-- BRANCH ONLY (kqvxkqqyojnnvkfkevhe). Never run this in the production SQL editor.
-- Batch 2 of 7: 0052 to 0062. Paste all of it, run once, read the last result grid.


-- ======== 0052_close_needs_review_shelf.sql ========
-- 0052: close public.needs_review_shelf (found 2026-10-10 by the Supabase
-- security advisor, level ERROR).
--
-- The view is not from this repo: it was created by hand on production,
-- outside the migrations. It listed every document in Needs Review (id,
-- file name, format, review reason, dates) across every org, ran with
-- its owner's rights so row level security never applied, and the
-- signed-out role could read it: 17 rows were readable with the public
-- key on 2026-10-10. Nothing in the app reads it.
--
-- Not dropped (it is not ours to remove): it now runs with the caller's
-- rights, and neither the signed-out nor the signed-in role may read it.
-- A no-op where the view does not exist (local test databases).

do $$
begin
  if to_regclass('public.needs_review_shelf') is not null then
    execute 'alter view public.needs_review_shelf set (security_invoker = true)';
    execute 'revoke all on public.needs_review_shelf from anon, authenticated';
  end if;
end $$;


-- ======== 0053_stub_reading_never_applied.sql ========
-- 0053: a reading made up by the stand-in can never be applied (backend
-- audit F-01, critical, 2026-10-06).
--
-- Until now the rule lived in the app (applyGate in
-- src/lib/actions/documents.ts): every apply path asks it first. That is
-- convention, not construction; a new write path that forgot to ask
-- could put invented data onto a real athlete's record. The database now
-- refuses it: a document whose read_by is 'stub' cannot become 'applied',
-- on insert or update, from any client, service role included.
-- read_by = 'stub' is already permanent (migration 0040), so the two
-- together close the gap. Additive: one function, one trigger.

create or replace function private.stub_reading_never_applied() returns trigger
  language plpgsql
  set search_path = public
  as $$
begin
  if new.status = 'applied' and new.read_by = 'stub'
     and (tg_op = 'INSERT' or old.status is distinct from 'applied') then
    raise exception 'documents: a reading made by the stand-in cannot be applied to an athlete'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger documents_stub_never_applied
  before insert or update of status, read_by on documents
  for each row execute function private.stub_reading_never_applied();


-- ======== 0054_document_filed_as.sql ========
-- 0054: types for documents the reader does not read (Alfred, 2026-10-10:
-- 13 of the 16 prepared files had no fitting type; board documents and
-- athlete profiles went up as No Type).
--
-- The six reader types (doc_category) each have a reading schema and a
-- place their fields land on an athlete; a board's bylaws or an athlete's
-- profile sheet has neither. So they are not new reader categories: a
-- document is filed as one of these, stored as it is, never read, and the
-- type shows wherever the document does. A document the reader read keeps
-- its reader category and no filed_as. Additive: one nullable column.

alter table documents add column filed_as text
  check (filed_as is null or filed_as in ('board_document', 'athlete_profile', 'other'));

comment on column documents.filed_as is
  'A type for a document the reader does not read: board_document, athlete_profile or other. Set on upload or later on the document screen. Never read by the AI.';


-- ======== 0055_document_moves_back.sql ========
-- 0055: two more document moves (Alfred's production audit, 2026-10-10).
--
--   ready -> needs_review: Mark Ready had no undo. A document marked Ready
--     by mistake could only be archived. Now a person can move it back.
--   needs_review -> processing: Read Again. A document waiting in review
--     with a reading type can be read again on demand (a clearer copy of
--     the rules, a type picked after upload), and comes back to Needs
--     Review when the reading ends.
--
-- The same list as src/lib/vault/lifecycle.ts; a law compares the two.
-- Replaces the function from 0048; the trigger is unchanged.

create or replace function private.documents_lifecycle_transition() returns trigger
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
        ('needs_review', 'processing'),
        ('ready', 'archived'),
        ('ready', 'needs_review'),
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


-- ======== 0056_checkin_photos.sql ========
-- 0056: a photo on a check-in (live check of the audit fixes, 2026-10-10:
-- a meeting with an athlete had nowhere to keep the picture taken at it).
--
-- One photo per check-in, the 0049 pattern. The phone shrinks it to a
-- JPEG and puts it in a private bucket under <org>/<athlete>/<n>.jpg; the
-- server reads the bytes back and checks them before the row points at
-- them, and serves it through
-- /org/<slug>/roster/<athlete>/checkins/<checkin>/photo to staff only,
-- because check-ins are staff only (0039: these athletes are minors).
--
-- One policy: an Admin of an org may add a file under that org's folder.
-- Nobody signed in may read, replace or delete one; the service role
-- does that on the server after the checks. Additive: one nullable
-- column, one bucket, one insert policy.

alter table athlete_checkins add column photo_path text;

comment on column athlete_checkins.photo_path is
  'A photo from the check-in: a path in the checkin-photos bucket, <org>/<athlete>/<n>.jpg. Staff only, like the notes.';

alter table athlete_checkins
  add constraint athlete_checkins_photo_path_shape
  check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]+\.jpg$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checkin-photos', 'checkin-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy checkin_photos_admin_insert on storage.objects
  for insert
  with check (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] in (select org_id::text from private._staff_org_ids() as org_id(org_id))
    and array_length(storage.foldername(name), 1) = 2
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]+\.jpg$'
  );


-- ======== 0057_migration_status.sql ========
-- 0057: the database says which migrations it has (live check of the
-- audit fixes, 2026-10-10: there was no way to see from the app whether
-- a backend fix was applied).
--
-- Organization Settings compares this list with the repo's own ledger
-- (migrations/APPLIED.md, mirrored in src/lib/ops/appliedLedger.ts). It
-- returns versions and names only, nothing from any org, and only to a
-- signed-in Admin of some org; anyone else gets no rows. It reads
-- Supabase's own history table, which a plain database (the local RLS
-- suite) does not have, so it answers empty there instead of failing.

create or replace function public.applied_migrations()
returns table (version text, name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from private._staff_org_ids()) then
    return;
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return;
  end if;
  return query execute 'select version::text, name::text from supabase_migrations.schema_migrations order by version';
end $$;

revoke all on function public.applied_migrations() from public, anon;
grant execute on function public.applied_migrations() to authenticated;


-- ======== 0058_document_athlete_link.sql ========
-- 0058: a document can be about an athlete (Dave, 2026-10-11: a document
-- could only be typed, so an athlete's page listed none of theirs).
--
-- linked_athlete_id is a person's choice, optional, set on upload or on
-- the document screen. It is NOT athlete_id: athlete_id is where a
-- reading was applied, and Undo clears it, which must never erase what a
-- person linked. Org-wide documents (bylaws, minutes) leave it empty.
--
-- No policy changes: the documents policies already decide who reads a
-- row, and a link widens nothing (a family login still sees only what
-- 0024 lets it). One trigger keeps the link inside the document's org,
-- because the update policies check org_id, not the athlete named.
-- Additive: one nullable column, one index, one trigger, and one more
-- activity action (document_linked) so a link or unlink is logged.

alter table documents add column linked_athlete_id uuid references athletes(id) on delete set null;

comment on column documents.linked_athlete_id is
  'The athlete this document is about, picked by a person. Optional; empty for org-wide documents. Separate from athlete_id (where a reading was applied).';

create index documents_linked_athlete_idx on documents (linked_athlete_id) where linked_athlete_id is not null;

create or replace function private.documents_link_is_coherent() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
begin
  if new.linked_athlete_id is not null
     and not exists (select 1 from public.athletes a where a.id = new.linked_athlete_id and a.org_id = new.org_id) then
    raise exception 'documents: athlete % is not in org %', new.linked_athlete_id, new.org_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger documents_link_coherent
  before insert or update of linked_athlete_id, org_id on documents
  for each row execute function private.documents_link_is_coherent();

alter type activity_action add value if not exists 'document_linked';


-- ======== 0059_doc_category_athlete_profile.sql ========
-- 0059: Athlete Profile is a reading type (Oct 11 live test: six profile
-- sheets were filed as a type the reader never read, and Read Again
-- stayed off on every one). One enum value, the 0028 pattern. Rows
-- filed as athlete_profile before this keep that filed_as; the app reads
-- them as this type and moves them over when they are read.

alter type doc_category add value if not exists 'athlete_profile';


-- ======== 0060_doc_category_board_other.sql ========
-- 0060: every document is read (Dave, Oct 11). Board Document and Other
-- become reading types (a reading for a person, never applied to an
-- athlete), and a document nobody typed is read as Other. Two enum
-- values, the 0028 pattern. Rows filed as either before keep that
-- filed_as and are read as the type of the same name.

alter type doc_category add value if not exists 'board_document';
alter type doc_category add value if not exists 'other';


-- ======== 0061_activity_document_deleted.sql ========
-- 0061: a deleted document is logged (Dave, Oct 11: documents get a
-- real Delete). One activity action. Deleting itself needs no schema
-- change: the app deletes on the server through the service role after
-- an Admin check, and the table and bucket still carry no delete policy
-- for anyone signed in (migration 0048).

alter type activity_action add value if not exists 'document_deleted';


-- ======== 0062_activity_board_seat_donor_linked.sql ========
-- 0062: linking board seats to donor records is logged (Oct 13: every
-- seat was unlinked, so the board showed $0 given). One activity action.

alter type activity_action add value if not exists 'board_seat_donor_linked';


-- CHECK 2: expect every value true
select exists(select 1 from information_schema.columns where table_name='documents' and column_name='filed_as') as filed_as,
       exists(select 1 from information_schema.columns where table_name='documents' and column_name='linked_athlete_id') as linked_athlete_id,
       exists(select 1 from information_schema.columns where table_name='athlete_checkins' and column_name='photo_path') as photo_path,
       exists(select 1 from pg_trigger where tgname='documents_stub_never_applied') as stub_trigger,
       exists(select 1 from pg_trigger where tgname='documents_link_coherent') as link_trigger,
       exists(select 1 from storage.buckets where id='checkin-photos') as checkin_bucket,
       exists(select 1 from pg_proc where proname='applied_migrations') as applied_migrations_fn,
       exists(select 1 from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='doc_category' and e.enumlabel='athlete_profile') as cat_athlete_profile;
