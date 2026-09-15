-- The Today dashboard needs two things recruiting_targets didn't track:
-- how long a target has gone without a status change ("needs follow-up"),
-- and when a visit is actually scheduled ("upcoming"). Both are real
-- columns, not derived guesses, so the dashboard never has to fabricate
-- a staleness window or an invented visit date. See docs/DECISIONS.md.

alter table recruiting_targets
  add column updated_at timestamptz not null default now(),
  add column visit_date date;

-- Mirrors athletes.updated_at: app code bumps this on any status/notes
-- change (no DB trigger, same as athletes - see migrations/0001_core_schema.sql).
comment on column recruiting_targets.updated_at is 'Set by app code on status/notes change, not a trigger. Defaults to created_at until the first edit.';
comment on column recruiting_targets.visit_date is 'Scheduled campus visit date, if any. Null means no visit scheduled yet.';
