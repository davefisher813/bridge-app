# Business rules

## Org / module model

- Every org gets `recruiting` and `doc_ai` on by default; they are the
  core product.
- `board_governance` and `donor_fundraising` are off by default. Bridge
  turns both on. Elite Squad turns neither on.
- An org's role labels (what "owner" and "staff" are called for that
  org) are display-only config in `orgs.role_labels`. They never affect
  what a role can actually do - that's the fixed `org_role` enum plus
  `requireRole()` / `requireOwner()` in `src/lib/auth/guard.ts`.

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
