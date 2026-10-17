import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { longDate } from "@/lib/copy/dates";
import { loadStaff } from "@/lib/data/staff";
import { effectiveStatus, isScoredStatus, placementAthlete, type PlacementTarget } from "@/lib/placement";
import { CHECKIN_DUE_DAYS, CHECKIN_KIND_LABEL, checkinAuthorName, checkinDue, daysSinceCheckin, latestByAthlete, sortByNeed, type CheckinKind } from "@/lib/checkins";
import { Avatar, Chevron, EmptyState, Row, Screen, Section } from "@/components/kit";

// Advisor Hub (live check, 2026-10-10): the whole program's advising in
// one place, for every Admin. Who still needs a check-in, who has no
// advisor, and the latest check-ins anyone logged. My Athletes is one
// advisor's slice of this; Advisors is the people. Staff only, like the
// check-in log it reads (migration 0039).

interface AthleteRow {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  status: string;
  detail: unknown;
  draft_team: string | null;
  draft_round: number | null;
  draft_year: number | null;
  advisor_id: string | null;
}

interface CheckinRow {
  id: string;
  athlete_id: string;
  kind: string;
  occurred_on: string | null;
  advisor_id: string | null;
  photo_path?: string | null;
}

interface CommittedRow {
  id: string;
  athlete_id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

const RECENT = 10;

export default async function AdvisorHubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athleteRows }, { data: checkinRows }, { data: committedRows }, staff] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position, status, detail, draft_team, draft_round, draft_year, advisor_id").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("athlete_checkins").select("id, athlete_id, kind, occurred_on, advisor_id, photo_path").eq("org_id", org.id).order("occurred_on", { ascending: false }),
    supabase.from("recruiting_targets").select("id, athlete_id, status, schools(name)").eq("org_id", org.id).eq("status", "Committed"),
    loadStaff(supabase, org.id),
  ]);

  const athletes = (athleteRows ?? []) as AthleteRow[];
  const checkins = (checkinRows ?? []) as CheckinRow[];
  const names = new Map(staff.map((s) => [s.id, s.name]));
  const athleteNames = new Map(athletes.map((a) => [a.id, a.name]));

  const committedByAthlete = new Map<string, PlacementTarget[]>();
  for (const t of (committedRows ?? []) as CommittedRow[]) {
    const school = Array.isArray(t.schools) ? t.schools[0] : t.schools;
    committedByAthlete.set(t.athlete_id, [...(committedByAthlete.get(t.athlete_id) ?? []), { id: t.id, status: t.status, schoolName: school?.name ?? null }]);
  }

  // The same rule as the reminders on Today and the Advisors count: only
  // an athlete still being recruited needs an advisor and a check-in.
  const latest = latestByAthlete(checkins);
  const today = new Date();
  const recruiting = athletes
    .filter((a) => isScoredStatus(effectiveStatus(placementAthlete(a), committedByAthlete.get(a.id) ?? [])))
    .map((a) => {
      const lastOn = latest.get(a.id) ?? null;
      return { ...a, lastOn, days: daysSinceCheckin(lastOn, today), due: checkinDue(lastOn, today) };
    });
  const due = sortByNeed(recruiting.filter((a) => a.due));
  const unassigned = recruiting.filter((a) => !a.advisor_id).length;
  // An advisor who left reads as nobody, the Check-Ins screen's rule.
  const advisorOf = (id: string | null) => (id && names.get(id)) || null;

  return (
    <Screen title="Advisor Hub" back={{ href: `/org/${slug}/advisors`, label: "Advisors" }} lede={`${recruiting.length} ${recruiting.length === 1 ? "athlete" : "athletes"} still being recruited`}>
      <Section label="Due for a Check-In" count={due.length} role="time" kind="clock">
        {due.length === 0 ? (
          <EmptyState kind="clock" role="time" title="Nobody Is Due" />
        ) : (
          due.map((a) => (
            <Row
              key={a.id}
              href={`/org/${slug}/roster/${a.id}/checkins`}
              leading={<Avatar name={a.name} />}
              title={a.name}
              meta={`${a.days === null ? "never checked in" : `no check-in in ${a.days} days`} · ${advisorOf(a.advisor_id) ?? "no advisor"}`}
              trailing={<Chevron />}
              wrap
            />
          ))
        )}
      </Section>

      <Section label="Advising" role="people" kind="people">
        <Row href={`/org/${slug}/roster?advisor=none`} kind="athlete" role="time" title="No Advisor Yet" meta={`${unassigned} ${unassigned === 1 ? "athlete" : "athletes"} still being recruited`} trailing={<Chevron />} wrap />
        <Row href={`/org/${slug}/mine`} kind="athlete" role="people" title="My Athletes" trailing={<Chevron />} wrap />
        <Row href={`/org/${slug}/advisors`} kind="people" role="people" title="Advisors" meta={`${staff.length} ${staff.length === 1 ? "Admin" : "Admins"}`} trailing={<Chevron />} wrap />
      </Section>

      <Section label="Latest Check-Ins" count={checkins.length} role="time" kind="clock">
        {checkins.length === 0 ? (
          <EmptyState kind="clock" role="time" title="No Check-Ins Yet" />
        ) : (
          checkins.slice(0, RECENT).map((c) => (
            <Row
              key={c.id}
              href={`/org/${slug}/roster/${c.athlete_id}/checkins/${c.id}`}
              leading={<Avatar name={athleteNames.get(c.athlete_id) ?? "Athlete"} />}
              title={athleteNames.get(c.athlete_id) ?? "An Athlete No Longer Listed"}
              meta={`${CHECKIN_KIND_LABEL[c.kind as CheckinKind] ?? c.kind} · ${longDate(c.occurred_on)} · by ${checkinAuthorName(staff, c.advisor_id)}${c.photo_path ? " · photo" : ""}`}
              trailing={<Chevron />}
              wrap
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
