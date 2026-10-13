-- 0070: one master account per org, and recommendation letters kept from
-- Athlete logins (Dave, 2026-10-13).
--
-- 1. orgs.master_user_id: the one Admin who decides who has access
--    (invite, role, remove, resend). Null means nobody is set and any
--    Admin manages access, as before. The app holds the rule on every
--    access action; the database holds the two things the app must never
--    get wrong: the master is always an Admin of that org, and the master
--    cannot be demoted or removed while they hold it. Production values
--    are set separately, never here.
-- 2. activity action 'master_transferred'.
-- 3. family_documents no longer returns a recommendation letter: a
--    letter written about the athlete is for the org, not the family.

-- ── 1. The master account ──────────────────────────────────────────
alter table orgs add column if not exists master_user_id uuid references users(id) on delete set null;

create index if not exists orgs_master_user_id_idx on orgs (master_user_id);

comment on column orgs.master_user_id is
  'The Admin who alone changes who has access (0070). Null: any Admin does.';

create or replace function private.orgs_master_is_admin() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
begin
  if new.master_user_id is not null and (tg_op = 'INSERT' or new.master_user_id is distinct from old.master_user_id) then
    if not exists (
      select 1 from public.org_members m
      where m.org_id = new.id and m.user_id = new.master_user_id and m.role in ('owner', 'staff')
    ) then
      raise exception 'orgs: the master account must be an Admin of this organization'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists orgs_master_is_admin on orgs;
create trigger orgs_master_is_admin
  before insert or update of master_user_id on orgs
  for each row execute function private.orgs_master_is_admin();

create or replace function private.org_members_master_stays() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
begin
  if exists (select 1 from public.orgs o where o.id = old.org_id and o.master_user_id = old.user_id) then
    if tg_op = 'DELETE' or new.role not in ('owner', 'staff') or new.user_id <> old.user_id or new.org_id <> old.org_id then
      raise exception 'the master account cannot be demoted or removed; transfer it first'
        using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists org_members_master_stays on org_members;
create trigger org_members_master_stays
  before update or delete on org_members
  for each row execute function private.org_members_master_stays();

revoke all on function private.orgs_master_is_admin() from public, anon, authenticated;
revoke all on function private.org_members_master_stays() from public, anon, authenticated;

-- ── 2. On the record ─────────────────────────────────────────────────
alter type activity_action add value if not exists 'master_transferred';

-- ── 3. No recommendation letter for an Athlete login ─────────────────
-- The body of 0063's definition, less recommendations.
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
      and coalesce(d.category::text, d.requested_category::text, '') <> 'recommendation'
    order by d.created_at desc
  $$;

revoke all on function public.family_documents(uuid, uuid) from public, anon;
grant execute on function public.family_documents(uuid, uuid) to authenticated;
