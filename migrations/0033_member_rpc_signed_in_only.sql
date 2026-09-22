-- The three member summary functions are for signed-in people only.
--
-- Migration 0031 granted them `to public` because the local test
-- harness has no `authenticated` role to grant to, and PostgREST
-- exposes anything in the public schema, so `anon` could call
-- /rest/v1/rpc/member_program without signing in. Nothing leaked: each
-- one checks membership through auth.uid(), which is null for anon, so
-- the answer was always empty. But an unauthenticated caller should not
-- reach the function at all, and Supabase's own linter says so.
--
-- The private helpers keep their public grant: the private schema is
-- not in the exposed API, and the row level security policies call them
-- as the querying user.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
end $$;

-- Two revokes, not one. `from public` drops the grant 0031 wrote; `from
-- anon` drops the one Supabase's default privileges write for every new
-- function in this schema, which is what actually left the RPC open.
revoke execute on function public.member_program(uuid) from public, anon;
revoke execute on function public.member_program_schools(uuid, uuid) from public, anon;
revoke execute on function public.member_giving(uuid) from public, anon;

grant execute on function public.member_program(uuid) to authenticated;
grant execute on function public.member_program_schools(uuid, uuid) to authenticated;
grant execute on function public.member_giving(uuid) to authenticated;
