-- 0061: a deleted document is logged (Dave, Oct 11: documents get a
-- real Delete). One activity action. Deleting itself needs no schema
-- change: the app deletes on the server through the service role after
-- an Admin check, and the table and bucket still carry no delete policy
-- for anyone signed in (migration 0048).

alter type activity_action add value if not exists 'document_deleted';
