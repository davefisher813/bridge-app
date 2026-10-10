-- 0049: a photo for a person in an org (Dave, 2026-10-10: the board and
-- the headshots go in the app, as Admins whose access he controls).
--
-- One photo per membership, not per account: the Admin of THIS org sets
-- it, so it never reaches into another org the same person belongs to
-- (the same reason a name change is guarded in renameMemberForm).
--
-- The bytes live in a private bucket. One policy: an Admin of an org may
-- add a file under that org's folder, <org>/<user>/<n>.jpg. Nobody signed
-- in may read, replace or delete one. The server checks an added file
-- before a row points at it, removes one it refuses or replaces, and
-- serves photos through /org/<slug>/members/<user>/photo after checking
-- the viewer belongs to the same org. Additive: one nullable column, one
-- bucket, one insert policy.

alter table org_members add column photo_path text;

comment on column org_members.photo_path is
  'The person''s photo in this org: a path in the member-photos bucket, <org>/<user>/<n>.jpg. Set and cleared by an Admin through the app. Display only.';

alter table org_members
  add constraint org_members_photo_path_shape
  check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]+\.jpg$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy member_photos_admin_insert on storage.objects
  for insert
  with check (
    bucket_id = 'member-photos'
    and (storage.foldername(name))[1] in (select org_id::text from private._staff_org_ids() as org_id(org_id))
    and array_length(storage.foldername(name), 1) = 2
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]+\.jpg$'
  );
