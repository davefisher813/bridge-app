-- _member_org_ids() and _staff_org_ids() live in `public`, which is the
-- schema PostgREST exposes. That makes both of them callable over HTTP as
-- /rest/v1/rpc/_member_org_ids by anon and by any signed-in user. Found by
-- Supabase's own security advisor the first time these migrations were
-- applied to a real project, 2026-09-19, which is the sort of thing a
-- local Postgres can never tell you: there is no PostgREST in front of it.
--
-- What the exposure is actually worth is small. Both functions read
-- auth.uid() and return only the caller's own org ids, so anon gets an
-- empty set and a member learns the ids of orgs they already belong to.
-- It is still an internal helper answering HTTP requests, and it is
-- SECURITY DEFINER, which is the combination worth not having.
--
-- Revoking EXECUTE is not the fix. A policy's USING clause is evaluated
-- as the querying role, so a role without EXECUTE cannot be checked
-- against a policy that calls the function: every org-scoped read would
-- fail with a permission error instead of returning no rows. The fix is
-- to put the helpers in a schema PostgREST does not expose, and keep
-- EXECUTE granted there.
--
-- The policies are rewritten programmatically rather than by hand.
-- Eighty-four policies across twenty-odd tables, written by three
-- different migrations in three different shapes (plain org_id, the
-- `org_id is null or` shape on benchmark_sets, the `id in` shape on
-- orgs), is exactly the situation where a hand-written list silently
-- misses one. This reads each policy's real definition out of the
-- catalog, substitutes the schema, and puts it back.

create schema if not exists private;

-- Granted to PUBLIC rather than to anon, authenticated and service_role
-- by name, for two reasons. Those roles are Supabase's and do not exist
-- on the throwaway Postgres the RLS suite runs against, where the role is
-- app_user, and granting to a role that does not exist is a hard error.
-- And a grant to a named role creates a dependency on it, which made
-- scripts/rls_test.sql fail at its own "drop role app_user" line.
--
-- The grant is not optional. A policy's USING clause is evaluated as the
-- querying role, so a role that cannot reach the helper cannot be checked
-- against the policy at all: every org-scoped read would fail with a
-- permission error rather than return no rows. EXECUTE on a function is
-- granted to PUBLIC by default, so schema USAGE is the only grant needed.
--
-- This is not what the advisor was warning about. The finding is that
-- PostgREST publishes everything in an exposed schema as an RPC endpoint;
-- `private` is not exposed, so nothing here is reachable over HTTP no
-- matter who holds EXECUTE.
grant usage on schema private to public;

create or replace function private._member_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() $$;

create or replace function private._staff_org_ids() returns setof uuid
  language sql stable security definer
  set search_path = public
  as $$ select org_id from org_members where user_id = auth.uid() and role in ('owner', 'staff') $$;

-- Stated rather than assumed, and still dependency-free.
grant execute on function private._member_org_ids() to public;
grant execute on function private._staff_org_ids() to public;

do $$
declare
  p record;
  new_qual text;
  new_check text;
  cmd text;
  role_list text;
  rewritten integer := 0;
begin
  -- Read from pg_policy directly rather than the pg_policies view. The
  -- view has columns named `roles` and `cmd`, which collide with plpgsql
  -- local variables of the same name and fail with "column reference is
  -- ambiguous" at runtime rather than at parse time.
  for p in
    select pol.polname as policyname,
           c.relname as tablename,
           n.nspname as schemaname,
           pol.polpermissive as permissive,
           pol.polroles as polroles,
           pol.polcmd as polcmd,
           pg_get_expr(pol.polqual, pol.polrelid) as qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as withcheck
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') like '%org_ids()%'
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') like '%org_ids()%')
  loop
    -- The catalog prints the calls unqualified, because public is on the
    -- search path. Both spellings are replaced so this is safe to run
    -- twice.
    new_qual := replace(replace(coalesce(p.qual, ''),
      'public._member_org_ids()', '_member_org_ids()'),
      'public._staff_org_ids()', '_staff_org_ids()');
    new_qual := replace(replace(new_qual,
      '_member_org_ids()', 'private._member_org_ids()'),
      '_staff_org_ids()', 'private._staff_org_ids()');

    new_check := replace(replace(coalesce(p.withcheck, ''),
      'public._member_org_ids()', '_member_org_ids()'),
      'public._staff_org_ids()', '_staff_org_ids()');
    new_check := replace(replace(new_check,
      '_member_org_ids()', 'private._member_org_ids()'),
      '_staff_org_ids()', 'private._staff_org_ids()');

    -- polroles is an oid array, and oid 0 is PUBLIC, which has no row in
    -- pg_roles. Every policy these migrations write is unqualified and so
    -- lands on PUBLIC; the lookup is here so a later policy scoped to a
    -- named role survives this rewrite too.
    select coalesce(string_agg(
             case when oid_entry = 0 then 'public' else quote_ident(rolname) end, ', '), 'public')
      into role_list
      from unnest(p.polroles) as oid_entry
      left join pg_roles on pg_roles.oid = oid_entry;

    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);

    cmd := format('create policy %I on %I.%I as %s for %s to %s',
      p.policyname, p.schemaname, p.tablename,
      case when p.permissive then 'permissive' else 'restrictive' end,
      case p.polcmd when '*' then 'all' when 'r' then 'select'
                    when 'a' then 'insert' when 'w' then 'update'
                    else 'delete' end,
      role_list);

    if new_qual <> '' then
      cmd := cmd || format(' using (%s)', new_qual);
    end if;
    if new_check <> '' then
      cmd := cmd || format(' with check (%s)', new_check);
    end if;

    execute cmd;
    rewritten := rewritten + 1;
  end loop;

  -- A rewrite count of zero would mean the catalog query matched nothing
  -- and every policy was left pointing at the public helpers, with the
  -- migration reporting success. That is the failure this guard exists
  -- to make loud.
  if rewritten < 40 then
    raise exception 'expected to rewrite at least 40 policies, rewrote %', rewritten;
  end if;
  raise notice 'rewrote % policies onto private helpers', rewritten;
end $$;

drop function if exists public._member_org_ids();
drop function if exists public._staff_org_ids();
