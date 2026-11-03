-- Proofs for 0078 (plan-stage draft). Synthetic accounts and files only:
-- roles and "Athlete A / Athlete B", no real names. Everything runs in one
-- transaction that is rolled back, so nothing persists.
--
-- To run: migration 0078 must be in force in the same transaction. For a
-- dry run on a database that does not have it, paste the migration between
-- the BEGIN below and the "-- fixtures" line, and keep the ROLLBACK.
--
-- Each case prints expected, actual and PASS or FAIL. A FAIL is a finding,
-- not a script error. Cases:
--   01-08  Athlete A's file, by role (reader copy)
--   09     family_documents, family_send_document
--   10     view-as never grants file access (10, 10b), master keeps its own
--          reach while viewing as someone (15)
--   11     an unentitled Admin lists documents: locked stubs only
--   12     family_document_twin with a known hash
--   13     a file with no document row: master only (13, 17)
--   14     an original (original_paths only) file
--   16     claiming someone else's object with a document row
--   17     the mid-upload sequence, step by step
--   P1a-e  staff moving Needs Review to Ready (Doc AI Piece 1)
begin;

create temp table results (seq serial, n text, who text, expected text, actual text);
create function pg_temp.t(n text, who text, expected text, uid text, kind text, arg text) returns void language plpgsql as $$
declare r text; q text; cnt bigint;
begin
  q := case kind
    when 'read' then format('select case when exists(select 1 from storage.objects where bucket_id=''documents'' and name=%L) then ''READ'' else ''DENIED'' end', arg)
    when 'list' then format('select case when exists(select 1 from public.documents where id=%L) then ''LISTED'' else ''HIDDEN'' end', arg)
    else arg end;
  perform set_config('request.jwt.claims', case when uid is null then '' else json_build_object('sub', uid, 'role', 'authenticated')::text end, true);
  if uid is null then execute 'set local role anon'; else execute 'set local role authenticated'; end if;
  begin
    if kind = 'dml' then
      execute q;
      get diagnostics cnt = row_count;
      r := cnt::text;
    else
      execute q into r;
    end if;
  exception when others then r := 'ERROR ' || sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  insert into pg_temp.results (n, who, expected, actual) values (n, who, expected, r);
end $$;

-- fixtures (all inserted before any role is assumed)
insert into auth.users (id, email) values
 ('a0000000-0000-0000-0000-000000000001','synth-athlete-a@example.test'),
 ('a0000000-0000-0000-0000-000000000002','synth-athlete-b@example.test'),
 ('a0000000-0000-0000-0000-000000000003','synth-advisor-a@example.test'),
 ('a0000000-0000-0000-0000-000000000004','synth-admin-2@example.test'),
 ('a0000000-0000-0000-0000-000000000005','synth-staff@example.test'),
 ('a0000000-0000-0000-0000-000000000006','synth-viewer@example.test'),
 ('a0000000-0000-0000-0000-000000000007','synth-family-x@example.test'),
 ('a0000000-0000-0000-0000-000000000008','synth-outsider@example.test'),
 ('a0000000-0000-0000-0000-000000000009','synth-advisor-b@example.test');
insert into public.org_members (user_id, org_id, role) values
 ('a0000000-0000-0000-0000-000000000001','25eb1763-fe05-450f-ad41-cbf79215c316','family'),
 ('a0000000-0000-0000-0000-000000000002','25eb1763-fe05-450f-ad41-cbf79215c316','family'),
 ('a0000000-0000-0000-0000-000000000003','25eb1763-fe05-450f-ad41-cbf79215c316','owner'),
 ('a0000000-0000-0000-0000-000000000004','25eb1763-fe05-450f-ad41-cbf79215c316','owner'),
 ('a0000000-0000-0000-0000-000000000005','25eb1763-fe05-450f-ad41-cbf79215c316','staff'),
 ('a0000000-0000-0000-0000-000000000006','25eb1763-fe05-450f-ad41-cbf79215c316','member'),
 ('a0000000-0000-0000-0000-000000000007','25eb1763-fe05-450f-ad41-cbf79215c316','family'),
 ('a0000000-0000-0000-0000-000000000009','25eb1763-fe05-450f-ad41-cbf79215c316','owner');
insert into public.athletes (id, org_id, name, sport, advisor_id) values
 ('b0000000-0000-0000-0000-00000000000a','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH Athlete A','baseball','a0000000-0000-0000-0000-000000000003'),
 ('b0000000-0000-0000-0000-00000000000b','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH Athlete B','baseball','a0000000-0000-0000-0000-000000000009');
insert into public.athlete_guardians (org_id, athlete_id, user_id) values
 ('25eb1763-fe05-450f-ad41-cbf79215c316','b0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001'),
 ('25eb1763-fe05-450f-ad41-cbf79215c316','b0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000002');
-- objects: owner Dave unless noted; oO is an orphan uploaded by the unentitled Admin
insert into storage.objects (bucket_id, name, owner) values
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf','67a129b2-c846-4de4-ab11-3cdfc5265b84'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf','67a129b2-c846-4de4-ab11-3cdfc5265b84'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a2/a.pdf','67a129b2-c846-4de4-ab11-3cdfc5265b84'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a3/a.pdf','67a129b2-c846-4de4-ab11-3cdfc5265b84'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a4/a.pdf','67a129b2-c846-4de4-ab11-3cdfc5265b84'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_t/a.pdf','67a129b2-c846-4de4-ab11-3cdfc5265b84'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_u/a.pdf','a0000000-0000-0000-0000-000000000004'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf','a0000000-0000-0000-0000-000000000004'),
 ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_m/a.pdf','67a129b2-c846-4de4-ab11-3cdfc5265b84');
insert into public.documents (id, org_id, file_name, file_size, media_type, source_role, athlete_id, linked_athlete_id, storage_paths, original_paths, content_hash, lifecycle, requested_category) values
 ('c0000000-0000-0000-0000-00000000000a','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-a.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf'],'synthhash0078','needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a2','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-a2.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a2/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a2/a.pdf'],null,'needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a3','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-a3.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a3/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a3/a.pdf'],null,'needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a4','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-a4.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a4/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a4/a.pdf'],null,'needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a5','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-transcript.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_t/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_t/a.pdf'],null,'needs_review','transcript'),
 ('c0000000-0000-0000-0000-0000000000a6','25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-unlinked.pdf',1,'application/pdf','admin',null,null,array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_u/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_u/a.pdf'],null,'needs_review',null);
-- Athlete A's advisor approves transcripts (area academic) for P1e
insert into public.doc_approvers (org_id, area, user_id) values ('25eb1763-fe05-450f-ad41-cbf79215c316','academic','a0000000-0000-0000-0000-000000000003');

-- 01-08: Athlete A's reader file
select pg_temp.t('01 read A', 'Athlete A (guardian of A)', 'READ',   'a0000000-0000-0000-0000-000000000001', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('02 read A', 'Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('03 read A', 'Advisor assigned to A', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('04 read A', 'Advisor of B (not A)', 'DENIED', 'a0000000-0000-0000-0000-000000000009', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('04 read A', 'Admin not assigned to A', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('05 read A', 'Master account', 'READ', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('06 read A', 'Viewer', 'DENIED', 'a0000000-0000-0000-0000-000000000006', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('06 read A', 'Leftover staff role', 'DENIED', 'a0000000-0000-0000-0000-000000000005', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('06 read A', 'Family role, not guardian of A', 'DENIED', 'a0000000-0000-0000-0000-000000000007', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('07 read A', 'Signed out (anon)', 'DENIED', null, 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('08 read A', 'Signed-in outsider with the path', 'DENIED', 'a0000000-0000-0000-0000-000000000008', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');

-- 14: the original file (listed only in original_paths)
select pg_temp.t('14 original', 'Admin not assigned to A', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Advisor assigned to A', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Athlete A', 'READ', 'a0000000-0000-0000-0000-000000000001', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Master account', 'READ', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf');

-- 13: a file with no document row is the master's alone
select pg_temp.t('13 no row', 'Uploader (unentitled Admin) reads own orphan', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf');
select pg_temp.t('13 no row', 'Advisor of A', 'DENIED', 'a0000000-0000-0000-0000-000000000003', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf');
select pg_temp.t('13 no row', 'Athlete A', 'DENIED', 'a0000000-0000-0000-0000-000000000001', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf');
select pg_temp.t('13 no row', 'Unentitled Admin reads the master''s orphan', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_m/a.pdf');
select pg_temp.t('13 no row', 'Master account', 'READ', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf');

-- an unlinked upload (a document, no athlete yet) stays open to the org's Admins
select pg_temp.t('18 unlinked doc', 'Unentitled Admin', 'READ', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_u/a.pdf');
select pg_temp.t('18 unlinked doc', 'Viewer', 'DENIED', 'a0000000-0000-0000-0000-000000000006', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_u/a.pdf');
select pg_temp.t('18 unlinked doc', 'Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_u/a.pdf');

-- 11: the Documents list, by role
select pg_temp.t('11 list', 'Admin not assigned to A: the table row', 'HIDDEN', 'a0000000-0000-0000-0000-000000000004', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 list', 'Advisor assigned to A: the table row', 'LISTED', 'a0000000-0000-0000-0000-000000000003', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 list', 'Master: the table row', 'LISTED', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 list', 'Viewer: the table row', 'HIDDEN', 'a0000000-0000-0000-0000-000000000006', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 locked', 'Admin not assigned to A: locked stubs for the 5 synthetic A documents', '5', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.documents_locked('25eb1763-fe05-450f-ad41-cbf79215c316') where id::text like 'c0000000-0000-0000-0000-0000000000a%' or id = 'c0000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.t('11 locked', 'Advisor assigned to A: locked stubs among the synthetic documents', '0', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select count(*)::text from public.documents_locked('25eb1763-fe05-450f-ad41-cbf79215c316') where id::text like 'c0000000-0000-0000-0000-0000000000a%' or id = 'c0000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.t('11 locked', 'Viewer: locked stubs', '0', 'a0000000-0000-0000-0000-000000000006', 'q', $q$select count(*)::text from public.documents_locked('25eb1763-fe05-450f-ad41-cbf79215c316')$q$);
select pg_temp.t('11 locked', 'Stub columns are exactly these', 'TABLE(id uuid, org_id uuid, status text, lifecycle text, created_at timestamp with time zone)', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select pg_get_function_result('public.documents_locked(uuid)'::regprocedure)$q$);

-- 09 and 12: the three family functions
select pg_temp.t('09 family_documents', 'Admin not assigned to A', '0', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.family_documents('25eb1763-fe05-450f-ad41-cbf79215c316','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('09 family_documents', 'Athlete B', '0', 'a0000000-0000-0000-0000-000000000002', 'q', $q$select count(*)::text from public.family_documents('25eb1763-fe05-450f-ad41-cbf79215c316','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('09 family_documents', 'Advisor assigned to A', '5', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select count(*)::text from public.family_documents('25eb1763-fe05-450f-ad41-cbf79215c316','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('09 family_documents', 'Athlete A', '5', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select count(*)::text from public.family_documents('25eb1763-fe05-450f-ad41-cbf79215c316','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('12 family_document_twin', 'Admin not assigned to A (known hash)', '0', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.family_document_twin('25eb1763-fe05-450f-ad41-cbf79215c316','synthhash0078')$q$);
select pg_temp.t('12 family_document_twin', 'Athlete B (known hash)', '0', 'a0000000-0000-0000-0000-000000000002', 'q', $q$select count(*)::text from public.family_document_twin('25eb1763-fe05-450f-ad41-cbf79215c316','synthhash0078')$q$);
select pg_temp.t('12 family_document_twin', 'Advisor assigned to A (known hash)', '1', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select count(*)::text from public.family_document_twin('25eb1763-fe05-450f-ad41-cbf79215c316','synthhash0078')$q$);
select pg_temp.t('09 family_send_document', 'Athlete B sending into A', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000002', 'q', $q$select public.family_send_document('b0000000-0000-0000-0000-00000000000a','x.pdf',1,'application/pdf','25eb1763-fe05-450f-ad41-cbf79215c316/family/b0000000-0000-0000-0000-00000000000a/x.pdf')::text$q$);

-- 10, 10b, 15: view-as is allowed, and never grants file access
select pg_temp.t('10 view-as', 'Admin not assigned to A starts view-as Athlete A', 'started', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select case when public.start_view_as('25eb1763-fe05-450f-ad41-cbf79215c316','a0000000-0000-0000-0000-000000000001') is not null then 'started' end$q$);
select pg_temp.t('10 view-as', '... then reads Athlete A''s file', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('10 view-as', '... then reads A''s original', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf');
update public.view_as_sessions set ended_at = now(), end_reason = 'returned' where viewer_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null;
select pg_temp.t('10b view-as master', 'Admin not assigned to A starts view-as the master', 'started', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select case when public.start_view_as('25eb1763-fe05-450f-ad41-cbf79215c316','67a129b2-c846-4de4-ab11-3cdfc5265b84') is not null then 'started' end$q$);
select pg_temp.t('10b view-as master', '... then reads A''s reader file', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('10b view-as master', '... then reads A''s original', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/orig.pdf');
select pg_temp.t('10b view-as master', '... then reads the master''s orphan', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_m/a.pdf');
select pg_temp.t('10b view-as master', '... A''s table row', 'HIDDEN', 'a0000000-0000-0000-0000-000000000004', 'list', 'c0000000-0000-0000-0000-00000000000a');
update public.view_as_sessions set ended_at = now(), end_reason = 'returned' where viewer_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null;
select pg_temp.t('15 master views as', 'Master starts view-as Athlete B', 'started', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'q', $q$select case when public.start_view_as('25eb1763-fe05-450f-ad41-cbf79215c316','a0000000-0000-0000-0000-000000000002') is not null then 'started' end$q$);
select pg_temp.t('15 master views as', '... still opens A''s file on his own right', 'READ', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf');
select pg_temp.t('15 master views as', '... the screen is Athlete B''s: A''s table row hidden', 'HIDDEN', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'list', 'c0000000-0000-0000-0000-00000000000a');
update public.view_as_sessions set ended_at = now(), end_reason = 'returned' where viewer_id = '67a129b2-c846-4de4-ab11-3cdfc5265b84' and ended_at is null;

-- P1a-e: staff moving Needs Review to Ready (Doc AI Piece 1)
select pg_temp.t('P1a ready', 'Advisor assigned to A readies A''s document', '1:ready:true', 'a0000000-0000-0000-0000-000000000003', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a2' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'a0000000-0000-0000-0000-000000000003')::text, '-') from x$q$);
select pg_temp.t('P1b ready', 'Master readies A''s document', '1:ready:true', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a4' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = '67a129b2-c846-4de4-ab11-3cdfc5265b84')::text, '-') from x$q$);
select pg_temp.t('P1c ready', 'Unentitled Admin readies an unlinked upload', '1:ready:true', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a6' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'a0000000-0000-0000-0000-000000000004')::text, '-') from x$q$);
select pg_temp.t('P1d ready', 'Unentitled Admin readies A''s document', '0:-:-', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a3' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'x')::text, '-') from x$q$);
select pg_temp.t('P1e ready', 'Master tries a transcript; the academic approver is the advisor', 'ERROR 42501', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a5' returning 1) select count(*)::text from x$q$);
select pg_temp.t('P1e ready', 'The academic approver readies the same transcript', '1:ready:true', 'a0000000-0000-0000-0000-000000000003', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a5' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'a0000000-0000-0000-0000-000000000003')::text, '-') from x$q$);

-- 16: claiming an object with a document row
select pg_temp.t('16 claim', 'Unentitled Admin lists the master''s orphan', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-claim.pdf',1,'application/pdf','admin',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_m/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_m/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'Unentitled Admin lists Athlete A''s file', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-claim.pdf',1,'application/pdf','admin',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_a/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'Uploader lists own object (the normal upload)', '1', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-own.pdf',1,'application/pdf','admin',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'A second row cannot list the same object', 'ERROR 23505', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-own2.pdf',1,'application/pdf','admin',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_o/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'Master lists the master''s orphan (clean-up path)', '1', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-master-claim.pdf',1,'application/pdf','admin',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_m/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_m/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);

-- 17: the mid-upload sequence, step by step
select pg_temp.t('17 upload', 'Step 1: unentitled Admin uploads an object', '1', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into storage.objects (bucket_id, name, owner) values ('documents','25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf','a0000000-0000-0000-0000-000000000004') returning 1) select count(*)::text from x$q$);
select pg_temp.t('17 upload', 'Step 2: the same Admin reads it back before a row exists', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 2: another Admin (advisor of A) cannot read it either', 'DENIED', 'a0000000-0000-0000-0000-000000000003', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 2: the master can', 'READ', '67a129b2-c846-4de4-ab11-3cdfc5265b84', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 3: the row is created (no athlete yet)', '1', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('25eb1763-fe05-450f-ad41-cbf79215c316','SYNTH-new-upload.pdf',1,'application/pdf','admin',array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf'],array['25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('17 upload', 'Step 4: an unlinked upload is open to the org''s Admins', 'READ', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 4: not to a Viewer', 'DENIED', 'a0000000-0000-0000-0000-000000000006', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 4: not to Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
-- Step 5: linking the upload to an athlete the Admin is not entitled to. The update would leave a row the
-- Admin can no longer read, and Postgres refuses it (also for a plain update, with no RETURNING). This is
-- the designed fail-closed behavior of 0078 as drafted; a definer RPC for "link to athlete" is the open
-- decision (D6). The link below is made by the migration owner, standing in for that RPC.
select pg_temp.t('17 upload', 'Step 5: the Admin tries to link it to Athlete A directly (plain update)', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'dml', $q$update public.documents set linked_athlete_id = 'b0000000-0000-0000-0000-00000000000a' where file_name = 'SYNTH-new-upload.pdf'$q$);
update public.documents set linked_athlete_id = 'b0000000-0000-0000-0000-00000000000a' where file_name = 'SYNTH-new-upload.pdf';
select pg_temp.t('17 upload', 'Step 5b: once linked, the uploading Admin no longer opens it', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 5b: Athlete A''s advisor does', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', '25eb1763-fe05-450f-ad41-cbf79215c316/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 5b: the uploading Admin now gets the 5 fixture documents and this one as locked stubs', '6', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.documents_locked('25eb1763-fe05-450f-ad41-cbf79215c316')$q$);

select n, who, expected, actual, case when actual = expected then 'PASS' else 'FAIL' end as result from results order by seq;
rollback;
