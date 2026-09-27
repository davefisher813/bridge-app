# Business rules

## Org / module model

- Every org gets `recruiting` and `doc_ai` on by default; they are the
  core product.
- `board_governance` and `donor_fundraising` are off by default. Bridge
  turns both on. Elite Squad turns neither on.
- Three access levels, with fixed names in every org (Dave,
  2026-09-27): Admin (`owner`), Viewer (`member`), Athlete (`family`).
  `staff` is retired: migration 0041 moved every staff row to owner and
  nothing offers it; a leftover row reads as Admin. What a role can do is
  the `org_role` enum plus `requireRole()` / `requireOwner()` in
  `src/lib/auth/guard.ts`, unchanged.
- A person's Title (`org_members.title`, 1 to 80 characters or null) is
  what they are called in that org: Head Coach, Board Chair. An Admin
  sets it on the person's page under Members. It shows next to their
  name in place of the access level and never grants anything.
  `orgs.role_labels` is no longer read; the column keeps its data.

## Who sees a school (2026-09-26)

- The school directory and a school's shared facts are open to every
  signed-in role: owner, staff, family and member. `schools` is shared
  reference data with no `org_id`.
- A school's coaches (`college_coaches`), the org's notes
  (`org_school_notes`) and which of the org's athletes are pointed at it
  are owner and staff only. A family or member school page never loads
  them.
- A D3 school never shows a scholarship claim, to any role.

## NCAA initial eligibility: verified against primary sources 2026-09-15

Everything in this section was read directly out of an NCAA-published
document on 2026-09-15, not recalled and not taken from a recruiting
blog. Each rule carries the document it came from. Dave asked for this
explicitly ("Make sure it's OFFICIAL... the ncaa changed stuff a lot").

Re-verify before each season. These change by convention vote, and two
NCAA-hosted pages are currently stale and contradict the live rules
(noted at the end).

### How the NCAA calculates core-course GPA

Source: "How is Core-Course GPA Calculated?", NCAA Eligibility Center,
`fs.ncaa.org/Docs/eligibility_center/Grading_and_GPA/Core_GPA_Calculation.pdf`
and "How to Update Your School's Grading Scale", same directory
(`Grading_Scales_and_How_to_Update.pdf`). Fetch these through
`https://s3.amazonaws.com/fs.ncaa.org/Docs/...`; the `fs.ncaa.org`
host redirect-loops between http and https.

1. **The scale is A=4, B=3, C=2, D=1.** Four values, nothing else.
2. **Plus and minus grades do not exist.** "NCAA legislation does not
   permit the use of pluses and minuses." B+, B and B- are each worth
   exactly three quality points. This is the single biggest divergence
   from how American high schools and this app compute GPA, and it cuts
   both ways: an A- is worth a full 4.0, a B+ only 3.0.
3. **Quality points = grade points x credit earned.** An A in a
   full-year (1.00 unit) course is 4.00 quality points; the same A in a
   half-credit course is 2.00.
4. **Core-course GPA = total quality points / total core-course units.**
5. **Only NCAA-approved core courses count.** Not the student's overall
   GPA. A transcript GPA and an NCAA core GPA are different numbers and
   are routinely far apart, because electives, PE and art inflate the
   first and are excluded from the second.
6. **Only the best grades count.** "Only your best grades from approved
   courses in the required subject areas will be used." Extra core
   courses beyond the 16 can displace weaker ones.
7. **Weighted honors/AP/IB is capped at +1.00 quality point per
   course**, and only when the course is titled honors, AP/IB or
   advanced, the high school has told the Eligibility Center it awards
   weighted grades, and the weighting actually feeds the student's GPA.
   "Weighted grades that are used only for class rank and do not factor
   into a student's overall grade-point average cannot be used."
8. **The high school's own scale governs the letter conversion.** The
   Eligibility Center converts the school's published numeric-to-letter
   scale into quality points. It does not impose its own numeric
   cutoffs. So a 100-point transcript is converted using that school's
   printed table, not a generic curve.
9. **Repeated or duplicated courses count once**, and the higher grade
   is the one that may count.
10. **A student who attended more than one high school** needs an
    official transcript from each.

### Current standards (2026-27)

Sources: NCAA Eligibility Center DI and DII requirement pages
(`ncaa.org/eligibility-center/initial-eligibility-requirements/`), the
DI requirements fact sheet, the high-school initial-eligibility
presentation (`fs.ncaa.org/Docs/eligibility_center/HS/HS_IE_Presentation.pdf`),
and the 2026-27 Guide for the College-Bound Student-Athlete
(`Student_Resources/CBSA.pdf`).

| Division | Status | Core GPA | Core credits | Year one |
| --- | --- | --- | --- | --- |
| D1 | Early academic qualifier | 3.0 | 14 | Aid, practice, compete |
| D1 | Qualifier | 2.3 | 16 | Aid, practice, compete |
| D1 | Academic redshirt | 2.0 | 16 | Aid and practice, no competition |
| D1 | Nonqualifier | below 2.0 | - | Nothing |
| D2 | Early academic qualifier | 2.5 | 14 | Aid, practice, compete |
| D2 | Qualifier | 2.2 | 16 | Aid, practice, compete |
| D2 | Partial qualifier | see caveat | - | Aid and practice, no competition |

- **D1 also has the 10/7 rule**: ten of the sixteen core credits,
  including seven in English, math or science, completed before the
  start of the seventh semester (senior year). D1 only; no D2
  equivalent appears in any current NCAA source.
- **D3 has no NCAA academic standard at all.** Each campus sets its
  own. The Eligibility Center only issues an NCAA ID, and only
  certifies athletics eligibility for international D3 athletes. Never
  show a D3 athlete an NCAA core-GPA verdict.
- **The exact D2 partial-qualifier GPA floor is not published** on any
  NCAA page that could be retrieved. Do not state a number for it.

### Standardized tests are gone, and the sliding scale with them

"In January 2023, NCAA Divisions I and II adopted legislation to remove
standardized test scores from initial-eligibility requirements."
(2026-27 Guide.) DI Proposal 2022-34, adopted 2023-01-12, effective
2023-08-01. The old GPA-against-test-score sliding scale no longer
exists in either division. SAT and ACT are listed under "Not
Considered" in the 2026-27 initial-eligibility waiver directive.

The app may still use test scores as an **admissions** signal. It must
never present them as an NCAA eligibility factor.

### Age-based eligibility (new, and it matters for Bridge)

Source: `ncaa.org/eligibility-center/division-i-and-division-ii-age-based-eligibility-rules/`,
plus the D1 adoption release (D1 Cabinet, 2026-06-23) and the D2
emergency legislation (2026-07).

A five-year eligibility period now starts at whichever comes **first**:
the term the athlete first enrolls full time at any college, or the
start of the academic year following their 19th birthday if they turn
19 before September 1. It "does not pause because a student-athlete
does not compete, transfers, sits out, changes teams or takes time away
from participation."

D1 and D2 only. 2026-27 enrollees may use whichever ruleset benefits
them; from fall 2027 the age-based rule is the only one.

This is the rule most likely to catch Bridge athletes, because the
clock can start **before an athlete ever enrolls anywhere**: post-grad
and prep years, a gap year, a late arrival from the Dominican Republic,
or an online-program athlete who graduated late all burn eligibility
while sitting out. Any athlete who will turn 19 before the September 1
preceding their intended enrollment needs this checked by hand.

`athletes.first_full_time_enrollment` is the one thing the app writes
into this rule (2026-09-26, Mark Enrolled): only when the column is
still null, and only to the date staff enter when an athlete actually
enrolls. A transfer athlete's clock started at their original school,
years before this org ever saw them, so a later enrollment recorded
here must never move it. Nothing else about the age clock is written by
the app; every other input is entered by hand where the eligibility
screen asks for it.

### Two NCAA-hosted pages that are wrong

- `ncaa.org/division-ii/governance/academics/` still describes "two
  sliding scales for full and partial qualifiers". That rule was
  eliminated in 2023. Do not cite or scrape it.
- The LSDBi rendering of D1 Bylaw 14.3.1.2 still contains pre-2023
  SAT/ACT text superseded by Proposal 2022-34.

### Where the app currently disagrees with the NCAA

Recorded 2026-09-15, before any of it was fixed, so the gap is written
down rather than remembered:

- `src/lib/docai/gpa.ts` converts a 100-point average with a
  plus/minus curve (97+ = 4.0, 93-96 = 3.7 band, and so on). The NCAA
  has no plus/minus and would use the high school's own printed table.
  It also converts an already-averaged number, where the NCAA computes
  per-course quality points and averages those.
- Nothing in the app computes a **core-course** GPA, because no
  per-course data is stored. Overall GPA is used everywhere an NCAA
  number is implied.
- `courseRigorBoost()` in `src/lib/fit/academic.ts` invents a rigor
  bonus (+0.02 per AP-equivalent, capped +0.20). The NCAA's actual
  allowance is up to +1.00 quality point per qualifying course, subject
  to the three conditions above.
- `scoreEligibility()` returns "not evaluated" for any athlete whose
  detail is not a transfer, so **high school athletes never receive an
  NCAA initial-eligibility check at all**. That is Bridge's entire
  population.
- `DIVISION_GPA_DEFAULTS` (D1 3.0, D2 2.5) are admissions-fit guesses,
  not NCAA floors, and are not labelled as such where they surface.

## NCAA facts encoded in the fit engine

These were researched and, in one case, corrected after Dave caught an
overstated first draft ("Did you check the scholarship thing for all
divisions? I don't believe d3 can offer scholarships" - 2026-09).
Verify against current NCAA/conference sources before relying on any of
these in production; rules like this change by NCAA vote.

- **D3 categorically bans athletic scholarships.** This is universal
  and NCAA-administered - D3 athletes get only need-based/merit aid, no
  exceptions. It is unrelated to the House settlement below. Encoded in
  `src/lib/fit/financial.ts`'s D3 branch and enforced as a law in
  `src/laws/fitLaws.test.ts` ("D3 never shows a scholarship-availability
  claim"), because a wrong or dirty School record should never be able
  to leak a false scholarship claim for a D3 school.
- **The House v. NCAA settlement** (elimination of sport-specific
  scholarship caps, replaced by roster limits) applies **only to
  Division I**, and only to D1 schools that opt in. Encoded as
  `School.financials.rosterSpotsOpen`, checked only when `isD1()` is
  true (`src/lib/fit/benchmarks.ts`).
- **D2 keeps its own separate, still-capped scholarship rules**,
  untouched by the House settlement. D2 schools use the same
  scholarship-type + aid-vs-cost model as before; the roster-spots
  signal never applies to them.
- **Transfer types and their rules**, encoded in `src/lib/fit/transfer.ts`:
  - `transfer_4to4` (four-year to four-year): the one-time transfer
    exception grants immediate eligibility for a first transfer, entered
    within the sport's portal window, in academic good standing. A
    second transfer generally requires an NCAA waiver, not covered by
    the exception - `transferCount >= 2` produces a warning, not a veto
    (a waiver can still be granted; this isn't a hard NCAA-wide rule the
    same way the 2.5 GPA floor below is).
  - `transfer_juco` (two-year to four-year, the "4-2-4 rule"): 2.5
    cumulative college GPA minimum (hard veto below it), plus a
    full-time credit-hour completion requirement (24 semester / 36
    quarter hours per NCAA year - a warning, since partial data
    shouldn't hard-veto).
  - `transfer_grad`: requires a completed bachelor's degree (hard veto
    if not completed) and remaining NCAA eligibility (hard veto at
    zero). Uses shorter (~60 day), sport-specific grad transfer windows,
    separate from the undergrad primary window.
  - **Portal windows are NCAA-voted and change most years.** They are
    always data (`transfer_windows` table / `TransferWindow[]` passed
    into `scoreEligibility()`), never hardcoded. Without a matching
    window row, timing is reported as unverified - never assumed valid.
    Enforced as a law in `src/laws/fitLaws.test.ts`.

## Athlete lifecycle (2026-09-26)

Seven statuses, app-validated free text (`ATHLETE_STATUSES`): Active,
Committed, Enrolled, Transferring, Graduated, Drafted, Inactive.

- **Placed** (Committed, Enrolled, Graduated, Drafted): recruiting is
  done. No score anywhere. The profile shows where they went in place
  of the stage stepper, and Matches disappears.
- **Scored** (Active, Transferring): the only two the fit engine scores.
  Inactive is not scored either; a kid who is not recruiting has nothing
  to rank.
- **A close-out** (Mark Enrolled, Mark Graduated or Mark Drafted, each
  of which asks for its date or team; since 2026-09-27 the Edit dropdown
  refuses all three and points at the button) closes every open target to Not Interested and records the
  status it replaced in `recruiting_targets.closed_from`, so nothing is
  lost and a reopen knows exactly what to restore. The Committed target
  stays as history.
- **Recruiting History** is its own screen off the profile: every
  school ever targeted, any status, with messages, visits and offers.
  The profile's Targets section shows only open targets, and nothing
  for a placed athlete.
- **Reopen Recruiting**: a Committed athlete goes back to Active and
  the commitment becomes an Offer or In Contact target. An Enrolled or
  Graduated athlete becomes Transferring, their record becomes a
  transfer record (the school they are leaving, transfer type, years
  left), the targets the close-out took come back as they were (In
  Contact when unknown), the commitment becomes history, and they are
  scored again. Drafted cannot reopen. The Edit dropdown refuses to
  walk a placed athlete backwards; Reopen is the only way.
- **Today** counts every status, and each tile opens the roster
  filtered to it. A tile's count and the filtered list are computed by
  the same rule (`effectiveStatus`), so they never disagree.

## Advisors, messages and check-ins (2026-09-26)

- **One advisor per athlete**, an owner or staff member of the
  athlete's own org, or nobody. It is display and reminders only, never
  a permission: every owner and staff member still reads and writes
  every athlete. A database trigger refuses anyone else, and removing a
  person or making them a member clears them as advisor. Production
  starts with nobody; any Admin assigns, changes or clears from the
  Advisor section at the top of the athlete's page (a sheet of the
  org's Admins, most recently used first, with Add Admin) or from the
  member's page. The Advisor select stays on Add only; Edit never
  writes it (Stage 5, Phase 2, 2026-09-27).
- **A check-in is due after 14 days** without one, or when there has
  never been one (`CHECKIN_DUE_DAYS` in `src/lib/checkins.ts`, the one
  place the number lives). Reminders are for Active and Transferring
  athletes with an advisor; a placed or Inactive athlete is not chased.
- **Check-ins are staff only.** Owner and staff read and write the log
  and its notes. A family login and a member read no row, enforced in
  the database, because these athletes are minors and a note written
  for staff must never reach a parent through the API.
- **The message thread** is one per athlete, between the org's owner
  and staff and that athlete's family logins. A member never reads it.
- **A family writes exactly one thing**: a message it authors, on an
  athlete it is linked to, plus its own read marker. It cannot edit or
  delete a message (staff can), cannot sign as someone else, and cannot
  file a message under another org.
- **No email yet.** A new message is signalled only by the unread count
  in the app.

## Adding, editing and removing (2026-09-27)

Dave: "everything should be very easy for anyone to edit anything...
add and delete and all that good stuff." Every record a person can add
they can now correct and remove where it lives, and every removal asks
first (a ConfirmButton inside the form). Every write checks the role on
the server and is scoped by org, and by athlete or target as well where
the row belongs to one.

| Record | Add | Edit | Remove |
|---|---|---|---|
| Athlete | owner, staff | owner, staff | owner, staff (a soft delete: off every list, targets kept on file) |
| Athlete note | owner, staff | nobody | owner, staff |
| Contact, metric, check-in, transcript course | owner, staff | owner, staff | owner, staff |
| Message | owner, staff, a linked family | nobody | owner, staff |
| Family link | owner, staff (invite, link another athlete) | owner, staff (relationship) | owner, staff (one athlete at a time) |
| Target, contact log entry, visit, award | owner, staff | owner, staff | owner, staff |
| Document | owner, staff | owner, staff (correct a pending reading) | owner, staff (discarded or failed only) |
| Grading scale, approved list | owner, staff | owner, staff | owner, staff |
| School | owner | owner | owner (refused while anything points at it; merge instead) |
| Coach (the shared directory) | owner | owner | owner |
| Transfer window | owner | owner | owner |
| Org name, role labels, modules | anyone signed in (a new org) | owner | nobody (not built) |
| Member role | owner (invite) | owner | owner |
| Advisor assignment | any Admin (on the athlete's page, on Add, or several at once on the member page) | same | same (Clear Advisor on the athlete's page) |
| A person's name | | owner (anyone in the org), owner and staff (their own) | |
| Board, seat, donor, gift, pledge, campaign, grant (modules on) | owner, staff | owner, staff | owner, staff (a board with seats cannot be removed; a donor is a soft delete) |

A family login and a member add, edit and remove nothing except a
family's own messages on its own athlete's thread.

- **Enrolled and Graduated are set by Mark Enrolled and Mark Graduated,
  never by Edit.** Edit corrects an Enrollment Date or Graduated On
  already set (the enrollment date also for a transfer, whose clock
  started elsewhere). Graduated On can never be before the enrollment.
- **A pledge's Fulfilled is worked out from its payments.** Editing or
  removing a gift re-settles its pledge both ways. Written Off is a
  choice and is left alone.
- **Duplicates are caught by name key** (`lower(btrim(name))`): an
  athlete on this roster (Add Anyway goes past it), a school anywhere.
- **Athlete notes are staff only.** Owner and staff read and write them;
  a family login or a member never reads one, enforced in the database
  (`athlete_notes`, never a column on `athletes`). A note is written
  once and removed, never edited. Mark Enrolled, Mark Graduated, Mark
  Drafted and Reopen Recruiting each file theirs with the step's name.

## Who edits the shared directory (2026-09-27)

- Schools, college coaches and transfer windows are shared by every
  organization. Only an owner of an organization marked
  `orgs.edits_shared_directory` can add, edit, import, merge or remove
  them. Being an owner of some organization is not enough.
- The first organization created on a fresh install is marked
  automatically. On this deployment Bridge is marked by a one-off
  statement, never by a migration. Nothing in the app can set the flag.
- Anyone signed in with no organization, or who only owns
  organizations, can create one and becomes its owner. A staff, member
  or family login cannot, so a parent can never make themselves an
  owner.
- Merging two schools never deletes another organization's notes or
  targets: notes are joined under "Merged from ...", and the more
  advanced stage of two targets for one athlete is kept.

## Autofill (2026-09-27)

"More buttons, less typing." A field suggests what the org already has
and what the public directory has, and a pick fills its neighbours.

- **A fill happens only when the field is blank.** Picking a high school
  fills Home State, a college fills Current Division, a coach fills
  email and phone, a donor fills a board seat's contact details, a
  transcript's header fills a blank High School. A typed value always
  wins, on the client and again on the server, and the server looks
  the pick up itself rather than trusting an id from the browser.
- **The high school directory is seeded from public files only**: the
  NCES Common Core of Data (public schools) and Private School Survey,
  grade 12 schools, loaded by `scripts/load_high_schools.ts`. Nothing an
  org entered ever goes into it, and it never ships in a migration.
  Until it is loaded, suggestions come from the org's own names.
- **The org's own names come first**: the high schools on its athletes,
  transcripts, grading scales and approved lists, then the directory in
  the states its athletes live in.
- **No data in a migration** from 0040 on: no org, athlete, school,
  coach, window, high school, donor or user row. A new install starts
  empty; data comes in through the app or a one-off script.

## Fit-scoring model

The scoring rules Dave picked on 2026-09-20 (which number scores, the
presets and the goal shift, net cost against a family budget, the
floors that veto, the grade blend, positional need, the strong-match
window) are in docs/MATCHING_CONTRACT.md, and every number lives in
`src/lib/fit/contract.ts`. That contract wins over anything below.

See docs/ARCHITECTURE.md for the full design rationale (the `veto`
field, the weighted blend, why this replaces Bridge's `calcCollegeFit`
patch stack). The score bands used to turn a 0-100 score into a
Conflict/Reach/Fit/Safety tag are centralized in `src/lib/fit/bands.ts`
- one scale, used everywhere, unlike Bridge which had four different
scales across its four `calc*FitTag` functions plus a fifth just for
sorting.
