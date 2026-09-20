# QA

The gate every change passes before it reaches Dave. Same shape as the
jarvis-backend QA layer, on purpose: one machine gate, one manual
checklist, one preview script, one publisher, and a list of what none of
them cover.

```
npm run qa:check                  # the four stage gate, writes the report
npm run qa:preview -- <task>      # 390px screenshots, light and dark
npm run qa:publish                # push the evidence to basecode-qa
```

`qa:check` and `qa:preview` are deliberately separate. The gate runs green
on a machine with no browser installed and imports nothing from the
preview, so a missing Chromium can never turn it red. Both exit nonzero on
failure, so either can gate a push later with no rewriting.

## What passing means

| Stage | What it proves | Pass |
|---|---|---|
| tests | every test ran and passed | Vitest reports failed 0, skipped 0, todo 0, and every `*.test.ts` under `src/` loaded and ran at least one real test |
| build | it would actually deploy | the lockfile resolves, `next build` compiles for production (not the fixture), the built app boots on placeholder env, `/login` and `/unauthorized` answer 200, `/` and an org route redirect a stranger to `/login`, and the boot log says nothing alarming |
| lint | the standing rules hold | no em dash outside the baseline, no secret shape anywhere the repo owns, no `.only` in a test, every personal detail value in the fixture and the SQL seeds is in the approved set, the boot allowlist and the approved set are well formed |
| types | the types check | `tsc --noEmit` is clean |

Stages run in that order and stop at the first failure. The laws in
`src/laws/` (the kit, the copy, the fit engine, the schema) run inside the
tests stage; this file does not duplicate them.

Then two things a machine cannot do:

- **The checklist**, `qa/checklist.md`. Walk the steps on a phone, record
  what really happened, put the commit it was built on in the `Commit:` line
  and `pass` or `fail` in the `Result:` line. The report reads both. A green
  `qa:check` with a red checklist is a FAIL. A checklist for some other
  commit makes the verdict `provisional`, and the report says so.
- **The preview**, for anything with a screen. `qa:preview` builds the app
  with `FIXTURE_MODE=1` (the two Supabase seams swapped for
  `src/testing/fixture.ts`, nothing else), starts it, and shoots sign-in,
  the email page, the organization picker and Today at 390px in light and
  dark. Shots land in `qa/previews/<task>/` and are recorded in the report.
  It needs Playwright's Chromium (`npx playwright install chromium`) or one
  named by `PW_CHROMIUM`. After it runs, `.next` holds the fixture build; the
  next `qa:check` rebuilds for production, and Vercel builds on its own
  machine, so nothing can ship it.

## The report

`qa/reports/latest.json`. Top level: the commit, the checked out branch,
every remote branch that contains the commit and whether there is one
(`shipped`), whether the tree was dirty, whether the commit is on
`origin/main`, the result, which stages did not run, every allowlist line
that fired, the manual verdict and the preview. A report for a commit on
no remote branch is evidence for nothing that shipped, and the run says so.
Then one block per stage with what it measured. Dated copies sit beside it
and are gitignored; only `latest.json` is committed, and it names the commit
it ran on, which is the parent of the commit that carries it.

## The boot allowlist

`qa/boot-allowlist.json`. Exact string match on the trimmed line, no
wildcards, every entry with a reason and a date. `check.js` refuses the file
if any entry contains `Error` or `Unhandled`, and names every entry that
fires in the report. It is empty today: the boot log is clean.

## The test data rule

Minors appear by name and role only. No ages, no birthdates, no schools,
no contact details, no photos. The hard line protects real minors; every
person in the fixture is synthetic (Clemenza's ruling, 2026-09-20). So the
lint stage does not forbid the fields, which would make the product itself
a violation (a school beside an athlete is the product, and the birthdate
drives the age clock the eligibility screens render). It requires every
personal detail value on an athlete, course, contact or metric row in
`src/testing/fixture.ts`, and in every `insert into athletes` in a SQL
seed, to come from `qa/approved-values.json`: a checked in set of invented
values, each with a reason and a date, same discipline as the boot
allowlist. The rule fires on an unapproved value, which is what would
indicate real data leaking in. It cannot tell an invented value from a
real one that somebody approved; see `qa/GAPS.md`. What a screenshot
shows is a checklist item, checked by a person.

## The publisher

`qa/publish.js` copies `reports/latest.json`, `checklist.md`, `GAPS.md` and
`previews/<task>/*.png` into a clone of `davefisher813/basecode-qa` under
`bridge-app/<YYYY-MM-DD>-<task>/`, commits and pushes. Before it pushes it
scans the exact bytes it is about to send for the shape of a secret, for the
value of every secret looking variable in its own environment, and for the
terms in `qa/publish-deny.txt` (local, gitignored, from
`publish-deny.example`), and refuses on any hit. It also refuses a report
from a dirty tree. `check.js` calls it at the end of every run;
`QA_PUBLISH=0` skips that, `QA_PUBLISH_DRY_RUN=1` stages without pushing.

## The baseline

`qa/baseline.json` records em dash debt that predates the gate, per file.
A file this change touches must be zero. An untouched file must match its
number exactly. Everything else must be zero. One file is listed: the law
that forbids em dashes names the character it looks for.

## What is not covered

`qa/GAPS.md`, with a severity and a file reference for each.
