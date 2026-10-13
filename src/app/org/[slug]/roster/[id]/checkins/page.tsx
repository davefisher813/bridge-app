import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { longDate } from "@/lib/copy/dates";
import { loadStaff } from "@/lib/data/staff";
import { CHECKIN_DUE_DAYS, CHECKIN_KIND_LABEL, checkinAuthorName, checkinDue, daysSinceCheckin, type CheckinKind } from "@/lib/checkins";
import { logCheckin, removeCheckin } from "@/lib/actions/checkins";
import { CheckinForm } from "@/components/CheckinForm";
import { checkinPhotoUrl } from "@/lib/checkinPhoto";
import { effectiveStatus, isScoredStatus, placementAthlete, type PlacementTarget } from "@/lib/placement";
import { Card, ConfirmButton, EmptyState, Form, Label, Notice, Photo, Screen, Section, TextLink } from "@/components/kit";

// One athlete's check-in log (migration 0039). Staff only, to read and
// to write: these athletes are minors and an advisor's notes never reach
// a family login, so there is no family version of this screen. The gap
// since the last one is said first, because it is the reason to open it.
//
// Each entry carries its own Edit and Remove, the Contacts pattern on the
// athlete page, so a card is never a surface that goes nowhere.

interface CheckinRow {
  id: string;
  kind: string;
  occurred_on: string;
  notes: string | null;
  advisor_id: string | null;
  photo_path: string | null;
}

export default async function CheckinsPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: checkinRows }, staff, { data: committedRows }] = await Promise.all([
    supabase.from("athletes").select("id, name, advisor_id, status, detail, draft_team, draft_round, draft_year").eq("id", id).eq("org_id", org.id).is("deleted_at", null).single(),
    supabase.from("athlete_checkins").select("id, kind, occurred_on, notes, advisor_id, photo_path").eq("org_id", org.id).eq("athlete_id", id).order("occurred_on", { ascending: false }),
    loadStaff(supabase, org.id),
    supabase.from("recruiting_targets").select("id, status").eq("org_id", org.id).eq("athlete_id", id).eq("status", "Committed"),
  ]);
  if (!athlete) notFound();

  // The advisor by the staff list rather than an embed: a removed or
  // demoted advisor is not on it, and reads as nobody picked.
  const advisor = staff.find((s) => s.id === athlete.advisor_id) ?? null;
  const entries = ((checkinRows ?? []) as CheckinRow[]).map((c) => ({ ...c, by: checkinAuthorName(staff, c.advisor_id) }));

  const lastOn = entries[0]?.occurred_on ?? null;
  const today = new Date();
  const days = daysSinceCheckin(lastOn, today);
  const due = checkinDue(lastOn, today);
  // Today's rule for its reminders, asked the same way here, so this
  // screen never says an athlete is on them when Today would not show
  // them: an advisor still on the staff, and still being recruited.
  const committed = ((committedRows ?? []) as { id: string; status: string }[]).map((t): PlacementTarget => ({ id: t.id, status: t.status, schoolName: null }));
  const onReminders = due && !!advisor && isScoredStatus(effectiveStatus(placementAthlete(athlete), committed));
  const athleteHref = `/org/${slug}/roster/${id}`;

  return (
    <Screen title="Check-Ins" back={{ href: athleteHref, label: athlete.name }} lede={advisor ? `${advisor.name} is the advisor` : "No advisor picked yet"}>
      <Notice tone={due ? "warning" : "info"} title={days === null ? "No Check-In Yet" : days === 0 ? "Last Check-In Today" : days === 1 ? "Last Check-In Yesterday" : `${days} Days Since the Last Check-In`}>
        {entries.length === 0 ? `Log the first one below. One every ${CHECKIN_DUE_DAYS} days keeps an athlete off the reminders on Today.` : `${entries.length} on the log. ${due ? (onReminders ? `Past the ${CHECKIN_DUE_DAYS} days, so this athlete is on the reminders on Today.` : `Past the ${CHECKIN_DUE_DAYS} days.`) : `Due again ${CHECKIN_DUE_DAYS} days after the last one.`}`}
      </Notice>

      <Section label="Log" count={entries.length} role="time" kind="clock">
        {entries.length === 0 ? (
          <EmptyState kind="clock" role="time" title="No Check-Ins Yet" />
        ) : (
          entries.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <TextLink href={`/org/${slug}/roster/${id}/checkins/${c.id}`}>{`${CHECKIN_KIND_LABEL[c.kind as CheckinKind] ?? c.kind} · ${longDate(c.occurred_on)}`}</TextLink>
                  <Label>{`By ${c.by}`}</Label>
                  {c.notes && <Label>{c.notes}</Label>}
                  {c.photo_path && <Photo src={checkinPhotoUrl(slug, id, c.id, c.photo_path)!} alt={`Photo from this check-in with ${athlete.name}`} />}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <TextLink href={`/org/${slug}/roster/${id}/checkins/${c.id}/edit`}>Edit</TextLink>
                  <Form action={removeCheckin.bind(null, slug, id, c.id)}>
                    <ConfirmButton inline title="Remove This Check-In?" body="It comes off the log. Nothing else changes." confirmLabel="Remove">
                      Remove
                    </ConfirmButton>
                  </Form>
                </div>
              </div>
            </Card>
          ))
        )}
      </Section>

      <Section label="New Check-In" role="time" kind="clock">
        <CheckinForm action={logCheckin.bind(null, slug, id)} orgId={org.id} athleteId={id} />
      </Section>

      <TextLink href={`${athleteHref}/messages`}>Open Messages</TextLink>
    </Screen>
  );
}
