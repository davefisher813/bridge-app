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

## What the stub covers now (2026-09-19)

`local_auth_stub.sql` also stands in for `auth.users.raw_user_meta_data`
and for Supabase's `storage` schema (`buckets`, `objects`,
`foldername()`), just far enough that migration 0017 applies and the
`documents` bucket's policies run as `app_user`. `rls_test.sql` asserts
the profile trigger and the bucket policies alongside everything else.
Add each new migration to `run_rls_test.sh` in order; the script is the
list.

### Supabase's default grants, mirrored (2026-09-27)

A Supabase project grants every new table and function in `public` to
`anon` and `authenticated` by default, which is why migrations revoke
from `anon` (0033, 0036, 0040). A plain local Postgres grants nothing,
so a missing revoke could never fail here. `run_rls_test.sh` now sets
the same default privileges before the first migration, and the suite
asserts the revokes by asking `has_table_privilege` and
`has_function_privilege` as `anon`.

## The high school directory loader

`load_high_schools.ts` fills the shared `high_schools` table (migration
0040) from the public NCES school files and nothing else. It is a
one-off, run by hand; the app never runs it and no migration writes the
table. The directory holds no org's data (Dave, 2026-09-27), and
`src/laws/autofillLaws.test.ts` fails if the loader or its parser
(`src/lib/lookup/ncesParse.ts`) so much as names an org table.

The files, downloaded and unzipped by hand:

- Public schools: the CCD school directory, "ccd_sch_029_<yyyy>_...csv",
  from https://nces.ed.gov/ccd/files.asp (Nonfiscal, School, Directory).
- Private schools: the PSS public-use file, "pss<yyyy>_pu.csv", from
  https://nces.ed.gov/surveys/pss/pssdata.asp.

Only schools that teach grade 12 in the states asked for are kept, and
closed public schools are skipped. Rows upsert on `nces_id` in batches of
500, tagged `nces_ccd_<year>` or `nces_pss_<year>`, so running it again
updates rather than duplicates. Always dry-run first and read the per
state counts: a count that is obviously wrong means the file's layout or
codebook changed (the PSS grade column is a code, 17 for grade 12).

```
npx esbuild scripts/load_high_schools.ts --bundle --platform=node --log-level=warning \
  | node - --states CT,NY,NJ --file ccd_sch_029_2324_w_1a_073124.csv --file pss2122_pu.csv --dry-run

NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
npx esbuild scripts/load_high_schools.ts --bundle --platform=node --log-level=warning \
  | node - --states CT,NY,NJ --file ccd_sch_029_2324_w_1a_073124.csv --file pss2122_pu.csv
```

Until it runs, the directory is empty and the high school suggestions
come from the org's own names only (its courses, grading scales,
approved lists and athlete records). The service role key never goes in
the repo.

## The preview and the bench

`build_previews.sh` compiles the app's stylesheet, renders every page in
`src/testing/pages.ts` on the fixture into one click-through file
(`scripts/preview/build_app_preview.ts`, run under vitest because it
needs the same mocks as the render law), bundles the shipped engine
modules into the test bench (`build_testbench.py`), proves the bench's
checks pass in a browser (`verify_testbench.mjs`), and audits every
preview screen in both themes (`audit_preview.mjs`): every class in the
markup exists in the stylesheet, every glyph draws, nothing scrolls
sideways at 390, text clears AA on the surface it sits on, every link
and button is 44px, no screen is empty. Any finding fails the build.

The preview is the page code's own output, not a copy of it. The six
hand-written generators and the 2,700 line prototype that used to live
here drifted from the app three times in one sitting and were retired
on 2026-09-19.

Every script writes to `PREVIEW_OUT_DIR`, default `/tmp/previews`, and
reads from the same place.

## The app itself, in a browser

A link the audit cannot match to a page is a finding, unless it names a
file under `public/` (the schools CSV template), which Next serves as is.

`scripts/live/` drives the shipped app rather than a render of it.

```
FIXTURE_MODE=1 npx next build && FIXTURE_MODE=1 npx next start -p 3100
SHOTS=1 node scripts/live/drive.mjs          # every route, 320/375/390, both themes
SUFFIX=375-light node scripts/live/sheets.mjs # contact sheets of the screenshots
```

`FIXTURE_MODE=1` makes `next.config.ts` alias the two Supabase seams to
`src/testing/fixtureServer.ts` and `fixtureMiddleware.ts`; every page,
form, font and client component is the real one. `drive.mjs` reports
sideways scroll, anything past the frame, text wider than its box and
any word broken in the middle, and writes screenshots and
`findings.json` next to them. `WIDTHS=260,280` approximates Safari's
page zoom. Never build for production with the flag set.

The browser scripts launch Playwright's own Chromium unless `PW_CHROMIUM`
names an executable. Set it when the installed `playwright` package and
the browsers on the machine are different builds, as on the Claude Code
container (`PW_CHROMIUM=/opt/pw-browsers/chromium`).
