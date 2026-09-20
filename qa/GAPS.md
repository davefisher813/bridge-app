# Gaps

What the QA layer does not protect, and what it found and did not fix,
because this pass adds the harness and nothing else (Clemenza,
2026-09-20). Severity: High means a reviewer should not merge without a
decision; Medium means a known hole with a workaround; Low means worth
knowing. Each entry names a file and line.

## Found by the gate on the current tree

**High. The fixture carries a birthdate for a minor.**
`src/testing/fixture.ts:116` sets `date_of_birth: "2009-04-02"` on Fixture
Athlete, a high school record. The test data rule says minors appear by
name and role only. The date feeds the NCAA five year clock on the
eligibility screen (`src/app/org/[slug]/roster/[id]/eligibility/page.tsx`)
and the fixture is what the page render law and the preview run on. The
clock's own law already uses an inline date (`src/laws/ncaaLaws.test.ts:79`,
`:159`), so the fixture does not need one for the rule to be tested; it
needs one for the eligibility screen to show the clock. Not changed here:
stripping it changes what that screen renders in the preview. Decision
needed.

**High. Two fixture course rows name the school a minor attends.**
`src/testing/fixture.ts:267` and `:268` set `school_name: "Fixture High
School"` and `"Unscaled High School"` on Fixture Athlete's transcript rows.
Same rule. The transcript screen and the grading scale match are built on
them. Decision needed, same as above.

**High. Screenshots show a minor's name beside a school.** Today lists
athletes with the college they are matched to or targeting
(`src/app/org/[slug]/page.tsx:193` and `:213`), and the preview shots
`qa/previews/qa-layer/today-light.png` and `today-dark.png` show "Fixture
Athlete" next to "Fixture College". The rule as written says no schools.
The product is recruiting: a target college beside an athlete is the
product. If the rule means the school the minor attends, not the colleges
being pursued, the shots are clean and the two fixture entries above are
the only findings. If it means any school, most screens fail it. The gate
enforces the narrow reading (birthdate, age, contact details, photos, the
school attended); the checklist records the wide one as a fail so nobody
decides by accident.

## Job 1, the git link

**High. The Vercel project is not connected to the repository.**
`get_project` on `prj_Nqm2BxgyLmwYvHAA4Rkdl4COLHx7` returns no `link`
block. Every production deployment so far was created through the API
from a commit on `main`, which is not the same as a git integration: a
push to `main` deploys nothing on its own. `vercel link` and `vercel git
connect` were not run: no Vercel CLI token exists on this machine, and the
API scope this session holds returns 403 when the team is named
explicitly. Dave connects it on his side.
`docs/CURRENT_STATE.md:20` says "deployed from `main`", which reads as a
git integration and is not one yet.

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
written in `qa/README.md`.

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
