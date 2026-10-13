-- Undo 0067. The two activity actions stay: Postgres cannot drop an enum
-- value, and an unused one is harmless. Who holds each area, and who
-- approved each document, go with the table and the columns.
drop trigger if exists documents_ready_by_approver on documents;
drop function if exists private.documents_ready_by_approver();
drop function if exists private.doc_approval_area(text);
drop index if exists documents_approved_by_idx;
alter table documents drop column if exists approved_at;
alter table documents drop column if exists approved_by;
drop table if exists doc_approvers;
drop function if exists private.doc_approver_is_admin();
