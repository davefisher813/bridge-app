-- Board governance: the boards, who sits on them, and whether each seat
-- is meeting the commitment it carries.
--
-- The last module still gated off with nothing behind it. The model
-- comes from Bridge's own governance structure document rather than a
-- guess, the same way the fundraising model came from its existing P&L:
--
--   Executive Board    $10K give/get   strategy, governance, oversight
--   General Board      $5K             the voting body
--   Sport Boards       $5K             3 seats growing to 5, one per sport
--   Development Board  $1K             outreach, fundraising, event support
--   Junior Board       $500            young professionals, leadership pipeline
--
-- The interesting part is the phrase "give/get". Both halves count: a
-- member meets their commitment by giving the money OR by bringing it in
-- from somebody else. That is why `gifts` gains a `solicited_by` column
-- here. Most board software counts only personal giving, which
-- understates every member who is good at fundraising and tells a board
-- chair the wrong people are behind.
--
-- Gated behind orgs.modules.board_governance, off by default, so Elite
-- Squad never sees any of it.

create type board_kind as enum ('executive', 'general', 'sport', 'development', 'junior');

create type board_seat_status as enum ('prospect', 'active', 'emeritus', 'resigned');

-- ── Boards ───────────────────────────────────────────────────────────
create table boards (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,

  name            text not null,
  kind            board_kind not null,
  -- Set only for a sport board. Bridge runs one per sport, and the
  -- governance document gives each the same three core roles.
  sport           text,

  -- The tier's amount, stored per board rather than hardcoded per kind.
  -- Bridge's numbers are Bridge's; another organization with a board
  -- sets its own and no code changes.
  give_get_amount numeric(12,2) not null default 0,

  -- The sport boards "start with 3 members and can grow to 5". A floor
  -- worth flagging, not just a suggestion, so it is stored.
  min_seats       integer not null default 1,
  max_seats       integer not null default 30,

  description     text,
  sort_order      integer not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint boards_seats_sane check (min_seats >= 0 and max_seats >= min_seats)
);

create index boards_org_idx on boards (org_id);

-- ── Seats ────────────────────────────────────────────────────────────
create table board_members (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,
  board_id        uuid not null references boards(id) on delete cascade,

  name            text not null,
  -- Links the seat to the donor record, which is what lets their own
  -- giving be found without anybody re-entering it. Nullable: a
  -- prospect being considered for a seat is not a donor yet.
  donor_id        uuid references donors(id) on delete set null,
  -- Set if they also have a login. A board member who never signs in is
  -- the common case, so this is not how a seat is identified.
  user_id         uuid references users(id) on delete set null,

  -- The governance document's core sport-board roles are Sport Director,
  -- Board Chair and Recruiting Lead. Free text rather than an enum
  -- because Bridge's officers (Chair, Vice Chair, Treasurer, Secretary)
  -- are a different vocabulary on the same kind of seat, and a board
  -- invents a title more often than a migration ships.
  role_title      text,

  status          board_seat_status not null default 'prospect',
  term_start      date,
  term_end        date,

  -- Normally the board's amount, copied at the time the seat is filled
  -- so that changing a board's tier later does not silently rewrite what
  -- a sitting member agreed to. A founding member on a reduced
  -- commitment is a real thing, and pretending otherwise means somebody
  -- keeps a spreadsheet.
  commitment_amount numeric(12,2) not null default 0,

  email           text,
  phone           text,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint board_members_term_order check (term_end is null or term_start is null or term_end >= term_start)
);

create index board_members_org_idx on board_members (org_id);
create index board_members_board_idx on board_members (board_id);
create index board_members_donor_idx on board_members (donor_id);

-- ── The "get" half ───────────────────────────────────────────────────
-- Who brought a gift in, when it was not their own money. This is the
-- column that makes give/get mean what the governance document says it
-- means. Without it the app can only ever report personal giving.
--
-- A gift the member both made and is credited with soliciting counts
-- once; that rule lives in src/lib/governance/giveGet.ts, because it is
-- the kind of thing worth a test rather than a constraint.
alter table gifts add column solicited_by uuid references board_members(id) on delete set null;
alter table pledges add column solicited_by uuid references board_members(id) on delete set null;

create index gifts_solicited_by_idx on gifts (solicited_by);
create index pledges_solicited_by_idx on pledges (solicited_by);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Same role-aware shape as everything since migration 0010: any member
-- of the org reads, only owner and staff write.
alter table boards enable row level security;
alter table board_members enable row level security;

do $$
declare t text;
declare tables text[] := array['boards', 'board_members'];
begin
  foreach t in array tables loop
    execute format('create policy %I on %I for select using (org_id in (select _member_org_ids()))', t || '_read', t);
    execute format('create policy %I on %I for insert with check (org_id in (select _staff_org_ids()))', t || '_insert', t);
    execute format(
      'create policy %I on %I for update using (org_id in (select _staff_org_ids())) with check (org_id in (select _staff_org_ids()))',
      t || '_update', t);
    execute format('create policy %I on %I for delete using (org_id in (select _staff_org_ids()))', t || '_delete', t);
  end loop;
end $$;
