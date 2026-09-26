import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createContact, deleteContact } from "@/lib/actions/contacts";
import { ContactForm } from "@/components/ContactForm";
import { JourneyStepper } from "@/components/JourneyStepper";
import { StatusPill } from "@/components/StatusPill";
import { deriveJourneyStage } from "@/lib/journey";
import { Avatar, Body, Card, Chevron, ConfirmButton, EmptyState, Form, Label, LinkButton, Notice, Row, Score, Screen, Section, Stack, Stat, StatRow, TextLink } from "@/components/kit";
import { relationshipLabel } from "@/lib/copy/relationships";
import { statusRole, stageKind } from "@/components/statusHue";
import { metricRowsToEntries, type MetricRow } from "@/lib/data/fitAdapters";
import { loadFitsForAthlete } from "@/lib/data/fits";
import { formatMetricValue, metricsFor, positionGroupOf, selectScoringMetrics } from "@/lib/fit";
import { GOAL_LABEL, type AthleteGoal } from "@/lib/fit/contract";
import type { FitTag } from "@/lib/fit/types";

// The score above the tag already says how good the fit is, so the tag
// is low-weight text. Same map as the board.
const TAG_TONE: Record<FitTag, "committed" | "ink" | "muted" | "danger"> = {
  Safety: "committed",
  Fit: "ink",
  Reach: "muted",
  Conflict: "danger",
  Unknown: "muted",
};

function money(dollars: number): string {
  return `$${Math.round(dollars).toLocaleString("en-US")}`;
}

const RECRUIT_TYPE_LABEL: Record<string, string> = {
  hs: "High School",
  transfer_4to4: "Transfer (4-to-4)",
  transfer_juco: "Transfer (JUCO)",
  transfer_grad: "Transfer (Grad)",
};

const CONTACT_ROLE_LABEL: Record<string, string> = {
  hs_coach: "HS coach",
  travel_coach: "Travel coach",
  parent_guardian: "Parent/guardian",
  advisor: "Advisor",
  college_coach: "College coach",
  other: "Other",
};

const VISIT_TYPE_LABEL: Record<string, string> = { official: "Official", unofficial: "Unofficial", junior_day: "Junior day", camp: "Camp", other: "Other" };

interface SchoolRow {
  id: string;
  name: string;
  division: string;
}

interface GuardianRow {
  user_id: string;
  relationship: string | null;
  users: { email: string; full_name: string | null } | { email: string; full_name: string | null }[] | null;
}

interface TargetRow {
  id: string;
  status: string;
  offer_type: string | null;
  offer_scholarship_percent: number | null;
  schools: SchoolRow | SchoolRow[] | null;
}

function unwrap<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// Athlete profile / detail screen. Colleges (the athlete's own
// recruiting_targets, reusing the board's data rather than duplicating
// it), Contacts (athlete-scoped), and Visits (aggregated from
// target_visits across every target this athlete has), as sections on
// one scrollable page.
export default async function AthletePage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ notice?: string }> }) {
  const { slug, id } = await params;
  const { notice } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athlete }, { data: targetRows }, { data: contactRows }, { data: schoolRows }, { data: metricRows }, fits] = await Promise.all([
    supabase
      .from("athletes")
      .select("id, name, sport, position, recruit_type, gpa, status, first_full_time_enrollment, goal, family_budget_cents, home_state")
      .eq("id", id)
      .eq("org_id", org.id)
      .is("deleted_at", null)
      .single(),
    supabase
      .from("recruiting_targets")
      .select("id, status, offer_type, offer_scholarship_percent, schools(id, name, division)")
      .eq("athlete_id", id)
      .eq("org_id", org.id)
      .order("created_at", { ascending: false }),
    supabase.from("contacts").select("id, name, role, email, phone, notes, school_id").eq("athlete_id", id).eq("org_id", org.id).order("name"),
    supabase.from("schools").select("id, name, division").order("name"),
    supabase.from("athlete_metrics").select("id, metric, value, measured_on, source").eq("athlete_id", id).eq("org_id", org.id).order("measured_on", { ascending: false }),
    loadFitsForAthlete(supabase, org.id, id),
  ]);

  if (!athlete) notFound();

  // The family logins linked to this athlete (migration 0023), with
  // the person behind each. Staff invite one from here (Dave's pick,
  // 2026-09-21); an owner can open the person under Members.
  const { data: guardianRows } = await supabase.from("athlete_guardians").select("user_id, relationship, users(email, full_name)").eq("athlete_id", id).eq("org_id", org.id);
  const family = ((guardianRows ?? []) as GuardianRow[])
    .map((g) => ({ userId: g.user_id, relationship: g.relationship, person: unwrap(g.users) }))
    .filter((g) => g.person?.email);

  // The current number for each metric the engine scores for the
  // position, from the same selection the score uses. A tile with no
  // entry says None rather than hiding, so the gap is visible.
  const metrics = (metricRows ?? []) as MetricRow[];
  const scoring = selectScoringMetrics(metricRowsToEntries(metrics));
  const group = positionGroupOf(athlete.sport, athlete.position ?? undefined);
  const tiles = metricsFor(athlete.sport, group).first.slice(0, 3);
  const lastLogged = metrics[0]?.measured_on;

  // Stored matches, best first. docs/MATCHING_CONTRACT.md section 2:
  // the top five here, the full ranked list with filters on its own
  // screen. A partial score says which dimensions it counted.
  const topFits = fits.slice(0, 5);
  const goal = GOAL_LABEL[(athlete.goal ?? "balanced") as AthleteGoal] ?? GOAL_LABEL.balanced;
  const budgetCents = athlete.family_budget_cents as number | null;

  const targets = ((targetRows ?? []) as TargetRow[]).map((t) => ({ ...t, school: unwrap(t.schools) }));
  const targetIds = targets.map((t) => t.id);

  const { data: visitRows } = targetIds.length
    ? await supabase
        .from("target_visits")
        .select("id, target_id, visit_type, visit_date, impression, next_step, notes")
        .in("target_id", targetIds)
        .eq("org_id", org.id)
        .order("visit_date", { ascending: false })
    : { data: [] };

  const schoolNameByTargetId = new Map(targets.map((t) => [t.id, t.school?.name ?? "Unknown school"]));
  const visits = visitRows ?? [];

  const journey = deriveJourneyStage(targets.map((t) => ({ status: t.status, schoolName: t.school?.name ?? "" })));
  const enrolled = athlete.status === "Enrolled";
  const committedTarget = targets.find((t) => t.status === "Committed") ?? null;
  const enrolledMeta = committedTarget
    ? `${committedTarget.school?.name ?? "Unknown school"}${athlete.first_full_time_enrollment ? ` · since ${longDate(athlete.first_full_time_enrollment)}` : ""}`
    : athlete.first_full_time_enrollment
      ? `Since ${longDate(athlete.first_full_time_enrollment)}`
      : undefined;

  const contacts = contactRows ?? [];
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));
  const contactAction = createContact.bind(null, slug, id);
  const deleteContactAction = deleteContact.bind(null, slug, id);

  return (
    <Screen
      title={athlete.name}
      back={{ href: `/org/${slug}/roster`, label: "Athletes" }}
      lede={`${athlete.sport}${athlete.position ? ` · ${athlete.position}` : ""} · ${RECRUIT_TYPE_LABEL[athlete.recruit_type] ?? athlete.recruit_type}${athlete.gpa != null ? ` · ${Number(athlete.gpa).toFixed(2)} school GPA` : ""}`}
      action={canEdit ? <TextLink href={`/org/${slug}/roster/${id}/edit`}>Edit</TextLink> : undefined}
    >
      {notice && (
        <Notice tone="success" title="Done">
          {notice}
        </Notice>
      )}

      <Stack gap={3}>
        {enrolled ? (
          // Recruiting is over: the stepper (still in progress) gives
          // way to the one fact that matters now. Dave, 2026-09-26.
          <Row
            href={committedTarget ? `/org/${slug}/board/${committedTarget.id}` : `/org/${slug}/board?athlete=${id}`}
            kind={stageKind("Enrolled")}
            role={statusRole("Enrolled")}
            title="Enrolled"
            meta={enrolledMeta}
            trailing={<Chevron />}
          />
        ) : (
          // The stage line opens this athlete's targets, which is what
          // it is a summary of. Dave, 2026-09-25.
          <Card href={`/org/${slug}/board?athlete=${id}`}>
            <JourneyStepper result={journey} />
          </Card>
        )}
        {!enrolled && canEdit && (
          <LinkButton href={`/org/${slug}/roster/${id}/enroll`} variant="secondary">
            Mark Enrolled
          </LinkButton>
        )}
      </Stack>

      <Stack gap={3}>
        <Row href={`/org/${slug}/roster/${id}/eligibility`} kind="checklist" role="contact" title="NCAA Eligibility" meta="Core GPA, qualifier status and the clock" trailing={<Chevron />} />
        <Row href={`/org/${slug}/roster/${id}/transcript`} kind="course" role="contact" title="Transcript" meta="Every course, and what the NCAA counted" trailing={<Chevron />} />
      </Stack>

      {tiles.length > 0 && (
        <StatRow>
          {tiles.map((m) => (
            <Stat
              key={m.key}
              value={scoring.measurables[m.key] !== undefined ? formatMetricValue(m.key, scoring.measurables[m.key]) : "None"}
              label={m.label}
              role="contact"
              href={`/org/${slug}/roster/${id}/metrics`}
            />
          ))}
        </StatRow>
      )}

      <Stack gap={3}>
        <Row
          href={`/org/${slug}/roster/${id}/metrics`}
          kind="check"
          role="contact"
          title="Metrics"
          meta={metrics.length === 0 ? "Nothing logged yet" : `${metrics.length} logged · last on ${longDate(lastLogged)}`}
          trailing={<Chevron />}
        />
        {/* The whole row opens the edit screen, so there is no second
            link inside it: an anchor inside an anchor is invalid HTML,
            React refuses to hydrate it, and the tap lands on whichever
            of the two the finger happened to cover. */}
        <Row
          href={canEdit ? `/org/${slug}/roster/${id}/edit` : undefined}
          kind="flag"
          role="committed"
          title="Goal and Budget"
          meta={`${goal} · ${budgetCents ? `${money(budgetCents / 100)} a year` : "No family budget"}${athlete.home_state ? ` · ${athlete.home_state}` : ""}`}
          trailing={canEdit ? <Chevron /> : undefined}
        />
      </Stack>

      {!enrolled && (
        // Once enrolled, recruiting is over: nothing left to score
        // against. Dave, 2026-09-26.
        <Section
          label="Matches"
          count={fits.length}
          role="place"
          kind="target"
          action={fits.length > 5 ? <TextLink href={`/org/${slug}/roster/${id}/matches`}>See All</TextLink> : undefined}
        >
          {fits.length === 0 ? (
            <EmptyState kind="target" title="No Matches Yet" action={canEdit ? <LinkButton href={`/org/${slug}/schools`}>Open Schools</LinkButton> : undefined}>
              {canEdit ? "With no schools on file there is nothing to score against." : "Every school on file is scored once the record is saved."}
            </EmptyState>
          ) : (
            <>
              {topFits.map((f) => (
                <Row
                  key={f.school_id}
                  href={`/org/${slug}/roster/${id}/matches`}
                  kind="school"
                  role={f.tag === "Conflict" ? "danger" : f.tag === "Safety" ? "committed" : "place"}
                  title={f.school.name}
                  meta={`${f.school.division} · ${f.partial ? (f.warnings[0] ?? "Partial score") : (f.reasons[0] ?? f.warnings[0] ?? "")}`}
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
                  A dimension with no data on file is left out and the rest are reweighted. Add the missing numbers and the score fills in.
                </Notice>
              )}
              <TextLink href={`/org/${slug}/roster/${id}/matches`}>{`See All ${fits.length} Matches`}</TextLink>
            </>
          )}
        </Section>
      )}

      <Section label="Colleges" count={targets.length} role="place" kind="school">
        {targets.length === 0 ? (
          <EmptyState kind="school" title="No Colleges Yet" action={canEdit && !enrolled ? <LinkButton href={`/org/${slug}/roster/${id}/matches`}>Pick from Matches</LinkButton> : undefined}
          />
        ) : (
          targets.map((t) => (
            <Row
              key={t.id}
              href={`/org/${slug}/board/${t.id}`}
              kind="school"
              role={statusRole(t.status)}
              title={t.school?.name ?? "Unknown school"}
              meta={`${t.school?.division ?? ""}${t.offer_type ? ` · ${t.offer_type} offer${t.offer_scholarship_percent ? ` (${t.offer_scholarship_percent}%)` : ""}` : ""}`}
              trailing={<StatusPill status={t.status} />}
            />
          ))
        )}
      </Section>

      <Section label="Contacts" count={contacts.length} role="people" kind="people">
        {contacts.length === 0 ? (
          <EmptyState kind="people" title="No Contacts Yet">
            {canEdit ? "Add the first one below." : "Coaches, parents and advisors live here."}
          </EmptyState>
        ) : (
          contacts.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Body weight="bold">{c.name}</Body>
                  <Label>{CONTACT_ROLE_LABEL[c.role] ?? c.role}</Label>
                  {(c.email || c.phone) && (
                    <Label>
                      {c.email && <TextLink href={`mailto:${c.email}`}>{c.email}</TextLink>}
                      {c.email && c.phone ? " · " : ""}
                      {c.phone && <TextLink href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`}>{c.phone}</TextLink>}
                    </Label>
                  )}
                  {c.notes && <Label>{c.notes}</Label>}
                </div>
                {canEdit && (
                  <Form action={deleteContactAction.bind(null, c.id)}>
                    <ConfirmButton inline title={`Remove ${c.name}?`} body="They come off this athlete's contacts. Nothing else changes." confirmLabel="Remove">
                      Remove
                    </ConfirmButton>
                  </Form>
                )}
              </div>
            </Card>
          ))
        )}
        {canEdit && (
          <div>
            <ContactForm action={contactAction} schools={schools} />
          </div>
        )}
      </Section>

      <Section label="Family" count={family.length} role="people" kind="people">
        {family.length === 0 ? (
          <EmptyState kind="people" title="No Family Login Yet" action={canEdit ? <LinkButton href={`/org/${slug}/roster/${id}/family/new`}>Invite Family</LinkButton> : undefined}>
            {canEdit ? "The athlete first, then a parent or guardian." : "Nobody in the family has a sign-in yet."}
          </EmptyState>
        ) : (
          family.map((g) => (
            <Row
              key={g.userId}
              href={user.role === "owner" ? `/org/${slug}/members/${g.userId}` : undefined}
              leading={<Avatar name={g.person!.full_name || g.person!.email} />}
              title={g.person!.full_name || g.person!.email}
              meta={`${relationshipLabel(g.relationship)} · ${g.person!.email}`}
              trailing={user.role === "owner" ? <Chevron /> : undefined}
              wrap
            />
          ))
        )}
        {canEdit && (
          <LinkButton href={`/org/${slug}/roster/${id}/family/new`} variant="secondary">
            Invite Family
          </LinkButton>
        )}
      </Section>

      <Section label="Visits" count={visits.length} role="place" kind="visit">
        {visits.length === 0 ? (
          <EmptyState kind="visit" title="No Visits Logged Yet" action={targets.length > 0 ? <LinkButton href={`/org/${slug}/board?athlete=${id}`}>Open Their Targets</LinkButton> : undefined}
          />
        ) : (
          visits.map((v) => (
            <Card key={v.id} href={`/org/${slug}/board/${v.target_id}`}>
              <div className="flex items-start justify-between gap-3">
                <Body weight="bold">
                  {schoolNameByTargetId.get(v.target_id) ?? "Unknown school"} · {VISIT_TYPE_LABEL[v.visit_type] ?? v.visit_type}
                </Body>
                <div className="flex-shrink-0">
                  <Label numeric>{longDate(v.visit_date)}</Label>
                </div>
              </div>
              {v.impression && <Body>{v.impression}</Body>}
              {v.next_step && <Label>Next: {v.next_step}</Label>}
            </Card>
          ))
        )}
      </Section>
    </Screen>
  );
}
