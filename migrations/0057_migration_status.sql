-- 0057: the database says which migrations it has (live check of the
-- audit fixes, 2026-10-10: there was no way to see from the app whether
-- a backend fix was applied).
--
-- Organization Settings compares this list with the repo's own ledger
-- (migrations/APPLIED.md, mirrored in src/lib/ops/appliedLedger.ts). It
-- returns versions and names only, nothing from any org, and only to a
-- signed-in Admin of some org; anyone else gets no rows. It reads
-- Supabase's own history table, which a plain database (the local RLS
-- suite) does not have, so it answers empty there instead of failing.

create or replace function public.applied_migrations()
returns table (version text, name text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from private._staff_org_ids()) then
    return;
  end if;
  if to_regclass('supabase_migrations.schema_migrations') is null then
    return;
  end if;
  return query execute 'select version::text, name::text from supabase_migrations.schema_migrations order by version';
end $$;

revoke all on function public.applied_migrations() from public, anon;
grant execute on function public.applied_migrations() to authenticated;
