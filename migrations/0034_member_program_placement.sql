-- The member Program screen names where every athlete is going, the
-- same way the staff and family screens do.
--
-- member_program() (migration 0031) worked out an athlete's stage from
-- their targets only. An athlete marked Enrolled still read Committed
-- forever, and one enrolled at the Current School on their own record,
-- with no target at all, read No Targets. Dave, 2026-09-26: "Fix it as
-- well."
--
-- The rule now matches placementOf() in src/lib/placement.ts:
--   Enrolled   athletes.status is Enrolled. School: the Committed
--              target, else the Current School on a transfer record.
--   Committed  a Committed target, or athletes.status is Committed.
--              School: the Committed target.
--   otherwise  Offers, Targeting or No Targets, exactly as before.
-- committed_school carries the school for both, so the return type,
-- and with it the grants from migration 0033, are unchanged.

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
        when a.status = 'Enrolled' then 'Enrolled'
        when a.status = 'Committed' or exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Committed') then 'Committed'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer') then 'Offers'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status <> 'Not Interested') then 'Targeting'
        else 'No Targets'
      end,
      (select count(*) from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer')::int,
      coalesce(
        (select s.name from recruiting_targets t join schools s on s.id = t.school_id where t.athlete_id = a.id and t.status = 'Committed' order by t.created_at desc limit 1),
        case when a.status = 'Enrolled' and a.detail->>'kind' = 'transfer' then nullif(btrim(a.detail->>'currentSchool'), '') end
      )
    from athletes a
    where a.org_id = p_org
      and a.deleted_at is null
      and (p_org in (select private._member_org_ids()) or p_org in (select private._observer_org_ids()))
    order by a.name
  $$;
