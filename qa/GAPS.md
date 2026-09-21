# Gaps

What the QA layer does not protect, and what it found and did not fix,
because this pass adds the harness and nothing else (Clemenza,
2026-09-20). Severity: High means a reviewer should not merge without a
decision; Medium means a known hole with a workaround; Low means worth
knowing. Each entry names a file and line.

## The test data rule

**High. The approved-values check cannot tell a synthetic value from a
real one.** `qa/check.js` fails on a personal detail value in
`src/testing/fixture.ts` or a SQL seed that is not in
`qa/approved-values.json`. It cannot know whether a value somebody adds to
that file was invented or copied. The only real guard is that no fixture
value is ever copied from the production database, and nothing here
enforces that: not the gate, not the publisher, not a law. Anyone adding
an entry to `approved-values.json` is asserting it is invented, and the
reason line is where they say so. State of the set today: one birthdate
(`2009-04-02`) and two school names, all invented, all on Fixture Athlete.

**Ruled, 2026-09-20 (Clemenza).** The rule is read narrowly and applies to
real minors. The earlier `minor-school` rule fired on the presence of a
`school_name` field, not its value, and would have fired forever; deleted.
The fixture birthdate stays: `src/lib/data/loadEligibility.ts:85` selects
it and `:188` passes it into the age clock, so the eligibility screens and
the 88 page render assertions depend on it. Screens that show an athlete
beside a college are the product, not a finding.

## Job 1, the git link

**Closed 2026-09-21.** The Vercel project is git connected. Proven by a
push, not a dashboard: commit `e61b84a` to `main` built and deployed on
its own with `meta.githubCommitSha` equal to the pushed commit. Pushes
before the link (`953f44e`, `fd7a11f`, `b0d88ed`) never deployed, which
is expected; `main` and production are level from `e61b84a` on.

## Not covered by the gate

**Medium. The row level security suite is not in the gate.**
`scripts/run_rls_test.sh` needs a local Postgres and is run by hand. A
migration that opens a table to another org would pass `qa:check`.

**Medium. No test posts a form through a real Supabase.** Every action
runs against `src/testing/fakeSupabase.ts`. Sign-in, the magic link, the
invitation email and the Storage upload are unverified by machine; the
checklist covers sign-in by hand and only against the fixture build, which
has no auth. One action uses `.ilike()` (`src/lib/actions/documents.ts:656`),
which the fake does not implement (`src/testing/fakeSupabase.ts:207`), so
that path is not executed by any test.

**Medium. Vercel installs devDependencies at build time.** Next needs
`typescript`, `tailwindcss` and `postcss` to build, so the install brings
every devDependency, `playwright` included (`package.json:26`). Checked:
`playwright` 1.63 has no install script (`node_modules/playwright/package.json`
has no `scripts`), so nothing downloads a browser. The build stage records
this as a warning if that ever changes. Belt and braces: set
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in the Vercel environment.

**Medium. iOS is unverified.** The preview and the checklist run in
Chromium. Native date and select controls, the status bar and the home
screen web app are what Dave sees and what no machine here can render.

**Medium. The boot probe runs on placeholder Supabase values.** It proves
the built app starts and sends a stranger to sign in. It cannot prove a
real session survives the middleware (`src/lib/supabase/middleware.ts`).

**Low. The published report trails its commit by one.**
`qa/reports/latest.json` is committed, so the report names the commit it
ran on, which is the parent of the commit that carries it. The publisher
refuses a report from a dirty tree, which is the guard; the convention is
written in `qa/README.md`. The first report on this branch said
`"branch": "main"` because the gate ran on a local `main` before the
commits were moved to the review branch; the report now records every
remote branch that contains the commit and whether there is one, so a
commit that shipped nowhere says so.

**Low. Em dash debt, baselined.** `src/laws/laws.test.ts:29` and `:33`
carry two em dashes on purpose: the law names the character it forbids.
Recorded in `qa/baseline.json`; touching the file requires cleaning it.

**Low. No region filter on matches.** `src/components/MatchFilters.tsx:66`
filters by state only; the contract said state or region. Needs a state to
region table. Already on the roadmap.

**Low. The matches screen filters in memory.**
`src/app/org/[slug]/roster/[id]/matches/page.tsx` loads every stored fit
and every school row for the athlete and filters in the request. Fine at
hundreds of schools; worth a query when the table passes a few thousand.

**Low. `scripts/live/` and `scripts/preview/` overlap `qa/preview.mjs`.**
Three ways to drive the app in a browser. Not consolidated in this pass.

**Low. The publisher was not exercised against GitHub from here.** This
session cannot push to `davefisher813/basecode-qa`. `QA_PUBLISH_DRY_RUN=1`
stages the folder and runs the scan; the push path is the same code as
jarvis-backend's and is unverified on this repo until Dave runs it.
