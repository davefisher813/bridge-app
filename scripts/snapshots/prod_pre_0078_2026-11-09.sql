-- Production snapshot of what migration 0078 replaces, taken 2026-11-09 from emllcefqxyxyhqolrllo (migration 0077 in force).
-- Restore: run this file, then drop the objects 0078 adds (scripts/down/0078_files_follow_the_real_user_down.sql section for new objects).
-- Each function body below was checked against its production md5 (pg_get_functiondef) before it was saved.

-- private._can_read_document_object md5 2ea6c3f5811960a8e8642f6e966537d8
CREATE OR REPLACE FUNCTION private._can_read_document_object(obj text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

-- private.documents_insert_guard md5 2fe08b3907d8fae9e6e958f335fed57f
CREATE OR REPLACE FUNCTION private.documents_insert_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
end $function$;

-- public.family_document_twin md5 55f8ce854648acafc95f8b005e255d4a
CREATE OR REPLACE FUNCTION public.family_document_twin(p_org uuid, p_hash text)
 RETURNS TABLE(id uuid, file_name text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select d.id, d.file_name, d.created_at
    from documents d
    where d.org_id = p_org
      and d.content_hash = p_hash
      and d.status <> 'discarded'
      and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
    order by d.created_at desc
    limit 1
  $function$;

-- public.family_documents md5 59e78d689a2ed3b6c486a82f5d8514b1
CREATE OR REPLACE FUNCTION public.family_documents(p_org uuid, p_athlete uuid)
 RETURNS TABLE(id uuid, file_name text, category text, status text, media_type text, file_size bigint, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select d.id, d.file_name, d.category::text, d.status::text, d.media_type, d.file_size::bigint, d.created_at
    from documents d
    where d.org_id = p_org
      and d.athlete_id = p_athlete
      and (d.org_id in (select private._member_org_ids()) or d.athlete_id in (select private._family_athlete_ids()))
      and coalesce(d.category::text, d.requested_category::text, '') <> 'recommendation'
    order by d.created_at desc
  $function$;

-- ACLs in production before 0078:
--   private._can_read_document_object(text): {=X/postgres,postgres=X/postgres} (execute to public)
--   public.family_documents(uuid, uuid) and public.family_document_twin(uuid, text): {postgres,authenticated,service_role}
--   private.documents_insert_guard(): default (null acl)

-- Policy documents_read on public.documents, production before 0078 (md5 of qual+cmd+roles 61bb45e4531182d174188644722cee9d):
drop policy if exists documents_read on public.documents;
create policy documents_read on public.documents for select using (org_id in (select private._member_org_ids()));
