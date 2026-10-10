# Go-live status

Checked 2026-10-10 against production: Supabase `emllcefqxyxyhqolrllo`,
Vercel `commit-app`, `main` at d1da4b8. Every line says what was checked
and how. Nothing in production was changed while writing this.

## 1. Backend

| Item | State | Evidence |
|---|---|---|
| Supabase keys in production | **Done, already in place** | Vercel production env has `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (set 2026-09-19). No handoff from Alfred needed. |
| Migrations | **Done** | 0001 to 0046 in the migration history. 0048 (document vault) was applied by hand on Oct 8 and is not in the history table, but the live catalog has all of it: the 6 columns, the 3 triggers, the delete policies gone, `authenticated` cannot delete, the 9 file types, the 5 activity values. 0047 (View As) is not applied, as intended. |
| Code pushed | **Done** | `main` = d1da4b8 on GitHub and in production. |
| 634 schools, 1,461 coaches | **Present: 638 schools, 1,461 coaches** | Row counts on production. 638, not 634: four more schools than the brief expects. |
| Athletes import | **Nothing to import; 2 to confirm** | The 28-athlete sheet ("BFFSA Athlete Database") is all already in the app: every one of the 28 names matches a live athlete. The app has 32: the 28 plus Jeremias Perez, Jeromie Volquez, Rogerlin Paulino, Wilfredo Paulino. No duplicates. The "MASTER Bridge Recruiting Tracker" lists two athletes the app does not have: **Ricky Perez** and **Frailyn Capellan**. Their files are already uploaded. Not added: need Dave to confirm they are Bridge athletes. Some sheet statuses are older than the app's (Angel Valerio, Brandon Jimenez, JJ Batista); the app was left as is. |
| 16 prepared files | **Uploaded, but sitting in Archived** | All 16 are in Documents (Oct 8, 13:30 to 13:33 UTC, by davefisher813@gmail.com): 7 board documents (articles of incorporation, bylaws, code of conduct, conflict of interest, fiscal policy, mission statement, NDA) and 9 athlete files (Bautista, Branche, Izquierdo, Paradis, Soroa). On Oct 9 01:42 to 01:50 every document was archived, and 17 copies were uploaded again with types chosen. Those 17 are what Needs Review shows now. Most are "Same file as" duplicates. Several have the wrong type (spreadsheets tagged Test Scores). See the decision list. |
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
| Governance | **Board documents uploaded; no boards and no meeting feature** | Production has 0 boards and 0 seats. The 7 board documents are in Documents, readable by Admins only (by design the Viewer role reads no documents). There is no meeting materials feature in the app. Building one is a new feature and needs a decision. |
| Doc AI | **Full flow already run on production by davefisher813@gmail.com** | The activity log shows it on Oct 8 and 9: uploaded, Needs Review, 42 Mark Ready, Archive, Unarchive, typed reading (Processing, then Needs Review), and "Did not look like" refusals kept with their reasons. No orphans: 0 files without a row, 0 rows pointing at a missing file, 0 stuck in Processing. The bucket's size limit on production is 50 MB, not 10 MB (changed outside the migrations). The app still enforces 10 MB. |

## 4. Content

| Item | State | Evidence |
|---|---|---|
| Headshots (4) | **Not possible in this app as built** | No photo field exists for any person (athlete, member, board seat). No photos were received. |
| Henry Tolentino as Asst Coach, Elite Squad NY | **Blocked: needs his email** | He is in the app only as an Enrolled Bridge athlete (alumni, Monroe University). A coach listing means an Elite Squad member account with the title "Asst Coach". |
| Karen Alvarez on the Development Board with a photo | **Not in the app** | No such person and no boards on production. Photos are not supported. |
| Dave once on /org/bridge/advisors | **True today** | Bridge has one member: Dave (davefisher813@gmail.com, Admin). |
| No placeholder or fake names | **Clean** | No lorem ipsum in the code. Production data has no test names. The fixture's invented names exist only in tests. |
| View As hidden | **Done** | 0047 not applied; no View As screen in `main`. |
| Spanish toggle | **Done** | No language toggle exists in `main`. |
| Elite Squad hidden | **Not done: waits on Gate 1 item 7** | Elite Squad has 0 athletes and 1 document. Dave is an Admin there with both accounts, so it shows in his organization picker. |

## 5. QA

| Item | State | Evidence |
|---|---|---|
| Gate on `main` | **Pass** | `npm run qa:check` on d1da4b8: 2,449 tests across 83 files, production build, lint (secret scan, em dash), types. |
| Phone widths, dead buttons, links | **Pass** | `scripts/live/check.sh` on `main`: 186 screens at 320, 375 and 390 in light and dark, 0 findings, 302 links followed, 0 broken, no new surface that goes nowhere. |
| Forms | **Pass in tests** | Every server action is run by `src/laws/actionRun.test.ts` and `otherActions.test.ts`, including the refusal paths. |
| Real-account role test | **Not run** | Needs a sign-in per role on production. There is one account (Dave, Admin). `scripts/access/probe.mjs` exists for it and runs only with Dave's approval. |

## 7. Handoff

| Item | State |
|---|---|
| Live URL | Working (see 2). |
| dave@bffsa.org as Admin of Bridge | **Not yet.** dave@bffsa.org is an Admin of Elite Squad only. Adding it to Bridge while davefisher813@gmail.com stays would put Dave on Advisors twice. Needs the swap decision below. |
| Runbook | `docs/RUNBOOK.md`. |

## Decisions for Dave (in addition to the seven Gate 1 items)

1. **Bridge Admin account:** add dave@bffsa.org to Bridge as Admin and take davefisher813@gmail.com off Bridge? This is the only way to meet both "Dave once on Advisors" and "dave@bffsa.org is Admin".
2. **Documents cleanup:** unarchive the 16 prepared files and archive the 17 Oct 9 duplicates? This is a list of taps in the app, nothing is deleted.
3. **Ricky Perez and Frailyn Capellan:** add them as Bridge athletes?
4. **Henry Tolentino:** his email, to invite him to Elite Squad as "Asst Coach".
5. **Headshots and the Development Board:** these look like content for the public site, not this app. If they belong here, adding photos is a new feature.
6. **Meeting materials:** a new governance feature, or are the board documents in Documents enough?
7. **Backups and point in time recovery** on Supabase: still unconfirmed.
8. **Bucket size limit:** set back to 10 MB to match the app, or leave it at 50 MB?
