-- Scratch databases only. Makes the local auth and storage stubs behave like
-- Supabase for scripts/proof/0078_proofs.sql: auth.uid() reads the JWT claims
-- the way Supabase does, the roles hold the grants Supabase gives them, and
-- storage.objects has owner_id (the column Storage fills in now).
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', ''), '')::uuid
$$;
grant usage on schema auth to anon, authenticated;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
alter table storage.objects add column if not exists owner_id text;
