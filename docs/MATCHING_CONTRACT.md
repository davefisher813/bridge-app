# Matching and Metrics Contract

Locked 2026-09-20 from Dave's picks in the Matching and Metrics catalog
(https://claude.ai/artifact/QEkpJRFCMCiyaQmyu59kZV, forty decisions,
every one answered). This is the contract for the metrics log, school
matching, the scoring rules and the school data. It overrides judgment
the same way docs/STYLING_CATALOG.md does for looks. Where a rule is
Dave's own words, they are quoted. Where a number is my reading of his
words, it is marked (interpretation) and lives in one constants file so
it can change without a rewrite.

## What the old site got wrong, in his words

"The concept was great but it never worked. It drained API usage like
crazy. Data never stored. We had to always rerun the matches. So what we
have discussed is already better but it HAS to be clean and store
forever. There's no need to keep running matches once it's ran. And the
school data should be in our system forever once we have it."

Three hard rules follow:

1. **Matching never calls an outside service.** The engine is pure code
   over rows we hold. No model, no API, nothing metered.
2. **A match is stored, not recomputed on view.** Every athlete by school
   score lives in `athlete_school_fits` with the dimensions, reasons,
   warnings, a hash of the inputs and a timestamp. It is recomputed only
   when one of its inputs changes (below), inside the server action that
   changed it. A screen reads rows; it never scores.
3. **School data is ours once it is in.** Schools import to our table and
   stay. Nothing is fetched live.

## 1. Metrics

| Decision | Pick |
|---|---|
| Where metrics live | A Metrics screen off the athlete page with a dated log. The athlete page shows the current number. |
| What one entry carries | Value, date, where it was measured. |
| Which number scores | Best verified, else most recent. |
| Source | Sets confidence. Score is the same; the app says how sure it is. |
| Fields per position | The metrics the engine scores for the position first, everything else under More. |
| Who enters | Staff and owners. |
| Improvement | Current number with a sparkline of the log. |
| Sports | Baseball, Softball, Basketball, Soccer. Football, volleyball and lacrosse keep the single-tier model as is. |
| Typing | Decimal field with the number pad, the unit printed beside it. |

**Sources and trust.** "Premier tech is the most reliable. PBR and
Perfect Game still work but not nearly as reliable. Still valid enough."

| Tier | Source | Confidence |
|---|---|---|
| 1 | Premier (Premier Athletics tech) | high |
| 2 | PBR, Perfect Game, other showcase or event | high |
| 3 | Coach-timed practice | medium |
| 4 | Self-reported | low |

The scoring entry for a metric is the best value in the best tier that
has one. Its tier is the athletic dimension's confidence. "Best" is
lowest for a time, highest for everything else.

**The metrics, by position group.** His words: "Velocity for pitchers
and strike pct (difficult to measure) and size of the pitcher. OF: exit
velocity and speed / arm strength. MIF: same as outfield but skill
matters more than raw skillset. C: pop time and size, skill matters the
most. 1B/3B: exit velo and size."

| Group | Scored first | Under More |
|---|---|---|
| RHP, LHP | FB velo, strike % | height, weight, 60 |
| Catcher | pop time, arm, exit velo, 60 | height, weight |
| MIF (SS, 2B, CF) | 60, arm, exit velo | height, weight |
| Corner (1B, 3B, LF, RF) | exit velo, 60, arm | height, weight |

Height and weight are measurables (inches, pounds) shown on the athlete.
They have no benchmark; "size" reaches the score through the Frame grade
below (interpretation).

Strike percentage is a pitcher measurable. Target 63% meets, within 8%
near (interpretation, provisional: he called it difficult to measure).

**Staff grades.** "Frame, twitchy v non twitchy, how he moves, natural
skill set, IQ/instincts, body language/competitive nature, and metrics."
Five grades on the 20 to 80 scouting scale, entered by staff on the
athlete: Frame, Athleticism, Skill, Baseball IQ, Competitiveness. They
blend into the athletic score with a weight per position group taken
from "skill matters more" and "skill matters the most" (interpretation):

| Group | Metrics | Grades |
|---|---|---|
| Catcher | 50% | 50% |
| MIF | 60% | 40% |
| Corner, OF | 75% | 25% |
| Pitchers | 75% | 25% |

A grade of 50 scores 50, 80 scores 100, 20 scores 0, linear. With no
grades on file the athletic score is metrics alone.

## 2. School matching

| Decision | Pick |
|---|---|
| Where it lives | Both: a Matches section on the athlete page (top five, See All) and a full screen with filters and Add to Board. |
| A match row | School, division, score and tag. The first reason on the second line. |
| Conflicts | At the bottom under a Conflicts rule, dimmed, each saying what blocks it. |
| Missing numbers | Leave the unknown dimension out of the blend and say so: "scored on academic and financial only". |
| Filters | Division, state or region, conference, major offered, cost ceiling, scholarship type, playing-time outlook. Sport sponsored always applies. |
| Default filters | None. Every school on file, ranked. |
| To the board | Add to Board on every row, creating a target at the Target stage. The row then shows the stage. |
| Order | Score, high to low. |
| Transfers | When the portal window is on file and the entry date misses it, the school goes to Conflicts. |
| Today | A Strong Matches section: athletes with a new Safety or Fit, one row each, only when there is one. |

"New" on Today means the stored fit was computed in the last seven days,
is Safety or Fit, and the school is not on the board (interpretation).

## 3. The scoring rules

| Decision | Pick |
|---|---|
| High school blend | Per-org preset. |
| Transfer blend | 30 academic, 30 athletic, 15 financial, 25 eligibility, scaled by the preset the same way. |
| Bands | 80 Safety, 55 Fit, 35 Reach, below is Conflict. |
| A school's tier | A Program Tier field on the school: Elite D1, Mid-Major D1, Low D1, D2 D3 NAIA, JUCO. Defaults from the division. Set by an owner. |
| Near | Within 8% of the target scores half. |
| Numbers as a conflict | When the primary number is under the floor. |
| Financial | A family budget on the athlete. Net cost after aid against it. |
| Offers, visits, messages | Shown as chips. Never move the score. |
| Academic adjustments | Rigor boost and test shift, as now. |
| Stale profile | Warn at 90 days. |

**Money.** "You need to value money a lot more. It's arguably the
biggest driving factor. The school has to financially make sense. Then
it's based on the student's goals. If they want to leverage baseball for
the best education or maximize their baseball development and
opportunities. Then we find a school that puts them on track to
accomplish those goals." And: "What they will most qualify for with
academic scholarships and financial aid."

So the presets, with Bridge's default first (interpretation of the
numbers, not the order):

| Preset | Academic | Athletic | Financial |
|---|---|---|---|
| Money First (Bridge default) | 30 | 30 | 40 |
| Academics First (added 2026-09-21 at Dave's request) | 50 | 30 | 20 |
| Balanced | 40 | 40 | 20 |
| Sport First (labelled Baseball First until 2026-09-21; the stored key is still baseball_first) | 30 | 50 | 20 |

For a transfer the eligibility weight is 25 and the three above are
scaled to fill 75.

**The athlete's goal** shifts the preset: Education First moves 10 from
athletic to academic; Development First moves 10 from academic to
athletic; Balanced moves nothing. Financial never moves. Set on the
athlete (interpretation of "based on the student's goals").

**Net cost.** Cost is the out-of-state total unless the athlete's home
state matches the school's state. Aid that counts (interpretation):

- Athletic: the school's average athletic aid, unless D3 or scholarship
  type none.
- Merit: the school's average merit aid times a GPA factor: 3.7 and up
  1.0, 3.4 to 3.69 0.7, 3.0 to 3.39 0.4, below 0.
- Need: half the school's average need aid, as "possible".

Net cost against the family budget: at or under budget scores 85 plus up
to 15 for the margin; within 25% over scores 60; within 50% over scores
40; further over scores 20. Every aid line is a reason so the family
sees what they would most qualify for. With no budget on file the
dimension keeps today's school-only model and reports low confidence.
Financial never vetoes.

Added 2026-09-21, consistent with the above: an applied award letter
for this athlete at this school replaces the estimate entirely. Its net
cost (as read, or cost of attendance less gift aid, never less a loan)
is scored against the budget on the same bands at high confidence, and
the first reason says "from the award letter". With no budget on file
it is shown at low confidence and not judged. The letter lives on the
recruiting target (`recruiting_targets.aid`, migration 0027).

**Floors.** The athletic dimension vetoes when the primary number is
under the tier's floor:

| Group | Primary | Floor |
|---|---|---|
| Pitchers | FB velo | the tier's FB floor (fbMin) |
| Catcher | Pop time | the tier's pop time plus 0.10s |
| MIF, Corner, OF | 60 time | the tier's 60 max |

Everything else below target lowers the score and stays a warning.

**Positional need.** An org can list positions of need on a school
(private to the org). An athlete whose position group and grad year
match adds 10 to the overall score and a reason.

**Unknown dimensions.** A dimension with confidence unknown is left out
and the remaining weights are renormalized. The stored fit carries
`partial: true` and which dimensions counted.

## 4. School data

| Decision | Pick |
|---|---|
| How schools get in | CSV import by an owner, with a template. Rows with problems are listed; nothing half-imports. |
| Shared or per org | Shared facts, private notes per org: coach contact, positions of need, notes. |
| Required on import | Name, division, conference, state, sports sponsored, GPA minimum, GPA average, SAT range, scholarship type, average athletic aid, cost in state, cost out of state, merit and need aid (D3), head coach and email, majors offered. |
| Positional need | On the school, per org, boosting the match. |
| Source | "Maybe. I have some data I think in Google Sheets." Export to the template. |

Head coach and email are per-org overlay fields, not shared facts, since
a coach relationship belongs to the org that has it.

## 5. Who sees it

"Of course the students see this. They need the same access to their own
personal data." Metrics entry stays staff-only for now (his pick), and
every score, reason and warning is written so a family can read it. The
family role shipped 2026-09-21 (migrations 0022 to 0024, the screens
under `/org/[slug]/family`); a family sees the same score, tag, four
dimensions and every reason staff see, and changes nothing.

## Inputs that trigger a recompute

| Changed | Recomputed |
|---|---|
| An athlete's profile, goal, budget, home state, grades | That athlete against every school |
| A metric logged or removed | That athlete against every school |
| A school's shared facts or program tier | Every athlete in every org against that school |
| An org's overlay on a school | Every athlete in that org against that school |
| The org's scoring preset | Every athlete in the org against every school |
| A CSV import | The imported schools against every athlete |
| Recalculate All (owner, under More) | Everything in the org |

## Where the numbers live

`src/lib/fit/contract.ts` carries every number above: presets, goal
shifts, bands, near, floors, grade weights, source tiers, GPA factors
for merit aid, net-cost bands, the positional-need boost, the
strong-match window. The laws in `src/laws/matchingLaws.test.ts` read
the same file, so a changed number changes the app and its tests
together.
