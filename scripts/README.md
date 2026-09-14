# Scripts

## RLS enforcement test

`run_rls_test.sh` builds a throwaway local Postgres database, applies
`local_auth_stub.sql` (a stand-in for Supabase's `auth` schema so
`auth.uid()`/`auth.role()` work outside Supabase), applies the real
migration, then runs `rls_test.sql`: seeds two orgs with one user each
and asserts, as a genuine non-superuser role (`app_user`,
`NOBYPASSRLS`), that cross-org reads/writes are actually denied, not
just that the schema's relationships insert correctly.

This matters because RLS is bypassed for superusers and table owners.
A migration test that only ever runs as the Postgres superuser (which
is what a quick local sanity check defaults to) can pass every insert
and still have row-level security completely broken, or even
recursing infinitely, and never find out. That's exactly what happened
here: the first version of `migrations/0001_core_schema.sql` had
`org_members`'s own RLS policy query `org_members`, so any other
policy that also filtered through `org_members` (athletes, recruiting
targets, benchmark sets) recursed into evaluating that same policy
forever. Running as superuser never triggers it; running as
`app_user` did, immediately, on the first real query. Fixed with a
`SECURITY DEFINER` helper function - see the comment above
`_member_org_ids()` in the migration.

Run it:

```
./scripts/run_rls_test.sh
```

Requires a local Postgres reachable via `su postgres -c psql` (adjust
the script if your setup differs - a Docker Postgres or a Supabase
preview branch both work, the SQL itself doesn't care). Never point
this at a database with real data: it drops/recreates `app_user` and
seeds fixed-UUID rows.

Before this schema is applied to a real Supabase project, rerun this
(or the Supabase-preview-branch equivalent) after any change to a
policy or to `_member_org_ids()`. RLS bugs are exactly the kind of
thing that look fine until the second organization's data shows up
next to the first one.
