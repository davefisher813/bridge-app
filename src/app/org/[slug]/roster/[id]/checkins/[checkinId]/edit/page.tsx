import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateCheckin } from "@/lib/actions/checkins";
import { CheckinForm } from "@/components/CheckinForm";
import { Screen } from "@/components/kit";

// Edit one check-in (audit crud F21): a wrong date, type or note is fixed
// in place rather than removed and retyped. Staff only, like the log
// itself: an advisor's notes never reach a family login (migration 0039).
export default async function EditCheckinPage({ params }: { params: Promise<{ slug: string; id: string; checkinId: string }> }) {
  const { slug, id, checkinId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: entry }] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase.from("athlete_checkins").select("id, kind, occurred_on, notes").eq("id", checkinId).eq("athlete_id", id).eq("org_id", org.id).maybeSingle(),
  ]);
  if (!athlete || !entry) notFound();
  const row = entry as { id: string; kind: string; occurred_on: string; notes: string | null };

  return (
    <Screen title="Edit Check-In" back={{ href: `/org/${slug}/roster/${id}/checkins`, label: "Check-Ins" }} lede={athlete.name}>
      <CheckinForm action={updateCheckin.bind(null, slug, id, row.id)} initial={{ kind: row.kind, occurredOn: row.occurred_on, notes: row.notes }} submitLabel="Save Changes" />
    </Screen>
  );
}
