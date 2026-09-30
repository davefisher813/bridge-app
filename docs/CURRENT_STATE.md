# Current state

Last updated: 2026-09-30. Stages 3 (advisors, messages, check-ins) and
4 (autofill, the high school directory, athlete notes) and the add,
edit and delete audit are deployed to production, with migrations
applied through 0040. The roles rework (three access levels with fixed
names, a Title per person, migration 0041) and Stage 5 Phases 1 to 3
(Matches, the advisor managed on the athlete's page, More as the
control center; migrations 0042 and 0043) are built and verified
locally, Phase 6 (the activity log, migration 0044) on top of them, and
Phase 4 (assignments, migrations 0045 and 0046) on top of that, and
Phase 5 (View As, migration 0047) on top of that, on branch
`claude/stage5-phase5-viewas`. Every phase of Stage 5 except Spanish
mode is now built and verified locally. Nothing past the Phase 6 merge
is committed or deployed.
Replaced wholesale when this changes meaningfully, never appended to.

**One-line summary.** Three access levels, each with their own app on
the same database: an Admin runs recruiting, fundraising, governance and
the org itself; an Athlete login sees one athlete and writes only
messages on that athlete's thread and its own assignment submissions; a Viewer sees the program as stages
and their own board seat. Every person can carry a Title (Head Coach,
Board Chair) that shows next to their name. The
matching engine scores every athlete against every school and stores
it; Doc AI reads a document into the right place and is hardened
against misreads; every list over five rows has a search; matches
filter by region as well as state; an owner enters the NCAA transfer
windows as data; enrolling an athlete closes their recruiting out for
good, everywhere it shows; every athlete can have an advisor on staff
who logs check-ins and talks with the family in the app; every record
can be corrected and removed where it lives, a pick fills what is
blank, staff keep notes on an athlete, an owner sets up the org and
anyone signed in with no other role can start one, and nothing the
stand-in reader read can ever be applied; an athlete's advisor is
assigned from the athlete's own page, More is grouped as the
control center, and an Admin can look at the app as an Athlete login, a
Viewer or another Admin, read only, for 30 minutes. 123 screens on one
kit, 2,348 tests green, the app itself driven in a browser at
320, 375 and 390 in both themes with nothing past the edge, no row or
tile that goes nowhere, and every link followed to a real screen.

---

## Where everything is

- **Code:** `github.com/davefisher813/bridge-app`, branch `main`. The
  repo name is a stand-in like the product name.
- **Production:** Vercel project `commit-app`, URL
  `https://commit-app-nu.vercel.app`, git connected to this repo since
  2026-09-21 (Alfred): every push to `main` builds and deploys on its
  own. Vercel Authentication is off; the app's own sign-in is the gate.
- **Database:** Supabase project `Bridge-app` (ref `emllcefqxyxyhqolrllo`,
  us-west-2). All 40 migrations applied, the last 0040 (high schools,
  athlete notes, window notes, `documents.read_by`, shared-directory
  editors, `create_org`) on 2026-09-27. Migration 0041 (staff to owner,
  `org_members.title`) is written and tested locally, not yet applied;
  on production it changes no row (four memberships, all owner). Bridge is the directory-editor
  org, set by a one-off statement. RLS on every table. The high school
  directory is empty: the loader (`scripts/load_high_schools.ts`) needs
  a machine that can reach nces.ed.gov.
- **Accounts:** dave@bffsa.org and davefisher813@gmail.com, both owners
  of both orgs, both with the same password. Password is the first
  screen; the magic link sits behind "Email me a link instead".

## What exists

**123 pages**, 47 migrations (40 applied), 2,348 tests in 76 files, 30 law
files, the row-level-security suite green through the 0047 block (270
PASS lines).

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
log, the school list and a school profile. Add, edit and remove for
athletes, targets, the contact log, visits, schools and coaches (see
Stage 4 below).

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
  never on view, with the net cost stored on the row (migration 0042,
  engine version 3). The board and target screens read the rows.
- **Matches** (`/roster/[id]/matches`, Stage 5 Phase 1, 2026-09-27):
  one ranking rule everywhere fits are listed (`src/lib/fit/rank.ts`:
  fully scored first, then partial, each by score, A to Z on a tie),
  a search by school name and a sort (Best Fit, Academic, Athletic,
  Financial, Net Cost, A to Z) in the address alongside the filters
  (division in NCAA order, region, state, conference, major, cost
  ceiling, scholarship type, playing time; sport sponsored always
  applies; a filter change keeps the search and the sort), a compact
  row ("D2 · 93 · Safety", or "Partial · 1 of 3 scored" first) with
  Add Target inside the row through the kit Row's `trailingAction`
  slot and the stage pill opening the target once one exists, 25 rows
  then Show More, conflicts at the bottom saying what blocks them. The
  athlete page shows the top ten under "N Schools Evaluated" with See
  All past ten; the family's Matches has the same search and sort and
  no target action; Today's Strong Matches headline follows the same
  rule. Distance is deferred until schools carry coordinates.
- **Schools**: a full form (program tier, state, majors, academics,
  money, depth), an owner edit screen, the org's private overlay (coach
  contact, positions of need that boost a matching athlete, notes), and
  a CSV import from `public/templates/schools.csv` that lists every
  problem by line and imports nothing until the file is clean.
- **More, Matching**: the scoring preset (Money First is the default)
  and Recalculate All, owner-only. **Today**: Strong Matches, one row
  per athlete with a new Safety or Fit not yet on the board.

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
on the server; nothing else changes. No key is set on Vercel yet. Since
2026-09-27 a document records who read it (`documents.read_by`), and a
stand-in reading can never be applied, even after the key is set.

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

Owner-only, under More, People. The members list, an invite form, and a
one-person screen to rename them, set their Title, change a role (to
and from family in place, links and all), assign the athletes they
advise (Assign Athlete, one at a time from a sheet, or several at once
from the tick list), or remove access. An org can never be left without
an owner. "Invited" is read off a mirror of `auth.users.last_sign_in_at`
kept by the profile trigger. Beside it, Advisors (every Admin) lists
each Admin with the number of athletes they advise.

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
nothing but messages on their own athlete's thread, their own read
marker (Stage 3, below) and an assignment submission (Stage 5 Phase 4,
below). The users policy shows a family member the
org's owner and staff and never another family. All of it is asserted
in `scripts/rls_test.sql` and the suite fails when the
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

Invite Athlete (formerly Invite Family) now sits on the athlete's page, which is where Dave
picked it (2026-09-22): a staff member opens Invite Athlete, the athlete
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

- **Invite Athlete from the athlete** (above).
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

### Everything that should open, opens, 2026-09-25

Dave, from his phone: "I can't click on anything pretty much ...
virtually anything should be clickable." Three things were wrong, and
all three are now measured rather than eyeballed.

- **The athlete screen was throwing.** It imported a plain array from
  the invite form, which is a client component, and a value exported
  from a client module reaches a server component as a reference rather
  than the value. Every test passed and the preview rendered, because
  neither has a client boundary in it. A law now fails the build on
  that import shape.
- **A row, a card and a stat tile now open what they are about.** A
  stat tile takes an href (the kit), so Today's three tiles open the
  roster and the targets at that stage; the athlete's metric tiles open
  the metrics log; the fundraising and governance tiles open the ledger
  and the seats. The stage line on an athlete opens that athlete's
  targets, which is what Targets learned to filter by (`?status=` and
  `?athlete=`). A course opens the approvals screen, a GPA card opens
  the transcript it is read from, a coach's address opens mail, a
  phone number dials, a logged call opens the log, a school's cost
  opens the form that corrects it, and an empty state carries the
  button that fills it.
- **A link inside a link** on the athlete screen (Edit inside a row
  that had just become a link) is invalid HTML: React refuses to
  hydrate the page and the tap lands on whichever of the two the finger
  covers. The live driver now fails on any tap target inside another.

`scripts/live/check.sh` runs the three browser checks in one command:
nothing past the edge, no row or tile that goes nowhere
(`qa/clickable-baseline.json`, 234 down to 55, and the 55 are records
with no deeper screen to open), and every link followed to a real
screen the signed-in person may open (116 links, none broken).


### The school directory, every role (Stage 2, 2026-09-26)

Every signed-in role can browse and search every school: staff at
`/schools`, a family at `/family/schools`, a member at
`/member/schools`, one implementation (`src/lib/data/schoolDirectory.ts`,
`SchoolDirectory`, `SchoolProfile`) under three guards. Search reaches
name, division, conference, state and city; Division, State, Conference
and Major dropdowns are built from the data, so no filter empties the
list on its own; the list runs A to Z. Staff see the schools they are
recruiting at first. A school shows everyone the shared facts (academics,
sports, majors, cost, D3 rule, depth chart, flags); coaches, the org's
notes and its athletes stay owner and staff only. Entry points: a row
on Today, member Home and Program, and the family athlete and Colleges
screens. No tab bar changed.

### Advisors, the family thread and staff check-ins (Stage 3, 2026-09-26)

Migration 0039. Nothing here changes what anyone may do; the advisor is
a name and a reminder, never a permission.

- **Advisor** (`athletes.advisor_id`): one of the org's Admins. A
  trigger refuses anyone else; removing a person or making them a
  Viewer clears it. Since Stage 5 Phase 2 (below) it is assigned from
  the athlete's own page, or on the Add form while the record is being
  built; the family's athlete page has Your Advisor or No Advisor Named
  Yet, pointing at More.
- **My Athletes** (`/mine`, owner and staff): the athletes you advise,
  never checked in first, then the longest gap, each with its new
  messages. Today has a My Athletes row, and Needs Follow-Up lists up
  to four check-in reminders ahead of the targets: org wide, Active and
  Transferring athletes with an advisor still on staff, advisor named.
  The roster filters to yours with `?advisor=me` (Just Mine).
- **Check-ins** (`/roster/[id]/checkins`): kind (Call, Meeting, Text,
  Other), date and notes, logged and removed by owner and staff. Due
  after 14 days (`CHECKIN_DUE_DAYS`, `src/lib/checkins.ts`). Staff only
  in the database as well as on screen: a family or member login reads
  no row.
- **Messages**: one thread per athlete, `/roster/[id]/messages` for
  staff and `/family/[id]/messages` for the family, one component for
  both. Opening a thread marks it read (one marker per person per
  thread); unread counts show on the profile, the family's athlete page
  and My Athletes. A member never sees a thread.
- **No email.** A new message tells nobody outside the app; the unread
  count is the only signal. Stage 3b on the roadmap.
- **Production starts empty.** Every athlete's advisor is null until
  Dave assigns one from the athlete's page, so My Athletes is empty and
  no reminder shows until then. Anyone to be picked needs an Admin
  login first, which Add Admin on the same sheet sends.

The RLS suite proves a family login reads no check-in, writes only its
own messages on its own athlete, cannot sign as someone else or file a
message under another org, and that the advisor must be owner or staff
of the athlete's org (each planted and watched to fail).

### Real schools and coaches, 2026-09-26

Production holds 122 schools and 240 college coaches, loaded from Dave's
enriched Google Sheets by another tool and then recorded, corrected and
checked here (docs/DECISIONS.md, same date). The sheets are no longer
synced to anything; the app is the master copy of athletes.

- `college_coaches` (migration 0036) is a shared directory readable by
  owners and staff only. The school and target screens list a school's
  coaches, head coach first, tapping through to email or a call. Each
  org's own coach relationship stays in its private school notes.
- `schools.location` (0037) holds "City, ST"; `state` is filled from it.
- The school jsonb reader falls back per field, so one malformed value
  never hides the rest (law in `src/laws/fitLaws.test.ts`).
- `academics.majorsNote` is a display-only sentence about the programs
  families ask about, shown as Programs of Interest and editable on the
  school form. It is never scored.
- A sheet "yes" for athletic money reads as partial scholarships; "no"
  and every D3 school read as none.
- Recalculate All under More reports how many matches it wrote, or
  that it failed. Stored scores need one run after the deploy that
  carries this.

### Enrolling closes recruiting out for good, 2026-09-26

Dave, after trying to update an athlete's status and watching nothing
else on the screen change: "their status should change and everything
should shift based on that status... the schools that they're
interested in, all that should no longer be relevant, it should be
cleared out." athletes.status already had an unused "Committed" value
with nothing reading it beyond a roster pill; this is what makes a
status change actually do something.

A new athletes.status value, Enrolled, the stage after Committed. It is
reached two ways: the dedicated Mark Enrolled screen
(`/roster/[id]/enroll`), which reads which school from a Committed
target when one exists (that is where the school comes from, so nothing
is typed twice) but does not require one - an athlete already in college
with no clean Committed row (a transfer, a historical record) still
gets their open targets closed the same way, just with no school named
in the notice - previews exactly which of the athlete's other targets
will close, and lets the enrollment date be picked; or the plain Edit
form's status dropdown, a permissive escape hatch for correcting an
import or a mistake, which cascades the same way and defaults the date
to today. Both run through one shared function, `applyEnrollment`
(`src/lib/data/enrollment.ts`), so neither path can silently do nothing
the way athletes.status used to.

What actually happens: every other open target on the athlete (not
Committed, not already Not Interested) closes to Not Interested with an
appended note saying why and when, so Today's Needs Follow-Up and the
Targets board stop showing a coach outstanding work on someone who has
already enrolled elsewhere. The Committed target is left alone. The
NCAA age clock's `first_full_time_enrollment` backfills from the
enrollment date only if nothing has started it already - a transfer
athlete's clock started at their original school, years earlier, and
must never be moved by a later enrollment.

Committed, Enrolled, Graduated and Drafted are one fact with a name,
worked out by `placementOf()` (`src/lib/placement.ts`) and read the same
way on the athlete page, the roster row and the family page. The name is
the school (the Committed target, else, once Enrolled or Graduated, the
Current School on their own record) or, for Drafted, the team with the
round and year. Once an athlete has one: the stepper gives way to a row
naming it, the roster row reads "Committed to X", "Enrolled at X",
"Graduated from X" or "Drafted by X, Round 5, 2026" in place of the
recruit type, and Matches stops showing (ranking more schools is over). The athlete's own schools section is
called Targets, the same rows as the Targets board; it keeps every
target with its real status, so history is never lost.

The board and the athlete stay in step (`src/lib/data/commitment.ts`):
moving a target to Committed makes an Active athlete Committed, and
moving the last one off Committed makes them Active again. Enrolled and
Inactive athletes are never touched by a board edit.

Three close-outs, each its own screen off the athlete page, each
closing open targets with a note through `applyCloseOut()`
(`src/lib/data/enrollment.ts`). The college commitment is kept as
history in every case. `nextOutcomes()` decides which buttons show:
Mark Enrolled and Mark Drafted before college, Mark Graduated and Mark
Drafted once Enrolled, Mark Drafted once Graduated, none once Drafted.
- **Mark Enrolled** never enrolls someone nowhere: with no Committed
  target it asks which school, defaulting to the Current School; a
  school picked from the list becomes the athlete's Committed target.
  Backfills the NCAA clock's first full-time enrollment only if empty.
- **Mark Graduated** (from college, Dave's pick) only follows Enrolled,
  is named by the same school, and records `graduated_on`.
- **Mark Drafted** records `draft_team` (required), `draft_round` and
  `draft_year` (migration 0035). On an athlete already Drafted the same
  screen corrects the details.
The Edit dropdown refuses Enrolled or Graduated with no school on file
anywhere, and refuses Drafted outright (the team lives on Mark Drafted).

The member/board Program screen follows the same rule through its own
SQL summary function (`member_program()`, migrations 0034 and 0035,
both applied to production 2026-09-26), since a member reads no athlete
rows and cannot call `placementOf()`. `src/testing/fakeRpc.ts` mirrors
it and `scripts/rls_test.sql` checks it on real Postgres.

Stage 1 of the rebuild (Dave's list, 2026-09-26): seven statuses with
Transferring; no score anywhere for a placed or Inactive athlete, and
their stored rows deleted at the moment recruiting ends (migration 0038
purged the existing ones); `recruiting_targets.closed_from` records what
a close-out closed; a Recruiting History screen off the profile holds
every school, message, visit and offer while the profile's Targets shows
only open ones; Reopen Recruiting (Committed back to Active, Enrolled or
Graduated to Transferring with the closed targets restored); Today
counts every status and each tile opens the roster filtered to it.
docs/BUSINESS_RULES.md, "Athlete lifecycle".

The app icon, the Apple touch icon and the manifest load without
signing in (`isPublicPath()`, `src/lib/supabase/middleware.ts`). iOS
fetches them without the session when a page is added to the Home
Screen; behind the sign-in redirect it drew a letter instead of the
logo. Already-added shortcuts keep the old icon until re-added.

"It can't just be like high school recruiting to transfer recruiting,
it needs to make sense" ruled out reusing `recruit_type` for this, which
describes what KIND of recruit someone is, never whether they still
are one.

### Stage 4 and the add, edit and delete audit, 2026-09-27

Shared schools, coaches and transfer windows are edited only by an owner
of a directory-editor organization (Bridge in production). A staff,
member or family login cannot create an organization.

Dave: "everything should be very easy for anyone to edit anything...
add and delete and all that good stuff", "more buttons, less typing",
and no data wired into the app. Migration 0040; the rules are in
docs/BUSINESS_RULES.md ("Adding, editing and removing" and "Autofill"),
the reasons in DECISIONS.md.

- **Autofill.** Every free-text field with a known answer suggests it
  (`SuggestField` in the kit): position by sport, high school, major,
  college, F-1 and NCAA statuses, metric source, conference, coach,
  grading-scale and approved-list school, board role, grant funder.
  Home State and State are a list. A pick fills Home State, Current
  Division, a coach's email and phone or a donor's details only when
  blank, checked again on the server.
- **The high school directory** (`high_schools`) exists and is empty.
  `scripts/load_high_schools.ts` fills it from the public NCES files;
  this sandbox's proxy refused nces.ed.gov, so nothing is loaded and the
  parser has been checked only against the published layouts. Until it
  runs, suggestions are the org's own high school names.
- **Athlete notes**, staff only: added from Add Athlete, Edit, the
  athlete page, and filed by Mark Enrolled, Mark Graduated, Mark
  Drafted and Reopen with the step's name. Removed, never edited.
- **Edit and remove everywhere.** Athletes (Remove Athlete, a soft
  delete), contacts, metrics, check-ins, messages, family links (one
  athlete at a time, from the athlete page or the member page),
  targets with their award, the contact log, visits, schools (removal
  refused while anything points at one; Merge Into for a duplicate),
  the coach directory (owner), grading scales, approved lists (edited
  in place), transfer windows (with notes), transcript courses, a
  pending reading, documents (discarded or failed, for good), boards,
  seats, donors, gifts, pledges, campaigns and grants. Every removal
  asks first. Duplicate athlete and school names are caught.
- **Enrolled and Graduated** only through Mark Enrolled and Mark
  Graduated; Edit corrects a date already set.
- **The org.** Organization Settings (Admin): name, fundraising and
  board on or off. Create an Organization for anyone signed in, from the
  start screen and More. Admins rename themselves on More.
- **Access levels and Titles (2026-09-27).** Admin, Viewer, Athlete,
  the same names in every org (`src/lib/org/roleLabels.ts`); staff is
  retired and nothing offers it. An Admin sets a per-person Title on the
  member's page; it shows on the members list, the member page, the
  athlete page's Advisor row and sheet, the Athlete screen's Your
  Advisor row, the Advisors list and the Add form's picker, with the
  access level shown when there is none.
  `src/laws/accessLaws.test.ts` and the 0041 block of
  `scripts/rls_test.sql` hold it.
- **The stand-in reader can never write onto an athlete.** Every
  document records who read it; a stand-in reading, any reading while
  no key is set, and an older document with no real model call on
  record are refused, and the review screen says why instead of
  offering Apply.
- **No data wired in.** The schools template no longer names Bridge, a
  law bans data in any migration from 0040 on, and a fixture build
  refuses to build on Vercel. The Bridge mark stays the app icon, as
  Dave asked; the name is one constant, `src/lib/product.ts`.

### The advisor managed where you see it, and More as the control center (Stage 5 Phases 2 and 3, 2026-09-27)

Built to docs/PLAN_STAGE5.md, which Dave approved whole; the reasons
are in DECISIONS.md under the same date. Migration 0043, no RLS change.

- **The Advisor section is first on the athlete's page**, under the
  header and any notice, with Messages and Check-Ins under it. With an
  advisor: their row (Title, tap to email) and Change; without: "No
  Advisor Assigned" and Assign. Either opens a sheet of the org's
  Admins, most recently used first (`athletes.advisor_assigned_at`,
  stamped by the database trigger when the advisor changes, never by
  the app), a search once there are more than three, one tap per Admin
  to assign, Clear Advisor, and Add Admin.
- **Add Admin** is the invite screen with the role preset to Admin and
  the athlete pinned: "They will be assigned as {name}'s advisor." Send
  Invite writes the membership, then the advisor, and returns to the
  athlete with the new person assigned; an address already an Admin
  here is assigned rather than refused. Every Admin may add an Admin.
- **Edit no longer has an Advisor field** and a Save there never
  touches the advisor; Add keeps the picker. The member's page keeps
  its tick list and gains Assign Athlete, the same sheet the other way
  round.
- **One rule**: `src/lib/org/advisors.ts` decides who may advise; the
  trigger `private.advisor_is_staff()` is its only twin.
- **More** is six sections: People (Members, owner only; Advisors,
  every Admin), Program (Assignments, Documents), Reference (Schools, Grading
  Scales, Approved Lists, Transfer Windows), Matching (preset,
  Recalculate All), Foundation (Fundraising, Board; the whole section
  gone when neither module is on), Organization (Settings, Doc AI
  Spending and its budget form, Start Another Organization, who you
  are, Your Name, Sign Out). Activity was added under Organization by
  Phase 6, Assignments joined Program with Phase 4, and View As (Admin
  only) sits after Activity with Phase 5.
- **Advisors** (`/advisors`): every Admin with "Title · N athletes",
  counting Active and Transferring athletes only (the reminder rule),
  the lede saying how many athletes have nobody, each row opening the
  person's page.

Laws: `advisorLaws.test.ts`, `moreLaws.test.ts`, the last block of
`pageRender.test.ts`, and the 0043 block of `scripts/rls_test.sql`
(Admin assigns and the stamp moves; an unrelated edit leaves it; a
Viewer reads no row; a family session changes nothing; another org's
Admin is refused by RLS and by the trigger).

### The activity log (Stage 5 Phase 6, 2026-09-27)

- **Who did what, for Admins.** Migration 0044 adds `activity_log`,
  append only: a select policy and an insert policy and nothing else,
  a trigger that stamps the time and the actor and refuses any update,
  and no delete path in code. A Viewer and an Athlete login read
  nothing and no family or member screen names the table.
- **Sentences from templates.** `logActivity` (`src/lib/data/activity.ts`)
  builds each summary from a per-action template out of names, statuses,
  kinds and dates and returns a branded `ActivitySummary` the insert
  requires; a note, a message or a document reading has no parameter to
  travel in. A failed log write warns and never fails the action.
- **What is logged.** Athlete created, edited, status changed (two rows
  when an edit moves the status), removed; the close-outs and Reopen;
  advisor set or cleared; targets added, moved, removed (Add to Targets
  included); documents uploaded, applied, discarded; check-ins (kind and
  date only); messages, staff and family (the family's through the
  security-definer `log_family_message`, which takes an athlete id and
  no text); members invited, role changed, removed; a guardian linked
  (`member_invited`) or unlinked (`member_removed`). A person removing or
  demoting themselves logs through the admin client.
- **Screens.** The athlete's page has an Activity section after Notes
  (the last five, See All past five). `/roster/[id]/activity` is that
  athlete's full log; `/org/[slug]/activity` is the whole org with a
  search over the sentence and the person (shown past five entries), 50
  entries and then Show More. More has an Activity row under
  Organization. An entry is a Row when it has somewhere to go and a plain
  card when it does not (a removed athlete, target or member, a discarded
  document); a week on, the date replaces "N days ago".
- **View As writes its own lines** in migration 0047, by role and never
  by name (see the View As section). "Invited" for linking a guardian who already has a login
  reads slightly off (one template line).

Laws: `activityLaws.test.ts`, the activity block of `actionRun.test.ts`,
`moreLaws.test.ts`, the last block of `pageRender.test.ts`, and the 0044
block of `scripts/rls_test.sql`. Five entries in `src/testing/pages.ts`
(`activity`, `activity-search`, `activity-search-empty`,
`athlete-activity`, `athlete-activity-empty`); the fixture holds six rows
on the fixture athlete, one about the org and one for Elite, none on the
transfer athlete so the empty state renders.

### Assignments (Stage 5 Phase 4, 2026-09-27)

- **Work with a due date.** Migration 0045 adds the `filed` document
  status, alone in its file. Migration 0046 adds `assignments` (five
  statuses, no in-progress; a kind, a category, a due date, the family's
  note and the reviewer's comment), the coherence and honesty triggers,
  the policies and `public.submit_assignment`. Admins read, create and
  update; the Athlete login reads only its linked athlete's rows and
  writes only by calling the function; a Viewer reads nothing; there is
  no delete policy, Cancel is a status. **Overdue and Due Soon are
  computed on every draw and never stored** (`src/lib/data/assignments.ts`,
  Eastern time until an org carries a timezone).
- **The Athlete login's path.** Your Assignments sits above Your Advisor
  on the athlete's page: one link button per open row (Submit, or
  Resubmit on a row sent back), a link row for one already sent, one
  line of text for the complete ones, cancelled hidden. The answer
  screen (`/family/[id]/assignments/[id]`) shows the instructions, the
  reviewer's comment only on a row sent back, a file field for an upload
  assignment, a note and one button. The file goes from the browser to
  `<org>/family/<request>/<file>` in the `documents` bucket, the only
  place a family may write, then `submitAssignment` reads the bytes with
  the service role once (size, type, hash, duplicate check) and calls the
  function, which files a `filed` document, links it and marks the row
  Submitted. No Doc AI call, no email.
- **The Admin's path.** The profile has an Assignments section after
  Advisor (three most urgent, See All, New Assignment).
  `/roster/[id]/assignments` groups Open, Submitted and Done; `/new`
  creates; `/[assignmentId]` shows the submission, the file as a
  Family Upload row on the document screen, and the review (Complete,
  Needs Revision with a required comment, a confirmed Cancel).
  `/org/[slug]/assignments` is the org-wide list (Submitted for Review,
  Overdue, Due Soon, Open; search past five rows). Today shows Submitted
  for Review and Overdue after Needs Follow-Up, each only when it has a
  row. My Athletes says "N open assignments · N overdue · N to review".
  More has an Assignments row under Program. The Documents list shows a
  filed file under Family Upload with no Apply and never under Needs
  Review.
- **Logged.** Created, submitted, reviewed and cancelled write activity
  lines from templates: names, kinds and dates only, never the note, the
  comment or the title. The family's line is a literal per kind that
  names nobody.
- **Not verified against a real project.** The function's storage
  `owner` check and the bucket limits are tested against the local stub
  only; confirm the `owner` column is filled for a client upload before
  this goes to production. A refused upload stays in the bucket.
  `submit_assignment` refuses while an Admin is viewing as someone
  (migration 0047).

Laws: `assignmentLaws.test.ts` (48 cases), the last block of
`pageRender.test.ts`, `moreLaws.test.ts`, and the 0046 block of
`scripts/rls_test.sql` (Admin, a leftover staff row, the Athlete login
for its own and another athlete, a Viewer, a second org, anon), each
planted and seen to fail. `src/testing/pages.ts` gains eleven entries;
the fixture holds seven assignment rows (one per status, a due-soon one,
one for Elite), a filed document and a family storage object.

### View As (Stage 5 Phase 5, 2026-09-30)

- **What it is.** An Admin sees exactly what an Athlete login, a Viewer
  or another Admin sees, read only, for at most 30 minutes, with a banner
  ("Viewing as <name>", the level, Read only, minutes left, Return to
  Admin) at the top of every org screen and on Not Authorized and the
  organization picker. More has a View As row for Admins only; it opens
  `/view-as` (three levels with counts) and `/view-as/[role]` (the people
  of that level, each with a View As button; an Athlete login's row says
  which athletes it sees). Starting lands on that person's own home.
- **How.** Migration 0047, option D2 of the plan, on the Admin's own
  token. A `view_as_sessions` row (written only by `start_view_as` and
  `end_view_as`) makes the effective identity the person viewed: the nine
  access helpers and five inline read policies follow it, every write
  policy in `public` and `storage.objects` carries `and not
  private._viewing()`, and the three definer functions that write refuse.
  No token is minted for anyone and nothing reads with the service role
  for another person. The app reads the row (`src/lib/data/viewAs.ts`,
  fails closed), the guard reads the seat viewed, and
  `requireNotViewing()` opens all 109 exported server actions. Design in
  ARCHITECTURE.md, rules in BUSINESS_RULES.md, the choice and its
  deviations in DECISIONS.md (2026-09-30).
- **Proof.** The RLS suite hashes every table and `storage.objects` as
  the Admin viewing and as the target directly, for an Admin, a Viewer
  and an Athlete target, and attempts every write while viewing; the
  render law renders every org screen through the layout while viewing
  and compares it with the target's own render (banner aside), and checks
  that no link leaves an Athlete login's or a Viewer's screens. Every plant
  in the README (41 to 46) was seen to fail.
- **Deviations and gaps.** The activity lines are role literals ("Started
  viewing as a Viewer"), not the named templates, because the log law
  holds SQL writers to literals. `signout()` does not end an open session
  (bounded by the 30 minutes; Return works). The root not-found and error
  screens carry no banner. The fixture has no second Admin by default
  (`withSecondAdmin`). `getViewAs` adds one indexed query per request.
  Unread counts do not clear while viewing.

Laws: `viewAsLaws.test.ts`, the last blocks of `pageRender.test.ts`,
`moreLaws.test.ts`, and the 0047 block of `scripts/rls_test.sql`. Eight
entries in `src/testing/pages.ts` (the two screens and their three
levels, plus a banner render of an Athlete's home and athlete page, a
Viewer's home and another Admin's Today); the live driver opens them
through a `fixture_view_as` cookie.

### Less text on every screen, 2026-09-25

Dave: "eliminate as much instructional subtext as possible. Leave only
what we will actually need." One rule decided each line: a sentence
that changes what somebody does stays (a refusal, a warning, an NCAA
caveat, a rule like a D3 school offering no athletic money); a sentence
that explains how the app works goes.

Cut or shortened: eight explanatory paragraphs under sections, four
notes that explained how a total is counted rather than what it is,
thirty-seven empty states (an empty state with a button on it no longer
repeats the button in a sentence), and twenty-five field hints that
gave the reasoning behind a field instead of the format it wants.
Format examples stay, because they are the part a person acts on.

---

## How it is verified

1. **Unit tests** over the pure modules.
2. **Laws** (`src/laws/`, 30 files) encode the rules from CLAUDE.md,
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
- **No API key for Doc AI.** The model caller is a stand-in, and since
  2026-09-27 nothing it reads can be applied. Every document already in
  production was read by it, so once the key is set each one is
  discarded, deleted for good and uploaded again.
- **The high school directory is empty.** Run
  `scripts/load_high_schools.ts` with the service role key from a
  machine that can reach nces.ed.gov (steps in scripts/README.md).
- **The name.** "BFFSA" is what the app calls itself for now.
- **Who advises whom.** Every production athlete's advisor is null
  until Dave assigns one from the athlete's page (or several at once
  from an Admin's page); the notes name Dave, Mike and Kev, but nothing
  maps those names to logins. Mike and Kev need Admin logins before
  they can be picked; Add Admin on the athlete's Advisor sheet sends
  the invite and assigns them when it lands.

### Known and deliberate

- **The three member summary functions are callable by any signed-in
  person**, which Supabase's linter reports and which is the point: a
  board member's own client calls them, and each one checks that the
  caller belongs to the org it was handed before it returns anything.
  What is not intentional, and was fixed on 2026-09-22 (migration
  0033), is that they were callable without signing in at all.

- **`org_members` has no write policy.** Every membership write goes
  through the service role behind `requireOwner()`, except the first
  owner of a new org, which `create_org` writes as a security-definer
  function any signed-in person may call.
- **School names are unique by name key in the app only.** There is no
  database index; Add School, Edit and the CSV import check.
- **`schools` is writable only by the service role**, with
  `requireOwner()` as the actual gate.
- **The preview shows fixture data and does not post forms.** What a
  render cannot show, the bench does with the real modules.

### Not yet done, not blocked

- The database has no transfer windows and no benchmark sets. The
  transfer-window form exists; the window dates have to be read off an
  NCAA-published page rather than recalled, which is why none are
  seeded.
- `@supabase/ssr` 0.5 and `zod` 3 are both a major behind.
- No message notifications: the app sends no email of its own, so a
  family learns of a message only by opening the app (Stage 3b).
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

1. The roles rework and Stage 5 Phases 1 to 6 ship when Dave says
   "go": commit, apply 0041 to 0047 to production (0041 changes no row
   there; 0042 and 0043 add columns; 0044 adds the empty activity log;
   0045 and 0046 add the `filed` status and the empty assignments
   table, and 0045 must run before 0046; 0047 adds the empty
   `view_as_sessions` table and rewrites the access helpers and every
   write policy, so run the RLS suite against a copy first), confirm the
   storage `owner` column is filled for a client upload,
   deploy, run Recalculate All once
   so every stored match carries its net cost, then Dave sets each
   person's Title from their page under Members and checks the members
   list on his phone. Built without a preview, per "I don't need
   previews. Ship it."
2. Dave assigns advisors from each athlete's page (Assign, then a tap on
   the Admin; Add Admin for Mike and Kev) and walks the edit and remove
   screens on his phone, then tries View As on an Athlete login, a Viewer
   and another Admin, and checks Return on his phone.
3. Load the high school directory (above), then set the AI key and
   discard, delete and re-upload the production documents.
4. Dave exports his school sheet to the template and imports it, then
   logs a first metric and reads a real match. The three interpreted
   numbers (strike target, grade weights, preset weights) get revisited
   on what he sees. Nothing else in the app is waiting on code: every
   screen it needs exists and is verified against the fixture.
5. Dave's page-by-page audit of the new screens on his phone.
6. The first real family (the athlete first, then a parent or legal
   guardian) and the first real board login, each from the athlete's
   page and the seat's page respectively.
7. The current NCAA transfer windows, entered from an NCAA-published
   page, so transfer timing stops reading as unverified.
8. Cleanup pass: one page loader, `cache()` on the org and user lookups,
   split `documents.ts`, then the `@supabase/ssr` and `zod` bumps.

See docs/ROADMAP.md for the rest.
