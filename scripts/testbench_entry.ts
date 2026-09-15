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
