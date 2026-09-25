import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateTarget } from "@/lib/actions/targets";
import { logCommunication } from "@/lib/actions/communications";
import { logVisit } from "@/lib/actions/visits";
import { TargetForm } from "@/components/TargetForm";
import { CommunicationForm } from "@/components/CommunicationForm";
import { VisitForm } from "@/components/VisitForm";
import { Label, Row, Screen, Section } from "@/components/kit";

const KIND_LABEL: Record<string, string> = { call: "Call", text: "Text", email: "Email", visit: "Visit", other: "Other" };
const VISIT_TYPE_LABEL: Record<string, string> = { official: "Official", unofficial: "Unofficial", junior_day: "Junior day", camp: "Camp", other: "Other" };

function shortDate(iso: string | null): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function EditTargetPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: target }, { data: athleteRows }, { data: schoolRows }, { data: commRows }, { data: visitRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select("id, athlete_id, school_id, status, coach_name, notes, visit_date, offer_type, offer_scholarship_percent")
      .eq("id", id)
      .eq("org_id", org.id)
      .single(),
    supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("schools").select("id, name, division").order("name"),
    supabase
      .from("target_communications")
      .select("id, kind, occurred_on, notes")
      .eq("target_id", id)
      .eq("org_id", org.id)
      .order("occurred_on", { ascending: false }),
    supabase
      .from("target_visits")
      .select("id, visit_type, visit_date, impression, next_step, notes")
      .eq("target_id", id)
      .eq("org_id", org.id)
      .order("visit_date", { ascending: false }),
  ]);

  if (!target) notFound();

  const athletes = (athleteRows ?? []).map((a) => ({ id: a.id, label: a.name }));
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));

  const action = updateTarget.bind(null, slug, target.id);
  const commAction = logCommunication.bind(null, slug, target.id);
  const visitAction = logVisit.bind(null, slug, target.id);
  const comms = commRows ?? [];
  const visits = visitRows ?? [];

  return (
    <Screen title="Edit Target" back={{ href: `/org/${slug}/board/${id}`, label: "Target" }}>
      <TargetForm
        action={action}
        athletes={athletes}
        schools={schools}
        submitLabel="Save Changes"
        initialValues={{
          athleteId: target.athlete_id,
          schoolId: target.school_id,
          status: target.status,
          coachName: target.coach_name ?? undefined,
          notes: target.notes ?? undefined,
          visitDate: target.visit_date ?? undefined,
          offerType: target.offer_type ?? undefined,
          offerScholarshipPercent: target.offer_scholarship_percent ?? undefined,
        }}
      />

      <Section label="Communication Log" count={comms.length} role="contact" kind="message">
        <CommunicationForm action={commAction} />
        {comms.length === 0 ? (
          <Label>Nothing logged yet.</Label>
        ) : (
          comms.map((c) => (
            <Row
              key={c.id}
              href={`/org/${slug}/board/${id}/communications`}
              kind="message"
              role="contact"
              title={KIND_LABEL[c.kind] ?? c.kind}
              meta={c.notes ?? undefined}
              trailing={<Label numeric>{shortDate(c.occurred_on)}</Label>}
              wrap
            />
          ))
        )}
      </Section>

      <Section label="Visits" count={visits.length} role="visit" kind="visit">
        <VisitForm action={visitAction} />
        {visits.length === 0 ? (
          <Label>No visits logged yet.</Label>
        ) : (
          visits.map((v) => (
            <Row
              key={v.id}
              href={`/org/${slug}/board/${id}/communications`}
              kind="visit"
              role="visit"
              title={VISIT_TYPE_LABEL[v.visit_type] ?? v.visit_type}
              meta={[v.impression, v.next_step ? `Next: ${v.next_step}` : null, v.notes].filter(Boolean).join(" · ") || undefined}
              trailing={<Label numeric>{shortDate(v.visit_date)}</Label>}
              wrap
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
