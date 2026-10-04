import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { threadSummaryByAthlete } from "@/lib/data/messages";
import { loadStaff } from "@/lib/data/staff";
import { computeDueSoon, computeOverdue, groupAssignments, loadAthleteAssignments, sortByUrgency, todayIso, type Assignment } from "@/lib/data/assignments";
import { personLabel } from "@/lib/org/roleLabels";
import { JourneyStepper } from "@/components/JourneyStepper";
import { StatusPill } from "@/components/StatusPill";
import { deriveJourneyStage } from "@/lib/journey";
import { isScoredStatus, placementAthlete, placementMeta, placementOf } from "@/lib/placement";
import { statusRole, stageKind } from "@/components/statusHue";
import { Avatar, Card, Chevron, EmptyState, Label, LinkButton, Notice, Row, Score, Screen, Section, Stack, Stat, StatRow, TextLink } from "@/components/kit";
import { metricRowsToEntries, type MetricRow } from "@/lib/data/fitAdapters";
import { loadFitsForAthlete } from "@/lib/data/fits";
import { formatMetricValue, metricsFor, partialLabelFor, positionGroupOf, rankFits, selectScoringMetrics } from "@/lib/fit";
import { GOAL_LABEL, type AthleteGoal } from "@/lib/fit/contract";
import type { FitTag } from "@/lib/fit/types";

// One athlete, as their family sees them: the same record staff keep,
// read only, with nothing from the rest of the org on it. Dave's picks
// in the Family Access catalog (2026-09-21): this page is home, every
// match shows its reasons, their own documents are listed, nothing is
// editable, and staff are who to ask. Stage 3 (2026-09-26): the athlete's
// advisor, by name with an email, and the thread with them. Check-ins
// are staff only and never show here.

const TAG_TONE: Record<FitTag, "committed" | "ink" | "muted" | "danger"> = {
  Safety: "committed",
  Fit: "ink",
  Reach: "muted",
  Conflict: "danger",
  Unknown: "muted",
};

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

const CATEGORY_LABEL: Record<string, string> = {
  transcript: "Transcript",
  test_scores: "Test Scores",
  offer_letter: "Offer Letter",
  recommendation: "Recommendation",
  financial_aid: "Financial Aid",
  metrics: "Metrics Report",
  film: "Film",
};

// A document's status, in a family's words. The pipeline's own words
// (route, failure stage) are staff's business.
const DOC_STATUS: Record<string, string> = {
  applied: "On the record",
  pending: "Being checked by an Admin",
  processing: "Being read",
  filed: "Filed for your Admin",
  failed: "Could not be read",
  discarded: "Set aside by an Admin",
};

interface TargetRow {
  id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

// One open assignment's second line: what is wrong with it first, then
// when it is due. Sentences, in the family's words.
function assignmentMeta(a: Assignment, today: string): string {
  const parts: string[] = [];
  if (a.status === "needs_revision") parts.push("Needs a change");
  if (computeOverdue(a.dueOn, a.status, today)) parts.push("Overdue");
  else if (computeDueSoon(a.dueOn, a.status, today)) parts.push("Due soon");
  parts.push(a.dueOn ? `Due ${longDate(a.dueOn)}` : "No due date");
  return parts.join(" · ");
}

interface DocRow {
  id: string;
  file_name: string;
  category: string | null;
  status: string;
  created_at: string;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function money(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

export default async function FamilyAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const { all } = await requireFamilyAthlete(org.id, user.id, id);
  const base = `/org/${slug}/family`;
  const here = `${base}/${id}`;

  const supabase = await createClient();
  const [{ data: athlete }, { data: targetRows }, { data: metricRows }, { data: docRows }, fits, staff, threads, { data: schoolRows }, assignmentRows] = await Promise.all([
    supabase
      .from("athletes")
      .select("id, name, sport, position, recruit_type, gpa, goal, family_budget_cents, home_state, status, detail, draft_team, draft_round, draft_year, graduated_on, first_full_time_enrollment, advisor_id")
      .eq("id", id)
      .eq("org_id", org.id)
      .is("deleted_at", null)
      .single(),
    supabase.from("recruiting_targets").select("id, status, schools(name)").eq("athlete_id", id).eq("org_id", org.id).order("created_at", { ascending: false }),
    supabase.from("athlete_metrics").select("id, metric, value, measured_on, source").eq("athlete_id", id).eq("org_id", org.id).order("measured_on", { ascending: false }),
    supabase.from("documents").select("id, file_name, category, status, created_at").eq("athlete_id", id).eq("org_id", org.id).order("created_at", { ascending: false }),
    loadFitsForAthlete(supabase, org.id, id),
    loadStaff(supabase, org.id),
    threadSummaryByAthlete(supabase, org.id, user.id, [id]),
    // Which sports each school sponsors, so the count of schools
    // evaluated is the same one the Matches screen shows.
    supabase.from("schools").select("id, sports_sponsored"),
    loadAthleteAssignments(supabase, org.id, id),
  ]);
  if (!athlete) notFound();

  const metrics = (metricRows ?? []) as MetricRow[];
  const scoring = selectScoringMetrics(metricRowsToEntries(metrics));
  const group = positionGroupOf(athlete.sport, athlete.position ?? undefined);
  const tiles = metricsFor(athlete.sport, group).first.slice(0, 3);
  const lastLogged = metrics[0]?.measured_on;

  const targets = ((targetRows ?? []) as TargetRow[]).map((t) => ({ ...t, school: unwrap(t.schools) }));
  const openTargets = targets.filter((t) => t.status !== "Not Interested");
  const journey = deriveJourneyStage(targets.map((t) => ({ status: t.status, schoolName: t.school?.name ?? "" })));
  const placement = placementOf(
    placementAthlete(athlete),
    targets.map((t) => ({ id: t.id, status: t.status, schoolName: t.school?.name ?? null })),
  );
  const meta = placement ? placementMeta(placement, { firstEnrollment: athlete.first_full_time_enrollment, graduatedOn: athlete.graduated_on }) : undefined;
  // The top ten stored matches through the one ranking rule (fully
  // scored first, then partial, each by score, src/lib/fit/rank.ts),
  // counted over the schools that sponsor the sport, the same as the
  // staff profile and the Matches screen. Amended 2026-09-27.
  const sport = (athlete.sport ?? "").toLowerCase();
  const sponsorsSport = new Map(((schoolRows ?? []) as { id: string; sports_sponsored: string[] | null }[]).map((s) => [s.id, (s.sports_sponsored ?? []).map((x) => x.toLowerCase())]));
  const evaluated = fits.filter((f) => {
    const list = sponsorsSport.get(f.school_id) ?? [];
    return list.length === 0 || list.includes(sport);
  });
  const topFits = rankFits(evaluated, "best").slice(0, 10);
  const evaluatedLabel = `${evaluated.length} ${evaluated.length === 1 ? "School" : "Schools"} Evaluated`;
  const goal = GOAL_LABEL[(athlete.goal ?? "balanced") as AthleteGoal] ?? GOAL_LABEL.balanced;
  const budgetCents = athlete.family_budget_cents as number | null;
  const docs = (docRows ?? []) as DocRow[];
  // The advisor is looked up among the org's owners and staff, so one who
  // has since left the staff reads as nobody named rather than a stale name.
  const advisor = athlete.advisor_id ? staff.find((s) => s.id === athlete.advisor_id && s.email) : undefined;
  const thread = threads.get(id) ?? { total: 0, unread: 0 };
  const threadMeta = thread.total === 0 ? "Nothing sent yet" : `${thread.total} ${thread.total === 1 ? "message" : "messages"}${thread.unread > 0 ? ` · ${thread.unread} new` : ""}`;

  // Cancelled rows are not shown. Open rows (assigned or sent back) come
  // urgent first with the one button; submitted rows say they are with an
  // Admin; complete ones are counted in one line.
  const today = todayIso();
  const visible = groupAssignments(assignmentRows.filter((a) => a.status !== "cancelled"));
  const openAssignments = sortByUrgency(visible.open, today);
  const submittedAssignments = sortByUrgency(visible.submitted, today);
  const completeCount = visible.done.length;

  return (
    <Screen
      title={athlete.name}
      back={all.length > 1 ? { href: base, label: "Your Athletes" } : undefined}
      lede={`${athlete.sport}${athlete.position ? ` · ${athlete.position}` : ""} · ${RECRUIT_TYPE_LABEL[athlete.recruit_type] ?? athlete.recruit_type}${athlete.gpa != null ? ` · ${Number(athlete.gpa).toFixed(2)} school GPA` : ""}`}
    >
      {placement ? (
        <Row
          href={placement.targetId ? `${base}/colleges/${placement.targetId}` : `${base}/colleges`}
          kind={stageKind(placement.state)}
          role={statusRole(placement.state)}
          title={placement.name ?? (placement.state === "Drafted" ? "Team Not on File" : "School Not on File")}
          meta={meta}
          trailing={
            <>
              <StatusPill status={placement.state} />
              <Chevron />
            </>
          }
        />
      ) : (
        <Card href={`${base}/colleges`}>
          <JourneyStepper result={journey} />
        </Card>
      )}

      {(openAssignments.length > 0 || submittedAssignments.length > 0 || completeCount > 0) && (
        <Section label="Your Assignments" count={openAssignments.length + submittedAssignments.length || undefined} role="time" kind="flag">
          {openAssignments.map((a) => {
            const late = computeOverdue(a.dueOn, a.status, today);
            return (
              <Row
                key={a.id}
                kind={late || a.status === "needs_revision" ? "warning" : "flag"}
                role={late || a.status === "needs_revision" ? "danger" : "contact"}
                title={a.title}
                meta={assignmentMeta(a, today)}
                wrap
                trailingAction={
                  <LinkButton href={`${here}/assignments/${a.id}`} inline>
                    {/* Short on purpose: "Fix and Resubmit" leaves a row at 320
                        too little width for the title (the audit's edge-spill
                        finding). The submit screen's button says the long
                        form. */}
                    {a.status === "needs_revision" ? "Resubmit" : "Submit"}
                  </LinkButton>
                }
              />
            );
          })}
          {/* A sent row opens the same screen, which says it is with an
              Admin; it is a link and not a button, so an open row is still
              the only thing with a button. */}
          {submittedAssignments.map((a) => (
            <Row key={a.id} href={`${here}/assignments/${a.id}`} kind="check" role="contact" title={a.title} meta="Sent. With an Admin for review." trailing={<Chevron />} />
          ))}
          {/* A line of text, not a row: there is no screen for a finished
              one to open, and a row that looks tappable and is not is what
              the clickable check exists to stop. */}
          {completeCount > 0 && <Label>{`${completeCount} complete. Reviewed and done.`}</Label>}
        </Section>
      )}

      <Section label="Your Advisor" role="people" kind="people">
        {advisor ? (
          <Row
            href={`mailto:${advisor.email}`}
            leading={<Avatar name={advisor.name} />}
            title={advisor.name}
            meta={`${personLabel(advisor)} · ${advisor.email}`}
            trailing={<Chevron />}
            wrap
          />
        ) : (
          <EmptyState kind="people" title="No Advisor Named Yet" action={<LinkButton href={`${base}/more`} variant="secondary">Who to Ask</LinkButton>}>
            Ask {org.name} under More.
          </EmptyState>
        )}
        <Row href={`${here}/messages`} kind="message" role="contact" title="Messages" meta={threadMeta} trailing={<Chevron />} />
      </Section>

      <Stack gap={3}>
        <Row href={`${here}/eligibility`} kind="checklist" role="contact" title="NCAA Eligibility" trailing={<Chevron />} />
        <Row href={`${here}/transcript`} kind="course" role="contact" title="Transcript" trailing={<Chevron />} />
      </Stack>

      {tiles.length > 0 && (
        <StatRow>
          {tiles.map((m) => (
            <Stat
              key={m.key}
              value={scoring.measurables[m.key] !== undefined ? formatMetricValue(m.key, scoring.measurables[m.key]) : "None"}
              label={m.label}
              role="contact"
              href={`${here}/metrics`}
            />
          ))}
        </StatRow>
      )}

      <Stack gap={3}>
        <Row href={`${here}/metrics`} kind="check" role="contact" title="Metrics" meta={metrics.length === 0 ? "Nothing logged yet" : `${metrics.length} logged · last on ${longDate(lastLogged)}`} trailing={<Chevron />} />
        <Row kind="flag" role="committed" title="Goal and Budget" meta={`${goal} · ${budgetCents ? `${money(budgetCents / 100)} a year` : "No family budget on file"}${athlete.home_state ? ` · ${athlete.home_state}` : ""}`} wrap />
        <Label>To change the goal or the budget, ask {org.name}.</Label>
      </Stack>

      {!placement && isScoredStatus(athlete.status) && (
        <Section label={evaluatedLabel} role="place" kind="target" action={evaluated.length > 10 ? <TextLink href={`${here}/matches`}>See All</TextLink> : undefined}>
          {evaluated.length === 0 ? (
            <EmptyState kind="target" title="No Matches Yet" />
          ) : (
            <>
              {topFits.map((f) => (
                <Row
                  key={f.school_id}
                  href={`${here}/matches/${f.school_id}`}
                  kind="school"
                  role={f.tag === "Conflict" ? "danger" : f.tag === "Safety" ? "committed" : "place"}
                  title={f.school.name}
                  meta={`${f.school.division} · ${f.partial ? partialLabelFor(f) : (f.reasons[0] ?? f.warnings[0] ?? "")}`}
                  trailing={
                    <>
                      <Score score={f.score} />
                      <Label tone={TAG_TONE[f.tag as FitTag] ?? "muted"}>{f.tag}</Label>
                    </>
                  }
                />
              ))}
              {topFits.some((f) => f.partial) && (
                <Notice tone="info" title="Some Scores Are Partial">
                  A dimension with nothing on file is left out and the rest are reweighted. The score fills in once the missing numbers are logged.
                </Notice>
              )}
              <TextLink href={`${here}/matches`}>{`See All ${evaluated.length} Matches`}</TextLink>
            </>
          )}
        </Section>
      )}

      {/* The count matches the staff rule: what is live while they are
          recruiting, the whole record once they are placed. */}
      <Section label="Colleges" count={placement ? targets.length : openTargets.length} role="place" kind="school">
        {targets.length === 0 ? (
          <EmptyState kind="school" title="No Colleges Yet" />
        ) : (
          <Row href={`${base}/colleges`} kind="school" role="place" title="Where Things Stand" meta={`${targets.length} ${targets.length === 1 ? "school" : "schools"} on the list, and every visit`} trailing={<Chevron />} />
        )}
        <Row href={`${base}/schools`} kind="school" role="place" title="Every School" trailing={<Chevron />} />
      </Section>

      <Section label="Documents" count={docs.length} role="contact" kind="document">
        {docs.length === 0 ? (
          <EmptyState kind="document" title="Nothing on File" />
        ) : (
          docs.map((d) => (
            <Row
              key={d.id}
              kind="document"
              role={d.status === "applied" ? "committed" : d.status === "failed" ? "danger" : "contact"}
              title={d.category ? (CATEGORY_LABEL[d.category] ?? d.category) : "Document"}
              meta={`${d.file_name} · ${DOC_STATUS[d.status] ?? d.status} · ${longDate(d.created_at)}`}
              wrap
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
