# Go-live status

Checked 2026-10-10 against production: Supabase `emllcefqxyxyhqolrllo`,
Vercel `commit-app`, `main` at d1da4b8. Every line says what was checked
and how. Three data changes ran later the same day on Dave's word (see
"Done on Dave's word"); everything else was read only.

## 1. Backend

| Item | State | Evidence |
|---|---|---|
| Supabase keys in production | **Done, already in place** | Vercel production env has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (set 2026-09-19). No handoff from Alfred needed. |
| Migrations | **Done** | 0001 to 0046 in the migration history. 0048 (document vault) was applied by hand on Oct 8 and is not in the history table, but the live catalog has all of it: the 6 columns, the 3 triggers, the delete policies gone, `authenticated` cannot delete, the 9 file types, the 5 activity values. 0047 (View As) is not applied, as intended. |
| Code pushed | **Done** | `main` = d1da4b8 on GitHub and in production. |
| 634 schools, 1,461 coaches | **Present: 638 schools, 1,461 coaches** | Row counts on production. 638, not 634: four more schools than the brief expects. |
| Athletes import | **Done** | The 28-athlete sheet was already in the app. Ricky Perez and Frailyn Capellan (from the MASTER tracker) were added on Dave's word, Active, Baseball. Bridge now has 34 athletes, no duplicates. Some sheet statuses are older than the app's (Angel Valerio, Brandon Jimenez, JJ Batista); the app was left as is. |
| 16 prepared files | **Done** | The 16 prepared files are back in Needs Review and the 16 Oct 9 copies are Archived. Read back from production: Needs Review 16, Archived 41. One activity row per move. Nothing deleted. |
| Test data | **None found** | Searched every text column of every public table for "AUDIT TEST", "AlfredQA", "Alfred Test" and "safe to delete": 0 rows. No athlete, user, board member or donor name contains "test" or "audit". |

## 2. Deployment

| Item | State | Evidence |
|---|---|---|
| Deploy target | **Vercel, unchanged** | Nothing is on Railway or Netlify. Switching waits on Dave. |
| Clean build | **Done** | Deployment dpl_EZJsWgzsm2NtJN61D3YkLCGxvzj9 (d1da4b8): compiled, TypeScript passed, no warnings or errors in the build log, READY. |
| Live URL | **Loads** | https://commit-app-nu.vercel.app/login answers 200 with the sign-in screen. 0 runtime errors in the last 7 days. |

## 3. Modules

| Item | State | Evidence |
|---|---|---|
| Recruiting | **Works in the built app; not checked signed in on production** | 39 browser tests pass, including matching, metrics and Add Target. 638 schools and 1,461 coaches can be queried. |
| Fundraising | **Tracking built and working; no payment processing** | Campaigns, donors, gifts, pledges and grants. Browser tests create, edit and remove each. Production has 0 donors, gifts, campaigns and pledges, so there is nothing to show yet. The donate button is Dave's call. |
| Governance | **Meetings built, not merged** | Production has 0 boards and 0 seats. The 7 board documents are in Documents (Admins only). Board meetings (agenda date, board, place, notes, attached documents) are built on this branch with migration 0050, not applied to production yet. Admins only; Viewers do not see meetings. |
| Doc AI | **Full flow already run on production by davefisher813@gmail.com** | The activity log shows it on Oct 8 and 9: uploaded, Needs Review, 42 Mark Ready, Archive, Unarchive, typed reading (Processing, then Needs Review), and "Did not look like" refusals kept with their reasons. No orphans: 0 files without a row, 0 rows pointing at a missing file, 0 stuck in Processing. The bucket limit is back to 10 MB (read back: 10485760), matching the app. |

## 4. Content

| Item | State | Evidence |
|---|---|---|
| Headshots (4) | **Built, not merged; no photos received** | Each member can now have a photo (migration 0049, not applied to production yet). An Admin adds it on the member's page. Photos are private to people in the org. |
| Henry Tolentino as Asst Coach, Elite Squad NY | **Blocked: needs his email** | He is in the app only as an Enrolled Bridge athlete (alumni, Monroe University). A coach listing means an Elite Squad member account with the title "Asst Coach". |
| Karen Alvarez on the Development Board with a photo | **Waits on her account** | Dave will invite her as an Admin and add her photo once 0049 is live. |
| Dave once on /org/bridge/advisors | **True today** | Bridge has one member: Dave (davefisher813@gmail.com, Admin). |
| No placeholder or fake names | **Clean** | No lorem ipsum in the code. Production data has no test names. The fixture's invented names exist only in tests. |
| View As hidden | **Done** | 0047 not applied; no View As screen in `main`. |
| Spanish toggle | **Done** | No language toggle exists in `main`. |
| Elite Squad hidden | **Not done: waits on Gate 1 item 7** | Elite Squad has 0 athletes and 1 document. Dave is an Admin there with both accounts, so it shows in his organization picker. |

## 5. QA

| Item | State | Evidence |
|---|---|---|
| Gate | **Pass** | `npm run qa:check`: on `main` d1da4b8, 2,449 tests; on this branch, 2,485 tests across 87 files, production build, lint (secret scan, em dash), types. RLS suite with 0049 and 0050, both reversible. |
| Phone widths, dead buttons, links | **Pass** | `scripts/live/check.sh` on this branch: 191 screens at 320, 375 and 390 in light and dark, 0 findings, 310 links followed, 0 broken, no new surface that goes nowhere. |
| Forms | **Pass in tests** | Every server action is run by `src/laws/actionRun.test.ts` and `otherActions.test.ts`, including the refusal paths. |
| Real-account role test | **Not run** | Needs a sign-in per role on production. There is one account (Dave, Admin). `scripts/access/probe.mjs` exists for it and runs only with Dave's approval. |

## 7. Handoff

| Item | State |
|---|---|
| Live URL | Working (see 2). |
| dave@bffsa.org as Admin of Bridge | **Not yet.** dave@bffsa.org is an Admin of Elite Squad only. Adding it to Bridge while davefisher813@gmail.com stays would put Dave on Advisors twice. Needs the swap decision below. |
| Runbook | `docs/RUNBOOK.md`. |

## Done on Dave's word (2026-10-10)

From the guarded scripts in `scripts/launch/`, after a dry run of each:

- `2_documents.sql`: 16 prepared files to Needs Review, 16 copies to Archived.
- `3_athletes.sql`: Ricky Perez and Frailyn Capellan added.
- `4_bucket_limit.sql`: documents bucket 50 MB to 10 MB.

Read back afterwards: Needs Review 16, Archived 41, athletes 34, bucket
10485760, 0 orphaned files.

## Still open

1. **Admin swap** (`1_admin_swap.sql`, dry run clean): Dave asked how it
   changes his day to day before answering.
2. **Henry Tolentino:** waits on his email.
3. **Backups or point in time recovery:** unconfirmed. Blocks applying
   0049 and 0050.
4. **Merge** of this branch: waits on Dave.
5. **Meetings for Viewers:** Admin only today; Dave's call.
