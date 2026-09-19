-- Two things the first real sign-in made unavoidable, 2026-09-19.
--
-- 1. public.users was a mirror of auth.users that nothing filled in.
--    The one row in it was typed by hand in SQL. Every account created
--    from now on, by an invitation or by Supabase's dashboard, would
--    have had no profile row, so org_members' foreign key would refuse
--    it and getCurrentUser() would show a blank name. A trigger on
--    auth.users keeps the mirror honest without anyone remembering to.
--
-- 2. Documents went to the server as base64 inside a server action's
--    request body. Next's limit on that body is 1MB and the app's own
--    limit on a document is 4MB, so any real scanned transcript failed
--    on the way in, and the original was thrown away after extraction
--    besides. Files now go to a private Storage bucket from the browser,
--    and the server reads them back from there. The bucket keeps the
--    original, which is what a coordinator will want the day an
--    extraction is questioned.
--
-- Both live in `private` for the same reason the membership helpers do
-- (migration 0015): nothing in an exposed schema, nothing answering HTTP.

-- ── 1. Profile rows follow auth.users ────────────────────────────────

create or replace function private.handle_auth_user_change() returns trigger
  language plpgsql security definer
  set search_path = public
  as $$
begin
  insert into public.users (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        -- A name typed into the app wins over one carried on the invite.
        full_name = case when public.users.full_name = '' then excluded.full_name else public.users.full_name end;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_auth_user_change();

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function private.handle_auth_user_change();

-- Anyone who already exists in auth and not in public gets a row now.
insert into public.users (id, email, full_name)
select id, coalesce(email, ''), coalesce(raw_user_meta_data ->> 'full_name', '')
from auth.users
on conflict (id) do nothing;

-- ── 2. The documents bucket ──────────────────────────────────────────
--
-- Private. An object's path is <org_id>/<document request id>/<file>, so
-- the first folder is the org, and the policies below key off it the
-- same way every table policy keys off org_id: any member of the org
-- may read, only owner and staff may write. The size and type limits
-- match src/lib/docai/limits.ts and acceptance.ts, checked here by
-- Storage before a byte lands rather than only by the app afterwards.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  4194304,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
on conflict (id) do nothing;

drop policy if exists documents_bucket_read on storage.objects;
create policy documents_bucket_read on storage.objects for select
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._member_org_ids() as org_id)
  );

drop policy if exists documents_bucket_insert on storage.objects;
create policy documents_bucket_insert on storage.objects for insert
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._staff_org_ids() as org_id)
  );

drop policy if exists documents_bucket_delete on storage.objects;
create policy documents_bucket_delete on storage.objects for delete
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] in (select org_id::text from private._staff_org_ids() as org_id)
  );

-- No update policy on purpose. An uploaded document is replaced by
-- uploading again, never edited in place.

-- Where each page of a document lives in the bucket, in upload order.
-- An array rather than a child table because the pages are one
-- document and are only ever read together.
alter table documents add column storage_paths text[] not null default '{}';
