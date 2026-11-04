-- Proofs for 0078 (plan-stage draft). Synthetic organization, master,
-- accounts and files only: roles and "Athlete A / Athlete B", no real names
-- and no production ids. Refuses to run unless the database is a scratch
-- one (name starts with "scratch", holding almost no users) or the RLS
-- runner's throwaway database. Everything runs in one
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
--   17     the mid-upload sequence, step by step, ending in link-to-athlete (D6)
--   L1-L10 document_link_athlete and locked rows being view-only
--   S1-S7  an Athlete's guardian answers an assignment with a file (submit_assignment)
--   P1a-e  staff moving Needs Review to Ready (Doc AI Piece 1)
begin;

do $$
begin
  if current_database() !~ '^(scratch|recruiting_platform_rls_test)' then
    raise exception 'These proofs run only in a scratch database ("scratch..." or the RLS runner''s throwaway). This is "%".', current_database();
  end if;
  if current_database() ~ '^scratch' and (select count(*) from auth.users) > 3 then
    raise exception 'This scratch database already holds % users. Proofs refuse to run beside other data.', (select count(*) from auth.users);
  end if;
end $$;

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
insert into auth.users (id, email) values ('5c5c0000-0000-0000-0000-0000000000d1','synth-master@example.test');
insert into public.orgs (id, name, slug) values ('5c5c0000-0000-0000-0000-000000000001','Synthetic Org','synthetic-org');
insert into public.org_members (user_id, org_id, role) values ('5c5c0000-0000-0000-0000-0000000000d1','5c5c0000-0000-0000-0000-000000000001','owner');
update public.orgs set master_user_id = '5c5c0000-0000-0000-0000-0000000000d1' where id = '5c5c0000-0000-0000-0000-000000000001';
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
 ('a0000000-0000-0000-0000-000000000001','5c5c0000-0000-0000-0000-000000000001','family'),
 ('a0000000-0000-0000-0000-000000000002','5c5c0000-0000-0000-0000-000000000001','family'),
 ('a0000000-0000-0000-0000-000000000003','5c5c0000-0000-0000-0000-000000000001','owner'),
 ('a0000000-0000-0000-0000-000000000004','5c5c0000-0000-0000-0000-000000000001','owner'),
 ('a0000000-0000-0000-0000-000000000005','5c5c0000-0000-0000-0000-000000000001','staff'),
 ('a0000000-0000-0000-0000-000000000006','5c5c0000-0000-0000-0000-000000000001','member'),
 ('a0000000-0000-0000-0000-000000000007','5c5c0000-0000-0000-0000-000000000001','family'),
 ('a0000000-0000-0000-0000-000000000009','5c5c0000-0000-0000-0000-000000000001','owner');
insert into public.athletes (id, org_id, name, sport, advisor_id) values
 ('b0000000-0000-0000-0000-00000000000a','5c5c0000-0000-0000-0000-000000000001','SYNTH Athlete A','baseball','a0000000-0000-0000-0000-000000000003'),
 ('b0000000-0000-0000-0000-00000000000b','5c5c0000-0000-0000-0000-000000000001','SYNTH Athlete B','baseball','a0000000-0000-0000-0000-000000000009');
insert into public.athlete_guardians (org_id, athlete_id, user_id) values
 ('5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a','a0000000-0000-0000-0000-000000000001'),
 ('5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-000000000002');
-- objects: owner Dave unless noted; oO is an orphan uploaded by the unentitled Admin
insert into storage.objects (bucket_id, name, owner) values
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf','5c5c0000-0000-0000-0000-0000000000d1'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf','5c5c0000-0000-0000-0000-0000000000d1'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_a2/a.pdf','5c5c0000-0000-0000-0000-0000000000d1'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_a3/a.pdf','5c5c0000-0000-0000-0000-0000000000d1'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_a4/a.pdf','5c5c0000-0000-0000-0000-0000000000d1'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_t/a.pdf','5c5c0000-0000-0000-0000-0000000000d1'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_u/a.pdf','a0000000-0000-0000-0000-000000000004'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf','a0000000-0000-0000-0000-000000000004'),
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf','5c5c0000-0000-0000-0000-0000000000d1');
update storage.objects set owner_id = owner::text where bucket_id = 'documents' and owner_id is null;
insert into storage.objects (bucket_id, name, owner, owner_id) values
 ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf','5c5c0000-0000-0000-0000-0000000000d1','5c5c0000-0000-0000-0000-0000000000d1');
insert into public.documents (id, org_id, file_name, file_size, media_type, source_role, athlete_id, linked_athlete_id, storage_paths, original_paths, content_hash, lifecycle, requested_category) values
 ('c0000000-0000-0000-0000-00000000000a','5c5c0000-0000-0000-0000-000000000001','SYNTH-a.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf'],'synthhash0078','needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a2','5c5c0000-0000-0000-0000-000000000001','SYNTH-a2.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['5c5c0000-0000-0000-0000-000000000001/doc_p_a2/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_a2/a.pdf'],null,'needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a3','5c5c0000-0000-0000-0000-000000000001','SYNTH-a3.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['5c5c0000-0000-0000-0000-000000000001/doc_p_a3/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_a3/a.pdf'],null,'needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a4','5c5c0000-0000-0000-0000-000000000001','SYNTH-a4.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['5c5c0000-0000-0000-0000-000000000001/doc_p_a4/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_a4/a.pdf'],null,'needs_review',null),
 ('c0000000-0000-0000-0000-0000000000a5','5c5c0000-0000-0000-0000-000000000001','SYNTH-transcript.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000a',array['5c5c0000-0000-0000-0000-000000000001/doc_p_t/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_t/a.pdf'],null,'needs_review','transcript'),
 ('c0000000-0000-0000-0000-0000000000a6','5c5c0000-0000-0000-0000-000000000001','SYNTH-unlinked.pdf',1,'application/pdf','admin',null,null,array['5c5c0000-0000-0000-0000-000000000001/doc_p_u/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_u/a.pdf'],null,'needs_review',null);
-- a document that names two different athletes (athlete_id A, linked B): AND semantics make it the master's alone
insert into public.documents (id, org_id, file_name, file_size, media_type, source_role, athlete_id, linked_athlete_id, storage_paths, original_paths, lifecycle) values
 ('c0000000-0000-0000-0000-0000000000a7','5c5c0000-0000-0000-0000-000000000001','SYNTH-two-athletes.pdf',1,'application/pdf','admin','b0000000-0000-0000-0000-00000000000a','b0000000-0000-0000-0000-00000000000b',array['5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf'],'needs_review');
-- an open upload assignment for Athlete A (Athlete A's guardian answers it in the S block)
insert into public.assignments (id, org_id, athlete_id, title, kind) values ('e1000000-0000-0000-0000-00000000000a','5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a','SYNTH upload assignment','upload');
-- Athlete A's advisor approves transcripts (area academic) for P1e
insert into public.doc_approvers (org_id, area, user_id) values ('5c5c0000-0000-0000-0000-000000000001','academic','a0000000-0000-0000-0000-000000000003');

-- 01-08: Athlete A's reader file
select pg_temp.t('01 read A', 'Athlete A (guardian of A)', 'READ',   'a0000000-0000-0000-0000-000000000001', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('02 read A', 'Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('03 read A', 'Advisor assigned to A', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('04 read A', 'Advisor of B (not A)', 'DENIED', 'a0000000-0000-0000-0000-000000000009', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('04 read A', 'Admin not assigned to A', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('05 read A', 'Master account', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('06 read A', 'Viewer', 'DENIED', 'a0000000-0000-0000-0000-000000000006', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('06 read A', 'Leftover staff role', 'DENIED', 'a0000000-0000-0000-0000-000000000005', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('06 read A', 'Family role, not guardian of A', 'DENIED', 'a0000000-0000-0000-0000-000000000007', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('07 read A', 'Signed out (anon)', 'DENIED', null, 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('08 read A', 'Signed-in outsider with the path', 'DENIED', 'a0000000-0000-0000-0000-000000000008', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');

-- 14: the original file (listed only in original_paths)
select pg_temp.t('14 original', 'Admin not assigned to A', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Advisor assigned to A', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Athlete A', 'READ', 'a0000000-0000-0000-0000-000000000001', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf');
select pg_temp.t('14 original', 'Master account', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf');

-- X: a document that names two different athletes (athlete_id A, linked B) opens for the master alone
select pg_temp.t('X1 two athletes', 'Master', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', $q$5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf$q$);
select pg_temp.t('X2 two athletes', 'Advisor of A', 'DENIED', 'a0000000-0000-0000-0000-000000000003', 'read', $q$5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf$q$);
select pg_temp.t('X3 two athletes', 'Advisor of B', 'DENIED', 'a0000000-0000-0000-0000-000000000009', 'read', $q$5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf$q$);
select pg_temp.t('X4 two athletes', 'Athlete A', 'DENIED', 'a0000000-0000-0000-0000-000000000001', 'read', $q$5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf$q$);
select pg_temp.t('X5 two athletes', 'Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', $q$5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf$q$);
select pg_temp.t('X6 two athletes', 'Admin not assigned', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', $q$5c5c0000-0000-0000-0000-000000000001/doc_p_x/a.pdf$q$);
select pg_temp.t('X7 two athletes', 'Advisor of A: the table row', 'HIDDEN', 'a0000000-0000-0000-0000-000000000003', 'list', $q$c0000000-0000-0000-0000-0000000000a7$q$);
select pg_temp.t('X8 two athletes', 'Master: the table row', 'LISTED', '5c5c0000-0000-0000-0000-0000000000d1', 'list', $q$c0000000-0000-0000-0000-0000000000a7$q$);

-- 13: a file with no document row is the master's alone
select pg_temp.t('13 no row', 'Uploader (unentitled Admin) reads own orphan', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf');
select pg_temp.t('13 no row', 'Advisor of A', 'DENIED', 'a0000000-0000-0000-0000-000000000003', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf');
select pg_temp.t('13 no row', 'Athlete A', 'DENIED', 'a0000000-0000-0000-0000-000000000001', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf');
select pg_temp.t('13 no row', 'Unentitled Admin reads the master''s orphan', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf');
select pg_temp.t('13 no row', 'Master account', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf');

-- U: upload_is_mine (the read-back after upload asks this before using the service client)
select pg_temp.t('U1 mine', 'Uploader (Admin) asks about own unclaimed object', 'true', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select public.upload_is_mine('5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf')::text$q$);
select pg_temp.t('U2 mine', 'Another Admin (advisor of A) asks about it', 'false', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select public.upload_is_mine('5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf')::text$q$);
select pg_temp.t('U3 mine', 'Master asks about the Admins object (not the masters own)', 'false', '5c5c0000-0000-0000-0000-0000000000d1', 'q', $q$select public.upload_is_mine('5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf')::text$q$);
select pg_temp.t('U4 mine', 'Admin asks about the masters unclaimed object', 'false', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select public.upload_is_mine('5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf')::text$q$);
select pg_temp.t('U5 mine', 'Admin asks about an object a document already lists', 'false', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select public.upload_is_mine('5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf')::text$q$);
select pg_temp.t('U6 mine', 'Viewer asks about the Admins object', 'false', 'a0000000-0000-0000-0000-000000000006', 'q', $q$select public.upload_is_mine('5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf')::text$q$);
select pg_temp.t('U7 mine', 'Signed out (the function is not granted to anon)', 'ERROR 42501', null, 'q', $q$select public.upload_is_mine('5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf')::text$q$);

-- an unlinked upload (a document, no athlete yet) stays open to the org's Admins
select pg_temp.t('18 unlinked doc', 'Unentitled Admin', 'READ', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_u/a.pdf');
select pg_temp.t('18 unlinked doc', 'Viewer', 'DENIED', 'a0000000-0000-0000-0000-000000000006', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_u/a.pdf');
select pg_temp.t('18 unlinked doc', 'Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_u/a.pdf');

-- 11: the Documents list, by role
select pg_temp.t('11 list', 'Admin not assigned to A: the table row', 'HIDDEN', 'a0000000-0000-0000-0000-000000000004', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 list', 'Advisor assigned to A: the table row', 'LISTED', 'a0000000-0000-0000-0000-000000000003', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 list', 'Master: the table row', 'LISTED', '5c5c0000-0000-0000-0000-0000000000d1', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 list', 'Viewer: the table row', 'HIDDEN', 'a0000000-0000-0000-0000-000000000006', 'list', 'c0000000-0000-0000-0000-00000000000a');
select pg_temp.t('11 locked', 'Admin not assigned to A: locked stubs for the 6 synthetic athlete documents', '6', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.documents_locked('5c5c0000-0000-0000-0000-000000000001') where id::text like 'c0000000-0000-0000-0000-0000000000a%' or id = 'c0000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.t('11 locked', 'Advisor assigned to A: locked stubs among the synthetic documents (only the two-athlete one)', '1', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select count(*)::text from public.documents_locked('5c5c0000-0000-0000-0000-000000000001') where id::text like 'c0000000-0000-0000-0000-0000000000a%' or id = 'c0000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.t('11 locked', 'Viewer: locked stubs', '0', 'a0000000-0000-0000-0000-000000000006', 'q', $q$select count(*)::text from public.documents_locked('5c5c0000-0000-0000-0000-000000000001')$q$);
select pg_temp.t('11 locked', 'Stub columns are exactly these', 'TABLE(id uuid, org_id uuid, status text, lifecycle text, created_at timestamp with time zone)', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select pg_get_function_result('public.documents_locked(uuid)'::regprocedure)$q$);

-- 09 and 12: the three family functions
select pg_temp.t('09 family_documents', 'Admin not assigned to A', '0', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.family_documents('5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('09 family_documents', 'Athlete B', '0', 'a0000000-0000-0000-0000-000000000002', 'q', $q$select count(*)::text from public.family_documents('5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('09 family_documents', 'Advisor assigned to A', '5', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select count(*)::text from public.family_documents('5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('09 family_documents', 'Athlete A', '5', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select count(*)::text from public.family_documents('5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('12 family_document_twin', 'Admin not assigned to A (known hash)', '0', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.family_document_twin('5c5c0000-0000-0000-0000-000000000001','synthhash0078')$q$);
select pg_temp.t('12 family_document_twin', 'Athlete B (known hash)', '0', 'a0000000-0000-0000-0000-000000000002', 'q', $q$select count(*)::text from public.family_document_twin('5c5c0000-0000-0000-0000-000000000001','synthhash0078')$q$);
select pg_temp.t('12 family_document_twin', 'Advisor assigned to A (known hash)', '1', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select count(*)::text from public.family_document_twin('5c5c0000-0000-0000-0000-000000000001','synthhash0078')$q$);
select pg_temp.t('09 family_send_document', 'Athlete B sending into A', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000002', 'q', $q$select public.family_send_document('b0000000-0000-0000-0000-00000000000a','x.pdf',1,'application/pdf','5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a/x.pdf')::text$q$);

-- 09b: a guardian sends a PDF (upload, family_send_document, read it back)
select pg_temp.t('09b send', 'Step 1: Athlete As guardian uploads a PDF (no row returned)', '1', 'a0000000-0000-0000-0000-000000000001', 'dml', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('documents','5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req1/x.pdf','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001')$q$);
select pg_temp.t('09b send', 'Step 2: ... sends it with family_send_document', 'sent', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select case when public.family_send_document('b0000000-0000-0000-0000-00000000000a','x.pdf',1,'application/pdf','5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req1/x.pdf') is not null then 'sent' end$q$);
select pg_temp.t('09b send', 'Step 3: ... and reads it back', 'READ', 'a0000000-0000-0000-0000-000000000001', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req1/x.pdf$q$);
select pg_temp.t('09b send', 'Step 3: ... it is on their family_documents list (6 with the 5 fixtures)', '6', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select count(*)::text from public.family_documents('5c5c0000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-00000000000a')$q$);
select pg_temp.t('09b send', 'Step 4: Athlete B cannot open it', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req1/x.pdf$q$);
select pg_temp.t('09b send', 'Step 4: the unassigned Admin cannot open it', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req1/x.pdf$q$);
select pg_temp.t('09b send', 'Step 4: the advisor of A can', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req1/x.pdf$q$);
select pg_temp.t('09b send', 'Step 4: the master can', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req1/x.pdf$q$);
select pg_temp.t('09b send', 'BLOCKER: the guardians upload when the insert returns the row (what Supabase Storage does)', 'returned', 'a0000000-0000-0000-0000-000000000001', 'q', $q$with x as (insert into storage.objects (bucket_id, name, owner, owner_id) values ('documents','5c5c0000-0000-0000-0000-000000000001/family/b0000000-0000-0000-0000-00000000000a_req2/y.pdf','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001') returning name) select case when count(*) = 1 then 'returned' end from x$q$);

-- S: an Athlete's guardian answers an assignment with a file (submit_assignment) under the stricter insert guard
select pg_temp.t('S1 submit', 'Athlete As guardian uploads the answer into the assignment folder (no row returned)', '1', 'a0000000-0000-0000-0000-000000000001', 'dml', $q$insert into storage.objects (bucket_id, name, owner, owner_id) values ('documents','5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf','a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001')$q$);
select pg_temp.t('S2 submit', '... submits it with submit_assignment', 'submitted', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select case when public.submit_assignment('e1000000-0000-0000-0000-00000000000a', 'done', 'answer.pdf', 1, 'application/pdf', '5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf') is not null then 'submitted' end$q$);
select pg_temp.t('S3 submit', '... the assignment is now submitted and carries the document', 'submitted:true', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select status::text || ':' || (document_id is not null)::text from public.assignments where id = 'e1000000-0000-0000-0000-00000000000a'$q$);
select pg_temp.t('S4 submit', '... the guardian reads the answer back', 'READ', 'a0000000-0000-0000-0000-000000000001', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf$q$);
select pg_temp.t('S4 submit', '... Athlete B cannot open it', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf$q$);
select pg_temp.t('S4 submit', '... the unassigned Admin cannot open it', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf$q$);
select pg_temp.t('S4 submit', '... the advisor of A can', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf$q$);
select pg_temp.t('S4 submit', '... the master can', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', $q$5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf$q$);
select pg_temp.t('S5 submit', 'Athlete Bs guardian cannot answer Athlete As assignment', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000002', 'q', $q$select public.submit_assignment('e1000000-0000-0000-0000-00000000000a', 'x', 'a.pdf', 1, 'application/pdf', '5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf')::text$q$);
select pg_temp.t('S6 submit', 'Athlete As guardian cannot answer with a file they did not upload', 'ERROR 23514', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select public.submit_assignment('e1000000-0000-0000-0000-00000000000a', 'x', 'a.pdf', 1, 'application/pdf', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf')::text$q$);
select pg_temp.t('S7 submit', 'The unassigned Admin cannot submit an Athletes assignment', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select public.submit_assignment('e1000000-0000-0000-0000-00000000000a', 'x', 'a.pdf', 1, 'application/pdf', '5c5c0000-0000-0000-0000-000000000001/family/e1000000-0000-0000-0000-00000000000a/answer.pdf')::text$q$);

-- 10, 10b, 15: view-as is allowed, and never grants file access
select pg_temp.t('10 view-as', 'Admin not assigned to A starts view-as Athlete A', 'started', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select case when public.start_view_as('5c5c0000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001') is not null then 'started' end$q$);
select pg_temp.t('10 view-as', '... then reads Athlete A''s file', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('10 view-as', '... then reads A''s original', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf');
update public.view_as_sessions set ended_at = now(), end_reason = 'returned' where viewer_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null;
select pg_temp.t('10b view-as master', 'Admin not assigned to A starts view-as the master', 'started', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select case when public.start_view_as('5c5c0000-0000-0000-0000-000000000001','5c5c0000-0000-0000-0000-0000000000d1') is not null then 'started' end$q$);
select pg_temp.t('10b view-as master', '... then reads A''s reader file', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('10b view-as master', '... then reads A''s original', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/orig.pdf');
select pg_temp.t('10b view-as master', '... then reads the master''s orphan', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf');
select pg_temp.t('10b view-as master', '... A''s table row', 'HIDDEN', 'a0000000-0000-0000-0000-000000000004', 'list', 'c0000000-0000-0000-0000-00000000000a');
update public.view_as_sessions set ended_at = now(), end_reason = 'returned' where viewer_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null;
select pg_temp.t('15 master views as', 'Master starts view-as Athlete B', 'started', '5c5c0000-0000-0000-0000-0000000000d1', 'q', $q$select case when public.start_view_as('5c5c0000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000002') is not null then 'started' end$q$);
select pg_temp.t('15 master views as', '... still opens A''s file on his own right', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf');
select pg_temp.t('15 master views as', '... the screen is Athlete B''s: A''s table row hidden', 'HIDDEN', '5c5c0000-0000-0000-0000-0000000000d1', 'list', 'c0000000-0000-0000-0000-00000000000a');
update public.view_as_sessions set ended_at = now(), end_reason = 'returned' where viewer_id = '5c5c0000-0000-0000-0000-0000000000d1' and ended_at is null;

-- P1a-e: staff moving Needs Review to Ready (Doc AI Piece 1)
select pg_temp.t('P1a ready', 'Advisor assigned to A readies A''s document', '1:ready:true', 'a0000000-0000-0000-0000-000000000003', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a2' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'a0000000-0000-0000-0000-000000000003')::text, '-') from x$q$);
select pg_temp.t('P1b ready', 'Master readies A''s document', '1:ready:true', '5c5c0000-0000-0000-0000-0000000000d1', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a4' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = '5c5c0000-0000-0000-0000-0000000000d1')::text, '-') from x$q$);
select pg_temp.t('P1c ready', 'Unentitled Admin readies an unlinked upload', '1:ready:true', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a6' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'a0000000-0000-0000-0000-000000000004')::text, '-') from x$q$);
select pg_temp.t('P1d ready', 'Unentitled Admin readies A''s document', '0:-:-', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a3' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'x')::text, '-') from x$q$);
select pg_temp.t('P1e ready', 'Master tries a transcript; the academic approver is the advisor', 'ERROR 42501', '5c5c0000-0000-0000-0000-0000000000d1', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a5' returning 1) select count(*)::text from x$q$);
select pg_temp.t('P1e ready', 'The academic approver readies the same transcript', '1:ready:true', 'a0000000-0000-0000-0000-000000000003', 'q', $q$with x as (update public.documents set lifecycle = 'ready' where id = 'c0000000-0000-0000-0000-0000000000a5' returning lifecycle, approved_by) select count(*)::text || ':' || coalesce(max(lifecycle::text), '-') || ':' || coalesce((max(approved_by::text) = 'a0000000-0000-0000-0000-000000000003')::text, '-') from x$q$);

-- 16: claiming an object with a document row
select pg_temp.t('16 claim', 'Unentitled Admin lists the master''s orphan', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('5c5c0000-0000-0000-0000-000000000001','SYNTH-claim.pdf',1,'application/pdf','admin',array['5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'Unentitled Admin lists Athlete A''s file', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('5c5c0000-0000-0000-0000-000000000001','SYNTH-claim.pdf',1,'application/pdf','admin',array['5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_a/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'Uploader lists own object (the normal upload)', '1', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('5c5c0000-0000-0000-0000-000000000001','SYNTH-own.pdf',1,'application/pdf','admin',array['5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'A second row cannot list the same object', 'ERROR 23505', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('5c5c0000-0000-0000-0000-000000000001','SYNTH-own2.pdf',1,'application/pdf','admin',array['5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_o/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('16 claim', 'Master lists the master''s orphan (clean-up path)', '1', '5c5c0000-0000-0000-0000-0000000000d1', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('5c5c0000-0000-0000-0000-000000000001','SYNTH-master-claim.pdf',1,'application/pdf','admin',array['5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_m/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);

-- 17: the mid-upload sequence, step by step
select pg_temp.t('17 upload', 'Step 1: unentitled Admin uploads an object (owner_id only, no row returned)', '1', 'a0000000-0000-0000-0000-000000000004', 'dml', $q$insert into storage.objects (bucket_id, name, owner_id) values ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf','a0000000-0000-0000-0000-000000000004')$q$);
select pg_temp.t('17 upload', 'Step 1b: ... and a second object (owner only)', '1', 'a0000000-0000-0000-0000-000000000004', 'dml', $q$insert into storage.objects (bucket_id, name, owner) values ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_n2/a.pdf','a0000000-0000-0000-0000-000000000004')$q$);
select pg_temp.t('17 upload', 'BLOCKER: the Admins upload when the insert returns the row (what Supabase Storage does)', 'returned', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into storage.objects (bucket_id, name, owner_id) values ('documents','5c5c0000-0000-0000-0000-000000000001/doc_p_n3/a.pdf','a0000000-0000-0000-0000-000000000004') returning name) select case when count(*) = 1 then 'returned' end from x$q$);
select pg_temp.t('17 upload', 'Step 2: the same Admin reads it back before a row exists', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 2: another Admin (advisor of A) cannot read it either', 'DENIED', 'a0000000-0000-0000-0000-000000000003', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 2: the master can', 'READ', '5c5c0000-0000-0000-0000-0000000000d1', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 3: the row is created (no athlete yet)', '1', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('5c5c0000-0000-0000-0000-000000000001','SYNTH-new-upload.pdf',1,'application/pdf','admin',array['5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('17 upload', 'Step 3b: a row for the owner-only object is accepted too', '1', 'a0000000-0000-0000-0000-000000000004', 'q', $q$with x as (insert into public.documents (org_id,file_name,file_size,media_type,source_role,storage_paths,original_paths,lifecycle) values ('5c5c0000-0000-0000-0000-000000000001','SYNTH-new-upload-2.pdf',1,'application/pdf','admin',array['5c5c0000-0000-0000-0000-000000000001/doc_p_n2/a.pdf'],array['5c5c0000-0000-0000-0000-000000000001/doc_p_n2/a.pdf'],'needs_review') returning 1) select count(*)::text from x$q$);
select pg_temp.t('17 upload', 'Step 4: an unlinked upload is open to the org''s Admins', 'READ', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 4: not to a Viewer', 'DENIED', 'a0000000-0000-0000-0000-000000000006', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 4: not to Athlete B', 'DENIED', 'a0000000-0000-0000-0000-000000000002', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
-- Step 5: linking the upload to an athlete the Admin is not entitled to. A plain update would leave a row
-- the Admin can no longer read, and Postgres refuses it (D6). The Admin links through
-- public.document_link_athlete instead, and the file then locks for them.
select pg_temp.t('17 upload', 'Step 5a: a plain update to link is refused', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'dml', $q$update public.documents set linked_athlete_id = 'b0000000-0000-0000-0000-00000000000a' where file_name = 'SYNTH-new-upload.pdf'$q$);
select pg_temp.t('17 upload', 'Step 5b: the Admin links it through document_link_athlete', 'linked', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select 'linked' from (select public.document_link_athlete((select id from public.documents where file_name = 'SYNTH-new-upload.pdf'), 'b0000000-0000-0000-0000-00000000000a')) x$q$);
select pg_temp.t('17 upload', 'Step 5c: once linked, the uploading Admin no longer opens it', 'DENIED', 'a0000000-0000-0000-0000-000000000004', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 5c: Athlete A''s advisor does', 'READ', 'a0000000-0000-0000-0000-000000000003', 'read', '5c5c0000-0000-0000-0000-000000000001/doc_p_n/a.pdf');
select pg_temp.t('17 upload', 'Step 5c: the uploading Admin now gets the 6 fixture documents, the guardian''s PDF, the assignment answer and this one as locked stubs', '9', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select count(*)::text from public.documents_locked('5c5c0000-0000-0000-0000-000000000001')$q$);

-- L: document_link_athlete (D6) and locked rows being view-only
select pg_temp.t('L1 link', 'Unentitled Admin relinks a locked document (A''s) to Athlete B', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000b')) x$q$);
select pg_temp.t('L2 link', 'Unentitled Admin unlinks a locked document', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a3', null)) x$q$);
select pg_temp.t('L3 link', 'Advisor of A relinks A''s document to a different athlete (B)', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000b')) x$q$);
select pg_temp.t('L4 link', 'Viewer', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000006', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a6', 'b0000000-0000-0000-0000-00000000000a')) x$q$);
select pg_temp.t('L5 link', 'Athlete A (family)', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000001', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a6', 'b0000000-0000-0000-0000-00000000000a')) x$q$);
select pg_temp.t('L6 link', 'Signed out (anon)', 'ERROR 42501', null, 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a6', 'b0000000-0000-0000-0000-00000000000a')) x$q$);
select pg_temp.t('L7 link', 'An athlete that is not on the roster', 'ERROR 22023', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a6', 'b0000000-0000-0000-0000-0000000000ff')) x$q$);
select pg_temp.t('L8 link', 'A document id that does not exist', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000ff', null)) x$q$);
select pg_temp.t('L9 link', 'Admin starts view-as Athlete A', 'started', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select case when public.start_view_as('5c5c0000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001') is not null then 'started' end$q$);
select pg_temp.t('L9 link', '... then tries to link an unlinked document (view-as never writes)', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a6', 'b0000000-0000-0000-0000-00000000000a')) x$q$);
update public.view_as_sessions set ended_at = now(), end_reason = 'returned' where viewer_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null;
select pg_temp.t('L10 view-only', 'Unentitled Admin changes a locked document directly (plain update)', '0', 'a0000000-0000-0000-0000-000000000004', 'dml', $q$update public.documents set file_name = 'SYNTH-renamed.pdf' where id = 'c0000000-0000-0000-0000-0000000000a3'$q$);
select pg_temp.t('L10 view-only', 'Unentitled Admin deletes a locked document (0048 revokes DELETE from signed-in users)', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000004', 'dml', $q$delete from public.documents where id = 'c0000000-0000-0000-0000-0000000000a3'$q$);

-- L11-L13: link_athlete never changes a document's athlete
select pg_temp.t('L11 link', 'Advisor of A asks for the athlete the document already has (no-op)', 'linked', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a3', 'b0000000-0000-0000-0000-00000000000a')) x$q$);
select pg_temp.t('L12 link', 'Advisor of A unlinks As document', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a3', null)) x$q$);
select pg_temp.t('L13 link', 'Advisor of A relinks the two-athlete document', 'ERROR 42501', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a7', 'b0000000-0000-0000-0000-00000000000a')) x$q$);
select pg_temp.t('L14 link', 'Advisor of A (an Admin) links the unlinked document to A', 'linked', 'a0000000-0000-0000-0000-000000000003', 'q', $q$select 'linked' from (select public.document_link_athlete('c0000000-0000-0000-0000-0000000000a6', 'b0000000-0000-0000-0000-00000000000a')) x$q$);

select n, who, expected, actual, case when actual = expected then 'PASS' else 'FAIL' end as result from results order by seq;
select version() as postgres_version;
rollback;
