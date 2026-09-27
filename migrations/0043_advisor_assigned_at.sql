-- When an advisor was last assigned, stamped by the database.
--
-- Stage 5, Phase 2 (Dave approved the plan 2026-09-27). The Advisor
-- sheet on the athlete page lists the org's Admins most recently used
-- first, so the two or three people who actually advise sit at the top
-- of a long list. That needs a moment of assignment on the row, and
-- athletes.updated_at is not it: it moves on any edit and the advisor
-- actions never touch it.
--
-- One nullable timestamptz on athletes, written by the trigger that
-- already guards advisor_id (0039: owner or staff of the athlete's own
-- org, nobody else), so the app never sets it and cannot forget to. It
-- moves only when the advisor changes to somebody; clearing the advisor
-- or editing anything else leaves it alone, and an unchanged advisor on
-- a re-save leaves it alone too. Nulls sort last, so an Admin never
-- picked yet sits under everyone who was.
--
-- The rule itself, who may advise, is unchanged and still lives in one
-- database place (this trigger) and one app place
-- (src/lib/org/advisors.ts). No policy changes: the column rides the
-- athletes update policy, a Viewer (member) reads no athletes row and so
-- reads nothing new. No rows are written here. Safe to run twice.

alter table athletes add column if not exists advisor_assigned_at timestamptz;

comment on column athletes.advisor_assigned_at is
  'When advisor_id last changed to somebody. Set by the advisor trigger, never by the app. Orders the Advisor sheet most recently used first.';

comment on column athletes.advisor_id is
  'The Admin (owner or staff) who checks in with this athlete. Null until someone is assigned from the athlete page or the member page. Display and reminders only, never permissions. The app twin of this trigger is src/lib/org/advisors.ts.';

-- Same body as 0039 plus the stamp. Fires only when advisor_id or org_id
-- is written (the trigger definition in 0039 is unchanged), so an
-- ordinary edit of an athlete never runs it.
create or replace function private.advisor_is_staff() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  if new.advisor_id is not null and not exists (
    select 1 from org_members m
    where m.user_id = new.advisor_id and m.org_id = new.org_id and m.role in ('owner', 'staff')
  ) then
    raise exception 'athletes: advisor % is not owner or staff of org %', new.advisor_id, new.org_id
      using errcode = 'check_violation';
  end if;
  -- The stamp: a new advisor, on insert or when the pick changes. On an
  -- insert there is no old row to compare with.
  if new.advisor_id is not null and (tg_op = 'INSERT' or new.advisor_id is distinct from old.advisor_id) then
    new.advisor_assigned_at := now();
  end if;
  return new;
end $$;

-- The sheet's read: this org's advisors by their latest stamp.
create index if not exists athletes_advisor_recency_idx on athletes (org_id, advisor_id, advisor_assigned_at desc);
