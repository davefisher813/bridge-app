import { notFound, redirect } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { getCurrentUser, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { Body, Card, Chevron, Chip, EmptyState, Label, LinkButton, Row, Score, Screen, Section, Stack, StatusCounts, TextLink } from "@/components/kit";
import { stageKind, statusRole } from "@/components/statusHue";
import { effectiveStatus, isScoredStatus, placementAthlete, type PlacementTarget } from "@/lib/placement";
import { checkinDue, daysSinceCheckin, latestByAthlete, sortByNeed } from "@/lib/checkins";
import { loadStaff } from "@/lib/data/staff";
import { ATHLETE_STATUSES } from "@/lib/validation/athlete";
import { formatMoneyShort, summarize } from "@/lib/fundraising/rollup";
import { toBudgetLines, toGifts, toPledges, type BudgetRow, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { STRONG_MATCH_DAYS } from "@/lib/fit/contract";
import { rankFits } from "@/lib/fit/rank";
import { loadOrgAssignments, partitionOrgAssignments, todayIso as orgCalendarDay } from "@/lib/data/assignments";
import { AssignmentRows } from "@/components/AssignmentRows";

// The Today screen. Per Dave (2026-09): this is an org/recruiting
// management tool, not a life-management app - so no "add a task" /
// "add an event" widgets here. What's here instead is what he said
// he'd actually check every morning: pipeline snapshot, who needs a
// follow-up, and what's coming up. Every number below comes from a
// real query; nothing is a placeholder stat. See docs/DECISIONS.md.

interface AthleteRow {
  id: string;
  name: string;
  advisor_id: string | null;
  status: string;
  detail: unknown;
  draft_team: string | null;
  draft_round: number | null;
  draft_year: number | null;
}

interface TargetRow {
  id: string;
  status: string;
  updated_at: string;
  visit_date: string | null;
  athlete_id: string;
  school_id: string;
  athletes: { name: string } | { name: string }[] | null;
  schools: { name: string } | { name: string }[] | null;
}

interface StrongFitRow {
  athlete_id: string;
  school_id: string;
  score: number;
  tag: string;
  partial: boolean;
  computed_at: string;
  athletes: { name: string } | { name: string }[] | null;
  schools: { name: string } | { name: string }[] | null;
}

interface TransferWindowRow {
  sport: string;
  division: string;
  window_label: string;
  opens_on: string;
  closes_on: string;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

const OPEN_STATUSES = ["Target", "In Contact", "Visit", "Offer"];

export default async function TodayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  // A family login has no Today: their athlete is home (Dave's pick,
  // 2026-09-21). Sent there before the org-wide gate refuses them.
  const who = await getCurrentUser(org.id);
  if (who?.role === "family") redirect(`/org/${slug}/family`);
  // A member (Bridge: Board) has their own home too, since 2026-09-21.
  if (who?.role === "member") redirect(`/org/${slug}/member`);
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();

  const [{ data: athleteRows }, { data: targets }, { data: windowRows }, { data: strongRows }, { data: checkinRows }, staff, openAssignments] = await Promise.all([
    supabase.from("athletes").select("id, name, advisor_id, status, detail, draft_team, draft_round, draft_year").eq("org_id", org.id).is("deleted_at", null),
    supabase
      .from("recruiting_targets")
      .select("id, status, updated_at, visit_date, athlete_id, school_id, athletes(name), schools(name)")
      .eq("org_id", org.id),
    supabase.from("transfer_windows").select("sport, division, window_label, opens_on, closes_on"),
    supabase
      .from("athlete_school_fits")
      .select("athlete_id, school_id, score, tag, partial, computed_at, athletes(name), schools(name)")
      .eq("org_id", org.id)
      .in("tag", ["Safety", "Fit"]),
    // Stage 3: the check-in log, for the reminders, and the staff list,
    // for the advisor's name on each one.
    supabase.from("athlete_checkins").select("athlete_id, occurred_on").eq("org_id", org.id).order("occurred_on", { ascending: false }),
    loadStaff(supabase, org.id),
    // Phase 4: the org's open assignments, for the two sections below.
    // Admin only (this screen is), and removed athletes are dropped by
    // the loader.
    loadOrgAssignments(supabase, org.id, { openOnly: true }),
  ]);

  // Only queried when the module is on. An org without fundraising does
  // not pay for three queries it will never render, and Elite Squad
  // never touches the tables at all.
  let fundraising: ReturnType<typeof summarize> | null = null;
  if (org.modules.donor_fundraising) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ data: giftRows }, { data: pledgeRows }, { data: budgetRows }] = await Promise.all([
      supabase
        .from("gifts")
        .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
        .eq("org_id", org.id),
      supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
      supabase.from("fundraising_budget").select("fiscal_year, category, amount").eq("org_id", org.id),
    ]);
    const gifts = toGifts(giftRows as GiftRow[] | null);
    const pledges = toPledges(pledgeRows as PledgeRow[] | null);
    // Null rather than a summary of nothing, so the screen shows an
    // empty state instead of a confident "$0 raised".
    if (gifts.length > 0 || pledges.length > 0) {
      fundraising = summarize({
        gifts,
        pledges,
        budget: toBudgetLines(budgetRows as BudgetRow[] | null),
        fiscalYear: Number(todayIso.slice(0, 4)),
        today: todayIso,
      });
    }
  }

  // Only athletes still on the roster: a removed athlete's targets stay
  // in the table for the record and leave every count here.
  const onRoster = new Set(((athleteRows ?? []) as AthleteRow[]).map((a) => a.id));
  const rows = ((targets ?? []) as TargetRow[]).filter((r) => onRoster.has(r.athlete_id));
  const inContactCount = rows.filter((r) => r.status === "In Contact").length;
  const committedCount = rows.filter((r) => r.status === "Committed").length;
  const totalTargets = rows.length;

  // One tile per athlete status, counted the way the roster filters
  // (effectiveStatus: a Committed target places an athlete whose own
  // row still says Active), so a tile and the list it opens agree. A
  // status outside the vocabulary is counted under its own word rather
  // than dropped, so nothing hides.
  const committedByAthlete = new Map<string, PlacementTarget[]>();
  for (const r of rows.filter((r) => r.status === "Committed")) {
    committedByAthlete.set(r.athlete_id, [...(committedByAthlete.get(r.athlete_id) ?? []), { id: r.id, status: r.status, schoolName: unwrap(r.schools)?.name ?? null }]);
  }
  const counts = new Map<string, number>(ATHLETE_STATUSES.map((s) => [s, 0]));
  let athleteTotal = 0;
  const effectiveById = new Map<string, string>();
  for (const a of (athleteRows ?? []) as AthleteRow[]) {
    const status = effectiveStatus(placementAthlete(a), committedByAthlete.get(a.id) ?? []);
    counts.set(status, (counts.get(status) ?? 0) + 1);
    effectiveById.set(a.id, status);
    athleteTotal += 1;
  }

  // Check-in reminders (Stage 3). Org wide, with the advisor named, so
  // an owner sees who on the staff owes a call: every athlete with an
  // advisor still on the staff who is still being recruited and has had
  // no check-in in CHECKIN_DUE_DAYS, never checked in first.
  const today = new Date();
  const lastCheckin = latestByAthlete((checkinRows ?? []) as { athlete_id: string; occurred_on: string | null }[]);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const advised = ((athleteRows ?? []) as AthleteRow[]).filter((a) => a.advisor_id && staffById.has(a.advisor_id));
  const checkinReminders = sortByNeed(
    advised
      .filter((a) => isScoredStatus(effectiveById.get(a.id) ?? a.status) && checkinDue(lastCheckin.get(a.id), today))
      .map((a) => ({ athleteId: a.id, name: a.name, days: daysSinceCheckin(lastCheckin.get(a.id), today), advisorFirstName: staffById.get(a.advisor_id!)!.name.split(" ")[0] })),
  ).slice(0, 4);
  // The way into My Athletes, with the same due rule the screen uses.
  const mine = advised.filter((a) => a.advisor_id === user.id);
  const mineDue = mine.filter((a) => isScoredStatus(effectiveById.get(a.id) ?? a.status) && checkinDue(lastCheckin.get(a.id), today)).length;

  // Assignments (Phase 4). Overdue is computed from the due date and the
  // status here, every load; nothing stored says so. A section shows only
  // when it has something, and shows the first few with a way to the rest.
  const assignmentDay = orgCalendarDay();
  const { submitted: toReview, overdue: overdueWork } = partitionOrgAssignments(openAssignments, assignmentDay);
  const ASSIGNMENTS_SHOWN = 5;

  const needsFollowUp = rows
    .filter((r) => OPEN_STATUSES.includes(r.status))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
    .slice(0, 4)
    .map((r) => ({
      id: r.id,
      status: r.status,
      athleteName: unwrap(r.athletes)?.name ?? "Unknown athlete",
      schoolName: unwrap(r.schools)?.name ?? "Unknown school",
      days: daysSince(r.updated_at),
    }));

  const upcomingVisits = rows
    .filter((r) => r.visit_date && new Date(r.visit_date) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.visit_date!).getTime() - new Date(b.visit_date!).getTime())
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      athleteName: unwrap(r.athletes)?.name ?? "Unknown athlete",
      schoolName: unwrap(r.schools)?.name ?? "Unknown school",
      visitDate: r.visit_date as string,
    }));

  const in60Days = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const upcomingWindows = ((windowRows ?? []) as TransferWindowRow[])
    .filter((w) => new Date(w.opens_on) >= today && new Date(w.opens_on) <= in60Days)
    .sort((a, b) => new Date(a.opens_on).getTime() - new Date(b.opens_on).getTime())
    .slice(0, 2);

  // Strong Matches. docs/MATCHING_CONTRACT.md section 2: a stored fit
  // computed in the last seven days, Safety or Fit, for a school not yet
  // on the board; one row per athlete, their best; the section only
  // shows when there is one. "Best" is the one ranking rule
  // (src/lib/fit/rank.ts, amended 2026-09-27): fully scored before
  // partial, then score, so a Safety scored on one dimension never
  // headlines over a Fit the engine could actually evaluate.
  const onBoard = new Set(rows.map((r) => `${r.athlete_id}:${r.school_id}`));
  const since = Date.now() - STRONG_MATCH_DAYS * 24 * 60 * 60 * 1000;
  const strongRowsByAthlete = new Map<string, StrongFitRow[]>();
  for (const f of ((strongRows ?? []) as StrongFitRow[]).filter((f) => onRoster.has(f.athlete_id) && new Date(f.computed_at).getTime() >= since && !onBoard.has(`${f.athlete_id}:${f.school_id}`))) {
    strongRowsByAthlete.set(f.athlete_id, [...(strongRowsByAthlete.get(f.athlete_id) ?? []), f]);
  }
  const headlines = [...strongRowsByAthlete.values()].map((group) => {
    const ranked = rankFits(
      group.map((f) => ({ ...f, school: { id: f.school_id, name: unwrap(f.schools)?.name ?? "" } })),
      "best",
    );
    return { ...ranked[0]!, more: ranked.length - 1 };
  });
  // Between athletes the same rule again, so one athlete's partial
  // headline never sits above another athlete's fully scored one.
  const strongMatches = rankFits(headlines, "best")
    .slice(0, 5)
    .map((best) => ({ athleteId: best.athlete_id, athleteName: unwrap(best.athletes)?.name ?? "Unknown athlete", schoolName: best.school.name || "Unknown school", score: best.score, tag: best.tag, more: best.more }));

  const firstName = (user.full_name || user.email).split(" ")[0] || user.email;

  return (
    <Screen title={`Good morning, ${firstName}.`} besideMark>
      {/* One tile per status with anyone in it, each opening the roster
          it counts: Dave's layout, 2026-09-27. */}
      <StatusCounts
        title="Athletes"
        total={athleteTotal}
        href={`/org/${slug}/roster`}
        items={[...counts]
          .filter(([, count]) => count > 0)
          .map(([status, count]) => ({ label: status, count, href: `/org/${slug}/roster?status=${encodeURIComponent(status)}`, role: statusRole(status), emphasis: status === "Active" }))}
      />

      <Row href={`/org/${slug}/schools`} kind="school" role="place" title="Schools" meta="Every school on file, with search and filters" trailing={<Chevron />} />
      <Row
        href={`/org/${slug}/mine`}
        kind="athlete"
        role="people"
        title="My Athletes"
        meta={mine.length === 0 ? "Nobody assigned to you yet" : `${mine.length} ${mine.length === 1 ? "athlete" : "athletes"}, ${mineDue} due for a check-in`}
        trailing={<Chevron />}
      />

      {strongMatches.length > 0 && (
        <Section label="Strong Matches" count={strongMatches.length} role="committed" kind="target">
          {strongMatches.map((m) => (
            <Row
              key={m.athleteId}
              href={`/org/${slug}/roster/${m.athleteId}/matches`}
              kind="target"
              role="committed"
              title={m.athleteName}
              meta={`${m.schoolName} · ${m.tag}${m.more > 0 ? ` · ${m.more} more not yet a target` : " · not a target yet"}`}
              trailing={<Score score={m.score} />}
            />
          ))}
        </Section>
      )}

      <Section label="Needs Follow-Up" count={checkinReminders.length + needsFollowUp.length} action={needsFollowUp.length > 0 ? <TextLink href={`/org/${slug}/board`}>View Board</TextLink> : undefined}>
        {checkinReminders.length === 0 && needsFollowUp.length === 0 ? (
          <EmptyState kind="check" role="committed" title="Nothing Needs a Follow-Up" action={<LinkButton href={`/org/${slug}/board`}>Open Targets</LinkButton>}
          />
        ) : (
          <>
            {checkinReminders.map((r) => (
              <Row
                key={`checkin-${r.athleteId}`}
                href={`/org/${slug}/roster/${r.athleteId}/checkins`}
                kind="clock"
                role="time"
                title={r.name}
                meta={`${r.days === null ? "never checked in" : `no check-in in ${r.days} days`} · ${r.advisorFirstName}`}
                trailing={<Chip label="Check-In" kind="clock" role="time" />}
                wrap
              />
            ))}
            {needsFollowUp.map((t) => (
              <Row
                key={t.id}
                href={`/org/${slug}/board/${t.id}`}
                kind="school"
                role={statusRole(t.status)}
                title={t.athleteName}
                meta={`${t.schoolName} · no update in ${t.days} ${t.days === 1 ? "day" : "days"}`}
                trailing={<StatusPill status={t.status} />}
                wrap
              />
            ))}
          </>
        )}
      </Section>

      {toReview.length > 0 && (
        <Section label="Submitted for Review" count={toReview.length} role="place" kind="document" action={<TextLink href={`/org/${slug}/assignments`}>See All</TextLink>}>
          <AssignmentRows slug={slug} rows={toReview.slice(0, ASSIGNMENTS_SHOWN)} today={assignmentDay} showAthlete />
        </Section>
      )}

      {overdueWork.length > 0 && (
        <Section label="Overdue" count={overdueWork.length} role="danger" kind="warning" action={<TextLink href={`/org/${slug}/assignments`}>See All</TextLink>}>
          <AssignmentRows slug={slug} rows={overdueWork.slice(0, ASSIGNMENTS_SHOWN)} today={assignmentDay} showAthlete />
        </Section>
      )}

      <Section label="Upcoming" count={upcomingVisits.length + upcomingWindows.length} role="visit" kind="clock">
        {upcomingVisits.length === 0 && upcomingWindows.length === 0 ? (
          <EmptyState kind="clock" title="Nothing Scheduled" action={<LinkButton href={`/org/${slug}/board`}>Open Targets</LinkButton>}
          />
        ) : (
          <>
            {upcomingVisits.map((v) => (
              <Row
                key={v.id}
                href={`/org/${slug}/board/${v.id}`}
                kind="visit"
                role="visit"
                title={`Visit · ${v.schoolName}`}
                meta={`${new Date(v.visitDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${v.athleteName}`}
              />
            ))}
            {upcomingWindows.map((w) => (
              <Row
                key={`${w.sport}-${w.division}-${w.window_label}`}
                href={`/org/${slug}/transfer-windows`}
                kind="clock"
                role="time"
                title="Transfer Portal Opens"
                meta={`${w.sport} ${w.division} · ${w.window_label} · in ${daysUntil(w.opens_on)} days`}
              />
            ))}
          </>
        )}
      </Section>

      {org.modules.donor_fundraising && (
        <Section label="Program Overview" role="committed" kind="money">
          {fundraising === null ? (
            <EmptyState kind="money" title="Nothing Recorded Yet" action={<LinkButton href={`/org/${slug}/fundraising/gifts/new`}>Record the First Gift</LinkButton>}
            />
          ) : (
            <Card href={`/org/${slug}/fundraising`}>
              <Body weight="semibold">{formatMoneyShort(fundraising.totalCashCents)} raised this year</Body>
              <Label>
                {fundraising.totalBudgetCents > 0
                  ? `${Math.round((fundraising.totalCashCents / fundraising.totalBudgetCents) * 100)}% of the year's target`
                  : "No budget set for the year"}
                {fundraising.outstandingPledgeCents > 0 ? ` · ${formatMoneyShort(fundraising.outstandingPledgeCents)} promised and not received` : ""}
              </Label>
            </Card>
          )}
        </Section>
      )}
    </Screen>
  );
}
