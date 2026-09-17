import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateTarget } from "@/lib/actions/targets";
import { logCommunication } from "@/lib/actions/communications";
import { logVisit } from "@/lib/actions/visits";
import { TargetForm } from "@/components/TargetForm";
import { CommunicationForm } from "@/components/CommunicationForm";
import { VisitForm } from "@/components/VisitForm";

const KIND_LABEL: Record<string, string> = { call: "Call", text: "Text", email: "Email", visit: "Visit", other: "Other" };
const VISIT_TYPE_LABEL: Record<string, string> = { official: "Official", unofficial: "Unofficial", junior_day: "Junior day", camp: "Camp", other: "Other" };

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
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/board`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Board
        </Link>
      </div>
      <h1 className="mb-4 text-[20px] font-extrabold text-ink">Edit target</h1>
      <TargetForm
        action={action}
        athletes={athletes}
        schools={schools}
        submitLabel="Save changes"
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

      <div className="mt-8 flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-ink">Communication log</h2>
        <CommunicationForm action={commAction} />
        {comms.length === 0 ? (
          <p className="text-[12.5px] text-muted">Nothing logged yet.</p>
        ) : (
          <div className="rounded-[16px] border border-line bg-paper">
            {comms.map((c, i) => (
              <div key={c.id} className={`px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-ink">{KIND_LABEL[c.kind] ?? c.kind}</span>
                  <span className="text-[11.5px] text-muted tabular-nums">
                    {new Date(c.occurred_on).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {c.notes && <p className="mt-1 text-[12.5px] text-muted">{c.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <h2 className="text-[15px] font-extrabold text-ink">Visits</h2>
        <VisitForm action={visitAction} />
        {visits.length === 0 ? (
          <p className="text-[12.5px] text-muted">No visits logged yet.</p>
        ) : (
          <div className="rounded-[16px] border border-line bg-paper">
            {visits.map((v, i) => (
              <div key={v.id} className={`px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-bold text-ink">{VISIT_TYPE_LABEL[v.visit_type] ?? v.visit_type}</span>
                  <span className="text-[11.5px] text-muted tabular-nums">
                    {new Date(v.visit_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {v.impression && <p className="mt-1 text-[12.5px] text-ink">{v.impression}</p>}
                {v.next_step && <p className="mt-0.5 text-[12px] text-muted">Next: {v.next_step}</p>}
                {v.notes && <p className="mt-0.5 text-[12px] text-muted">{v.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
