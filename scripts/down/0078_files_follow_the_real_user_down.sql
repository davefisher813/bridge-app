-- Down for 0078. Restores the 0077 file read, the org-wide table read,
-- the old family_documents and family_document_twin bodies, and the old
-- insert guard exactly as they were in production before 0078.

create or replace function private._can_read_document_object(obj text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  with me as (select private._effective_uid() as uid, private._view_org() as vorg),
  docs as (
    select coalesce(d.athlete_id, d.linked_athlete_id, d.subject_athlete_id) as aid
    from public.documents d
    where obj = any (d.storage_paths)
      and d.org_id::text = (storage.foldername(obj))[1]
  )
  select
    exists (
      select 1 from public.orgs o, me
      where o.id::text = (storage.foldername(obj))[1]
        and o.master_user_id = me.uid
        and coalesce(me.vorg, o.id) = o.id
    )
    or exists (
      select 1 from docs, me
      where docs.aid is not null
        and (
          docs.aid in (select private._family_athlete_ids())
          or exists (
            select 1 from public.athletes a
            where a.id = docs.aid
              and a.org_id::text = (storage.foldername(obj))[1]
              and a.advisor_id = me.uid
          )
        )
    )
    or (
      (storage.foldername(obj))[1] in (select o.org_id::text from private._member_org_ids() as o(org_id))
      and not exists (select 1 from docs where docs.aid is not null)
    )
$$;

drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select
  using (org_id in (select private._member_org_ids()));

create or replace function public.family_documents(p_org uuid, p_athlete uuid)
returns table (id uuid, file_name text, category text, status text, media_type text, file_size bigint, created_at timestamptz)
language sql stable security definer
set search_path to 'public'
as $$
  select d.id, d.file_name, d.category::text, d.status::text, d.media_type, d.file_size::bigint, d.created_at
  from documents d
  where d.org_id = p_org
    and d.athlete_id = p_athlete
    and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
    and coalesce(d.category::text, d.requested_category::text, '') <> 'recommendation'
  order by d.created_at desc
$$;

create or replace function public.family_document_twin(p_org uuid, p_hash text)
returns table (id uuid, file_name text, created_at timestamptz)
language sql stable security definer
set search_path to 'public'
as $$
  select d.id, d.file_name, d.created_at
  from documents d
  where d.org_id = p_org
    and d.content_hash = p_hash
    and d.status <> 'discarded'
    and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
  order by d.created_at desc
  limit 1
$$;

create or replace function private.documents_insert_guard() returns trigger
  language plpgsql security definer
  set search_path = ''
  as $$
declare
  p text;
begin
  if new.lifecycle not in ('uploaded', 'needs_review') then
    raise exception 'documents: a new document starts as Uploaded, not %', new.lifecycle
      using errcode = 'check_violation';
  end if;
  foreach p in array (coalesce(new.storage_paths, '{}') || coalesce(new.original_paths, '{}')) loop
    if not exists (select 1 from storage.objects o where o.bucket_id = 'documents' and o.name = p) then
      raise exception 'documents: % is not in storage', p using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end $$;

drop function if exists public.document_link_athlete(uuid, uuid);
drop function if exists public.documents_locked(uuid);
drop function if exists private._real_can_read_doc(uuid, uuid, uuid, uuid);
drop function if exists private._real_entitled_to_athlete(uuid, uuid);
drop function if exists private._real_staff_org_ids();
