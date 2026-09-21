// Entry point for the functional test bench artifact.
//
// The point: this imports the SHIPPED modules, not copies of them. The fit
// engine and Doc AI are walled off from Next, Supabase and the DOM
// precisely so they are pure functions over plain types (CLAUDE.md), which
// means esbuild can bundle them straight into a browser page. What Dave
// runs in the artifact is the same code that runs in the app. If it passes
// there it passes here, and if it is wrong here it is wrong in production.
//
// Built by scripts/build_testbench.py.

import { scoreFit } from "../src/lib/fit/score";
import { scoreFinancial } from "../src/lib/fit/financial";
import { scoreEligibility } from "../src/lib/fit/transfer";
import { scoreAcademic } from "../src/lib/fit/academic";
import { scoreAthletic } from "../src/lib/fit/athletic";
import type { Athlete, School, TransferWindow } from "../src/lib/fit/types";
import { detectCategory, runExtractionPipeline } from "../src/lib/docai/pipeline";
import { createStubCaller } from "../src/lib/docai/stubCaller";
import type { DocCategoryId, IngestedRecord, ResolverAthlete, SourceRole } from "../src/lib/docai/types";
import { findCandidates } from "../src/lib/docai/resolver";
import { effectiveConfidence, routeDecision, NAME_MATCH_AUTO } from "../src/lib/docai/provenance";
import { calculateCoreGpa, gradePoints, MAX_WEIGHT_BONUS, type CoreCourse } from "../src/lib/fit/ncaa/coreGpa";
import { DIVISION_STANDARDS, evaluateInitialEligibility } from "../src/lib/fit/ncaa/initialEligibility";
import { evaluateAgeClock } from "../src/lib/fit/ncaa/ageClock";
import { gradingScaleProblem, resolveScale, TEN_POINT_STARTING_POINT } from "../src/lib/fit/ncaa/gradingScale";
import { matchCourseTitle, applyApprovedLists, approvedListProblem, type ApprovedCourseList } from "../src/lib/fit/ncaa/approvedCourses";
import { parseApprovedListPaste, parseIsSaveable } from "../src/lib/fit/ncaa/approvedListPaste";
import { letterFromScale } from "../src/lib/fit/ncaa/fromTranscript";
import { checkIngestedRecord } from "../src/lib/docai/acceptance";
import { summarize as summarizeFundraising, toCents as moneyToCents, campaignProgress } from "../src/lib/fundraising/rollup";
import { creditedGifts, giveGetProgress, summarizeBoard } from "../src/lib/governance/giveGet";
import { MAX_INGEST_BYTES } from "../src/lib/docai/limits";
import { selectScoringMetrics } from "../src/lib/fit/metrics";
import { BANDS, DEFAULT_PRESET, GOAL_SHIFT, NET_COST_BANDS, POSITIONAL_NEED_BOOST, PRESETS, blendWeights } from "../src/lib/fit/contract";

// ---------------------------------------------------------------- assertions

interface Check {
  suite: string;
  name: string;
  pass: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(suite: string, name: string, fn: () => string | null): void {
  try {
    const failure = fn();
    checks.push({ suite, name, pass: failure === null, detail: failure ?? "ok" });
  } catch (e) {
    checks.push({ suite, name, pass: false, detail: `threw: ${(e as Error).message}` });
  }
}

const hsAthlete = (over: Partial<Athlete> = {}): Athlete => ({
  id: "a",
  orgId: "o",
  recruitType: "hs",
  name: "Test Athlete",
  sport: "baseball",
  gpa: 3.5,
  ...over,
});

const school = (over: Partial<School> = {}): School => ({
  id: "s",
  name: "Test School",
  division: "D2",
  sportsSponsored: ["baseball"],
  ...over,
});

function runSuite(): Check[] {
  checks.length = 0;

  // These are the repo's own laws (src/laws/fitLaws.test.ts), run against
  // the same functions the app calls. Not a re-implementation of them.
  for (const schType of ["full", "partial", "none"] as const) {
    check("D3 scholarships", `never claims availability when the record says "${schType}"`, () => {
      const result = scoreFinancial(
        hsAthlete(),
        school({ division: "D3", financials: { athleticScholarship: schType, avgMeritAid: 15000, outstateTotal: 50000 } })
      );
      const text = [...result.reasons, ...result.warnings].join(" ").toLowerCase();
      if (/scholarships? (are |is )?available/.test(text)) return `claimed availability: ${text}`;
      if (!/not allowed by ncaa rules/.test(text)) return `never said it is banned: ${text}`;
      return null;
    });
  }

  check("D3 scholarships", "spelling variants still trigger the ban", () => {
    for (const division of ["d3", "NCAA D3", "Division III", " D3 "]) {
      const result = scoreFinancial(hsAthlete(), school({ division, financials: { athleticScholarship: "full" } }));
      if (!/not allowed by NCAA rules/i.test(result.reasons.join(" "))) return `"${division}" slipped through`;
    }
    return null;
  });

  // Fixtures deliberately mirror src/laws/fitLaws.test.ts. The first pass
  // here did not: it used a numeric seasonYear and left out transferCount,
  // so no window ever matched and the "outside the window vetoes" check
  // quietly passed through the one-time-transfer exception instead. The
  // app was right and the bench was wrong, which is exactly the failure
  // mode a bench has to be built to avoid.
  const transfer = (over: Partial<Athlete["detail"]> = {}): Athlete =>
    hsAthlete({
      recruitType: "transfer_4to4",
      detail: {
        kind: "transfer",
        currentSchool: "Old U",
        eligibilityYearsRemaining: 2,
        transferCount: 1,
        portalEntryDate: "2026-06-15",
        ...over,
      } as Athlete["detail"],
    });
  const d1 = school({ division: "D1" });
  const windows: TransferWindow[] = [
    { sport: "baseball", division: "D1", seasonYear: "2026", windowLabel: "undergrad primary", opensOn: "2026-06-01", closesOn: "2026-06-30" },
  ];

  check("Portal windows", "timing is unverified when no window record is supplied", () => {
    const result = scoreEligibility(transfer(), d1, []);
    if (result.veto) return "vetoed on a window it cannot see";
    const text = [...result.reasons, ...result.warnings].join(" ").toLowerCase();
    if (/falls within/.test(text)) return `asserted a window it cannot see: ${text}`;
    if (!/not on file|not verified/.test(text)) return `did not say it is unverified: ${text}`;
    return null;
  });

  check("Portal windows", "a real window confirms an entry inside it", () => {
    const result = scoreEligibility(transfer(), d1, windows);
    if (result.veto) return "vetoed an entry that was inside the window";
    if (!/falls within/.test(result.reasons.join(" "))) return "did not confirm the entry was inside";
    return null;
  });

  check("Portal windows", "a real window vetoes an entry outside it", () => {
    const result = scoreEligibility(transfer({ portalEntryDate: "2026-07-15" } as Partial<Athlete["detail"]>), d1, windows);
    if (!result.veto) return "let an entry outside the window through";
    return null;
  });

  check("Vetoes", "an elite athlete at a school that does not sponsor the sport is still a Conflict", () => {
    const athlete = hsAthlete({ gpa: 4.0, measurables: { exitVelo: 100, sixtyYard: 6.4 } });
    const result = scoreFit(athlete, school({ sportsSponsored: ["football"] }), { signals: { offer: { offerType: "scholarship" } } });
    if (result.tag !== "Conflict") return `tag was ${result.tag}, not Conflict`;
    return null;
  });

  check("Vetoes", "a veto is never averaged away by the blend", () => {
    const athlete = hsAthlete({ gpa: 4.0 });
    const vetoed = scoreFit(athlete, school({ sportsSponsored: ["football"] }));
    const clean = scoreFit(athlete, school());
    if (vetoed.score >= clean.score) return `vetoed scored ${vetoed.score}, clean scored ${clean.score}`;
    return null;
  });

  check("Scoring", "a placed athlete is not re-evaluated", () => {
    const result = scoreFit(hsAthlete(), school(), { isPlaced: true });
    if (!result.reasons.join(" ").toLowerCase().includes("placed")) return "did not say it skipped evaluation";
    return null;
  });

  check("Scoring", "every score stays inside 0 to 100", () => {
    const cases: [Athlete, School][] = [
      [hsAthlete({ gpa: 0 }), school()],
      [hsAthlete({ gpa: 4 }), school({ division: "D1" })],
      [hsAthlete({ gpa: undefined }), school({ division: "D3" })],
      [hsAthlete({ gpa: 4, measurables: { exitVelo: 120 } }), school({ division: "NAIA" })],
    ];
    for (const [a, s] of cases) {
      for (const dim of [scoreFit(a, s), scoreAcademic(a, s), scoreAthletic(a, s), scoreFinancial(a, s)]) {
        if (dim.score < 0 || dim.score > 100) return `got ${dim.score}`;
      }
    }
    return null;
  });

  check("Scoring", "missing data lowers confidence rather than inventing a number", () => {
    const bare = scoreAcademic(hsAthlete({ gpa: undefined }), school({ academics: {} }));
    if (bare.confidence === "high") return "claimed high confidence with nothing to go on";
    return null;
  });

  // ---- The matching contract (docs/MATCHING_CONTRACT.md), same code
  // path the metrics log, the athlete form and the matches screen use ----
  check("Matching", "the best verified number scores, not the biggest self-reported one", () => {
    const pick = selectScoringMetrics([
      { id: "self", metric: "fbVelo", value: 91, measuredOn: "2026-09-01", source: "self" },
      { id: "premier", metric: "fbVelo", value: 86, measuredOn: "2026-08-15", source: "premier" },
      { id: "coach", metric: "fbVelo", value: 88, measuredOn: "2026-06-01", source: "coach" },
    ]);
    if (pick.measurables.fbVelo !== 86) return `scored ${pick.measurables.fbVelo}, not the Premier 86`;
    if (pick.confidence.fbVelo !== "high") return `confidence ${pick.confidence.fbVelo}`;
    if (pick.scoredEntryId.fbVelo !== "premier") return "marked the wrong entry";
    return null;
  });

  check("Matching", "a time picks the lowest number in the best tier", () => {
    const pick = selectScoringMetrics([
      { id: "a", metric: "sixty", value: 6.9, measuredOn: "2026-07-20", source: "pbr" },
      { id: "b", metric: "sixty", value: 6.7, measuredOn: "2026-09-14", source: "coach" },
      { id: "c", metric: "sixty", value: 7.0, measuredOn: "2026-05-01", source: "pbr" },
    ]);
    if (pick.measurables.sixty !== 6.9) return `scored ${pick.measurables.sixty}, not the PBR 6.9`;
    return null;
  });

  check("Matching", "every preset blends to one and the default is Money First", () => {
    for (const [key, p] of Object.entries(PRESETS)) {
      const sum = p.weights.academic + p.weights.athletic + p.weights.financial;
      if (Math.abs(sum - 1) > 1e-9) return `${key} sums to ${sum}`;
    }
    if (DEFAULT_PRESET !== "money_first") return `default is ${DEFAULT_PRESET}`;
    if (PRESETS.money_first.weights.financial < PRESETS.money_first.weights.academic) return "Money First does not weight money most";
    return null;
  });

  check("Matching", "an applied award letter replaces the aid estimate", () => {
    const a = hsAthlete({ familyBudgetCents: 2_000_000 });
    const s = school({ financials: { outstateTotal: 50_000, athleticScholarship: "partial", avgAthleticAid: 5_000 } });
    const estimate = scoreFinancial(a, s);
    const letter = scoreFinancial(a, s, { netCost: 12_000, academicYear: "2027-28" });
    if (letter.confidence !== "high") return `confidence ${letter.confidence}, expected high`;
    if (!/award letter for 2027-28/.test(letter.reasons[0] ?? "")) return `first reason was "${letter.reasons[0]}"`;
    if (letter.score <= estimate.score) return `letter ${letter.score} did not beat the estimate ${estimate.score}`;
    return null;
  });

  check("Matching", "the goal shifts academic and athletic and never money", () => {
    const base = blendWeights("balanced", "balanced", false);
    const edu = blendWeights("balanced", "education", false);
    const dev = blendWeights("balanced", "development", false);
    if (Math.abs(edu.academic - base.academic - GOAL_SHIFT) > 1e-9) return "Education First did not add the shift to academic";
    if (Math.abs(dev.athletic - base.athletic - GOAL_SHIFT) > 1e-9) return "Development First did not add the shift to athletic";
    if (edu.financial !== base.financial || dev.financial !== base.financial) return "money moved";
    return null;
  });

  check("Matching", "a transfer gives eligibility a quarter and scales the rest", () => {
    const w = blendWeights("money_first", "balanced", true);
    if (Math.abs(w.eligibility - 0.25) > 1e-9) return `eligibility ${w.eligibility}`;
    const sum = w.academic + w.athletic + w.financial + w.eligibility;
    if (Math.abs(sum - 1) > 1e-9) return `sums to ${sum}`;
    return null;
  });

  check("Matching", "a school under the family budget scores at least 85 and never vetoes", () => {
    const a = hsAthlete({ familyBudgetCents: 3000000, homeState: "CT", gpa: 3.8 });
    const s = school({ state: "CT", financials: { instateTotal: 40000, outstateTotal: 55000, avgAthleticAid: 10000, avgMeritAid: 8000, athleticScholarship: "partial" } });
    const r = scoreFinancial(a, s);
    if (r.veto) return "money vetoed";
    if (r.score < NET_COST_BANDS.underBudget) return `scored ${r.score} under budget`;
    return null;
  });

  check("Matching", "a D3 school gets no athletic aid in the net cost", () => {
    const a = hsAthlete({ familyBudgetCents: 1000000, gpa: 2.5 });
    const s = school({ division: "D3", financials: { outstateTotal: 60000, avgAthleticAid: 30000, athleticScholarship: "full" } });
    const r = scoreFinancial(a, s);
    if (r.reasons.concat(r.warnings).join(" ").toLowerCase().includes("athletic aid")) return "counted athletic aid at D3";
    if (r.score > NET_COST_BANDS.further) return `scored ${r.score} for a school four times the budget`;
    return null;
  });

  check("Matching", "no budget on file means low confidence, not a guess", () => {
    const r = scoreFinancial(hsAthlete({ familyBudgetCents: undefined }), school({ financials: { outstateTotal: 50000, athleticScholarship: "partial", avgAthleticAid: 12000 } }));
    if (r.confidence === "high") return "claimed high confidence with no budget";
    if (!r.warnings.join(" ").toLowerCase().includes("budget")) return "did not ask for a budget";
    return null;
  });

  check("Matching", "a pitcher under the tier's fastball floor is a Conflict", () => {
    const a = hsAthlete({ position: "RHP", measurables: { fbVelo: 70 }, measurableConfidence: { fbVelo: "high" } });
    const r = scoreFit(a, school({ division: "D1", programTier: "elite_d1" }));
    if (r.tag !== "Conflict") return `tagged ${r.tag} at 70 mph for elite D1`;
    return null;
  });

  check("Matching", "a position of need adds the boost and says so", () => {
    const a = hsAthlete({ position: "SS", gpa: 3.5, measurables: { sixty: 6.8, exitVelo: 90, armVelo: 85 }, detail: { kind: "hs", gradYear: 2027 } });
    const s = school();
    const plain = scoreFit(a, s);
    const need = scoreFit(a, s, { positionalNeed: [{ position: "SS", gradYear: 2027 }] });
    if (need.score - plain.score !== Math.min(POSITIONAL_NEED_BOOST, 100 - plain.score)) return `boosted by ${need.score - plain.score}`;
    if (!need.reasons.join(" ").toLowerCase().includes("need")) return "no reason given";
    return null;
  });

  check("Matching", "a dimension with no data is left out and the score says so", () => {
    const a = hsAthlete({ gpa: undefined, measurables: {}, familyBudgetCents: 2000000 });
    const r = scoreFit(a, school({ financials: { outstateTotal: 30000 } }));
    if (!r.partial) return "not marked partial";
    if (r.counted.includes("academic") || r.counted.includes("athletic")) return `counted ${r.counted.join(", ")}`;
    if (!r.warnings.join(" ").toLowerCase().includes("scored on")) return "did not say what it scored on";
    return null;
  });

  check("Matching", "the bands are 80 Safety, 55 Fit, 35 Reach", () => {
    if (BANDS.safety !== 80 || BANDS.fit !== 55 || BANDS.reach !== 35) return `bands ${JSON.stringify(BANDS)}`;
    return null;
  });

  // ---- Doc AI, same code path the upload screen uses ----
  const roster: ResolverAthlete[] = [
    { id: "a1", name: "Sample Athlete", school: "Sample High School", gradYear: 2027 },
    { id: "a2", name: "Marcus Bellamy", school: "Other High", gradYear: 2026 },
    // A sibling pair, because the real roster has one and that is what
    // exposed the wrong-athlete route.
    { id: "a3", name: "Darnell Whitfield", school: "Monroe (Comp Sci HS)", gradYear: 2027 },
    { id: "a4", name: "Ervin Whitfield", school: "James Monroe", gradYear: 2022 },
    { id: "a5", name: "Jayden (JJ) Pereira", school: "Elite Squad Academy", gradYear: 2025 },
  ];

  check("Doc AI routing", "source role changes the outcome, not just the number", () => {
    const mine = effectiveConfidence(0.95, "coordinator", 0.97);
    const theirs = effectiveConfidence(0.95, "parent", 0.97);
    if (!(theirs < mine)) return `parent ${theirs} was not below coordinator ${mine}`;
    if (routeDecision(mine, 1) !== "auto_apply") return "a clean coordinator upload did not auto-apply";
    if (routeDecision(theirs, 1) !== "review") return "the same scan from a parent did not go to review";
    return null;
  });

  check("Doc AI routing", "a weak name match blocks auto-apply even at high confidence", () => {
    if (routeDecision(0.97, 0.3) !== "review") return "applied a document it could not confidently attach to anyone";
    return null;
  });

  check("Doc AI matching", "the right athlete outranks a similar name", () => {
    const found = findCandidates({ studentName: "Sample Athlete", school: "Sample High School", gradYear: 2027 }, roster);
    if (found[0]?.athlete.id !== "a1") return `top match was ${found[0]?.athlete.id ?? "nobody"}`;
    return null;
  });

  check("Doc AI matching", "a name nobody on the roster has matches nobody", () => {
    const found = findCandidates({ studentName: "Zxqw Vbnm", school: null, gradYear: null }, roster);
    if (found.length > 0) return `matched ${found[0]!.athlete.name} anyway`;
    return null;
  });

  // The next four all failed against Dave's real Google Drive documents
  // before 2026-09-15. Real transcripts print names one way, the roster
  // stores them another, and two brothers share a surname.
  check("Doc AI matching", 'a transcript that prints "Lastname, Firstname Middlename" still matches', () => {
    const found = findCandidates({ studentName: "Athlete, Sample Alexander", school: "Sample High School", gradYear: 2027 }, roster);
    const top = found[0];
    if (top?.athlete.id !== "a1") return `top match was ${top?.athlete.name ?? "nobody"}`;
    if (top.score < NAME_MATCH_AUTO) return `scored ${top.score.toFixed(3)}, under the ${NAME_MATCH_AUTO} auto-apply bar`;
    return null;
  });

  check("Doc AI matching", "a nickname in brackets on the roster does not break the match", () => {
    const found = findCandidates({ studentName: "Pereira, Jayden", school: "Elite Squad Academy", gradYear: 2025 }, roster);
    if (found[0]?.athlete.id !== "a5") return `top match was ${found[0]?.athlete.name ?? "nobody"}`;
    return null;
  });

  check("Doc AI matching", "a surname on its own is never enough to identify anyone", () => {
    const found = findCandidates({ studentName: "Whitfield", school: null, gradYear: null }, roster);
    const top = found[0];
    if (top && top.score >= NAME_MATCH_AUTO) return `"Whitfield" scored ${top.score.toFixed(3)} against ${top.athlete.name}`;
    return null;
  });

  check("Doc AI routing", "a document is not written to a record when a sibling is right behind", () => {
    if (routeDecision(0.99, 0.8, 0.72) !== "review") return "auto-applied with the runner-up 0.08 behind";
    if (routeDecision(0.99, 0.95, 0.4) !== "auto_apply") return "a clear winner was blocked from auto-applying";
    return null;
  });

  // NCAA rules, verified against NCAA-published documents on
  // 2026-09-15 and cited in docs/BUSINESS_RULES.md. These run the same
  // functions the app calls.
  const core = (over: Partial<CoreCourse> = {}): CoreCourse => ({ title: "Course", subject: "english", credit: 1, grade: "B", ...over });
  const sixteen = (grade: string): CoreCourse[] =>
    Array.from({ length: 16 }, (_, i) => core({ title: `Core ${i}`, grade, ncaaApproved: true, subject: i < 4 ? "english" : i < 7 ? "math" : i < 9 ? "science" : i < 11 ? "social_science" : "other_academic" }));

  check("NCAA core GPA", "the scale is A=4 B=3 C=2 D=1, with no plus or minus", () => {
    if (gradePoints("A") !== 4 || gradePoints("B") !== 3 || gradePoints("C") !== 2 || gradePoints("D") !== 1) return "the base scale is not 4/3/2/1";
    if (gradePoints("A-") !== 4) return `A- scored ${gradePoints("A-")}, but the NCAA does not permit minuses`;
    if (gradePoints("B+") !== 3) return `B+ scored ${gradePoints("B+")}, but the NCAA does not permit pluses`;
    return null;
  });

  check("NCAA core GPA", "credit-only and withdrawn courses carry no quality points", () => {
    for (const g of ["CR", "W", "P", "I"]) {
      if (gradePoints(g) !== null) return `"${g}" scored ${gradePoints(g)} instead of nothing`;
    }
    return null;
  });

  check("NCAA core GPA", "the weighted bonus is capped at one quality point and needs the school on record", () => {
    const ap = core({ grade: "A", weighted: true, schoolWeightBonus: 3 });
    const capped = calculateCoreGpa([ap], 16, { schoolReportsWeightedGrades: true });
    if ((capped.gpa ?? 0) > 4 + MAX_WEIGHT_BONUS) return `bonus ran to ${capped.gpa}`;
    const withheld = calculateCoreGpa([ap], 16, {});
    if (withheld.gpa !== 4) return `applied a bonus with the school not on record: ${withheld.gpa}`;
    const rankOnly = calculateCoreGpa([ap], 16, { schoolReportsWeightedGrades: true, weightingIsClassRankOnly: true });
    if (rankOnly.gpa !== 4) return `applied a class-rank-only bonus: ${rankOnly.gpa}`;
    return null;
  });

  check("NCAA core GPA", "electives that are not on the approved list cannot lift the number", () => {
    const withElectives = [
      ...Array.from({ length: 16 }, (_, i) => core({ title: `Core ${i}`, grade: "C", ncaaApproved: true })),
      ...Array.from({ length: 6 }, (_, i) => core({ title: `PE ${i}`, grade: "A", ncaaApproved: false })),
    ];
    const r = calculateCoreGpa(withElectives, 16);
    if (r.gpa !== 2) return `core GPA came out at ${r.gpa} instead of 2.0`;
    return null;
  });

  check("NCAA eligibility", "D1 tiers: qualifier 2.3, academic redshirt 2.0, nonqualifier below", () => {
    if (DIVISION_STANDARDS.D1.qualifierGpa !== 2.3) return `qualifier is ${DIVISION_STANDARDS.D1.qualifierGpa}`;
    if (DIVISION_STANDARDS.D1.secondTierGpa !== 2.0) return `redshirt floor is ${DIVISION_STANDARDS.D1.secondTierGpa}`;
    const mixed = [...sixteen("B").slice(0, 4), ...sixteen("C").slice(4)]; // 2.25
    if (evaluateInitialEligibility({ division: "D1", courses: mixed }).status !== "academic_redshirt") return "2.25 did not land in the academic redshirt band";
    if (evaluateInitialEligibility({ division: "D1", courses: sixteen("D") }).status !== "nonqualifier") return "a 1.0 core GPA was not a nonqualifier";
    return null;
  });

  check("NCAA eligibility", "Division III never gets a core GPA or a qualifier status", () => {
    for (const div of ["D3", "NCAA D3", "Division III"]) {
      const r = evaluateInitialEligibility({ division: div, courses: sixteen("A") });
      if (r.coreGpa !== null) return `${div} was given a core GPA`;
      if (r.status !== "not_applicable") return `${div} was given the status ${r.status}`;
    }
    return null;
  });

  check("NCAA eligibility", "no number is invented for the unpublished D2 partial-qualifier floor", () => {
    if (DIVISION_STANDARDS.D2.secondTierGpa !== null) return "a D2 second-tier GPA has been made up";
    const r = evaluateInitialEligibility({ division: "D2", courses: sixteen("D") });
    if (r.status === "nonqualifier") return "declared a D2 nonqualifier on a floor the NCAA does not publish";
    return null;
  });

  check("NCAA eligibility", "a core GPA is never guessed without a course list", () => {
    const r = evaluateInitialEligibility({ division: "D1", courses: [] });
    if (r.coreGpa !== null) return "produced a core GPA from nothing";
    if (r.status !== "insufficient_data") return `status was ${r.status}`;
    return null;
  });

  check("NCAA age clock", "the five-year clock can start before an athlete enrolls anywhere", () => {
    const r = evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D1", intendedEnrollment: "2029-08-15", today: "2026-09-15" });
    if (r.startedBy !== "age") return `clock started by ${r.startedBy ?? "nothing"}`;
    if ((r.yearsBurnedAtEnrollment ?? 0) < 1.9) return `only ${r.yearsBurnedAtEnrollment} years burned before enrollment`;
    return null;
  });

  check("NCAA age clock", "does not apply to Division III", () => {
    if (evaluateAgeClock({ dateOfBirth: "2008-03-15", division: "D3", today: "2026-09-15" }).applies) return "ran the age clock for a D3 athlete";
    return null;
  });

  check("Grading scales", "a real table with a wide F band is accepted", () => {
    // The F band runs 0 to 64 on every real scale there is. A catch-all
    // rule that did not exempt it rejected every complete table, which
    // is what Doc AI was silently doing to transcript legends.
    const problem = gradingScaleProblem(TEN_POINT_STARTING_POINT);
    return problem === null ? null : `refused a real table: ${problem}`;
  });

  check("Grading scales", "a table whose letters run backwards is refused", () => {
    const problem = gradingScaleProblem([
      { letter: "A", min: 60, max: 69 },
      { letter: "B", min: 70, max: 79 },
      { letter: "C", min: 90, max: 100 },
    ]);
    return problem ? null : "accepted a table where A sits below C, which turns every good grade into a bad one";
  });

  check("Grading scales", "a confirmed table beats one an org typed in", () => {
    const picked = resolveScale([{ origin: "org" as const }, { origin: "verified" as const }]);
    return picked?.origin === "verified" ? null : `picked ${picked?.origin ?? "nothing"}`;
  });

  check("Grading scales", "the assumed default is only ever the last resort", () => {
    const withOrg = resolveScale([{ origin: "assumed" as const }, { origin: "org" as const }]);
    if (withOrg?.origin !== "org") return `preferred the assumption over a real table (${withOrg?.origin})`;
    const alone = resolveScale([{ origin: "assumed" as const }]);
    return alone?.origin === "assumed" ? null : "did not fall back at all";
  });

  // ── Approved course lists ──────────────────────────────────────────
  const CARDINAL = (isComplete: boolean): ApprovedCourseList => ({
    schoolName: "Cardinal Ridge High School",
    isComplete,
    source: "ncaa_portal",
    courses: [
      { title: "English 11", subject: "english" },
      { title: "Algebra II", subject: "math" },
      { title: "AP Biology", subject: "science" },
      { title: "Computer Science", subject: "other_academic" },
    ],
  });

  check("Approved lists", "a partial list can confirm a course but never exclude one", () => {
    const partial = CARDINAL(false);
    if (matchCourseTitle("Algebra II", partial).status !== "approved") return "failed to confirm a course that is on the list";
    const absent = matchCourseTitle("Ceramics", partial).status;
    return absent === "unknown" ? null : `a partial list ruled a course out (${absent}), which drops credits nobody checked`;
  });

  check("Approved lists", "a complete list does exclude a course that is not on it", () => {
    const s = matchCourseTitle("Ceramics", CARDINAL(true)).status;
    return s === "not_approved" ? null : `a complete list returned ${s} instead of excluding the course`;
  });

  check("Approved lists", "an ambiguous title is never resolved by guessing", () => {
    const twins: ApprovedCourseList = {
      schoolName: "X",
      isComplete: true,
      source: "ncaa_portal",
      courses: [
        { title: "AP Biology", subject: "science" },
        { title: "Biology Honors", subject: "other_academic" },
      ],
    };
    const m = matchCourseTitle("Biology", twins);
    if (m.status !== "ambiguous") return `picked ${m.entry?.title ?? m.status} between two equally good matches`;
    return m.entry === undefined ? null : "returned an entry alongside an ambiguous verdict";
  });

  check("Approved lists", "the list's subject beats the transcript's", () => {
    const r = applyApprovedLists(
      [{ title: "Computer Science", subject: "science", credit: 1, grade: "A" }],
      new Map([["cardinal ridge high school", CARDINAL(false)]]),
      () => "Cardinal Ridge High School",
    );
    return r.courses[0]?.subject === "other_academic"
      ? null
      : `kept the transcript's subject (${r.courses[0]?.subject}), which counts the course toward the wrong minimum`;
  });

  check("Approved lists", "a handful of rows may not call itself a whole catalog", () => {
    const three = [
      { title: "A", subject: "math" },
      { title: "B", subject: "english" },
      { title: "C", subject: "science" },
    ];
    if (!approvedListProblem({ courses: three, isComplete: true })) return "accepted three courses as a school's whole approved list";
    return approvedListProblem({ courses: three, isComplete: false }) === null ? null : "refused the same three as a partial list";
  });

  check("Approved lists", "a pasted portal table parses into courses", () => {
    const r = parseApprovedListPaste(["Course Title\tSubject\tCredit", "English 9\tEnglish\t1.0", "Algebra I\tMathematics\t1.0"].join("\n"));
    if (r.rows.length !== 2) return `parsed ${r.rows.length} rows out of a two-row table`;
    // The bug this check exists for: stripping digits turned "English 9"
    // into the category "English", so the title was eaten as the subject
    // and the course imported with no title of its own.
    if (r.rows[0]?.title !== "English 9") return `lost the course title, got "${r.rows[0]?.title}"`;
    return parseIsSaveable(r) ? null : "a clean paste was not saveable";
  });

  check("Approved lists", "a category the parser does not know is left for a person", () => {
    const r = parseApprovedListPaste("Underwater Basket Weaving\tElectives");
    if (r.rows[0]?.subject !== null) return `invented the subject ${r.rows[0]?.subject}`;
    return parseIsSaveable(r) ? "let a list save with a course that has no subject" : null;
  });

  check("Board give/get", "money brought in counts, not just money given", () => {
    // The half most board software drops, which understates everyone
    // who is good at fundraising.
    const p = giveGetProgress({
      member: { id: "m1", boardId: "b1", name: "X", donorId: "d1", roleTitle: null, status: "active", termStart: null, termEnd: null, commitmentCents: 1000000 },
      gifts: [{ id: "g1", amountCents: 600000, receivedOn: "2026-05-01", category: "board", method: "check", donorId: "someone-else", campaignId: null, pledgeId: null }],
      pledges: [],
      solicitedBy: { g1: "m1" },
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    if (p.raisedCents !== 600000) return `credited ${p.raisedCents} instead of 600000`;
    return null;
  });

  check("Board give/get", "a gift both made and solicited counts once", () => {
    // Otherwise somebody clears a $10,000 commitment with $5,000.
    const p = giveGetProgress({
      member: { id: "m1", boardId: "b1", name: "X", donorId: "d1", roleTitle: null, status: "active", termStart: null, termEnd: null, commitmentCents: 1000000 },
      gifts: [{ id: "g1", amountCents: 500000, receivedOn: "2026-05-01", category: "board", method: "check", donorId: "d1", campaignId: null, pledgeId: null }],
      pledges: [],
      solicitedBy: { g1: "m1" },
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
    });
    if (p.totalCents !== 500000) return `counted ${p.totalCents} for a single $5,000 gift`;
    if (p.met) return "a $5,000 gift cleared a $10,000 commitment";
    return null;
  });

  check("Board give/get", "only active seats count against a board", () => {
    const board = { id: "b1", kind: "sport" as const, name: "B", sport: "baseball", giveGetCents: 500000, minSeats: 3, maxSeats: 5 };
    const seat = (id: string, status: "active" | "prospect" | "emeritus") => ({
      id, boardId: "b1", name: id, donorId: null, roleTitle: null, status, termStart: null, termEnd: null, commitmentCents: 500000,
    });
    const s = summarizeBoard(board, [seat("m1", "active"), seat("m2", "prospect"), seat("m3", "emeritus")], []);
    if (s.seatsFilled !== 1) return `counted ${s.seatsFilled} filled seats, expected 1`;
    if (s.committedCents !== 500000) return `committed ${s.committedCents}, expected 500000`;
    return null;
  });

  check("Board give/get", "the gifts a seat shows add up to the percentage above them", () => {
    // The seat screen prints a percentage and lists the gifts behind
    // it. The list includes gifts that did not count, each marked with
    // a reason, so a member can see nothing was lost. Those two are only
    // trustworthy together if the counted rows sum to exactly the total.
    const member = { id: "m1", boardId: "b1", name: "X", donorId: "d1", roleTitle: null, status: "active" as const, termStart: null, termEnd: null, commitmentCents: 1000000 };
    const g = (id: string, cents: number, on: string, method: "check" | "in_kind", donorId: string) =>
      ({ id, amountCents: cents, receivedOn: on, category: "board" as const, method, donorId, campaignId: null, pledgeId: null });
    const gifts = [
      g("g1", 100000, "2026-03-01", "check", "d1"),
      g("g2", 50000, "2026-03-02", "in_kind", "d1"),
      g("g3", 70000, "2025-12-31", "check", "d1"),
      g("g4", 200000, "2026-06-01", "check", "d7"),
      g("g5", 900000, "2026-06-02", "check", "d9"),
    ];
    const input = { member, gifts, pledges: [], solicitedBy: { g4: "m1" }, periodStart: "2026-01-01", periodEnd: "2026-12-31" };
    const list = creditedGifts(input);
    const p = giveGetProgress(input);

    if (list.length !== 4) return `listed ${list.length} gifts on the seat, expected 4 (g5 belongs to nobody here)`;
    const counted = list.filter((c) => c.counted).reduce((s2, c) => s2 + c.gift.amountCents, 0);
    if (counted !== p.totalCents) return `the listed gifts total ${counted} and the screen prints ${p.totalCents}`;
    if (!list.some((c) => c.excludedBecause === "in_kind")) return "the in-kind gift was not shown as excluded";
    if (!list.some((c) => c.excludedBecause === "outside_period")) return "last year's gift was not shown as excluded";
    return null;
  });

  check("Uploads", "the server measures the file rather than believing it", () => {
    const r = checkIngestedRecord({
      originalName: "huge.pdf",
      originalSize: 10,
      mediaType: "application/pdf",
      kind: "pdf",
      base64Length: 0,
      byteLength: MAX_INGEST_BYTES + 1,
      header: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
    return r.ok ? "accepted an oversized file because the client said it was small" : null;
  });

  check("Uploads", "a file renamed .pdf is refused for what it actually is", () => {
    const r = checkIngestedRecord({
      originalName: "transcript.pdf",
      originalSize: 100,
      mediaType: "application/pdf",
      kind: "pdf",
      base64Length: 0,
      byteLength: 100,
      header: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    });
    return r.ok ? "accepted a zip archive named transcript.pdf" : null;
  });

  check("Grading scales", "an 85 is a different grade at two different schools", () => {
    // The transfer-student case, which is why a course carries its own
    // school rather than taking the transcript header's. Converting both
    // halves against one table is wrong and completely invisible: the
    // GPA looks ordinary either way.
    const strict = [
      { letter: "A", min: 93, max: 100 },
      { letter: "B", min: 86, max: 92 },
      { letter: "C", min: 78, max: 85 },
      { letter: "F", min: 0, max: 77 },
    ];
    const lenient = [
      { letter: "A", min: 90, max: 100 },
      { letter: "B", min: 80, max: 89 },
      { letter: "C", min: 70, max: 79 },
      { letter: "F", min: 0, max: 69 },
    ];
    const atStrict = letterFromScale(85, strict);
    const atLenient = letterFromScale(85, lenient);
    if (atStrict === atLenient) return `both schools called an 85 a ${atStrict}`;
    if (atStrict !== "C" || atLenient !== "B") return `got ${atStrict} and ${atLenient}, expected C and B`;
    return null;
  });

  check("Fundraising", "a promise is never counted as money raised", () => {
    // The single most damaging thing this feature could do, because
    // nobody questions a number that is too good.
    const s = summarizeFundraising({
      gifts: [],
      pledges: [{ id: "p1", amountCents: 1000000, promisedOn: "2026-01-15", dueOn: "2026-12-31", status: "open", donorId: "d1", campaignId: null }],
      budget: [],
      fiscalYear: 2026,
      today: "2026-09-16",
    });
    if (s.totalCashCents !== 0) return `counted ${s.totalCashCents} cents of promises as raised`;
    if (s.outstandingPledgeCents !== 1000000) return "lost the promise entirely";
    return null;
  });

  check("Fundraising", "a donated case of food is support, not cash", () => {
    const s = summarizeFundraising({
      gifts: [
        { id: "g1", amountCents: 50000, receivedOn: "2026-05-01", category: "corporate", method: "in_kind", donorId: "d1", campaignId: null, pledgeId: null },
        { id: "g2", amountCents: 25000, receivedOn: "2026-05-01", category: "corporate", method: "check", donorId: "d1", campaignId: null, pledgeId: null },
      ],
      pledges: [],
      budget: [],
      fiscalYear: 2026,
      today: "2026-09-16",
    });
    if (s.totalCashCents !== 25000) return `cash was ${s.totalCashCents}, expected 25000`;
    if (s.totalInKindCents !== 50000) return `in kind was ${s.totalInKindCents}, expected 50000`;
    if (s.totalSupportCents !== 75000) return `support was ${s.totalSupportCents}, expected 75000`;
    return null;
  });

  check("Fundraising", "a thousand ten-cent gifts total exactly one hundred dollars", () => {
    // Added as dollars this drifts. Added as integer cents it cannot.
    const gifts = Array.from({ length: 1000 }, (_, i) => ({
      id: `g${i}`,
      amountCents: moneyToCents(0.1),
      receivedOn: "2026-05-01",
      category: "individual" as const,
      method: "check" as const,
      donorId: null,
      campaignId: null,
      pledgeId: null,
    }));
    const s = summarizeFundraising({ gifts, pledges: [], budget: [], fiscalYear: 2026, today: "2026-09-16" });
    return s.totalCashCents === 10000 ? null : `drifted to ${s.totalCashCents} cents instead of 10000`;
  });

  check("Fundraising", "promises cannot complete a campaign", () => {
    const p = campaignProgress("c1", 100000, [], [
      { id: "p1", amountCents: 100000, promisedOn: "2026-01-15", dueOn: null, status: "open", donorId: "d1", campaignId: "c1" },
    ]);
    return p.percentOfGoal === 0 ? null : `campaign read ${p.percentOfGoal}% on promises alone`;
  });

  check("Uploads", "HEIC is refused rather than stored unreadable", () => {
    const r = checkIngestedRecord({
      originalName: "IMG_0042.HEIC",
      originalSize: 100,
      mediaType: "image/heic",
      kind: "image",
      base64Length: 0,
      byteLength: 100,
      header: new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]),
    });
    return r.ok ? "accepted a HEIC nothing downstream can read" : null;
  });

  return [...checks];
}

async function runDocSuite(): Promise<Check[]> {
  const out: Check[] = [];
  const roster: ResolverAthlete[] = [{ id: "a1", name: "Sample Athlete", school: "Sample High School", gradYear: 2027 }];
  const outcomes = new Set<string>();

  for (let i = 0; i < 60; i++) {
    const name = `scan-${i}.pdf`;
    const size = 10000 + i * 137;
    const r = await runExtractionPipeline({
      categoryId: "transcript",
      records: [makeRecord(name, size, "coordinator")],
      sourceRole: "coordinator",
      roster,
      rosterContext: roster,
      priorVersions: [],
      callModel: createStubCaller({ category: "transcript", seedText: `${name}:${size}` }),
    });
    outcomes.add(r.ok ? r.route : `failed:${r.stage}`);
  }

  out.push({
    suite: "Doc AI pipeline",
    name: "every outcome is reachable, not just the easy one",
    pass: outcomes.has("auto_apply") && outcomes.has("review") && outcomes.has("failed:triage_retake"),
    detail: [...outcomes].join(", "),
  });

  const a = await runExtractionPipeline({
    categoryId: "transcript",
    records: [makeRecord("same.pdf", 4242, "coordinator")],
    sourceRole: "coordinator",
    roster,
    rosterContext: roster,
    priorVersions: [],
    callModel: createStubCaller({ category: "transcript", seedText: "same.pdf:4242" }),
  });
  const b = await runExtractionPipeline({
    categoryId: "transcript",
    records: [makeRecord("same.pdf", 4242, "coordinator")],
    sourceRole: "coordinator",
    roster,
    rosterContext: roster,
    priorVersions: [],
    callModel: createStubCaller({ category: "transcript", seedText: "same.pdf:4242" }),
  });
  out.push({
    suite: "Doc AI pipeline",
    name: "the same document lands the same way twice",
    pass: (a.ok ? a.route : a.stage) === (b.ok ? b.route : b.stage),
    detail: `${a.ok ? a.route : a.stage} then ${b.ok ? b.route : b.stage}`,
  });

  const detected = await detectCategory({
    records: [makeRecord("offer.pdf", 9000, "coordinator")],
    callModel: createStubCaller({ category: "offer_letter", seedText: "offer.pdf:9000" }),
  });
  out.push({
    suite: "Doc AI pipeline",
    name: "detects the document type with nobody telling it",
    pass: detected.categoryId === "offer_letter",
    detail: String(detected.categoryId),
  });

  return out;
}

function makeRecord(name: string, size: number, sourceRole: SourceRole): IngestedRecord {
  return {
    originalName: name,
    originalSize: size,
    originalMime: "application/pdf",
    kind: "pdf",
    sourceRole,
    ingestedAt: new Date().toISOString(),
    requestId: `bench_${name}`,
    mediaType: "application/pdf",
    base64: "JVBERi0=",
    blockType: "document",
  };
}

// ------------------------------------------------------------ live playground

async function runDoc(input: {
  category: DocCategoryId | null;
  sourceRole: SourceRole;
  fileName: string;
  fileSize: number;
  rosterNames: string[];
}) {
  const roster: ResolverAthlete[] = input.rosterNames.map((n, i) => ({
    id: `r${i}`,
    name: n,
    school: "Sample High School",
    gradYear: 2027,
  }));
  const records = [makeRecord(input.fileName, input.fileSize, input.sourceRole)];
  const seedText = `${input.fileName}:${input.fileSize}`;

  let category = input.category;
  let detected: string | null = null;
  if (!category) {
    const d = await detectCategory({ records, callModel: createStubCaller({ category: "transcript", seedText }) });
    detected = d.triage?.detectedType ?? null;
    if (!d.categoryId) return { detected, result: null, error: "Could not tell what this is" };
    category = d.categoryId;
  }

  const result = await runExtractionPipeline({
    categoryId: category,
    records,
    sourceRole: input.sourceRole,
    roster,
    rosterContext: roster,
    priorVersions: [],
    callModel: createStubCaller({ category, seedText }),
  });
  return { detected, category, result, error: null };
}

declare global {
  interface Window {
    Bridge: {
      scoreFit: typeof scoreFit;
      scoreAcademic: typeof scoreAcademic;
      scoreAthletic: typeof scoreAthletic;
      scoreFinancial: typeof scoreFinancial;
      runSuite: () => Check[];
      runDocSuite: () => Promise<Check[]>;
      runDoc: typeof runDoc;
    };
  }
}

window.Bridge = { scoreFit, scoreAcademic, scoreAthletic, scoreFinancial, runSuite, runDocSuite, runDoc };
