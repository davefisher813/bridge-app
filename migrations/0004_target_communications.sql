-- Communication log per target. Feeds src/lib/fit/score.ts's
-- RecruitingSignals.commCount/visitCount, which the fit engine already
-- expected as an input (see src/lib/fit/types.ts) but nothing populated -
-- the board's scoreFit() call has been running with no signals at all.
-- See docs/DECISIONS.md.

create type target_communication_kind as enum ('call', 'text', 'email', 'visit', 'other');

create table target_communications (
  id            uuid primary key default uuid_generate_v4(),
  -- Denormalized org_id (same pattern as every other org-scoped table)
  -- rather than joining through recruiting_targets for RLS: a policy
  -- that has to join to another RLS-protected table to decide visibility
  -- is exactly the recursion trap _member_org_ids() exists to avoid.
  org_id        uuid not null references orgs(id) on delete cascade,
  target_id     uuid not null references recruiting_targets(id) on delete cascade,
  kind          target_communication_kind not null,
  occurred_on   date not null default current_date,
  notes         text,
  created_at    timestamptz not null default now()
);

create index target_communications_target_id_idx on target_communications(target_id);

alter table target_communications enable row level security;

create policy target_communications_by_org on target_communications for all
  using (org_id in (select _member_org_ids()));
