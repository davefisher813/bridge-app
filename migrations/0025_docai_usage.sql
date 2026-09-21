-- Doc AI goes live: what each model call cost, and how much an org may
-- spend on reading documents in a month.
--
-- Bridge's original Doc AI "drained API usage like crazy" (Dave) and
-- kept its budget in localStorage, which is one browser's memory of one
-- person's spend. This is multi-tenant and server-side, so the record is
-- a table: one row per model call, with the tokens the API reported and
-- the cost in cents at the model's list price. The cap is a column on
-- the org, in cents, set by an owner under More. The action that reads a
-- document refuses to start once the month's rows add up to the cap.
--
-- The rows are written by staff (the action runs as the person who
-- uploaded) and read by any member of the org. Nobody edits a usage row
-- by hand; the update and delete policies exist because the RLS suite
-- refuses a table without the standard four, and they are staff-only.

create table docai_usage (
  id                 uuid primary key default uuid_generate_v4(),
  org_id             uuid not null references orgs(id) on delete cascade,
  -- Set null rather than cascade: the spend happened even if the
  -- document row is later discarded.
  document_id        uuid references documents(id) on delete set null,
  request_id         text not null,
  model              text not null,
  input_tokens       integer not null default 0,
  output_tokens      integer not null default 0,
  cache_read_tokens  integer not null default 0,
  cache_write_tokens integer not null default 0,
  cost_cents         numeric(10,3) not null default 0 check (cost_cents >= 0),
  created_at         timestamptz not null default now()
);

create index docai_usage_org_month_idx on docai_usage (org_id, created_at desc);
create index docai_usage_document_idx on docai_usage (document_id);

alter table docai_usage enable row level security;

create policy docai_usage_read on docai_usage for select
  using (org_id in (select private._member_org_ids()));
create policy docai_usage_insert on docai_usage for insert
  with check (org_id in (select private._staff_org_ids()));
create policy docai_usage_update on docai_usage for update
  using (org_id in (select private._staff_org_ids()))
  with check (org_id in (select private._staff_org_ids()));
create policy docai_usage_delete on docai_usage for delete
  using (org_id in (select private._staff_org_ids()));

-- Twenty dollars a month unless an owner says otherwise. At list price
-- that is on the order of a hundred transcripts.
alter table orgs add column docai_budget_cents integer not null default 2000
  check (docai_budget_cents >= 0);

comment on column orgs.docai_budget_cents is
  'How much this org may spend on document reading per calendar month, in cents. Set by an owner under More. Zero turns document reading off.';
