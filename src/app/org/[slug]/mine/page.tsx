import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { longDate } from "@/lib/copy/dates";
import { StatusPill } from "@/components/StatusPill";
import { Avatar, EmptyState, LinkButton, Row, Screen, Section, TextLink } from "@/components/kit";
import { effectiveStatus, isScoredStatus, placementAthlete, type PlacementTarget } from "@/lib/placement";
import { checkinDue, daysSinceCheckin, latestByAthlete, sortByNeed } from "@/lib/checkins";
import { unreadByAthlete } from "@/lib/data/messages";

// My Athletes: the athletes this person advises, the ones who need a
// check-in most first (never checked in, then the longest gap). The
// working view behind the reminders on Today, for one advisor. Staff
// only; the advisor is display and reminders, never a permission, so
// nothing here is hidden from the rest of the staff elsewhere.

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
}

interface CommittedRow {
  id: string;
  athlete_id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

export default async function MyAthletesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athleteRows }, { data: checkinRows }, { data: committedRows }] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position, status, detail, draft_team, draft_round, draft_year").eq("org_id", org.id).eq("advisor_id", user.id).is("deleted_at", null).order("name"),
    supabase.from("athlete_checkins").select("athlete_id, occurred_on").eq("org_id", org.id).order("occurred_on", { ascending: false }),
    supabase.from("recruiting_targets").select("id, athlete_id, status, schools(name)").eq("org_id", org.id).eq("status", "Committed"),
  ]);

  const athletes = (athleteRows ?? []) as AthleteRow[];
  const unread = await unreadByAthlete(
    supabase,
    org.id,
    user.id,
    athletes.map((a) => a.id),
  );

  const committedByAthlete = new Map<string, PlacementTarget[]>();
  for (const t of (committedRows ?? []) as CommittedRow[]) {
    const school = Array.isArray(t.schools) ? t.schools[0] : t.schools;
    committedByAthlete.set(t.athlete_id, [...(committedByAthlete.get(t.athlete_id) ?? []), { id: t.id, status: t.status, schoolName: school?.name ?? null }]);
  }

  const latest = latestByAthlete((checkinRows ?? []) as { athlete_id: string; occurred_on: string | null }[]);
  const today = new Date();
  const rows = sortByNeed(
    athletes.map((a) => {
      const lastOn = latest.get(a.id) ?? null;
      const effective = effectiveStatus(placementAthlete(a), committedByAthlete.get(a.id) ?? []);
      return {
        ...a,
        lastOn,
        days: daysSinceCheckin(lastOn, today),
        // Due by the same rule as the reminders on Today: only an athlete
        // still being recruited. A placed or graduated one is never due.
        due: isScoredStatus(effective) && checkinDue(lastOn, today),
        unread: unread.get(a.id) ?? 0,
        effective,
      };
    }),
  );
  const dueCount = rows.filter((r) => r.due).length;

  return (
    <Screen
      title="My Athletes"
      back={{ href: `/org/${slug}`, label: "Today" }}
      lede={`${rows.length} ${rows.length === 1 ? "athlete" : "athletes"} · ${dueCount} due for a check-in`}
    >
      <Section label="Yours" count={rows.length} role="people" kind="athlete" action={rows.length > 0 ? <TextLink href={`/org/${slug}/roster?advisor=me`}>On the Roster</TextLink> : undefined}>
        {rows.length === 0 ? (
          <EmptyState kind="athlete" role="people" title="Nobody Assigned to You Yet" action={<LinkButton href={`/org/${slug}/roster`}>Open Athletes</LinkButton>}>
            Pick yourself as Advisor on an athlete&apos;s Edit screen.
          </EmptyState>
        ) : (
          rows.map((a) => (
            <Row
              key={a.id}
              href={`/org/${slug}/roster/${a.id}`}
              leading={<Avatar name={a.name} />}
              title={a.name}
              meta={`${a.days === null ? "never checked in" : a.due ? `no check-in in ${a.days} days` : `last check-in ${longDate(a.lastOn)}`} · ${a.sport}${a.position ? ` · ${a.position}` : ""}${a.unread > 0 ? ` · ${a.unread} new ${a.unread === 1 ? "message" : "messages"}` : ""}`}
              trailing={<StatusPill status={a.effective} />}
              wrap
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
