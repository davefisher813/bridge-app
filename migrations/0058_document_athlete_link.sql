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
