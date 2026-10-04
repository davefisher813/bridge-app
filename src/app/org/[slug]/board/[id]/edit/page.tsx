import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { isRemovedAthlete } from "@/lib/data/loadTarget";
import { clearTargetAid, deleteTarget, saveTargetAid, updateTarget } from "@/lib/actions/targets";
import { logCommunication } from "@/lib/actions/communications";
import { logVisit } from "@/lib/actions/visits";
import { loadCoachSuggestionsBySchool } from "@/lib/data/coaches";
import { aidFromRow } from "@/lib/validation/targetAid";
import { TargetForm } from "@/components/TargetForm";
import { TargetAidForm } from "@/components/TargetAidForm";
import { CommunicationForm } from "@/components/CommunicationForm";
import { VisitForm } from "@/components/VisitForm";
import { ConfirmButton, Form, Label, Notice, Prose, Row, Screen, Section } from "@/components/kit";

const KIND_LABEL: Record<string, string> = { call: "Call", text: "Text", email: "Email", visit: "Visit", other: "Other" };
const VISIT_TYPE_LABEL: Record<string, string> = { official: "Official", unofficial: "Unofficial", junior_day: "Junior day", camp: "Camp", other: "Other" };

function shortDate(iso: string | null): string {
  if (!iso) return "no date";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default async function EditTargetPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = (await searchParams) ?? {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: target }, { data: athleteRows }, { data: schoolRows }, { data: commRows }, { data: visitRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select("id, athlete_id, school_id, status, coach_name, notes, visit_date, offer_type, offer_scholarship_percent, aid, athletes(deleted_at)")
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

  // A removed athlete's target is not edited (src/lib/data/loadTarget.ts).
  if (!target || isRemovedAthlete((target as { athletes?: { deleted_at?: string | null } | { deleted_at?: string | null }[] | null }).athletes)) notFound();

  const athletes = (athleteRows ?? []).map((a) => ({ id: a.id, label: a.name }));
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));
  const coaches = await loadCoachSuggestionsBySchool(supabase);

  const action = updateTarget.bind(null, slug, target.id);
  const commAction = logCommunication.bind(null, slug, target.id);
  const visitAction = logVisit.bind(null, slug, target.id);
  const comms = commRows ?? [];
  const visits = visitRows ?? [];
  const aid = aidFromRow(target.aid);
  const base = `/org/${slug}/board/${id}`;

  return (
    <Screen title="Edit Target" back={{ href: base, label: "Target" }}>
      {error && (
        <Notice tone="danger" title="Could Not Remove the Target">
          {error}
        </Notice>
      )}
      <TargetForm
        action={action}
        athletes={athletes}
        schools={schools}
        coaches={coaches}
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

      {/* The award letter's numbers (crud F14): filled by Doc AI when a
          letter is applied, and editable here either way. A net cost is
          the best money evidence the match score has. */}
      <Section label="Award" role="offer" kind="money">
        {aid?.documentId && <Label>Read from an award letter. A correction here keeps the link to the document.</Label>}
        <TargetAidForm action={saveTargetAid.bind(null, slug, target.id)} aid={aid} />
        {aid && (
          <Form action={clearTargetAid.bind(null, slug, target.id)}>
            <ConfirmButton title="Clear the Award?" body="The match score goes back to the school's average costs." confirmLabel="Clear Award">
              Clear Award
            </ConfirmButton>
          </Form>
        )}
      </Section>

      <Section label="Communication Log" count={comms.length} role="contact" kind="message">
        <CommunicationForm action={commAction} />
        {comms.length === 0 ? (
          <Label>Nothing logged yet.</Label>
        ) : (
          comms.map((c) => (
            <Row
              key={c.id}
              href={`${base}/communications/${c.id}`}
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
              href={`${base}/visits/${v.id}`}
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

      {/* Remove outright, for a duplicate or a mistake (crud F15). Not
          Interested is the answer for a school that said no; this is for
          a row that should never have been there. */}
      <Form action={deleteTarget.bind(null, slug, target.id)}>
        <ConfirmButton
          title="Remove This Target?"
          body="It comes off the board, Recruiting History and the school's list, with every logged contact and visit. If it was the commitment, the athlete is recruiting again."
          confirmLabel="Remove Target"
        >
          Remove Target
        </ConfirmButton>
      </Form>
    </Screen>
  );
}
