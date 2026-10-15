-- Down for 0074 (View As). Puts every policy, helper and function back to
-- what it was before the migration, then drops the session table and the
-- functions the migration added. Written to run in one transaction.
-- Nothing here names a person or an org; the gate and the guards are found
-- from the catalog the way the migration found the policies.
begin;

-- 1. The gate comes off every write policy that carries it.
do $$
declare
  p record;
  q text;
  c text;
  cmd text;
begin
  for p in
    select pol.polname as policyname,
           cl.relname as tablename,
           n.nspname as schemaname,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as withcheck
    from pg_policy pol
    join pg_class cl on cl.oid = pol.polrelid
    join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname in ('public', 'storage')
      and pol.polcmd in ('a', 'w', 'd', '*')
      and coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%_viewing()%'
    order by n.nspname, cl.relname, pol.polname
  loop
    q := regexp_replace(p.qual, '\s+AND\s+\(NOT\s+\(\s*SELECT\s+private\._viewing\(\)\s+AS\s+_viewing\)\)', '', 'g');
    c := regexp_replace(p.withcheck, '\s+AND\s+\(NOT\s+\(\s*SELECT\s+private\._viewing\(\)\s+AS\s+_viewing\)\)', '', 'g');
    if q like '(NOT ( SELECT private._viewing()%' then q := 'true'; end if;
    if c like '(NOT ( SELECT private._viewing()%' then c := 'true'; end if;
    cmd := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if q is not null then cmd := cmd || format(' using (%s)', q); end if;
    if c is not null then cmd := cmd || format(' with check (%s)', c); end if;
    execute cmd;
  end loop;
end $$;

-- 2. The five read policies back on the real caller.
alter policy org_members_self on org_members
  using (
    (user_id = (select auth.uid()))
    or org_id in (select private._member_org_ids())
    or (org_id, user_id) in (select r.org_id, r.user_id from private._family_staff_rows() r)
    or (org_id, user_id) in (select r.org_id, r.user_id from private._observer_staff_rows() r)
  );
alter policy users_self on users
  using (id = (select auth.uid()));
alter policy athlete_guardians_read on athlete_guardians
  using (
    org_id in (select private._member_org_ids())
    or user_id = (select auth.uid())
  );
alter policy athlete_message_reads_read on athlete_message_reads
  using (
    user_id = (select auth.uid())
    or org_id in (select private._member_org_ids())
  );
alter policy grading_scales_readable on high_school_grading_scales
  using ((select auth.uid()) is not null);

-- 3. The nine access helpers back on auth.uid().
create or replace function private._any_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() $$;

create or replace function private._family_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role = 'family' $$;

create or replace function private._member_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'staff') $$;

create or replace function private._staff_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'staff') $$;

create or replace function private._observer_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role = 'member' $$;

create or replace function private._family_athlete_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select g.athlete_id
    from athlete_guardians g
    join org_members m on m.user_id = g.user_id and m.org_id = g.org_id and m.role = 'family'
    where g.user_id = auth.uid()
  $$;

create or replace function private._family_staff_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$
    select m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (select org_id from org_members where user_id = auth.uid() and role = 'family')
  $$;

create or replace function private._family_staff_rows() returns table (org_id uuid, user_id uuid)
  language sql stable security definer
  set search_path = public
  as $$
    select m.org_id, m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (select org_id from org_members where user_id = auth.uid() and role = 'family')
  $$;

create or replace function private._observer_staff_rows() returns table (org_id uuid, user_id uuid)
  language sql stable security definer
  set search_path = public
  as $$
    select m.org_id, m.user_id from org_members m
    where m.role in ('owner', 'staff')
      and m.org_id in (select org_id from org_members where user_id = auth.uid() and role = 'member')
  $$;

-- 4. The refusal comes out of the definer writers, and member_giving reads
-- the real caller again. Each is rewritten from its own current text.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('create_org', 'log_family_message', 'submit_assignment', 'family_send_document')
  loop
    def := pg_get_functiondef(f.oid);
    def := regexp_replace(def, E'\n  if private\\._viewing\\(\\) then\n    raise exception ''[^'']*'' using errcode = ''insufficient_privilege'';\n  end if;', '');
    execute def;
  end loop;
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'member_giving'
  loop
    def := replace(pg_get_functiondef(f.oid), 'private._effective_uid()', 'auth.uid()');
    execute def;
  end loop;
end $$;

-- 5. The table, its functions and its identity.
drop table if exists view_as_sessions;
drop function if exists public.start_view_as(uuid, uuid);
drop function if exists public.start_view_as(uuid);
drop function if exists public.end_view_as();
drop function if exists private._close_view_as(uuid, boolean);
drop function if exists private.view_as_is_coherent();
drop function if exists private._viewing();
drop function if exists private._effective_uid();
drop function if exists private._view_org();
drop function if exists private._view_target();
drop function if exists private._owner_org_ids();

commit;
