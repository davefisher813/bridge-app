// One school: what it costs, what it takes academically, how deep the
// position is, and which of your athletes are pointed at it.
//
// A school record is the input to half the fit engine, so "what does
// this school actually say" has to have an answer somewhere in the
// product.
//
// The D3 rule is enforced here as well as in the engine. It is a law
// (src/laws/fitLaws.test.ts) because a D3 school cannot offer athletic
// aid under NCAA rules, whatever a School record's financials field was
// filled in with, and a screen that prints the field is a screen that
// tells a family money exists.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { Body, EmptyState, Label, LinkButton, Notice, Row, Score, Screen, Section, Stat, StatRow, TextLink } from "@/components/kit";
import { OrgSchoolNoteForm } from "@/components/OrgSchoolNoteForm";
import { saveOrgSchoolNote } from "@/lib/actions/schools";
import { formatPositionsOfNeed, type PositionOfNeed } from "@/lib/validation/orgSchoolNote";
import { PROGRAM_TIERS } from "@/lib/fit/contract";
import { Note } from "@/components/EligibilityVerdict";
import { stageKind, statusRole } from "@/components/statusHue";
import { schoolRowToFitSchool, type SchoolRow } from "@/lib/data/fitAdapters";
import { isD3 } from "@/lib/fit/benchmarks";
import { loadTarget } from "@/lib/data/loadTarget";
import { loadCoachesForSchool } from "@/lib/data/coaches";
import { CoachRows } from "@/components/CoachRows";

export const dynamic = "force-dynamic";

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

export default async function SchoolPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);
  const isOwner = user.role === "owner";
  // Only an owner may change a school, so only an owner gets a tile
  // that opens the form. For everybody else the number is just a number.
  const editHref = isOwner ? `/org/${slug}/schools/${id}/edit` : undefined;

  const supabase = await createClient();
  const [{ data: schoolRow }, { data: targetRows }, { data: noteRow }, coaches] = await Promise.all([
    supabase
      .from("schools")
      .select("id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date, program_tier, state, majors")
      .eq("id", id)
      .single(),
    supabase
      .from("recruiting_targets")
      .select("id, status, athletes(id, name, position)")
      .eq("school_id", id)
      .eq("org_id", org.id),
    supabase.from("org_school_notes").select("coach_name, coach_email, positions_of_need, notes").eq("org_id", org.id).eq("school_id", id).maybeSingle(),
    loadCoachesForSchool(supabase, id),
  ]);

  if (!schoolRow) notFound();
  const school = schoolRowToFitSchool(schoolRow as SchoolRow);

  const targets = (targetRows ?? []) as Array<{
    id: string;
    status: string;
    athletes: { id: string; name: string; position: string | null } | Array<{ id: string; name: string; position: string | null }> | null;
  }>;

  // Each target's score comes from loadTarget, the same call the target
  // page makes. Scoring them inline here with a second set of adapters is
  // exactly how the same target ends up at 68 on one screen and 71 on
  // another with nothing failing.
  const scored = await Promise.all(
    targets.map(async (t) => {
      const bundle = await loadTarget(org.id, t.id);
      const a = Array.isArray(t.athletes) ? t.athletes[0] : t.athletes;
      return { id: t.id, status: t.status, name: a?.name ?? "Unknown athlete", position: a?.position ?? null, fit: bundle?.fit ?? null };
    }),
  );
  scored.sort((a, b) => (b.fit?.score ?? -1) - (a.fit?.score ?? -1));

  const fin = school.financials ?? {};
  const ac = school.academics ?? {};
  const at = school.athletics ?? {};
  const d3 = isD3(school.division);

  const cost = fin.outstateTotal ?? fin.instateTotal;
  const aid = d3 ? (fin.avgMeritAid ?? 0) + (fin.avgNeedAid ?? 0) : (fin.avgAthleticAid ?? 0);
  const coverage = cost && cost > 0 && aid > 0 ? Math.round((aid / cost) * 100) : null;

  const note = (noteRow ?? null) as { coach_name: string | null; coach_email: string | null; positions_of_need: PositionOfNeed[] | null; notes: string | null } | null;
  const needs = formatPositionsOfNeed(Array.isArray(note?.positions_of_need) ? note!.positions_of_need! : []);
  const noteAction = saveOrgSchoolNote.bind(null, slug, id);
  const tierLabel = PROGRAM_TIERS.find((t) => t.key === school.programTier)?.label;

  const staleDays = school.profileDate ? Math.floor((Date.now() - new Date(school.profileDate).getTime()) / 86_400_000) : null;

  const amount = (n: number) => (
    <Body weight="bold" numeric>
      {money(n)}
    </Body>
  );

  return (
    <Screen
      title={school.name}
      back={{ href: `/org/${slug}/schools`, label: "Schools" }}
      lede={`${school.division}${school.conference ? ` · ${school.conference}` : ""}${school.state ? ` · ${school.state}` : ""}${tierLabel ? ` · ${tierLabel}` : ""}${school.sportsSponsored.length > 0 ? ` · ${school.sportsSponsored.length} ${school.sportsSponsored.length === 1 ? "sport" : "sports"}` : ""}`}
      action={isOwner ? <TextLink href={`/org/${slug}/schools/${id}/edit`}>Edit</TextLink> : undefined}
    >
      {/* A stale profile is the quiet failure mode of this whole record:
          every number below feeds a fit score, and a three-year-old
          tuition figure produces a confident wrong answer. */}
      {staleDays !== null && staleDays >= 90 && (
        <Notice tone="warning" title={`This Profile Is ${staleDays} Days Old`}>
          Every fit score against this school is built on the numbers below. Refresh them before anyone leans on one.
        </Notice>
      )}

      {/* The numbers the score is built on, and the way to correct one. */}
      <StatRow>
        <Stat value={ac.gpaAvg != null ? ac.gpaAvg.toFixed(2) : "None"} label="Avg GPA" href={editHref} />
        <Stat value={ac.gpaMin != null ? ac.gpaMin.toFixed(2) : "None"} label="Min GPA" href={editHref} />
        <Stat value={fin.rosterSpotsOpen != null ? String(fin.rosterSpotsOpen) : "None"} label="Spots" href={editHref} />
      </StatRow>

      {(ac.satRange || ac.actRange) && (
        <Note title={[ac.satRange ? `SAT ${ac.satRange}` : null, ac.actRange ? `ACT ${ac.actRange}` : null].filter(Boolean).join(" · ")}>
          The middle 50% of admitted students. Above the top number is a real advantage; below the bottom one is a real headwind.
        </Note>
      )}

      {school.majors && school.majors.length > 0 && <Note title="Majors Offered">{school.majors.join(", ")}</Note>}
      {ac.majorsNote && <Note title="Programs of Interest">{ac.majorsNote}</Note>}

      <CoachRows coaches={coaches} />

      {/* This org's private overlay: the coach relationship and the
          positions the program needs. Positions of need move the score
          for an athlete whose position and grad year fit. */}
      <Section label="Your Notes" role="contact" kind="note">
        {note && (note.coach_name || note.coach_email) && (
          <Row href={note.coach_email ? `mailto:${note.coach_email}` : undefined} kind="people" role="people" title={note.coach_name ?? "Head Coach"} meta={note.coach_email ?? undefined} wrap />
        )}
        {needs && <Row kind="target" role="contact" title="Positions of Need" meta={needs} wrap />}
        {note?.notes && <Note>{note.notes}</Note>}
        {!note && !canEdit && (
          <EmptyState kind="note" title="Nothing Noted Yet">
            Staff keep the coach contact and positions of need here.
          </EmptyState>
        )}
        {canEdit && (
          <OrgSchoolNoteForm
            action={noteAction}
            initialValues={{ coachName: note?.coach_name ?? undefined, coachEmail: note?.coach_email ?? undefined, positionsOfNeed: needs || undefined, notes: note?.notes ?? undefined }}
          />
        )}
        {canEdit && <Label>Private to your organization. A matching position and grad year adds ten to a score here.</Label>}
      </Section>

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
        {aid > 0 && (
          <Row
            href={editHref}
            kind="grant"
            role="committed"
            title={d3 ? "Average academic and need aid" : "Average athletic award"}
            meta={coverage !== null ? `Covers about ${coverage}% of the cost of attendance.` : undefined}
            trailing={amount(aid)}
            wrap
          />
        )}
        {fin.instateTotal != null && <Row href={editHref} kind="school" role="contact" title="In State" meta="Cost of attendance" trailing={amount(fin.instateTotal)} />}
        {fin.outstateTotal != null && <Row href={editHref} kind="school" role="contact" title="Out of State" meta="Cost of attendance" trailing={amount(fin.outstateTotal)} />}
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

      <Section label="Your Athletes Here" count={scored.length} role="contact" kind="athlete">
        {scored.length === 0 ? (
          <EmptyState kind="athlete" title="Nobody Here Yet" action={<LinkButton href={`/org/${slug}/roster`}>Open Athletes</LinkButton>}
          />
        ) : (
          scored.map((t) => (
            <Row
              key={t.id}
              href={`/org/${slug}/board/${t.id}`}
              kind={stageKind(t.status)}
              role={statusRole(t.status)}
              title={t.name}
              meta={[t.position, t.status].filter(Boolean).join(" · ")}
              trailing={t.fit ? <Score score={t.fit.score} /> : undefined}
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
