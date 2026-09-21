-- The membership shape behind the family role (migration 0022).
--
-- A family member belongs to the org like anyone else (an org_members
-- row, role 'family') and is linked to the athletes they may see through
-- athlete_guardians. One row per person per athlete: a parent with two
-- kids at Bridge has two rows, and an athlete and both parents on one
-- record have three. The org_members row grants the sign-in; the
-- guardian row grants the athlete. Neither alone shows a family anything.
--
-- What a family member may read, and nothing else:
--
--   their org's row (name, branding, role labels)
--   their own org_members row
--   the profiles of the org's owner and staff, so they know who to ask
--   their athletes, and those athletes' metrics, stored matches, courses,
--     recruiting targets and visits
--   the org's grading scales and approved course lists, which the
--     eligibility screen needs to explain a verdict
--
-- Not: other athletes, staff communications, contacts, documents, the
-- org's private school notes, fundraising or governance. Those stay
-- behind private._member_org_ids(), which from here on excludes the
-- family role. A family member writes nothing: every write policy is
-- keyed off private._staff_org_ids(), which never included them.

-- ── Who may see which athlete ────────────────────────────────────────
create table athlete_guardians (
  org_id        uuid not null references orgs(id) on delete cascade,
  athlete_id    uuid not null references athletes(id) on delete cascade,
  user_id       uuid not null references users(id) on delete cascade,
  -- Free text: parent, guardian, self. Display only.
  relationship  text,
  created_at    timestamptz not null default now(),
  primary key (athlete_id, user_id)
);

create index athlete_guardians_org_idx on athlete_guardians (org_id);
create index athlete_guardians_user_idx on athlete_guardians (user_id);

-- A guardian row must point at an athlete in its own org, and at a
-- person who is a member of that org. Postgres cannot say that with a
-- foreign key, so a trigger says it. Without this a staff member of
-- org A could, through PostgREST, link a user to an athlete of org B by
-- writing org A's id on the row.
create or replace function private.guardian_row_is_coherent() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  if not exists (select 1 from athletes a where a.id = new.athlete_id and a.org_id = new.org_id) then
    raise exception 'athlete_guardians: athlete % is not in org %', new.athlete_id, new.org_id
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from org_members m where m.user_id = new.user_id and m.org_id = new.org_id) then
    raise exception 'athlete_guardians: user % is not a member of org %', new.user_id, new.org_id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger athlete_guardians_coherent
  before insert or update on athlete_guardians
  for each row execute function private.guardian_row_is_coherent();

-- ── Helpers ──────────────────────────────────────────────────────────
-- Same SECURITY DEFINER pattern as the two from 0015, for the same
-- reason: a policy on org_members that reads org_members recurses.

-- Every org the caller belongs to in any role. Only orgs_by_membership
-- uses it: a family member must be able to resolve the org they signed
-- in to.
create or replace function private._any_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() $$;

-- The orgs the caller reads in full. Family is excluded from here on:
-- every `_read` policy in the schema is keyed off this function, and a
-- family member reading the whole org through it is the leak this
-- migration exists to prevent.
create or replace function private._member_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role <> 'family' $$;

create or replace function private._family_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role = 'family' $$;

create or replace function private._family_athlete_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select athlete_id from athlete_guardians where user_id = auth.uid() $$;

-- The owner and staff of the orgs the caller is a family member of.
-- A helper rather than a subselect in the users policy, because that
-- subselect on org_members would run under org_members_self, which
-- shows a family member only their own row.
create or replace function private._family_staff_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (select org_id from org_members where user_id = auth.uid() and role = 'family')
  $$;

grant execute on function private._any_org_ids() to public;
grant execute on function private._family_org_ids() to public;
grant execute on function private._family_athlete_ids() to public;
grant execute on function private._family_staff_ids() to public;

-- ── The guardian table's own policies ────────────────────────────────
-- Staff read and write the org's rows; a family member reads their own.
alter table athlete_guardians enable row level security;

create policy athlete_guardians_read on athlete_guardians for select
  using (org_id in (select private._member_org_ids()) or user_id = (select auth.uid()));
create policy athlete_guardians_insert on athlete_guardians for insert
  with check (org_id in (select private._staff_org_ids()));
create policy athlete_guardians_update on athlete_guardians for update
  using (org_id in (select private._staff_org_ids()))
  with check (org_id in (select private._staff_org_ids()));
create policy athlete_guardians_delete on athlete_guardians for delete
  using (org_id in (select private._staff_org_ids()));

-- ── What a family member reads ───────────────────────────────────────
-- Each read policy is dropped and recreated with the family clause
-- added. Write policies are untouched.

drop policy if exists orgs_by_membership on orgs;
create policy orgs_by_membership on orgs for select
  using (id in (select private._any_org_ids()));

-- Colleagues as before, plus, for a family member, the owner and staff
-- of their org. Never other families: a parent must not be able to list
-- the other parents.
drop policy if exists users_in_my_orgs on users;
create policy users_in_my_orgs on users for select
  using (
    id in (select user_id from org_members where org_id in (select private._member_org_ids()))
    or id in (select private._family_staff_ids())
  );

drop policy if exists athletes_read on athletes;
create policy athletes_read on athletes for select
  using (org_id in (select private._member_org_ids()) or id in (select private._family_athlete_ids()));

do $$
declare t text;
declare tables text[] := array['athlete_metrics', 'athlete_school_fits', 'athlete_courses', 'recruiting_targets'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select using (org_id in (select private._member_org_ids()) or athlete_id in (select private._family_athlete_ids()))',
      t || '_read', t);
  end loop;
end $$;

-- Visits hang off a target, not an athlete. The subselect on
-- recruiting_targets runs under that table's own policy, which the
-- clause above already opened for the family's athletes.
drop policy if exists target_visits_read on target_visits;
create policy target_visits_read on target_visits for select
  using (
    org_id in (select private._member_org_ids())
    or target_id in (select id from recruiting_targets where athlete_id in (select private._family_athlete_ids()))
  );

-- Org reference data the eligibility screen reads to explain itself.
do $$
declare t text;
declare tables text[] := array['org_grading_scales', 'org_approved_course_lists', 'org_approved_courses'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select using (org_id in (select private._member_org_ids()) or org_id in (select private._family_org_ids()))',
      t || '_read', t);
  end loop;
end $$;
