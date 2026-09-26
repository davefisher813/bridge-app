import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { markGraduated } from "@/lib/actions/enrollment";
import { EnrollForm } from "@/components/EnrollForm";
import { StatusPill } from "@/components/StatusPill";
import { statusRole } from "@/components/statusHue";
import { currentSchoolOf, nextOutcomes } from "@/lib/placement";
import { Row, Screen } from "@/components/kit";

// Graduated from college (Dave, 2026-09-26): only after Enrolled, named
// by the school they were at. Asks for one only when nothing names it.
export default async function GraduateAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name, status, detail").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();
  if (!nextOutcomes(athlete.status).includes("graduate")) notFound();

  const { data: committedRow } = await supabase.from("recruiting_targets").select("id, schools(name)").eq("athlete_id", id).eq("org_id", org.id).eq("status", "Committed").maybeSingle();
  const committed = committedRow as { id: string; schools: { name: string } | { name: string }[] | null } | null;
  const committedName = committed ? ((Array.isArray(committed.schools) ? committed.schools[0] : committed.schools)?.name ?? "Unknown school") : null;
  const currentSchool = currentSchoolOf(athlete.detail);

  let schoolChoice = null;
  if (!committed && !currentSchool) {
    const { data: schoolRows } = await supabase.from("schools").select("id, name, division").order("name");
    schoolChoice = { currentSchool: null, schools: ((schoolRows ?? []) as { id: string; name: string; division: string }[]).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` })) };
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Screen title="Mark Graduated" back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}>
      {committed && committedName && <Row href={`/org/${slug}/board/${committed.id}`} kind="school" role={statusRole("Enrolled")} title={committedName} trailing={<StatusPill status="Enrolled" />} />}
      {!committed && currentSchool && <Row href={`/org/${slug}/roster/${id}/edit`} kind="school" role={statusRole("Enrolled")} title={currentSchool} trailing={<StatusPill status="Enrolled" />} />}
      <EnrollForm action={markGraduated.bind(null, slug, id)} today={today} schoolChoice={schoolChoice} schoolLabel="Graduated From" dateName="graduatedOn" dateLabel="Graduated On" submitLabel="Mark Graduated" />
    </Screen>
  );
}
