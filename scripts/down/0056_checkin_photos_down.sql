-- Undo 0056. The bucket row stays if it holds files (storage refuses to
-- drop a bucket with objects), so only the policy and the column go.
drop policy if exists checkin_photos_admin_insert on storage.objects;
alter table athlete_checkins drop constraint if exists athlete_checkins_photo_path_shape;
alter table athlete_checkins drop column if exists photo_path;
delete from storage.buckets where id = 'checkin-photos' and not exists (select 1 from storage.objects where bucket_id = 'checkin-photos');
