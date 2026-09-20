import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createContact, deleteContact } from "@/lib/actions/contacts";
import { ContactForm } from "@/components/ContactForm";
import { JourneyStepper } from "@/components/JourneyStepper";
import { StatusPill } from "@/components/StatusPill";
import { deriveJourneyStage } from "@/lib/journey";
import { Body, Button, Card, Chevron, EmptyState, Form, Label, Row, Screen, Section, Stack, TextLink } from "@/components/kit";
import { statusRole } from "@/components/statusHue";

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
export default async function AthleteDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athlete }, { data: targetRows }, { data: contactRows }, { data: schoolRows }] = await Promise.all([
    supabase
      .from("athletes")
      .select("id, name, sport, position, recruit_type, gpa, status")
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
  ]);

  if (!athlete) notFound();

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
      <Card>
        <JourneyStepper result={journey} />
      </Card>

      <Stack gap={3}>
        <Row href={`/org/${slug}/roster/${id}/eligibility`} kind="checklist" role="contact" title="NCAA Eligibility" meta="Core GPA, qualifier status and the clock" trailing={<Chevron />} />
        <Row href={`/org/${slug}/roster/${id}/transcript`} kind="course" role="contact" title="Transcript" meta="Every course, and what the NCAA counted" trailing={<Chevron />} />
      </Stack>

      <Section label="Colleges" count={targets.length} role="target" kind="school">
        {targets.length === 0 ? (
          <EmptyState kind="school" title="No Colleges Yet">
            Add a target from the board to start tracking one.
          </EmptyState>
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
            Coaches, parents and advisors for this athlete live here.
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
                      {c.email}
                      {c.email && c.phone ? " · " : ""}
                      {c.phone}
                    </Label>
                  )}
                  {c.notes && <Label>{c.notes}</Label>}
                </div>
                {canEdit && (
                  <Form action={deleteContactAction.bind(null, c.id)}>
                    <Button variant="quiet" inline>
                      Remove
                    </Button>
                  </Form>
                )}
              </div>
            </Card>
          ))
        )}
        {canEdit && (
          <Card>
            <ContactForm action={contactAction} schools={schools} />
          </Card>
        )}
      </Section>

      <Section label="Visits" count={visits.length} role="place" kind="visit">
        {visits.length === 0 ? (
          <EmptyState kind="visit" title="No Visits Logged Yet">
            Log one from a target on the board.
          </EmptyState>
        ) : (
          visits.map((v) => (
            <Card key={v.id}>
              <div className="flex items-start justify-between gap-3">
                <Body weight="bold">
                  {schoolNameByTargetId.get(v.target_id) ?? "Unknown school"} · {VISIT_TYPE_LABEL[v.visit_type] ?? v.visit_type}
                </Body>
                <Label>{new Date(v.visit_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</Label>
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
