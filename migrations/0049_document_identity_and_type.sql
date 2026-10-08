-- 0049: who a document is about, and what kind of thing it is (Doc AI
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
-- A matching down script is scripts/down/0049_document_identity_and_type_down.sql.

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
