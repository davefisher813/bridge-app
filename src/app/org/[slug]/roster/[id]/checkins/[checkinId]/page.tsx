import { notFound, redirect } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { longDate } from "@/lib/copy/dates";
import { loadStaff } from "@/lib/data/staff";
import { CHECKIN_KIND_LABEL, checkinAuthorName, type CheckinKind } from "@/lib/checkins";
import { checkinPhotoUrl } from "@/lib/checkinPhoto";
import { removeCheckin } from "@/lib/actions/checkins";
import { Body, Card, ConfirmButton, Form, Label, LinkButton, Photo, Screen, Section, Stack } from "@/components/kit";

// One check-in (live check, 2026-10-10): what happened, who logged it,
// the notes and the photo from it (migration 0056). Staff only, like the
// log (0039). Edit and Remove live here as well as on the log.
export default async function CheckinPage({ params }: { params: Promise<{ slug: string; id: string; checkinId: string }> }) {
  const { slug, id, checkinId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: entry }, staff] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase.from("athlete_checkins").select("id, kind, occurred_on, notes, advisor_id, photo_path").eq("id", checkinId).eq("athlete_id", id).eq("org_id", org.id).maybeSingle(),
    loadStaff(supabase, org.id),
  ]);
  if (!athlete || !entry) notFound();
  const c = entry as { id: string; kind: string; occurred_on: string; notes: string | null; advisor_id: string | null; photo_path: string | null };
  const by = checkinAuthorName(staff, c.advisor_id);
  const photo = checkinPhotoUrl(slug, id, c.id, c.photo_path);
  const kind = CHECKIN_KIND_LABEL[c.kind as CheckinKind] ?? c.kind;
  const logHref = `/org/${slug}/roster/${id}/checkins`;
  // Removed from here, the log is where to land.
  const remove = async () => {
    "use server";
    await removeCheckin(slug, id, c.id);
    redirect(logHref);
  };

  return (
    <Screen title={`${kind} Check-In`} back={{ href: logHref, label: "Check-Ins" }} lede={`${athlete.name} · ${longDate(c.occurred_on)} · by ${by}`}>
      <Section label="Notes" role="time" kind="note">
        <Card isStatic>
          {c.notes ? <Body>{c.notes}</Body> : <Label>No notes on this one.</Label>}
        </Card>
      </Section>
      <Section label="Photo" role="time" kind="document">
        {photo ? (
          <Photo src={photo} alt={`Photo from the ${kind.toLowerCase()} with ${athlete.name}`} />
        ) : (
          <Card isStatic>
            <Label>No photo yet. Add one with Edit.</Label>
          </Card>
        )}
      </Section>
      <Stack gap={2}>
        <LinkButton href={`${logHref}/${c.id}/edit`}>Edit</LinkButton>
        <Form action={remove}>
          <ConfirmButton title="Remove This Check-In?" body="It comes off the log, with its photo. Nothing else changes." confirmLabel="Remove">
            Remove
          </ConfirmButton>
        </Form>
      </Stack>
    </Screen>
  );
}
