-- After migration 0048: every old document maps onto the new states and
-- nothing is deleted or changed that should not be. Then the mapping org
-- is removed so the fresh-install probe at the top of rls_test.sql still
-- finds an empty orgs table.
\set ON_ERROR_STOP on
do $$
declare
  n int;
  r record;
  expected jsonb := '{
    "old-processing.pdf": ["needs_review", "Reading did not finish.", "pdf"],
    "old-pending.pdf":    ["needs_review", null, "pdf"],
    "old-applied.jpg":    ["needs_review", null, "jpg"],
    "old-discarded.png":  ["archived", null, "png"],
    "old-failed.pdf":     ["needs_review", "Could not tell what this document is.", "pdf"],
    "old-filed.gif":      ["needs_review", null, null]
  }';
begin
  select count(*) into n from documents where org_id = '00000000-0000-0000-0000-000000048099';
  if n <> 6 then raise exception 'FAIL: the migration left % of 6 old documents', n; end if;
  for r in select * from documents where org_id = '00000000-0000-0000-0000-000000048099' loop
    if r.lifecycle::text <> (expected -> r.file_name ->> 0) then
      raise exception 'FAIL: % mapped to %, expected %', r.file_name, r.lifecycle, expected -> r.file_name ->> 0;
    end if;
    if r.review_reason is distinct from (expected -> r.file_name ->> 1) then
      raise exception 'FAIL: % review_reason is %, expected %', r.file_name, r.review_reason, expected -> r.file_name ->> 1;
    end if;
    if r.format is distinct from (expected -> r.file_name ->> 2) then
      raise exception 'FAIL: % format is %, expected %', r.file_name, r.format, expected -> r.file_name ->> 2;
    end if;
    if r.original_paths <> r.storage_paths then raise exception 'FAIL: % original_paths differ from storage_paths', r.file_name; end if;
    if r.lifecycle = 'ready' then raise exception 'FAIL: % became Ready on its own', r.file_name; end if;
  end loop;
  select count(*) into n from documents where org_id = '00000000-0000-0000-0000-000000048099' and content_hash is null;
  if n <> 0 then raise exception 'FAIL: the migration lost % content hashes', n; end if;
  raise notice 'PASS: old statuses map onto the five new states, nothing deleted, nothing Ready';
end $$;
delete from orgs where id = '00000000-0000-0000-0000-000000048099';
