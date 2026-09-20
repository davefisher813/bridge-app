# Manual check: the QA layer on the fixture build

Commit: 8831012 (the commit this change is built on; the change itself is the next commit)
Date: 2026-09-20
Checked by: Claude Code, in the repo, driving the FIXTURE_MODE build in headless Chromium at 390px, light and dark
QA report: qa/reports/latest.json
Preview: qa/previews/qa-layer/, 8 shots
Result: fail

Every "Actual" below is what the browser reported, not what the code
says it should do. Sign-in itself is not exercised: the fixture build has
no auth, and no real credentials are used from this machine.

## Steps

| # | Do this | Expect this | Actual | Pass |
|---|---|---|---|---|
| 1 | Open `/login` | Sign-in with a password field, the Bridge lockup, and "Email Me a Link Instead" | 200; one password field; toggle present; `data-theme` light then dark | pass |
| 2 | Open `/login?mode=link` (the email page) | An email field, "Email Me a Link", no password field | 200; one email field; zero password fields; button present | pass |
| 3 | On `/login`, tap "Email Me a Link Instead" | The form switches to email without a reload | password 0, email 1 after the tap | pass |
| 4 | Sign in with a wrong password | An error, no session | Not run: needs a real Supabase; the fixture build has no auth | not run |
| 5 | Open `/` (first screen after sign-in, two orgs) | "Choose an Organization" with both orgs | 200; two org rows; wordmark on the org that has one | pass |
| 6 | Open Today (`/org/bridge-fixture`) | Greeting, three stat tiles, sections, the wordmark top right, four tabs, nothing past the frame | 200; greeting; tabs Today, Athletes, Board, More; wordmark at x 305 y 12; document width 390 | pass |
| 7 | Athletes, then Fixture Athlete, then Metrics, then back, then See All Matches | Each screen opens by tapping, not by typing a URL | roster, athlete, metrics, matches all reached by tap; matches link reads "See All 2 Matches" | pass |
| 8 | Open Board, Schools, More | Each renders | 200, 200, 200 | pass |
| 9 | Dark mode | Every screen above in dark, from the phone's scheme, no forced theme | all of 1 to 8 repeated with `colorScheme: dark`; `data-theme` reads dark | pass |
| 10 | Console | No page error on any screen | none, light or dark | pass |
| 11 | Run `qa:check` on a machine with no browser | Green with no Chromium involved | tests, build pass; lint fails on the test data rule (three findings, all in `src/testing/fixture.ts`); types not run because lint stopped it; nothing in the run touched a browser | fail, see GAPS.md |
| 12 | Break a test, run `qa:check` | Red at the tests stage, later stages not run | see the final message: planted a failing assertion, tests FAIL, three stages not run, reverted | pass |
| 13 | Read every preview shot for the test data rule | Minors by name and role only | Today shows "Fixture Athlete" and "Fixture Transfer" beside the colleges they match; sign-in and the picker show no minor | fail under the rule as written; see GAPS.md |
| 14 | Read every preview shot for a secret | None | none: placeholder org, no key, no address, no phone | pass |

## The standing rules

- [x] No secret printed, logged, committed, or visible in any screenshot. The publisher's scan runs before every push and refuses on a hit.
- [ ] Minors appear by name and role only. The fixture carries one birthdate and two school names on a minor, and Today puts a minor's name beside a college. Recorded in GAPS.md, not fixed here.
- [x] No em dashes. The lint stage's ratchet passed on every touched file.
- [x] No app behavior changed. The diff is `qa/`, two package.json scripts and two gitignore lines.

## What I would tell Dave in one line

The gate, the preview and the publisher exist and run; the one red light is the test data rule, which the fixture breaks in three places, and that is a decision, not a fix.
