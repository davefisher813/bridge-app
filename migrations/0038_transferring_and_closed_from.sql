-- Transferring, and a close-out that remembers what it closed.
--
-- Dave, 2026-09-26: a placed athlete (Committed, Enrolled, Graduated,
-- Drafted) has no score anywhere, and a kid who backs out of a
-- commitment or leaves college is recruited again with the schools that
-- were closed for them put back as they were.
--
-- Three things here, all in support of src/lib/data/reopen.ts:
--
-- 1. recruiting_targets.closed_from: the status the close-out replaced
--    (src/lib/data/enrollment.ts). Null for an open target and for a
--    hand-picked Not Interested, so a reopen restores exactly the rows
--    the close-out took and nothing anyone chose to drop. Committed is
--    not a value it can hold: the Committed target is never closed by a
--    close-out, and a reopen handles it on its own.
-- 2. Stored fits for placed and Inactive athletes are deleted once; from
--    here the app deletes them at the moment recruiting ends and never
--    writes new ones (src/lib/data/fits.ts).
-- 3. member_program() learns Transferring: a college athlete who reopened
--    recruiting. Their leftover Committed target, if a reopen left one,
--    is history and never reads them as Committed again. Same rule as
--    placementOf() in src/lib/placement.ts.
--
-- athletes.status stays free text validated in the app (ATHLETE_STATUSES),
-- so Transferring itself needs no change here.

alter table recruiting_targets add column if not exists closed_from text
  check (closed_from is null or closed_from in ('Target', 'In Contact', 'Visit', 'Offer'));

comment on column recruiting_targets.closed_from is
  'The target status a close-out replaced with Not Interested; null for an open target or a hand-picked Not Interested. Reopen Recruiting restores it.';

-- Rows the close-out closed before this column existed carry only its
-- note. Dave's rule for an unknown prior status is In Contact.
update recruiting_targets
  set closed_from = 'In Contact'
  where status = 'Not Interested'
    and closed_from is null
    and notes like '%Closed automatically:%';

-- Inactive too: scoring is only for a kid who is recruiting (Active or
-- Transferring).
delete from athlete_school_fits f
  using athletes a
  where a.id = f.athlete_id
    and a.status not in ('Active', 'Transferring');

-- Same return type as 0035, so the grants below are re-asserted rather
-- than re-created (the way 0034 did it).
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
        when a.status <> 'Transferring' and (a.status = 'Committed' or exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Committed')) then 'Committed'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer') then 'Offers'
        when exists (select 1 from recruiting_targets t where t.athlete_id = a.id and t.status <> 'Not Interested') then 'Targeting'
        else 'No Targets'
      end,
      (select count(*) from recruiting_targets t where t.athlete_id = a.id and t.status = 'Offer')::int,
      case
        when a.status = 'Drafted' then nullif(btrim(a.draft_team), '')
        else coalesce(
          case when a.status <> 'Transferring' then
            (select s.name from recruiting_targets t join schools s on s.id = t.school_id where t.athlete_id = a.id and t.status = 'Committed' order by t.created_at desc limit 1)
          end,
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
