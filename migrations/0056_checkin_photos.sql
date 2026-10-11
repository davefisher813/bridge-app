-- 0056: a photo on a check-in (live check of the audit fixes, 2026-10-10:
-- a meeting with an athlete had nowhere to keep the picture taken at it).
--
-- One photo per check-in, the 0049 pattern. The phone shrinks it to a
-- JPEG and puts it in a private bucket under <org>/<athlete>/<n>.jpg; the
-- server reads the bytes back and checks them before the row points at
-- them, and serves it through
-- /org/<slug>/roster/<athlete>/checkins/<checkin>/photo to staff only,
-- because check-ins are staff only (0039: these athletes are minors).
--
-- One policy: an Admin of an org may add a file under that org's folder.
-- Nobody signed in may read, replace or delete one; the service role
-- does that on the server after the checks. Additive: one nullable
-- column, one bucket, one insert policy.

alter table athlete_checkins add column photo_path text;

comment on column athlete_checkins.photo_path is
  'A photo from the check-in: a path in the checkin-photos bucket, <org>/<athlete>/<n>.jpg. Staff only, like the notes.';

alter table athlete_checkins
  add constraint athlete_checkins_photo_path_shape
  check (photo_path is null or photo_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]+\.jpg$');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('checkin-photos', 'checkin-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do nothing;

create policy checkin_photos_admin_insert on storage.objects
  for insert
  with check (
    bucket_id = 'checkin-photos'
    and (storage.foldername(name))[1] in (select org_id::text from private._staff_org_ids() as org_id(org_id))
    and array_length(storage.foldername(name), 1) = 2
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9]+\.jpg$'
  );
