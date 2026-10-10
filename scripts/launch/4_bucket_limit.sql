-- Decision 6: the documents bucket's size limit back to 10 MB (10485760
-- bytes), the limit the app enforces and migration 0029 set. Run only on
-- Dave's yes. Files already stored are not affected.
update storage.buckets set file_size_limit = 10485760 where id = 'documents' and file_size_limit = 52428800;
select id, file_size_limit from storage.buckets where id = 'documents';
