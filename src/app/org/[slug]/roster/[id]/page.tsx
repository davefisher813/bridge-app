import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createContact, deleteContact } from "@/lib/actions/contacts";
import { ContactForm } from "@/components/ContactForm";
import { JourneyStepper } from "@/components/JourneyStepper";
import { StatusPill } from "@/components/StatusPill";
import { deriveJourneyStage } from "@/lib/journey";

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

// Athlete profile / detail screen (docs/ROADMAP.md). Colleges (the
// athlete's own recruiting_targets, reusing the board's data rather than
// duplicating it), Contacts (new, athlete-scoped), and Visits (new,
// aggregated from target_visits across every target this athlete has) -
// the three tabs from the full-preview mock, collapsed into sections on
// one scrollable page rather than actual tabs, matching the rest of the
// app's mobile-first single-column layout. JourneyStepper finally gets
// wired to a real screen here - it only ever needed recruiting_targets.status.
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
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link href={`/org/${slug}/roster`} className="text-[13px] font-bold text-muted">
          &larr; Athletes
        </Link>
        {canEdit && (
          <Link href={`/org/${slug}/roster/${id}/edit`} className="text-[12px] font-bold text-accent">
            Edit
          </Link>
        )}
      </div>

      <h1 className="text-[20px] font-extrabold text-ink">{athlete.name}</h1>
      <div className="mt-1 text-[13px] text-muted">
        {athlete.sport}
        {athlete.position ? ` · ${athlete.position}` : ""} · {RECRUIT_TYPE_LABEL[athlete.recruit_type] ?? athlete.recruit_type}
        {athlete.gpa != null ? ` · ${athlete.gpa.toFixed(2)} GPA` : ""}
      </div>

      <div className="mt-6 rounded-[16px] border border-line bg-paper p-4">
        <JourneyStepper result={journey} />
      </div>

      <div className="mt-8">
        <h2 className="mb-2 text-[15px] font-extrabold text-ink">Colleges</h2>
        {targets.length === 0 ? (
          <p className="text-[12.5px] text-muted">No recruiting targets yet.</p>
        ) : (
          <div className="divide-y divide-line border-y border-line">
            {targets.map((t) => (
              <Link key={t.id} href={`/org/${slug}/board/${t.id}/edit`} className="flex items-center justify-between py-3">
                <div>
                  <div className="text-[14px] font-semibold text-ink">{t.school?.name ?? "Unknown school"}</div>
                  <div className="text-[12px] text-muted">
                    {t.school?.division ?? ""}
                    {t.offer_type ? ` · ${t.offer_type} offer${t.offer_scholarship_percent ? ` (${t.offer_scholarship_percent}%)` : ""}` : ""}
                  </div>
                </div>
                <StatusPill status={t.status} />
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8">
        <h2 className="mb-2 text-[15px] font-extrabold text-ink">Contacts</h2>
        <div className="flex flex-col gap-3">
          {canEdit && <ContactForm action={contactAction} schools={schools} />}
          {contacts.length === 0 ? (
            <p className="text-[12.5px] text-muted">No contacts yet.</p>
          ) : (
            <div className="rounded-[16px] border border-line bg-paper">
              {contacts.map((c, i) => (
                <div key={c.id} className={`flex items-start justify-between px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
                  <div>
                    <div className="text-[13px] font-bold text-ink">{c.name}</div>
                    <div className="text-[11.5px] text-muted">{CONTACT_ROLE_LABEL[c.role] ?? c.role}</div>
                    {(c.email || c.phone) && (
                      <div className="mt-1 text-[12px] text-muted">
                        {c.email}
                        {c.email && c.phone ? " · " : ""}
                        {c.phone}
                      </div>
                    )}
                    {c.notes && <p className="mt-1 text-[12px] text-muted">{c.notes}</p>}
                  </div>
                  {canEdit && (
                    <form action={deleteContactAction.bind(null, c.id)}>
                      <button type="submit" className="text-[11.5px] font-bold text-danger">
                        Remove
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8">
        <h2 className="mb-2 text-[15px] font-extrabold text-ink">Visits</h2>
        {visits.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            No visits logged yet. Log one from a target&apos;s{" "}
            <Link href={`/org/${slug}/board`} className="font-bold text-accent">
              edit page
            </Link>
            .
          </p>
        ) : (
          <div className="rounded-[16px] border border-line bg-paper">
            {visits.map((v, i) => (
              <div key={v.id} className={`px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-ink">
                    {schoolNameByTargetId.get(v.target_id) ?? "Unknown school"} · {VISIT_TYPE_LABEL[v.visit_type] ?? v.visit_type}
                  </span>
                  <span className="text-[11.5px] text-muted tabular-nums">
                    {new Date(v.visit_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {v.impression && <p className="mt-1 text-[12.5px] text-ink">{v.impression}</p>}
                {v.next_step && <p className="mt-0.5 text-[12px] text-muted">Next: {v.next_step}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
