-- Fundraising: donors, gifts, pledges, campaigns, grants and budget.
--
-- Bridge's "Program overview" on Today has been a coming-soon
-- placeholder with no table behind it since the redesign. This is the
-- table behind it.
--
-- The model is not invented. Dave's existing BFFSA platform app already
-- tracks all of this, and its shapes are the starting point so a report
-- out of this system reconciles against the one his board already sees:
--
--   donor:     { name, total, last, init, email, phone, address, notes }
--   financial: { desc, cat, date, amt, type: income|expense, notes }
--   P&L:       Individual Donations, Board Member Contributions,
--              Corporate Donations, Special Events, Foundation Grants,
--              each with an actual YTD and a full-year budget
--
-- Three deliberate departures from that shape, each for a reason:
--
-- 1. `total`, `last` and `init` are NOT columns here. They are derived
--    from the gift rows (src/lib/fundraising/rollup.ts's donorTotals).
--    A stored lifetime total drifts the first time a gift is corrected
--    or removed and nobody remembers to fix it by hand, and a wrong
--    donor total that nobody can explain is worse than a sum.
--
-- 2. A pledge is its own table, not a gift with a flag. Money promised
--    is not money received, and the two must never be summed into one
--    "raised" figure. Keeping them in separate tables means the wrong
--    query is hard to write rather than easy.
--
-- 3. Grants are a table, not only a revenue category. Dave: "We don't
--    have grants yet but build it for when we do." A grant has a
--    lifecycle a gift does not (applied, pending, awarded, declined)
--    and dates that matter before any money exists (decision expected,
--    report due). The money, once awarded and received, is still an
--    ordinary gift row in the `grant` category, so nothing is counted
--    twice.
--
-- Everything is org-scoped and gated behind orgs.modules.donor_fundraising,
-- which is off by default. Elite Squad will never see any of it.

-- Matches GiftCategory in src/lib/fundraising/rollup.ts, which carries
-- the display labels. The enum is the five P&L rows Dave already reports.
create type gift_category as enum (
  'individual',
  'board',
  'corporate',
  'special_event',
  'grant'
);

create type donor_type as enum ('individual', 'board_member', 'corporate', 'foundation', 'other');

-- How the money arrived. `in_kind` is not a payment method in the
-- ordinary sense and that is exactly why it belongs here: a donated case
-- of food is support and not cash, and the rollup has to be able to tell
-- the difference without a second column that can disagree with this one.
create type gift_method as enum ('stripe', 'check', 'cash', 'in_kind', 'other');

create type pledge_status as enum ('open', 'fulfilled', 'written_off');

create type grant_status as enum ('researching', 'applied', 'pending', 'awarded', 'declined', 'closed');

-- Whether a campaign is an event, an appeal or something else. The
-- Bridge Invitational golf outing is an event; a year-end letter is an
-- appeal.
create type campaign_kind as enum ('event', 'appeal', 'grant', 'other');

-- ── Donors ───────────────────────────────────────────────────────────
-- A supporter. Org-scoped rather than shared reference data, unlike
-- `schools`: two organizations with the same donor do not want to share
-- an address book, and one of them being able to read the other's donor
-- list would be the single worst leak this system could have.
create table donors (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,

  name            text not null,
  donor_type      donor_type not null default 'individual',

  email           text,
  phone           text,
  address         text,

  -- Somebody on the board who owns this relationship.
  steward_user_id uuid references users(id) on delete set null,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create index donors_org_idx on donors (org_id) where deleted_at is null;

-- ── Campaigns ────────────────────────────────────────────────────────
create table campaigns (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,

  name            text not null,
  kind            campaign_kind not null default 'other',
  starts_on       date,
  ends_on         date,

  -- numeric(12,2) throughout, never a float and never an integer of
  -- dollars. The app works in integer cents and converts at this
  -- boundary; the column keeps the exact decimal Postgres is good at.
  goal_amount     numeric(12,2),
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index campaigns_org_idx on campaigns (org_id);

-- ── Pledges ──────────────────────────────────────────────────────────
-- Money promised. Deliberately its own table so that no query summing
-- "donations" can accidentally include it.
create table pledges (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,

  -- A pledge always has somebody behind it, unlike a gift. An anonymous
  -- promise is not a promise anyone can follow up on.
  donor_id        uuid not null references donors(id) on delete cascade,
  campaign_id     uuid references campaigns(id) on delete set null,

  amount          numeric(12,2) not null check (amount > 0),
  promised_on     date not null,
  -- When it was said it would arrive. Null means no date was given,
  -- which the rollup treats as not overdue rather than always overdue.
  due_on          date,

  status          pledge_status not null default 'open',
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index pledges_org_idx on pledges (org_id);
create index pledges_donor_idx on pledges (donor_id);

-- ── Grants ───────────────────────────────────────────────────────────
-- The application, not the money. The money arrives as a gift row in the
-- `grant` category, linked back here, so an awarded grant is never
-- counted both as an award and as revenue.
create table grants (
  id                    uuid primary key default uuid_generate_v4(),
  org_id                uuid not null references orgs(id) on delete cascade,

  funder_name           text not null,
  -- Set once the funder exists in the address book as well. Optional,
  -- because researching a foundation comes before having a relationship
  -- with it.
  donor_id              uuid references donors(id) on delete set null,
  campaign_id           uuid references campaigns(id) on delete set null,

  status                grant_status not null default 'researching',
  amount_requested      numeric(12,2),
  amount_awarded        numeric(12,2),

  -- The dates that matter before any money exists, which is most of a
  -- grant's life.
  deadline_on           date,
  applied_on            date,
  decision_expected_on  date,
  report_due_on         date,

  notes                 text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index grants_org_idx on grants (org_id);

-- ── Gifts ────────────────────────────────────────────────────────────
-- Money actually received. The only table anything may call "raised".
create table gifts (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,

  -- Nullable: cash in a bucket at an event is real money with no
  -- supporter behind it. The rollup counts it in the total and not in
  -- the donor count, because a number quoted in a grant application has
  -- to mean people.
  donor_id        uuid references donors(id) on delete set null,
  campaign_id     uuid references campaigns(id) on delete set null,
  -- Set when this payment is against a promise, which is what lets the
  -- outstanding balance fall as it is paid instead of the committed
  -- figure growing.
  pledge_id       uuid references pledges(id) on delete set null,
  grant_id        uuid references grants(id) on delete set null,

  -- Negative is allowed, and means a refund or a correction. Keeping a
  -- reversal in the same ledger as the thing it reverses is what makes
  -- the sum right without a second code path somebody forgets to
  -- subtract. Zero is not a gift.
  amount          numeric(12,2) not null check (amount <> 0),
  received_on     date not null,
  category        gift_category not null,
  method          gift_method not null default 'other',

  -- What was given, when it was not money. Required for an in-kind gift
  -- by the app, because "$500 in-kind" with no description is not
  -- something a treasurer or an auditor can do anything with.
  in_kind_description text,

  -- The Stripe payment or charge id, or a check number. Lets a row be
  -- traced back to the payment processor without storing anything
  -- sensitive: an identifier, never a card number.
  external_ref    text,
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index gifts_org_received_idx on gifts (org_id, received_on desc);
create index gifts_donor_idx on gifts (donor_id);
create index gifts_campaign_idx on gifts (campaign_id);
create index gifts_pledge_idx on gifts (pledge_id);

-- Stripe sends the same event more than once. Without this, replaying a
-- webhook books the same donation twice and the year's total is simply
-- wrong, in the direction nobody questions.
create unique index gifts_external_ref_unique on gifts (org_id, external_ref) where external_ref is not null;

-- ── Budget ───────────────────────────────────────────────────────────
-- One row per category per year, which is exactly the "2026 Budget"
-- column in Dave's current P&L. Actuals are never stored here: they are
-- summed from gifts, so the two can never disagree.
create table fundraising_budget (
  id              uuid primary key default uuid_generate_v4(),
  org_id          uuid not null references orgs(id) on delete cascade,

  fiscal_year     integer not null,
  category        gift_category not null,
  amount          numeric(12,2) not null default 0,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (org_id, fiscal_year, category)
);

create index fundraising_budget_org_year_idx on fundraising_budget (org_id, fiscal_year);

-- ── RLS ──────────────────────────────────────────────────────────────
-- Same role-aware shape as migration 0010: any member of the org reads,
-- only owner and staff write. Written out per table rather than looped,
-- because these tables are created here and the loop in 0010 exists to
-- convert ones that already had a policy.
--
-- Donor names, addresses and giving histories are the most sensitive
-- rows in this database. Cross-org isolation on them is asserted in
-- scripts/rls_test.sql alongside everything else.
alter table donors enable row level security;
alter table campaigns enable row level security;
alter table pledges enable row level security;
alter table grants enable row level security;
alter table gifts enable row level security;
alter table fundraising_budget enable row level security;

do $$
declare t text;
declare tables text[] := array['donors', 'campaigns', 'pledges', 'grants', 'gifts', 'fundraising_budget'];
begin
  foreach t in array tables loop
    execute format('create policy %I on %I for select using (org_id in (select _member_org_ids()))', t || '_read', t);
    execute format('create policy %I on %I for insert with check (org_id in (select _staff_org_ids()))', t || '_insert', t);
    -- USING picks the rows, WITH CHECK picks what they may become. Both,
    -- so a staff member cannot move a donor into another org by
    -- rewriting org_id.
    execute format(
      'create policy %I on %I for update using (org_id in (select _staff_org_ids())) with check (org_id in (select _staff_org_ids()))',
      t || '_update', t);
    execute format('create policy %I on %I for delete using (org_id in (select _staff_org_ids()))', t || '_delete', t);
  end loop;
end $$;
