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
import { canReopen, isScoredStatus, nextOutcomes, placementAthlete, placementMeta, placementOf, type Outcome } from "@/lib/placement";
import { reopenRecruiting } from "@/lib/actions/reopen";
import { addNote, removeAthlete, removeNote } from "@/lib/actions/athletes";
import { AthleteNoteForm } from "@/components/AthleteNoteForm";
import { loadAthleteNotes, NOTE_CONTEXT_LABEL } from "@/lib/data/athleteNotes";
import { loadAthleteActivity } from "@/lib/data/activity";
import { isOpenStatus, loadAthleteAssignments, sortByUrgency, todayIso } from "@/lib/data/assignments";
import { AssignmentRows } from "@/components/AssignmentRows";
import { ActivityRows } from "@/components/ActivityRows";
import { loadCoachOptions } from "@/lib/data/lookups";
import { Avatar, Body, Card, Chevron, ConfirmButton, EmptyState, Form, Grid2, Label, LinkButton, Notice, Row, Score, Screen, Section, Stack, Stat, StatRow, TextLink } from "@/components/kit";
import { relationshipLabel } from "@/lib/copy/relationships";
import { statusRole, stageKind } from "@/components/statusHue";
import { metricRowsToEntries, type MetricRow } from "@/lib/data/fitAdapters";
import { loadFitsForAthlete } from "@/lib/data/fits";
import { formatMetricValue, metricsFor, partialLabelFor, positionGroupOf, rankFits, selectScoringMetrics } from "@/lib/fit";
import { loadAdvisorChoices } from "@/lib/org/advisors";
import { setAdvisorFromAthleteForm } from "@/lib/actions/advisor";
import { AdvisorSheet } from "@/components/AdvisorSheet";
import { threadSummaryByAthlete } from "@/lib/data/messages";
import { checkinDue } from "@/lib/checkins";
import { personLabel } from "@/lib/org/roleLabels";
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

// How many activity entries the profile shows before See All.
const ACTIVITY_PREVIEW = 5;

// How many assignments the profile shows before See All: the most urgent.
const ASSIGNMENT_PREVIEW = 3;

const OUTCOME_LABEL: Record<Outcome, string> = { enroll: "Mark Enrolled", graduate: "Mark Graduated", draft: "Mark Drafted" };

interface SchoolRow {
  id: string;
  name: string;
  division: string;
  sports_sponsored?: string[] | null;
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

// Athlete profile / detail screen. Targets (the athlete's open
// recruiting_targets, the same rows as the Targets board, reusing the
// board's data rather than duplicating it), Contacts (athlete-scoped)
// and Family, as sections on one scrollable page. Closed targets,
// messages and visits live on Recruiting History; the profile shows
// only what is live. Dave, 2026-09-26.
export default async function AthletePage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ notice?: string; error?: string }> }) {
  const { slug, id } = await params;
  const { notice, error } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athlete }, { data: targetRows }, { data: contactRows }, { data: schoolRows }, { data: metricRows }, fits, advisors, { data: lastCheckinRows }, threads, notes, recentActivity, assignmentRows] = await Promise.all([
    supabase
      .from("athletes")
      .select("id, name, sport, position, recruit_type, gpa, goal, family_budget_cents, home_state, status, detail, draft_team, draft_round, draft_year, graduated_on, first_full_time_enrollment, advisor_id")
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
    supabase.from("schools").select("id, name, division, sports_sponsored").order("name"),
    supabase.from("athlete_metrics").select("id, metric, value, measured_on, source").eq("athlete_id", id).eq("org_id", org.id).order("measured_on", { ascending: false }),
    loadFitsForAthlete(supabase, org.id, id),
    // Stage 3 (migration 0039): the advisor comes from the Admin list,
    // which also carries the Title for the label, so a removed or
    // demoted advisor reads as nobody assigned rather than a stale
    // name. Stage 5, Phase 2: the same list, most recently used first,
    // is what the Advisor sheet offers.
    loadAdvisorChoices(supabase, org.id),
    supabase.from("athlete_checkins").select("occurred_on").eq("org_id", org.id).eq("athlete_id", id).order("occurred_on", { ascending: false }).limit(1),
    threadSummaryByAthlete(supabase, org.id, user.id, [id]),
    // Staff notes (migration 0040), all of them: this is the only screen
    // that lists them, so a cut-off would hide a note nobody could then
    // read or delete. Behind the staff guard above; no family or member
    // screen reads this table.
    loadAthleteNotes(supabase, org.id, id),
    // The last five entries of the activity log (migration 0044), one
    // more than shown so See All knows whether there is more. Behind
    // the same staff guard; no family or member screen reads the log.
    loadAthleteActivity(supabase, org.id, id, ACTIVITY_PREVIEW + 1),
    // Assignments (migration 0046), every status, for the section below.
    // Admins only: the Viewer reads none of this table.
    loadAthleteAssignments(supabase, org.id, id),
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

  // Stored matches. docs/MATCHING_CONTRACT.md section 2, amended
  // 2026-09-27: the top ten here through the one ranking rule (fully
  // scored first, then partial, each by score, src/lib/fit/rank.ts), the
  // full list with search, sort and filters on its own screen. The count
  // is the schools evaluated for this athlete: every stored row for a
  // school that sponsors the sport, the same rule the Matches screen
  // applies before its filters. A partial row says so in plain words,
  // where a full row says its first reason.
  const sport = (athlete.sport ?? "").toLowerCase();
  const sponsorsSport = new Map(((schoolRows ?? []) as SchoolRow[]).map((s) => [s.id, (s.sports_sponsored ?? []).map((x) => x.toLowerCase())]));
  const evaluated = fits.filter((f) => {
    const list = sponsorsSport.get(f.school_id) ?? [];
    return list.length === 0 || list.includes(sport);
  });
  const topFits = rankFits(evaluated, "best").slice(0, 10);
  const evaluatedLabel = `${evaluated.length} ${evaluated.length === 1 ? "School" : "Schools"} Evaluated`;
  const goal = GOAL_LABEL[(athlete.goal ?? "balanced") as AthleteGoal] ?? GOAL_LABEL.balanced;
  const budgetCents = athlete.family_budget_cents as number | null;

  const targets = ((targetRows ?? []) as TargetRow[]).map((t) => ({ ...t, school: unwrap(t.schools) }));
  const openTargets = targets.filter((t) => t.status !== "Not Interested");

  const journey = deriveJourneyStage(targets.map((t) => ({ status: t.status, schoolName: t.school?.name ?? "" })));
  const placement = placementOf(
    placementAthlete(athlete),
    targets.map((t) => ({ id: t.id, status: t.status, schoolName: t.school?.name ?? null })),
  );
  const meta = placement ? placementMeta(placement, { firstEnrollment: athlete.first_full_time_enrollment, graduatedOn: athlete.graduated_on }) : undefined;
  const outcomes = canEdit ? nextOutcomes(athlete.status) : [];
  // Reopen sits beside the outcomes. A withdrawn commitment needs no
  // facts, so it is one confirm; leaving college needs the transfer
  // facts, so it is a screen.
  const reopen = canEdit && canReopen(athlete.status) ? (athlete.status === "Committed" ? "confirm" : "screen") : null;
  // Opens the target that names the school; otherwise wherever the
  // name gets recorded (the board for a commitment, the record for the
  // Current School or the draft).
  const placementHref = placement?.targetId
    ? `/org/${slug}/board/${placement.targetId}`
    : !canEdit
      ? undefined
      : placement?.state === "Committed"
        ? `/org/${slug}/board/new`
        : placement?.state === "Drafted"
          ? `/org/${slug}/roster/${id}/draft`
          : `/org/${slug}/roster/${id}/edit`;

  // The Committed athlete's reopen is a plain form with no fields, and
  // the kit's Form wants an action that returns nothing, so the state
  // the screen version reads is dropped here; the action redirects
  // either way.
  async function reopenNow(formData: FormData) {
    "use server";
    await reopenRecruiting(slug, id, formData);
  }

  const advisor = advisors.find((s) => s.id === athlete.advisor_id) ?? null;
  const thread = threads.get(id);
  const lastCheckinOn = ((lastCheckinRows ?? []) as { occurred_on: string | null }[])[0]?.occurred_on ?? null;
  const checkinIsDue = checkinDue(lastCheckinOn, new Date());

  // Assignments: what still needs doing (open or waiting on a review),
  // most urgent first, so overdue and due soon lead. Done and cancelled
  // rows stay on See All.
  const today = todayIso();
  const assignments = sortByUrgency(assignmentRows, today);
  const activeAssignments = assignments.filter((a) => isOpenStatus(a.status) || a.status === "submitted");
  const assignHref = `/org/${slug}/roster/${id}/assignments`;
  const assignmentsShown = Math.min(activeAssignments.length, ASSIGNMENT_PREVIEW);

  const contacts = contactRows ?? [];
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));
  // Each college's coaches, so a contact form that picks a school can
  // suggest them by name and fill the email and phone (Stage 4).
  const coaches = canEdit ? await loadCoachOptions(supabase, schools.map((s) => s.id)) : {};
  const contactAction = createContact.bind(null, slug, id);
  const deleteContactAction = deleteContact.bind(null, slug, id);
  const noteAction = addNote.bind(null, slug, id);

  // The Advisor sheet (Stage 5, Phase 2): Assign or Change, the org's
  // Admins most recently used first, Clear, and Add Admin, which is the
  // existing invite with the role preset and a way back here with the
  // new person assigned. Admins only; the advisor itself is display and
  // reminders, never a permission.
  const advisorAction = setAdvisorFromAthleteForm.bind(null, slug, id);
  const advisorSheet = canEdit ? (
    <AdvisorSheet
      action={advisorAction}
      field="advisorId"
      title="Advisor"
      trigger={advisor ? "Change" : "Assign"}
      searchLabel="Search Admins"
      currentId={advisor?.id ?? null}
      clearLabel={advisor ? "Clear Advisor" : undefined}
      choices={advisors.map((a) => ({ id: a.id, title: a.name, meta: `${personLabel(a)} · ${a.email}${a.advising ? ` · ${a.advising} ${a.advising === 1 ? "athlete" : "athletes"}` : ""}`, keywords: a.email }))}
      // Inviting an Admin is an owner's (inviteMember, members/new), so
      // the door is offered to the same people who may go through it.
      add={user.role === "owner" ? { href: `/org/${slug}/members/new?role=owner&assignAthleteId=${id}`, label: "Add Admin" } : undefined}
      empty="Nobody here can advise yet. Add an Admin below."
    />
  ) : undefined;

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
      {error && <Notice tone="danger" title={error} />}

      {/* Who checks in with this athlete, and the two things they do:
          the thread with the family and the check-in log. First on the
          page (Stage 5, Phase 2), managed where you see it: Assign or
          Change opens the sheet. The advisor is display and reminders
          only, never a permission. */}
      <Section label="Advisor" role="people" kind="people" action={advisor ? advisorSheet : undefined}>
        {advisor ? (
          <Row
            href={advisor.email ? `mailto:${advisor.email}` : undefined}
            leading={<Avatar name={advisor.name} />}
            title={advisor.name}
            meta={`${personLabel(advisor)}${advisor.email ? ` · ${advisor.email}` : ""}`}
            trailing={advisor.email ? <Chevron /> : undefined}
            wrap
          />
        ) : (
          <EmptyState kind="people" title="No Advisor Assigned" action={advisorSheet} />
        )}
        <Row
          href={`/org/${slug}/roster/${id}/messages`}
          kind="message"
          role="contact"
          title="Messages"
          meta={thread ? `${thread.total} ${thread.total === 1 ? "message" : "messages"}${thread.unread > 0 ? ` · ${thread.unread} new` : ""}` : "Nothing sent yet"}
          trailing={<Chevron />}
        />
        <Row
          href={`/org/${slug}/roster/${id}/checkins`}
          kind="clock"
          role="time"
          title="Check-Ins"
          meta={lastCheckinOn ? `last on ${longDate(lastCheckinOn)}${checkinIsDue ? " · due for one" : ""}` : "None yet"}
          trailing={<Chevron />}
        />
      </Section>

      {/* Work given to this athlete (Stage 5, Phase 4): overdue and due
          soon first, New Assignment to add one, See All for the whole list.
          Not labelled Assign: the Advisor sheet's trigger is Assign, and
          the advisor laws tell the two apart by that word. */}
      <Section
        label="Assignments"
        count={activeAssignments.length}
        role="contact"
        kind="checklist"
        action={assignments.length > assignmentsShown ? <TextLink href={assignHref}>See All</TextLink> : undefined}
      >
        {assignments.length === 0 ? (
          <EmptyState kind="checklist" role="contact" title="No Assignments Yet" action={<LinkButton href={`${assignHref}/new`}>New Assignment</LinkButton>} />
        ) : (
          <>
            {activeAssignments.length === 0 ? (
              <EmptyState kind="check" role="committed" title="Nothing Open" />
            ) : (
              <AssignmentRows slug={slug} rows={activeAssignments.slice(0, assignmentsShown)} today={today} />
            )}
            <LinkButton href={`${assignHref}/new`} variant="secondary">
              New Assignment
            </LinkButton>
          </>
        )}
      </Section>

      <Stack gap={3}>
        {placement ? (
          // Committed, Enrolled, Graduated or Drafted: where they went is
          // the one fact that matters now, so it replaces the stepper.
          // Dave, 2026-09-26.
          <Row
            href={placementHref}
            kind={stageKind(placement.state)}
            role={statusRole(placement.state)}
            title={placement.name ?? (placement.state === "Drafted" ? "Team Not on File" : "School Not on File")}
            meta={meta}
            trailing={
              <>
                <StatusPill status={placement.state} />
                {placementHref && <Chevron />}
              </>
            }
          />
        ) : (
          // The stage line opens this athlete's targets, which is what
          // it is a summary of. Dave, 2026-09-25.
          <Card href={`/org/${slug}/board?athlete=${id}`}>
            <JourneyStepper result={journey} />
          </Card>
        )}
        {outcomes.length > 0 && (
          <Grid2>
            {outcomes.map((o) => (
              <LinkButton key={o} href={`/org/${slug}/roster/${id}/${o}`} variant="secondary">
                {OUTCOME_LABEL[o]}
              </LinkButton>
            ))}
          </Grid2>
        )}
        {reopen === "screen" && (
          <LinkButton href={`/org/${slug}/roster/${id}/reopen`} variant="secondary">
            Reopen Recruiting
          </LinkButton>
        )}
        {reopen === "confirm" && (
          <Form action={reopenNow}>
            <ConfirmButton title="Reopen Recruiting?" body="The commitment comes off the board and matches score again." confirmLabel="Reopen">
              Reopen Recruiting
            </ConfirmButton>
          </Form>
        )}
      </Stack>

      <Stack gap={3}>
        <Row href={`/org/${slug}/roster/${id}/eligibility`} kind="checklist" role="contact" title="NCAA Eligibility" trailing={<Chevron />} />
        <Row href={`/org/${slug}/roster/${id}/transcript`} kind="course" role="contact" title="Transcript" trailing={<Chevron />} />
        {targets.length > 0 && (
          <Row
            href={`/org/${slug}/roster/${id}/history`}
            kind="school"
            role="place"
            title="Recruiting History"
            meta={`${targets.length} ${targets.length === 1 ? "school" : "schools"} · every message, visit and offer`}
            trailing={<Chevron />}
          />
        )}
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

      {!placement && isScoredStatus(athlete.status) && (
        // Once Committed or Enrolled, recruiting is over: ranking more
        // schools is noise, and an Inactive athlete is not scored either.
        // Dave, 2026-09-26.
        <Section
          label={evaluatedLabel}
          role="place"
          kind="target"
          action={evaluated.length > 10 ? <TextLink href={`/org/${slug}/roster/${id}/matches`}>See All</TextLink> : undefined}
        >
          {evaluated.length === 0 ? (
            <EmptyState kind="target" title="No Matches Yet" action={canEdit ? <LinkButton href={`/org/${slug}/schools`}>Open Schools</LinkButton> : undefined} />
          ) : (
            <>
              {topFits.map((f) => (
                <Row
                  key={f.school_id}
                  href={`/org/${slug}/roster/${id}/matches`}
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
                  A dimension with no data on file is left out and the rest are reweighted. Add the missing numbers and the score fills in.
                </Notice>
              )}
              <TextLink href={`/org/${slug}/roster/${id}/matches`}>{`See All ${evaluated.length} Matches`}</TextLink>
            </>
          )}
        </Section>
      )}

      {!placement && (
        // Recruiting is over for a placed athlete, so the live list goes
        // with it; the closed schools are on Recruiting History.
        <Section label="Targets" count={openTargets.length} role="place" kind="school">
          {openTargets.length === 0 ? (
            <EmptyState kind="school" title="No Targets Yet" action={canEdit ? <LinkButton href={`/org/${slug}/roster/${id}/matches`}>Pick from Matches</LinkButton> : undefined} />
          ) : (
            openTargets.map((t) => (
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
      )}


      {/* Staff only (migration 0040): a dated log, newest first. Notes
          are deleted, never edited, and no family or member screen reads
          them. */}
      <Section label="Notes" count={notes.length} role="accent" kind="note">
        {notes.length === 0 ? (
          <EmptyState kind="note" title="No Notes Yet" />
        ) : (
          notes.map((n) => (
            <Card key={n.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Label>{[NOTE_CONTEXT_LABEL[n.context] ?? "Note", n.createdAt ? longDate(n.createdAt.slice(0, 10)) : null, n.authorName].filter(Boolean).join(" · ")}</Label>
                  <Body>{n.body}</Body>
                </div>
                {canEdit && (
                  <Form action={removeNote.bind(null, slug, id, n.id)}>
                    <ConfirmButton inline title="Delete This Note?" body="It comes off the log for good. Nothing else changes." confirmLabel="Delete">
                      Delete
                    </ConfirmButton>
                  </Form>
                )}
              </div>
            </Card>
          ))
        )}
        {canEdit && <AthleteNoteForm action={noteAction} />}
      </Section>

      {/* Who did what to this athlete, newest first: Admins only, and
          never the text of a note, a message or a document. */}
      <Section
        label="Activity"
        role="accent"
        kind="clock"
        action={recentActivity.length > ACTIVITY_PREVIEW ? <TextLink href={`/org/${slug}/roster/${id}/activity`}>See All</TextLink> : undefined}
      >
        {recentActivity.length === 0 ? (
          <EmptyState kind="clock" title="No Activity Yet" />
        ) : (
          <ActivityRows slug={slug} rows={recentActivity.slice(0, ACTIVITY_PREVIEW)} liveAthletes={new Set([id])} profileLinks={false} />
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
                  <div className="flex flex-col items-end gap-1">
                    <TextLink href={`/org/${slug}/roster/${id}/contacts/${c.id}/edit`}>Edit</TextLink>
                    <Form action={deleteContactAction.bind(null, c.id)}>
                      <ConfirmButton inline title={`Remove ${c.name}?`} body="They come off this athlete's contacts. Nothing else changes." confirmLabel="Remove">
                        Remove
                      </ConfirmButton>
                    </Form>
                  </div>
                )}
              </div>
            </Card>
          ))
        )}
        {canEdit && (
          <div>
            <ContactForm action={contactAction} schools={schools} coaches={coaches} />
          </div>
        )}
      </Section>

      <Section label="Athlete Logins" count={family.length} role="people" kind="people">
        {family.length === 0 ? (
          <EmptyState kind="people" title="No Athlete Login Yet" action={canEdit ? <LinkButton href={`/org/${slug}/roster/${id}/family/new`}>Invite Athlete</LinkButton> : undefined} />
        ) : (
          family.map((g) => (
            // Opens the link itself: who they are to this athlete, Unlink,
            // and linking them to another athlete (audit crud F7).
            <Row
              key={g.userId}
              href={canEdit ? `/org/${slug}/roster/${id}/family/${g.userId}` : undefined}
              leading={<Avatar name={g.person!.full_name || g.person!.email} />}
              title={g.person!.full_name || g.person!.email}
              meta={`${relationshipLabel(g.relationship)} · ${g.person!.email}`}
              trailing={canEdit ? <Chevron /> : undefined}
              wrap
            />
          ))
        )}
        {/* With nobody linked yet the empty state above already carries
            this button; a second one beside it is the same link twice. */}
        {canEdit && family.length > 0 && (
          <LinkButton href={`/org/${slug}/roster/${id}/family/new`} variant="secondary">
            Invite Athlete
          </LinkButton>
        )}
      </Section>

      {canEdit && (
        // Audit crud F1: a test record, a duplicate, or a family that asks
        // for the record to go. It leaves every list at once.
        <Form action={removeAthlete.bind(null, slug, id)}>
          <ConfirmButton title={`Remove ${athlete.name}?`} body="They come off the roster, Today, the Targets board and their athlete logins, and their matches are cleared." confirmLabel="Remove Athlete">
            Remove Athlete
          </ConfirmButton>
        </Form>
      )}
    </Screen>
  );
}
