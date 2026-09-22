# Current state

Last updated: 2026-09-22, after the board member's own version, the
staff-side gaps (invite family, seat sign-in, transfer windows, search)
and the region filter.
Replaced wholesale when this changes meaningfully, never appended to.

**One-line summary.** Three logins, each with their own app on the same
database: staff run recruiting, fundraising and governance; a family
sees one athlete read only; a board member sees the program as stages
and their own seat. The matching engine scores every athlete against
every school and stores it; Doc AI reads a document into the right
place and is hardened against misreads; every list over five rows has a
search; matches filter by region as well as state; an owner enters the
NCAA transfer windows as data. Seventy-seven screens on one kit, 1,108
tests green, the app itself driven in a browser at 320, 375 and 390 in
both themes with nothing past the edge.

---

## Where everything is

- **Code:** `github.com/davefisher813/bridge-app`, branch `main`. The
  repo name is a stand-in like the product name.
- **Production:** Vercel project `commit-app`, URL
  `https://commit-app-nu.vercel.app`, git connected to this repo since
  2026-09-21 (Alfred): every push to `main` builds and deploys on its
  own. Vercel Authentication is off; the app's own sign-in is the gate.
- **Database:** Supabase project `Bridge-app` (ref `emllcefqxyxyhqolrllo`,
  us-west-2). 33 migrations applied, 0033 (the member summary functions
  are for signed-in callers only) on 2026-09-22. RLS on every table.
- **Accounts:** dave@bffsa.org and davefisher813@gmail.com, both owners
  of both orgs, both with the same password. Password is the first
  screen; the magic link sits behind "Email me a link instead".

## What exists

**77 pages**, 33 migrations, 1,110 tests in 51 files, 13 law files,
129 PASS lines in the row-level-security suite.

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
- **On the Add Athlete form**: a First Metrics section, the sport's
  metrics with the position's first, one date and one source, each
  number logged as an entry when the athlete is saved (Dave,
  2026-09-21: metrics while the profile is built, not after).
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
confidence, routing, versioning, undo on the server. With no API key on
the server it runs on a scripted stand-in model, and every screen
showing a result says so.

The real caller exists since 2026-09-21 (`src/lib/ai/anthropicCaller.ts`,
outside the walled module): the official SDK, each file as a document or
image block, a refusal or a cut-off answer filed as a failed extraction,
and every call's tokens and cost written to `docai_usage` (migration
0025). Triage runs on Haiku 4.5, extraction on Opus 5. An org has a
monthly cap in cents on its row, $20 by default, set by an owner under
More; the upload action refuses to start once the calendar month's
ledger reaches it, and the More screen shows the month against the cap.
The action picks the real caller the moment `ANTHROPIC_API_KEY` is set
on the server; nothing else changes. No key is set on Vercel yet.

Hardened against misreads (2026-09-21, later the same day): every
schema field reads what a model actually sends (quoted numbers, slashed
dates, "N/A", hyphenated enums) while still refusing a value with no
meaning; a plausibility pass drops a metric in the wrong unit, a test
total the agency cannot score, a future date, and holds anything
doubtful for a human; every warning is shown on the document under
What It Flagged; a pinned upload naming somebody else goes to review;
the detect path runs one triage; a failed model call stops the reading;
apply and discard are claimed so they happen once; a crash leaves a
failed row; the stub reaches every category's screen. A second pass
walked every scenario from the phone: camera photos now go in (HEIC
no longer listed, so iOS converts; photos scaled to 2000px; cap 10MB,
migration 0029); the same file twice is refused by hash; API errors
read as what to do; a killed reading shows as stuck and can be
cleared; a college transcript keeps its GPA and leaves its courses; a
metric from the wrong sport is left out and named. See
docs/ARCHITECTURE.md, "Hardened against misreads" and "The second
pass".

Every type applies now (2026-09-21), not only the transcript: test
scores onto the athlete (best SAT and ACT), an offer letter onto the
board (the college as Offer, with type, percentage and coach), an award
letter onto the same college as the net cost the financial score uses
(migration 0027), a recommendation letter as a contact, and a metrics
report (a PBR or Perfect Game profile, a Premier report, a showcase
sheet, a dashboard screenshot; migration 0028 adds the type) as dated,
sourced entries in the metrics log, the source read off the report so
its trust is right. Each is undone by discard, each is proven by an
action law, and the document screen says what applying and discarding
do for each type.

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

### The family role, 2026-09-21

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

Migration 0024 adds the two reads Dave's picks needed: the org's owner
and staff rows (who to ask) and documents bound to their athlete.

The screens, from the Family Access catalog (Dave's twelve picks,
2026-09-21): athlete and parents each get their own login; one login
can be linked to more than one athlete; the athlete's page is home and
lists the picker only when there is more than one; three tabs (Athlete,
Colleges, More); every match shows its score, tag, four dimensions and
every reason; Colleges shows status, score and visits and never staff
calls, notes or the coach's contact; their own documents are listed
read only; nothing is editable; More lists the owner and staff with
emails. The role is called Family. Under `/org/[slug]/family`: home,
the athlete, matches and one match, colleges and one college, More.
The eligibility, transcript, approvals, caveats and metrics screens are
the roster's own pages served under `/family`, building their links
from `athleteHome()` so a family never lands on an org screen. The
tab bar follows the role (`Chrome tabs`). Today sends a family login to
`/family`.

In the app besides the screens: the invite form offers Family with an
athlete picker, the action writes the membership and the guardian link
through the service role, a role can never be changed to or from family
(remove and re-invite), and a family member's page under Members names
the athletes they see. The render law renders every family screen as
the fixture's family login (two athletes linked), proves an owner
cannot open them, that a family login cannot open any org screen, that
the shared athlete screens carry only family links and no form for a
family, and that an unlinked athlete is not found. The live driver
opens the family routes as the family login through a `fixture_user`
cookie the fixture server reads.

Invite Family now sits on the athlete's page, which is where Dave
picked it (2026-09-22): a staff member opens Invite Family, the athlete
is pinned rather than chosen from a list, the form asks who the person
is (parent, guardian, the athlete themselves, other), and the invite
comes back to that athlete's page with a line saying what was sent. The
relationship is written on the guardian link. Staff may invite a family
and nothing else; every other role is still an owner's to hand out. The
athlete's page lists the family it already has, and an owner can open
each one.

### The member role's own version, 2026-09-21

Bridge calls the third role Board. Until today a Board login saw every
screen a coordinator sees, read only. From the Board Access catalog
(Dave's ten picks): the program first, then their seat; four tabs
(Home, Program, Giving, More; no Giving without the fundraising
module); athletes as names and stages, never grades or numbers; each
athlete's schools and stages, never calls or notes; fundraising as the
year against budget and the campaigns, never donor names; their own
seat with the whole give/get account and every gift credited to it;
the board's total without names; nothing editable; More lists who to
ask. Migration 0031 enforces it from the database side: a member reads
no org rows and gets three summary functions instead (129 PASS lines
in the RLS suite). The screens live under `/org/[slug]/member`; Today
sends a member there; every org screen refuses the role; the render
law proves a member opens member screens and nothing else, that staff
cannot open them, and that no GPA, score, metric, call note or donor
name appears on them. The recruiting board is now called Targets in
the tab bar and on its screen (Dave: "most won't get what that means").

### The staff-side gaps, 2026-09-22

The four things staff could not do from inside the app, and the two
that made a long list unusable.

- **Invite Family from the athlete** (above).
- **A board seat points at a sign-in.** `board_members.user_id` is what
  `member_giving()` reads to decide whose seat is whose, and nothing
  ever set it. A seat's page now links or unlinks a sign-in: the person
  must be an owner, staff or member of this org (a family login cannot
  hold a seat), and one sign-in holds one seat, so a board member's own
  Giving screen can never show somebody else's give/get.
- **Transfer windows are enterable.** NCAA portal dates are data, never
  code (CLAUDE.md), and `src/lib/fit/transfer.ts` reports timing as
  unverified when no window matches. An owner now adds one under More,
  Reference: sport, division, season, label, the two dates and a source
  URL, which is required. The same window twice is refused, by a unique
  index (migration 0032) as well as by a check in the form, so two
  owners writing at the same moment cannot both get through. Windows are
  shared reference data, so the write goes through the service role
  behind `requireOwner()`, like schools.
- **Search on every long list.** A field appears once a list passes
  five rows, and stays while a term is in the address so the way back
  is never the browser's own bar. The roster searches name, sport and
  position; Schools name, division and conference; Targets the athlete,
  school, sport and coach; Documents the file name, type and athlete;
  Donors name, type and address; Gifts the donor and campaign, on top
  of whatever category or method filter is already on. The term lives
  in the URL, so a filtered list can be shared, and each screen has its
  own empty state for a term nothing matches.
- **Region on the matches screen.** Seven regions derived from the
  school's state in `src/lib/fit/regions.ts` (data, never stored), next
  to the state filter rather than replacing it.
- **The fake Supabase client understands `.ilike()` and `.or()`**, with
  PostgREST's meaning (case-insensitive, `%` as any run of characters,
  an anchored pattern, alternatives that narrow alongside the other
  filters), so an action that uses either can be tested.

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

- `ANTHROPIC_API_KEY` on the Vercel project (Settings, Environment
  Variables, production). Until it is there, document reading stays
  simulated and the More screen says so.

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

- **The three member summary functions are callable by any signed-in
  person**, which Supabase's linter reports and which is the point: a
  board member's own client calls them, and each one checks that the
  caller belongs to the org it was handed before it returns anything.
  What is not intentional, and was fixed on 2026-09-22 (migration
  0033), is that they were callable without signing in at all.

- **`org_members` has no write policy.** Every membership write goes
  through the service role behind `requireOwner()`.
- **`schools` is writable only by the service role**, with
  `requireOwner()` as the actual gate.
- **The preview shows fixture data and does not post forms.** What a
  render cannot show, the bench does with the real modules.

### Not yet done, not blocked

- The database has no schools, no transfer windows and no benchmark
  sets. The CSV import exists and the transfer-window form exists; the
  schools are Dave's Google Sheet exported to the template, and the
  window dates have to be read off an NCAA-published page rather than
  recalled, which is why none are seeded.
- `@supabase/ssr` 0.5 and `zod` 3 are both a major behind.
- A stat tile has no sub-line and a row has two lines; the few captions
  that lost a home moved into a meta line or a note beside them. Worth a
  look during the audit.
- Below about 300px of layout width (Safari's page zoom at 150%) three
  things still break a word in half: the journey stepper's Committed
  label, the eligibility section heading at 260, and one donor row title
  that misses fitting by a pixel. A row's and an option's trailing now
  wrap under the body instead, which took the live driver's count at 260
  and 300 from 72 to 14. Nothing breaks at 320 and above.
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
3. The first real family (the athlete first, then a parent or legal
   guardian) and the first real board login, each from the athlete's
   page and the seat's page respectively.
4. The current NCAA transfer windows, entered from an NCAA-published
   page, so transfer timing stops reading as unverified.
5. Cleanup pass: one page loader, `cache()` on the org and user lookups,
   split `documents.ts`, then the `@supabase/ssr` and `zod` bumps.

See docs/ROADMAP.md for the rest.
