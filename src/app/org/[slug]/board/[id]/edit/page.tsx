import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateTarget } from "@/lib/actions/targets";
import { TargetForm } from "@/components/TargetForm";

export default async function EditTargetPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: target }, { data: athleteRows }, { data: schoolRows }] = await Promise.all([
    supabase.from("recruiting_targets").select("id, athlete_id, school_id, status, coach_name, notes, visit_date").eq("id", id).eq("org_id", org.id).single(),
    supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("schools").select("id, name, division").order("name"),
  ]);

  if (!target) notFound();

  const athletes = (athleteRows ?? []).map((a) => ({ id: a.id, label: a.name }));
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));

  const action = updateTarget.bind(null, slug, target.id);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/board`} className="text-[13px] font-bold text-muted">
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
        }}
      />
    </main>
  );
}
