import { Body, Notice, Row, Section, Stat, StatRow } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { PROGRAM_TIERS } from "@/lib/fit/contract";
import { isD3 } from "@/lib/fit/benchmarks";
import type { School } from "@/lib/fit/types";

// One school's shared facts, the same for every role that can open it.
// The staff page adds the org's own side (coaches, notes, its athletes)
// between the two halves, so the facts are two exports rather than one:
// SchoolAcademics above, SchoolMoneyAndDepth below, in the order the
// staff page has always shown them.
//
// The D3 rule is enforced here as well as in the engine. It is a law
// (src/laws/fitLaws.test.ts) because a D3 school cannot offer athletic
// aid under NCAA rules, whatever a School record's financials field was
// filled in with, and a screen that prints the field is a screen that
// tells a family money exists.

export type SchoolViewer = "owner" | "staff" | "family" | "member";

const AID_LABEL: Record<string, string> = {
  full: "Full scholarships available",
  partial: "Partial scholarships available",
  none: "No athletic aid, academic only",
};

const OUTLOOK_LABEL: Record<string, string> = {
  realistic: "Realistic shot at playing time",
  competitive: "Competitive for playing time",
  difficult: "Difficult to break into",
};

function money(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

// Division · conference · "City, ST" (or the state) · tier · sports.
export function schoolLede(school: School, location: string | null): string {
  const tierLabel = PROGRAM_TIERS.find((t) => t.key === school.programTier)?.label;
  const place = location ?? school.state;
  const sports = school.sportsSponsored.length;
  return `${school.division}${school.conference ? ` · ${school.conference}` : ""}${place ? ` · ${place}` : ""}${tierLabel ? ` · ${tierLabel}` : ""}${sports > 0 ? ` · ${sports} ${sports === 1 ? "sport" : "sports"}` : ""}`;
}

// The numbers the score is built on. Only an owner may change a school,
// so only an owner gets a tile that opens the form; for everybody else
// the number is just a number.
export function SchoolAcademics({ school, viewer, editHref }: { school: School; viewer: SchoolViewer; editHref?: string }) {
  const ac = school.academics ?? {};
  const fin = school.financials ?? {};
  const edit = viewer === "owner" ? editHref : undefined;
  const staleDays = school.profileDate ? Math.floor((Date.now() - new Date(school.profileDate).getTime()) / 86_400_000) : null;

  return (
    <>
      {/* A stale profile is the quiet failure mode of this whole record:
          every number below feeds a fit score, and a three-year-old
          tuition figure produces a confident wrong answer. The copy is
          a staff instruction, so a family or member never sees it. */}
      {(viewer === "owner" || viewer === "staff") && staleDays !== null && staleDays >= 90 && (
        <Notice tone="warning" title={`This Profile Is ${staleDays} Days Old`}>
          Every fit score against this school is built on the numbers below. Refresh them before anyone leans on one.
        </Notice>
      )}

      <StatRow>
        <Stat value={ac.gpaAvg != null ? ac.gpaAvg.toFixed(2) : "None"} label="Avg GPA" href={edit} />
        <Stat value={ac.gpaMin != null ? ac.gpaMin.toFixed(2) : "None"} label="Min GPA" href={edit} />
        <Stat value={fin.rosterSpotsOpen != null ? String(fin.rosterSpotsOpen) : "None"} label="Spots" href={edit} />
      </StatRow>

      {(ac.satRange || ac.actRange) && (
        <Note title={[ac.satRange ? `SAT ${ac.satRange}` : null, ac.actRange ? `ACT ${ac.actRange}` : null].filter(Boolean).join(" · ")}>
          The middle 50% of admitted students. Above the top number is a real advantage; below the bottom one is a real headwind.
        </Note>
      )}

      {school.sportsSponsored.length > 0 && <Note title="Sports Sponsored">{school.sportsSponsored.join(", ")}</Note>}
      {school.majors && school.majors.length > 0 && <Note title="Majors Offered">{school.majors.join(", ")}</Note>}
      {ac.majorsNote && <Note title="Programs of Interest">{ac.majorsNote}</Note>}
    </>
  );
}

export function SchoolMoneyAndDepth({ school, viewer, editHref }: { school: School; viewer: SchoolViewer; editHref?: string }) {
  const fin = school.financials ?? {};
  const at = school.athletics ?? {};
  const d3 = isD3(school.division);
  const isOwner = viewer === "owner";
  const edit = isOwner ? editHref : undefined;

  const cost = fin.outstateTotal ?? fin.instateTotal;
  const aid = d3 ? (fin.avgMeritAid ?? 0) + (fin.avgNeedAid ?? 0) : (fin.avgAthleticAid ?? 0);
  const coverage = cost && cost > 0 && aid > 0 ? Math.round((aid / cost) * 100) : null;
  const aidTitle = d3 ? "Average academic and need aid" : "Average athletic award";
  const coverageLine = coverage !== null ? `Covers about ${coverage}% of the cost of attendance.` : undefined;

  const amount = (n: number) => (
    <Body weight="bold" numeric>
      {money(n)}
    </Body>
  );

  return (
    <>
      <Section label="Money" role="committed" kind="money">
        {/* The D3 rule, enforced on the screen as well as in the engine.
            A D3 school cannot offer athletic aid whatever the record
            says, and printing the field would tell a family money exists
            that does not. */}
        <Note title={d3 ? "No athletic scholarships at D3" : (AID_LABEL[fin.athleticScholarship ?? ""] ?? "Athletic aid not recorded")}>
          {d3
            ? "NCAA rules, not this school's choice. Academic and need-based aid still apply and are often substantial."
            : "From this school's profile. Confirm with the coaching staff before a family plans around it."}
        </Note>
        {/* An owner's figures open the form. Everyone else gets the same
            figures as notes, never a row that goes nowhere. */}
        {isOwner ? (
          <>
            {aid > 0 && <Row href={edit} kind="grant" role="committed" title={aidTitle} meta={coverageLine} trailing={amount(aid)} wrap />}
            {fin.instateTotal != null && <Row href={edit} kind="school" role="contact" title="In State" meta="Cost of attendance" trailing={amount(fin.instateTotal)} />}
            {fin.outstateTotal != null && <Row href={edit} kind="school" role="contact" title="Out of State" meta="Cost of attendance" trailing={amount(fin.outstateTotal)} />}
          </>
        ) : (
          <>
            {aid > 0 && <Note title={`${aidTitle}: ${money(aid)}`}>{coverageLine}</Note>}
            {fin.instateTotal != null && <Note title={`In State: ${money(fin.instateTotal)}`}>Cost of attendance</Note>}
            {fin.outstateTotal != null && <Note title={`Out of State: ${money(fin.outstateTotal)}`}>Cost of attendance</Note>}
          </>
        )}
        {fin.instateTotal == null && fin.outstateTotal == null && (
          <Note>No cost of attendance on file, so the financial dimension of every fit score here is running on defaults.</Note>
        )}
      </Section>

      {(at.positionDepth || at.playingTimeOutlook) && (
        <Section label="Depth Chart" role="visit" kind="athlete">
          <Note title={at.playingTimeOutlook ? (OUTLOOK_LABEL[at.playingTimeOutlook] ?? at.playingTimeOutlook) : undefined}>{at.positionDepth}</Note>
        </Section>
      )}

      {/* Conflicts are on the record for a reason and belong on the
          school, not buried inside one athlete's score. */}
      {school.conflicts && school.conflicts.length > 0 && (
        <Section label="Flags on This School" count={school.conflicts.length} role="offer" kind="warning">
          {school.conflicts.map((c, i) => (
            <Notice key={i} tone={c.severity === "conflict" ? "danger" : "warning"} title={c.severity === "conflict" ? "Conflict" : "Worth Knowing"}>
              {c.message}
            </Notice>
          ))}
        </Section>
      )}
    </>
  );
}
