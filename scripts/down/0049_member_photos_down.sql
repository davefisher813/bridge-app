-- Reverses 0049. Removes the column; the bucket is left (it may hold
-- photos, and deleting stored files is not something a down script does).
alter table org_members drop constraint if exists org_members_photo_path_shape;
alter table org_members drop column if exists photo_path;
drop policy if exists member_photos_admin_insert on storage.objects;
