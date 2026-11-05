# 0078 staging run, by hand (branch kqvxkqqyojnnvkfkevhe only)

Never run any of this in the production SQL editor (ref emllcefqxyxyhqolrllo).
Prepared because the Supabase connector asks a question on every write that
this session cannot answer. Reads work. Dry-run on a local Postgres 16 with
each batch in one transaction: every check query returned true.

## 1. Migrations (branch SQL editor, one file at a time, in order)
1. `1_batch_0048.sql` (0048 is missing on the branch; production got it by hand)
2. `2_batch_0052_to_0062.sql`
3. `3_batch_0063_to_0073.sql`
4. `4_batch_0074.sql`
5. `5_batch_0075_to_0077.sql`
Each ends with a CHECK query. Stop on any error or any false.
The editor may warn about destructive statements (drop policy, revoke): that is expected.

## 2. Schema match against production (before 0078)
Run `FINGERPRINT.sql` on the branch and on production. Production reads:
policies 147, functions 57, tables 44, columns 508, triggers 26,
policy_names_md5 5e541223881b560d9d14267074ebe075,
function_names_md5 10615961574cebec7570d0cc5a51253f,
column_names_md5 66579ed5f305ab301c5c22337e3ad30f.
If the branch differs, send me both rows. Do not apply 0078 until it matches or
the difference is explained. A local replay of the repo files gave 502 columns, not 508, so
expect to look at the column difference: production may hold columns no
migration file creates.

## 3. 0078
`6_batch_0078.sql`, then its CHECK (all true).

## 4. Seed
Dashboard, Authentication, Add user, tick Auto Confirm User, three users:
`stg-master@example.test`, `stg-admin@example.test`, `stg-athlete@example.test`
(a different strong password each; not a real one). Then run `7_seed.sql`.
It prints ORG_ID and ASSIGNMENT_ID.

## 5. Run the test (from a checkout of claude/stoic-hypatia-xhpoxf, networked)
```bash
export STAGING_URL=https://kqvxkqqyojnnvkfkevhe.supabase.co
export STAGING_ANON_KEY=<branch anon/publishable key, Project Settings, API>
export ATHLETE_EMAIL=stg-athlete@example.test ATHLETE_PASSWORD=<chosen>
export ADMIN_EMAIL=stg-admin@example.test ADMIN_PASSWORD=<chosen>
export ORG_ID=5c5c0000-0000-0000-0000-000000000001
export ASSIGNMENT_ID=e1000000-0000-0000-0000-00000000000a
node scripts/staging/0078_upload_test.mjs
```
Check STAGING_URL says kqvxkqqyojnnvkfkevhe before running. Expected PASS lines:
Athlete uploads; Athlete submits (submit_assignment); Athlete reads it back;
Admin uploads; upload_is_mine true; Admin cannot read it back (master-only).
