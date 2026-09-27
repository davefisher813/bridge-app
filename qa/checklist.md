# Manual check: Stages 3 and 4 and the add, edit and delete audit, shipped

Commit: 8e1a9ea (the commit this revision is built on; the revision itself is the next commit)
Date: 2026-09-27
Checked by: Claude Code, driving the FIXTURE_MODE build of 8e1a9ea in headless Chromium at 390px, light and dark, plus read-only checks against the production database
QA report: qa/reports/latest.json
Preview: qa/previews/ship-2026-09-27/, 20 shots
Result: pass

Every "Actual" below is what the browser or the database reported. The
fixture build has no auth and rebuilds its synthetic data on every
request, so a save is shown by the action returning cleanly; the write
itself is proven by the action laws (src/laws/actionRun.test.ts). Test
data is synthetic only; minors appear by name and role only.

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Owner opens an athlete profile | Advisor, Messages, Check-Ins rows, outcomes, targets | rendered, 0 page errors, light and dark | pass |
| 2 | Owner assigns an advisor and picks a high school on Edit, saves | Back on the profile, no error | redirected to the profile; advisor select and high school field accepted | pass |
| 3 | Owner logs a check-in | The log screen, form cleared, no error | returned to Check-Ins with the form cleared; entries carry Edit and Remove | pass |
| 4 | Owner sends a message | The thread, no error | returned to Messages, no error | pass |
| 5 | Owner edits a contact, then removes one | Edit saves; Remove asks to confirm, then removes | edit saved back to the profile; the confirm dialog opened and Remove completed | pass |
| 6 | Family opens their athlete and the thread | Your Advisor, Messages; no check-in or staff note text | both rendered; check-in note visible: false; staff note visible: false | pass |
| 7 | Family opens the staff check-ins screen by URL | Refused | /unauthorized | pass |
| 8 | Board member opens Home, Program, the staff check-ins and messages screens | Home and Program render; staff screens refused; no check-in note anywhere | Home and Program 200; both staff screens /unauthorized; check-in note visible: false | pass |
| 9 | Production: a signed-out visitor and a signed-in user in no org read every private table | 0 rows | 0 on athletes, check-ins, messages, notes, targets, contacts, coaches, org notes, documents, orgs, members, users; the shared school list readable when signed in only | pass |
| 10 | Production, inside a rolled-back transaction: a synthetic athlete with a check-in, a staff note and a message; a synthetic family login and board login | Family reads its athlete and message, 0 check-ins, 0 notes, 0 coaches; board reads none of them | family 1, 1, 0, 0, 0; board 0, 0, 0, 0; afterwards 0 synthetic rows remain | pass |
| 11 | Every screen at 320, 375 and 390, both themes, links followed | No finding, no broken link | 161 routes, 0 findings; 257 links, 0 broken | pass |
| 12 | Walk the live production app signed in, on Dave's phone | The same as 1 to 8 on real data | Not run: no sign-in to production from this machine, and fetching the live URL was not permitted in this session | not run |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot.
- [x] Minors appear by name and role only. Every person in the shots is synthetic.
- [x] No em dashes.
- [x] No app behavior changed by this revision: docs, the checklist and the preview shots only.
