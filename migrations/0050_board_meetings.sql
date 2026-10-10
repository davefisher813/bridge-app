-- 0050: meeting materials for Board Governance (Dave, 2026-10-10:
-- "Build the feature").
--
-- A meeting is a date, a title, where it is and notes, optionally for one
-- board. Its materials are documents already in the vault, linked, never
-- copied: the file stays where Piece 1 keeps it (original, permanent, five
-- states), so a meeting cannot lose a file and removing a meeting or a
-- link never touches a document.
--
-- Admins only, read and write, like Documents. A Viewer (the board) reads
-- no document today (migration 0031), so letting the board see meeting
-- materials is a separate decision, not something this migration slips in.

create table board_meetings (
  id          uuid primary key default uuid_generate_v4(),
  org_id      uuid not null references orgs(id) on delete cascade,
  board_id    uuid references boards(id) on delete set null,
  title       text not null check (length(btrim(title)) between 1 and 120),
  meets_on    date not null,
  location    text check (location is null or length(location) <= 200),
  notes       text check (notes is null or length(notes) <= 4000),
  created_by  uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index board_meetings_org_idx on board_meetings (org_id, meets_on desc);
create index board_meetings_board_idx on board_meetings (board_id);
create index board_meetings_created_by_idx on board_meetings (created_by);

create table board_meeting_documents (
  meeting_id  uuid not null references board_meetings(id) on delete cascade,
  document_id uuid not null references documents(id) on delete restrict,
  org_id      uuid not null references orgs(id) on delete cascade,
  added_by    uuid references users(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (meeting_id, document_id)
);

create index board_meeting_documents_document_idx on board_meeting_documents (document_id);
create index board_meeting_documents_org_idx on board_meeting_documents (org_id);
create index board_meeting_documents_added_by_idx on board_meeting_documents (added_by);

-- A link may only join a meeting and a document of the same org as the
-- link itself. RLS sees only the new row's org_id, so this is checked here.
create function private.board_meeting_documents_same_org() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.board_meetings m where m.id = new.meeting_id and m.org_id = new.org_id)
     or not exists (select 1 from public.documents d where d.id = new.document_id and d.org_id = new.org_id) then
    raise exception 'board_meeting_documents: the meeting and the document must both be in this organization'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger board_meeting_documents_same_org
  before insert or update on board_meeting_documents
  for each row execute function private.board_meeting_documents_same_org();

-- And a meeting's board, when set, is one of this org's boards.
create function private.board_meetings_board_same_org() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.board_id is not null and not exists (select 1 from public.boards b where b.id = new.board_id and b.org_id = new.org_id) then
    raise exception 'board_meetings: that board is not in this organization' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger board_meetings_board_same_org
  before insert or update on board_meetings
  for each row execute function private.board_meetings_board_same_org();

alter table board_meetings enable row level security;
alter table board_meeting_documents enable row level security;

do $$
declare t text;
begin
  foreach t in array array['board_meetings', 'board_meeting_documents'] loop
    execute format('create policy %I on %I for select using (org_id in (select private._staff_org_ids()))', t || '_read', t);
    execute format('create policy %I on %I for insert with check (org_id in (select private._staff_org_ids()))', t || '_insert', t);
    execute format('create policy %I on %I for update using (org_id in (select private._staff_org_ids())) with check (org_id in (select private._staff_org_ids()))', t || '_update', t);
    execute format('create policy %I on %I for delete using (org_id in (select private._staff_org_ids()))', t || '_delete', t);
  end loop;
end $$;
