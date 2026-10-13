-- Undo 0070. The activity action stays: Postgres cannot drop an enum
-- value, and an unused one is harmless. family_documents goes back to
-- 0063's body, recommendations included.
drop trigger if exists org_members_master_stays on org_members;
drop function if exists private.org_members_master_stays();
drop trigger if exists orgs_master_is_admin on orgs;
drop function if exists private.orgs_master_is_admin();
drop index if exists orgs_master_user_id_idx;
alter table orgs drop column if exists master_user_id;

create or replace function public.family_documents(p_org uuid, p_athlete uuid)
  returns table (
    id uuid,
    file_name text,
    category text,
    status text,
    media_type text,
    file_size bigint,
    created_at timestamptz
  )
  language sql stable security definer
  set search_path = public
  as $$
    select d.id, d.file_name, d.category::text, d.status::text, d.media_type, d.file_size::bigint, d.created_at
    from documents d
    where d.org_id = p_org
      and d.athlete_id = p_athlete
      and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
    order by d.created_at desc
  $$;

revoke all on function public.family_documents(uuid, uuid) from public, anon;
grant execute on function public.family_documents(uuid, uuid) to authenticated;
