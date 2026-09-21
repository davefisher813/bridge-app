# Current state

Last updated: 2026-09-21, after the family role's data model shipped.
Replaced wholesale when this changes meaningfully, never appended to.

**One-line summary.** The matching feature exists: a metrics log,
staff grades, a goal and budget on the athlete, every athlete scored
against every school and stored, a matches screen with filters and Add
to Board, CSV import of schools, the org's scoring preset, Strong
Matches on Today. The family role exists in the database (a fourth
`org_role`, a guardian link per athlete, row rules proven by the RLS
suite) and in the invite flow; its screens wait on Dave's catalog picks.
Fifty-seven screens on one kit, the laws green, the app itself driven
in a browser at 320, 375 and 390 in both themes with nothing past the
edge.

---

## Where everything is

- **Code:** `github.com/davefisher813/bridge-app`, branch `main`. The
  repo name is a stand-in like the product name.
- **Production:** Vercel project `commit-app`, URL
  `https://commit-app-nu.vercel.app`, git connected to this repo since
  2026-09-21 (Alfred): every push to `main` builds and deploys on its
  own. Vercel Authentication is off; the app's own sign-in is the gate.
- **Database:** Supabase project `Bridge-app` (ref `emllcefqxyxyhqolrllo`,
  us-west-2). 21 migrations applied, 0021 (matching and metrics) on
  2026-09-20. 30 tables, RLS on every one.
- **Accounts:** dave@bffsa.org and davefisher813@gmail.com, both owners
  of both orgs, both with the same password. Password is the first
  screen; the magic link sits behind "Email me a link instead".

## What exists

**57 pages**, 21 migrations, 729 tests in 46 files, 13 law files.

### The kit, 2026-09-19, and the catalog picks, 2026-09-20

`src/components/kit/` is the whole vocabulary a screen has: four text
sizes, one spacing step, one radius, paper surfaces with a hairline
border, filled 16px inputs with hints instead of placeholders, outlined
secondary buttons, a confirm sheet before a delete, a fixed tab bar, a
theme that follows the phone, Title Case on every title. The contract
is docs/STYLING_CATALOG.md; `src/laws/kitLaws.test.ts` fails the build
on a page that styles anything itself. `tailwind.config.ts` replaces
the theme, so a class outside the scale does not exist. The old
catalog, the form style constants and the six preview generators are
deleted.

### Recruiting

The core of the product and the part that would lift out into a
standalone app. `src/lib/fit/` is walled off from Next and Supabase and
scores a target on four dimensions with a shared result shape, where a
veto overrides the blend rather than averaging into it.

Screens: roster and athlete profile, the board grouped by stage, a target
read view with its score broken down, one dimension in full, the contact
log, the school list and a school profile. Add and edit for athletes,
targets and schools.

### Matching and metrics, 2026-09-20

The most important function in the app, per Dave, built from his forty
picks in docs/MATCHING_CONTRACT.md.

- **Metrics log** (`/roster/[id]/metrics`): value, date, source; the
  position's metrics first on the form; the current number per metric
  with a sparkline and the entry that scores marked. The best number in
  the most trusted source tier scores, and that tier is the athletic
  confidence. Staff and owners log; anyone in the org reads.
- **On the athlete**: metric tiles, a goal (shifts the blend), a family
  budget and home state (net cost), five staff grades on the 20 to 80
  scale (blended into the athletic score by position group).
- **Stored matches** (`athlete_school_fits`): every athlete against
  every school, recomputed inside the action that changed an input,
  never on view. The board and target screens read the rows.
- **Matches** (`/roster/[id]/matches`): ranked, filters in the URL
  (division, state, conference, major, cost ceiling, scholarship type,
  playing time; sport sponsored always applies), Add to Board on each
  row, conflicts at the bottom saying what blocks them, partial scores
  saying which dimensions counted. The top five on the athlete page.
- **Schools**: a full form (program tier, state, majors, academics,
  money, depth), an owner edit screen, the org's private overlay (coach
  contact, positions of need that boost a matching athlete, notes), and
  a CSV import from `public/templates/schools.csv` that lists every
  problem by line and imports nothing until the file is clean.
- **More**: the scoring preset (Money First is the default) and
  Recalculate All, owner-only. **Today**: Strong Matches, one row per
  athlete with a new Safety or Fit not yet on the board.

Every number is in `src/lib/fit/contract.ts`; `src/laws/matchingLaws.test.ts`
and twelve bench checks read the same file.

**NCAA eligibility** is researched rather than recalled, cited in
docs/BUSINESS_RULES.md against NCAA-published documents. Core-course GPA,
qualifier status, the D1 10/7 rule, the age-based five-year clock.
Screens: the verdict, the transcript, per-course approvals, the caveats.

**Grading scales and approved-course lists** are the two inputs that make
a core GPA real rather than assumed. Shared reference data behind the
service role, plus an org-scoped table the org writes itself.

### Fundraising and board governance (module-gated, off by default)

Gifts, pledges, donors, campaigns, grants, budget; boards, seats,
give/get. Bridge has both on, Elite Squad neither.

### Doc AI

Ingest in the browser, upload to a private Storage bucket under the
org's folder, then triage, extraction, Zod validation, roster matching,
confidence, routing, versioning, undo on the server. Runs end to end on
a scripted stand-in model, and every screen showing a result says so.

### Around the pages

Error, not-found and loading screens at the root and inside the org
chrome. Viewport and Apple web app metadata, a manifest, and icons
generated at build from the stylesheet's own tokens. `src/proxy.ts`
(Next 16's name for the middleware) refreshes the session.

### Membership

Owner-only, under More. The members list, an invite form, and a
one-person screen to change a role or remove access. An org can never
be left without an owner. "Invited" is read off a mirror of
`auth.users.last_sign_in_at` kept by the profile trigger.

### The family role, 2026-09-21, data model only

A fourth `org_role`, `family` (migration 0022), linked to athletes
through `athlete_guardians` (0023): one row per person per athlete, a
trigger that refuses a row whose athlete or person is not the org's.
Every `_read` policy on athlete data (athletes, metrics, stored
matches, courses, targets, visits) admits the family's own athlete; the
org's grading scales and approved lists are readable so the eligibility
screen can explain itself; `private._member_org_ids()` now excludes the
family role, so communications, contacts, documents, private school
notes, fundraising and governance stay closed. A family member writes
nothing. The users policy shows a family member the org's owner and
staff and never another family. All of it is asserted in
`scripts/rls_test.sql` (118 PASS lines) and the suite fails when the
exclusion is removed.

In the app: the invite form offers Family with an athlete picker, the
action writes the membership and the guardian link through the service
role, a role can never be changed to or from family (remove and
re-invite), and a family member's page names the athlete they see. A
family member is refused by every existing org screen, since each one
checks the three org-wide roles. What a family member sees is decided
by the Family Access catalog (published 2026-09-21); no family screen is
built until Dave picks.

---

## How it is verified

1. **Unit tests** over the pure modules.
2. **Laws** (`src/laws/`, 13 files) encode the rules from CLAUDE.md,
   BUSINESS_RULES.md, STYLING_CATALOG.md and MATCHING_CONTRACT.md as
   executable checks, each planted, watched to fail, and reverted
   before it counts.
3. **The RLS suite** (`scripts/run_rls_test.sh`) applies every migration
   to a real Postgres and runs its assertions as a non-superuser role.
4. **The page render harness** executes every page in
   `src/testing/pages.ts` against a fake client.
5. **The action harness** executes every server action and asserts what
   it wrote.
6. **The preview and its audit** render the same page list on the
   fixture into one tappable file, in the app's own font, and inspect
   what a browser computed on every screen in both themes at 390, 375
   and 320: classes that exist, glyphs that draw, AA contrast on the
   real surface, 44px targets, no sideways scroll, nothing past the
   edge, no word broken in the middle.
7. **The app itself, in a browser** (`scripts/live/`). `FIXTURE_MODE=1
   next build` swaps the two Supabase seams for the fixture and nothing
   else, so the shipped app runs with its real font, hydration and
   chrome; `drive.mjs` opens every route at 320, 375 and 390 in both
   themes and measures the same things the audit does, plus
   screenshots. Added 2026-09-20 after the preview's system fallback
   font hid overflows that Inter causes.
8. **The test bench** runs the shipped engine modules in a browser and
   proves its own checks.
10. **The QA gate** (`qa/`, signed off by Clemenza 2026-09-20).
   `npm run qa:check` runs tests, the production build with a boot on
   placeholder env, the house rules (em dash ratchet, secret shapes, the
   test data rule against `qa/approved-values.json`) and types, with no
   browser, and writes `qa/reports/latest.json`. `npm run qa:preview`
   shoots sign-in, the email page, the org picker and Today at 390px in
   both themes. `qa/publish.js` sends the evidence to the public
   `basecode-qa` repo after a secret scan that refuses on any hit.
   `qa/GAPS.md` lists what none of this covers.
9. **The real project.** Supabase's advisors and the deployment.

---

## What does not exist

### Owed by Dave (dashboard settings no tool here can reach)

- **Supabase Auth URL configuration** for magic links and invitations,
  and the email templates on `token_hash`. Steps in
  docs/SETUP_CHECKLIST.md. Password sign-in does not need them.
- **Leaked-password protection** in Supabase Auth. One toggle.

### Blocked on Dave

- **The page-by-page audit** of the rebuilt app on his phone. Dave
  reported text off the screen after the catalog picks landed; the
  real-app check found and fixed a nowrap trailing that could squeeze a
  row title to nothing, stat tiles that broke a word or a figure, and
  the stepper's last label at 320, but nothing past the edge at 375 or
  390. One screenshot from his phone is the missing input.
- **No API key for Doc AI.** The model caller is a stand-in.
- **The name.** "BFFSA" is what the app calls itself for now.

### Known and deliberate

- **`org_members` has no write policy.** Every membership write goes
  through the service role behind `requireOwner()`.
- **`schools` is writable only by the service role**, with
  `requireOwner()` as the actual gate.
- **The preview shows fixture data and does not post forms.** What a
  render cannot show, the bench does with the real modules.

### Not yet done, not blocked

- The database has no schools, no transfer windows and no benchmark
  sets. The CSV import exists now; the schools themselves are Dave's
  Google Sheet exported to the template.
- No search or filter on any list except the matches screen.
- Region is not a filter yet, only state; a region needs a state table.
- No family screens yet: a family login is refused by every org screen
  until the catalog picks are in (contract section 5).
- The fake client does not implement `.or()` or `.ilike()`; one action
  uses each.
- `@supabase/ssr` 0.5 and `zod` 3 are both a major behind.
- A stat tile has no sub-line and a row has two lines; the few captions
  that lost a home moved into a meta line or a note beside them. Worth a
  look during the audit.
- Below about 300px of layout width (Safari's page zoom at 150%) row
  titles start breaking mid-word; the live driver reports it at 260 and
  the kit does not yet stack a row's trailing under its body.
- No WebKit here. The live check runs in Chromium; iOS-only rendering
  (native date and select controls) is unverified until a screenshot
  says otherwise.

---

## Immediate next steps

1. Dave exports his school sheet to the template and imports it, then
   logs a first metric and reads a real match. The three interpreted
   numbers (strike target, grade weights, preset weights) get revisited
   on what he sees.
2. Dave's page-by-page audit of the new screens on his phone.
3. Dave's picks in the Family Access catalog, then the family screens.
4. Cleanup pass: one page loader, `cache()` on the org and user lookups,
   split `documents.ts`, then the `@supabase/ssr` and `zod` bumps.

See docs/ROADMAP.md for the rest.
