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
import { effectiveConfidence, routeDecision } from "../src/lib/docai/provenance";

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
