-- Graduated and Drafted: two more ways recruiting ends for an athlete.
--
-- Dave, 2026-09-26: "I should be able to say graduated or drafted."
-- His picks: Graduated means graduated from college, named by the school
-- they were at; Drafted records the team, round and year.
--
-- athletes.status stays free text validated in the app
-- (ATHLETE_STATUSES), so the two new values need no change here. What a
-- status cannot hold is the team and the round, so those get columns,
-- plus the graduation date. All nullable: they only mean something
-- while the status says so.

alter table athletes add column if not exists draft_team text;
alter table athletes add column if not exists draft_round int check (draft_round is null or draft_round between 1 and 99);
alter table athletes add column if not exists draft_year int check (draft_year is null or draft_year between 1900 and 2200);
alter table athletes add column if not exists graduated_on date;

-- The member Program screen follows placementOf() in
-- src/lib/placement.ts (migration 0034 did Enrolled). committed_school
-- now carries whatever the athlete is placed with: the school for
-- Committed, Enrolled and Graduated, the team for Drafted. Round and
-- year come back as their own columns, so the return type changes and
-- the function is dropped and recreated with 0033's grants.

drop function if exists public.member_program(uuid);

create function public.member_program(p_org uuid)
  returns table (
    athlete_id uuid,
    name text,
    sport text,
    "position" text,
    grad_year int,
    recruit_type text,
    stage text,
    offers int,
    committed_school text,
    draft_round int,
    draft_year int
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
        when a.status in ('Drafted', 'Graduated', 'Enrolled') then a.status
        when a.status = 'Committed' or exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Committed') then 'Committed'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer') then 'Offers'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status <> 'Not Interested') then 'Targeting'
        else 'No Targets'
      end,
      (select count(*) from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer')::int,
      case
        when a.status = 'Drafted' then nullif(btrim(a.draft_team), '')
        else coalesce(
          (select s.name from recruiting_targets t join schools s on s.id = t.school_id where t.athlete_id = a.id and t.status = 'Committed' order by t.created_at desc limit 1),
          case when a.status in ('Enrolled', 'Graduated') and a.detail->>'kind' = 'transfer' then nullif(btrim(a.detail->>'currentSchool'), '') end
        )
      end,
      case when a.status = 'Drafted' then a.draft_round end,
      case when a.status = 'Drafted' then a.draft_year end
    from athletes a
    where a.org_id = p_org
      and a.deleted_at is null
      and (p_org in (select private._member_org_ids()) or p_org in (select private._observer_org_ids()))
    order by a.name
  $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
end $$;
revoke execute on function public.member_program(uuid) from public, anon;
grant execute on function public.member_program(uuid) to authenticated;
