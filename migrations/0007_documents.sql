-- Doc AI's front end (docs/ROADMAP.md). The extraction pipeline
-- (src/lib/docai/) has been built and tested since before any of this
-- existed, but it deliberately returns a result and never persists
-- anything: "Persisting the result (auto apply vs. review queue vs.
-- reject) is the caller's job, because that's where org_id, RLS, and the
-- actual athlete row live" (src/lib/docai/pipeline.ts). This table is
-- that caller's storage.
--
-- One row per uploaded document, not per extracted field. The row carries
-- what the pipeline decided and what a human did about it, so the review
-- queue is a query over this table rather than a separate structure.

-- Matches DocCategoryId in src/lib/docai/types.ts. `film` is included
-- because the category exists in the registry as an explicit
-- not-yet-supported placeholder; a row can be recorded against it and
-- rejected honestly rather than the upload being silently impossible.
create type doc_category as enum ('transcript', 'test_scores', 'offer_letter', 'recommendation', 'financial_aid', 'film');

-- Matches SourceRole. Who supplied the document changes how far its
-- extraction is trusted (see provenance.ts), so it is stored, not derived.
create type doc_source_role as enum ('admin', 'coordinator', 'email', 'parent', 'athlete');

-- Matches RouteDecision: what the pipeline decided on its own.
create type doc_route as enum ('auto_apply', 'review', 'reject');

-- What has actually happened to the row since, which is a different
-- question from the route. A document routed to review is `pending` until
-- a human applies or discards it; one routed to auto_apply is `applied`
-- immediately. Keeping these separate is what makes "why did this change"
-- answerable later: the route is the machine's call and the status is the
-- outcome.
create type doc_status as enum ('processing', 'pending', 'applied', 'discarded', 'failed');

create table documents (
  id                uuid primary key default uuid_generate_v4(),
  org_id            uuid not null references orgs(id) on delete cascade,

  -- The upload itself.
  file_name         text not null,
  file_size         integer not null,
  media_type        text not null,
  page_count        integer,

  -- What the user said it was, and what triage thought. Dave wanted both:
  -- triage detects the type by default, and he can force one up front.
  -- A null requested_category means "detect it".
  requested_category doc_category,
  category          doc_category,
  detected_type     text,
  source_role       doc_source_role not null,

  -- The pipeline's own output. `extracted` is the validated payload, so a
  -- row can never hold raw unvalidated model JSON (see
  -- docs/DECISIONS.md). `failure_stage` records which of the pipeline's
  -- early exits fired, which is what the UI needs to say something useful
  -- rather than "something went wrong".
  route             doc_route,
  status            doc_status not null default 'processing',
  failure_stage     text,
  failure_reason    text,
  extracted         jsonb,
  provenance        jsonb,
  triage            jsonb,
  candidates        jsonb,

  -- Who it ended up attached to, and who decided that. Null while the
  -- document is unmatched or was discarded.
  athlete_id        uuid references athletes(id) on delete set null,
  applied_at        timestamptz,
  applied_by        uuid references users(id) on delete set null,

  -- The pipeline's request id, so a row can be traced back to the model
  -- calls that produced it.
  request_id        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- The queue screen reads "everything in this org that still needs a
-- human", oldest first, which is this index.
create index documents_org_status_idx on documents(org_id, status, created_at desc);
create index documents_athlete_id_idx on documents(athlete_id);

alter table documents enable row level security;

-- Same policy shape as every other org-scoped table: membership decides
-- visibility, and a document belonging to another org is invisible rather
-- than forbidden.
create policy documents_by_org on documents for all
  using (org_id in (select _member_org_ids()));
