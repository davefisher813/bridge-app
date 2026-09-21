-- The member role (Bridge calls it Board) gets its own version of the
-- app: the program as names and stages, the year against budget, the
-- campaigns, their own seat, and the board's total without names.
-- Dave's picks from the Board Access catalog, 2026-09-21.
--
-- Until now a member read every org table exactly like a coordinator
-- (migration 0010 made them read-only, nothing made them read less).
-- With the anon key in the browser that meant every athlete's GPA,
-- every call note and every donor's name were one PostgREST call away
-- for a board member. This migration closes that from the database
-- side, the way 0022 to 0024 did for the family role: the row policies
-- stop admitting the member role, and three SECURITY DEFINER functions
-- hand back exactly the summaries the picks describe.
--
-- What changes for the helpers:
--   private._member_org_ids()   owner and staff only (it was every
--                               non-family role). Every read policy
--                               written against it narrows at once.
--   private._observer_org_ids() new: the orgs where the caller is a
--                               member. Used by the users and
--                               org_members policies so a member can
--                               still see who to ask, and by the three
--                               functions to admit the caller.
--
-- Nothing changes for owner, staff or family.

-- ── 1. The helpers ───────────────────────────────────────────────────

create or replace function private._member_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'staff') $$;

create or replace function private._observer_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role = 'member' $$;
grant execute on function private._observer_org_ids() to public;

-- The owner and staff of the orgs where the caller is a member, as
-- (org, user) pairs: what a member's More screen lists under Who to
-- Ask. Mirrors private._family_staff_rows() for the family role.
create or replace function private._observer_staff_rows() returns table (org_id uuid, user_id uuid)
  language sql stable security definer
  set search_path = public
  as $$
    select m.org_id, m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (select org_id from org_members where user_id = auth.uid() and role = 'member')
  $$;
grant execute on function private._observer_staff_rows() to public;

-- ── 2. The two policies a member still needs a row from ──────────────

drop policy if exists users_in_my_orgs on users;
create policy users_in_my_orgs on users for select
  using (
    id in (select user_id from org_members where org_id in (select private._member_org_ids()))
    or id in (select private._family_staff_ids())
    or id in (select r.user_id from private._observer_staff_rows() r)
  );

drop policy if exists org_members_self on org_members;
create policy org_members_self on org_members for select
  using (
    user_id = (select auth.uid())
    or org_id in (select private._member_org_ids())
    or (org_id, user_id) in (select r.org_id, r.user_id from private._family_staff_rows() r)
    or (org_id, user_id) in (select r.org_id, r.user_id from private._observer_staff_rows() r)
  );

-- ── 3. What a member reads instead of rows ───────────────────────────
-- Each function admits owner, staff and member of the org named and
-- nobody else: a family login, or anyone outside the org, gets no rows.
-- SECURITY DEFINER so the function reads the tables the caller's own
-- policies no longer show them, and the function body is the whole of
-- what they get.

-- The program: every athlete as a name and where they stand. No
-- grades, no metrics, no matches, no record to open.
create or replace function public.member_program(p_org uuid)
  returns table (
    athlete_id uuid,
    name text,
    sport text,
    "position" text,
    grad_year int,
    recruit_type text,
    stage text,
    offers int,
    committed_school text
  )
  language sql stable security definer
  set search_path = public
  as $$
    select
      a.id,
      a.name,
      a.sport,
      a.position,
      nullif(a.detail->>'gradYear', '')::int,
      a.recruit_type::text,
      case
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Committed') then 'Committed'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer') then 'Offers'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status <> 'Not Interested') then 'Targeting'
        else 'No Targets'
      end,
      (select count(*) from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer')::int,
      (select s.name from recruiting_targets t join schools s on s.id = t.school_id where t.athlete_id = a.id and t.status = 'Committed' order by t.created_at desc limit 1)
    from athletes a
    where a.org_id = p_org
      and a.deleted_at is null
      and (p_org in (select private._member_org_ids()) or p_org in (select private._observer_org_ids()))
    order by a.name
  $$;
grant execute on function public.member_program(uuid) to public;

-- One athlete's schools and where each stands. Not the calls, notes,
-- visits, offer terms or the coach's contact.
create or replace function public.member_program_schools(p_org uuid, p_athlete uuid)
  returns table (target_id uuid, school_name text, division text, status text)
  language sql stable security definer
  set search_path = public
  as $$
    select t.id, s.name, s.division, t.status
    from recruiting_targets t
    join schools s on s.id = t.school_id
    join athletes a on a.id = t.athlete_id
    where t.org_id = p_org
      and t.athlete_id = p_athlete
      and a.deleted_at is null
      and (p_org in (select private._member_org_ids()) or p_org in (select private._observer_org_ids()))
    order by
      case t.status when 'Committed' then 0 when 'Offer' then 1 when 'Visit' then 2 when 'In Contact' then 3 when 'Target' then 4 else 5 end,
      s.name
  $$;
grant execute on function public.member_program_schools(uuid, uuid) to public;

-- Giving: the rows the year, the campaigns, the caller's own seat and
-- the board's total are computed from, with every name stripped except
-- on the gifts credited to the caller's seat. Ids stay (they are what
-- the give/get arithmetic joins on); names are what a board member
-- must not see about anyone else. The arithmetic itself stays in
-- src/lib/governance/giveGet.ts so the member's number is the same
-- number staff see on the seat.
create or replace function public.member_giving(p_org uuid)
  returns jsonb
  language plpgsql stable security definer
  set search_path = public
  as $$
  declare
    my_seat board_members%rowtype;
    my_donor uuid;
    out jsonb;
  begin
    if not (p_org in (select private._member_org_ids()) or p_org in (select private._observer_org_ids())) then
      return null;
    end if;

    select * into my_seat from board_members
      where org_id = p_org and user_id = auth.uid()
      order by status = 'active' desc, created_at
      limit 1;
    my_donor := my_seat.donor_id;

    out := jsonb_build_object(
      'my_seat_id', my_seat.id,
      'gifts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id, 'amount', g.amount, 'received_on', g.received_on, 'category', g.category, 'method', g.method,
          'donor_id', g.donor_id, 'campaign_id', g.campaign_id, 'pledge_id', g.pledge_id, 'solicited_by', g.solicited_by,
          'donor_name', case
            when my_seat.id is not null and (g.solicited_by = my_seat.id or (my_donor is not null and g.donor_id = my_donor))
              then (select d.name from donors d where d.id = g.donor_id)
            else null end
        ) order by g.received_on desc)
        from gifts g where g.org_id = p_org
      ), '[]'::jsonb),
      'pledges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'amount', p.amount, 'promised_on', p.promised_on, 'due_on', p.due_on, 'status', p.status,
          'donor_id', p.donor_id, 'campaign_id', p.campaign_id, 'solicited_by', p.solicited_by
        ) order by p.promised_on desc)
        from pledges p where p.org_id = p_org
      ), '[]'::jsonb),
      'campaigns', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'goal_amount', c.goal_amount, 'ends_on', c.ends_on) order by c.ends_on desc)
        from campaigns c where c.org_id = p_org
      ), '[]'::jsonb),
      'budget', coalesce((
        select jsonb_agg(jsonb_build_object('fiscal_year', b.fiscal_year, 'category', b.category, 'amount', b.amount))
        from fundraising_budget b where b.org_id = p_org
      ), '[]'::jsonb),
      'boards', coalesce((
        select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.kind, 'sport', b.sport, 'give_get_amount', b.give_get_amount, 'min_seats', b.min_seats, 'max_seats', b.max_seats) order by b.sort_order)
        from boards b where b.org_id = p_org
      ), '[]'::jsonb),
      'seats', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', m.id, 'board_id', m.board_id,
          'name', case when m.id = my_seat.id then m.name else null end,
          'role_title', case when m.id = my_seat.id then m.role_title else null end,
          'donor_id', m.donor_id, 'status', m.status, 'term_start', m.term_start, 'term_end', m.term_end,
          'commitment_amount', m.commitment_amount
        ) order by m.created_at)
        from board_members m where m.org_id = p_org
      ), '[]'::jsonb)
    );
    return out;
  end;
  $$;
grant execute on function public.member_giving(uuid) to public;

comment on function public.member_program(uuid) is 'What a member (Bridge: Board) sees of the program: each athlete as a name and a stage. Admits owner, staff and member of the org; nobody else gets rows.';
comment on function public.member_program_schools(uuid, uuid) is 'One athlete''s target schools and stages for a member. No calls, notes, visits or offer terms.';
comment on function public.member_giving(uuid) is 'The rows a member''s Giving screen computes from, names stripped except on gifts credited to the caller''s own seat. Null for anyone not owner, staff or member of the org.';
