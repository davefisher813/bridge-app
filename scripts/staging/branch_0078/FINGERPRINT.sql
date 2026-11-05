-- Read-only. Run on the branch and on production; the two rows must match.
select
  (select count(*) from pg_policies where schemaname in ('public','storage')) as policies,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')) as functions,
  (select count(*) from pg_tables where schemaname='public') as tables,
  (select count(*) from information_schema.columns where table_schema='public') as columns,
  (select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname='public') as triggers,
  md5((select string_agg(schemaname||'.'||tablename||'.'||policyname, ',' order by 1) from (select schemaname,tablename,policyname from pg_policies where schemaname in ('public','storage')) x)) as policy_names_md5,
  md5((select string_agg(n.nspname||'.'||p.proname, ',' order by n.nspname, p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private'))) as function_names_md5,
  md5((select string_agg(table_name||'.'||column_name, ',' order by table_name, column_name) from information_schema.columns where table_schema='public')) as column_names_md5;
