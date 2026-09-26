import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { markEnrolled } from "@/lib/actions/enrollment";
import { EnrollForm } from "@/components/EnrollForm";
import { StatusPill } from "@/components/StatusPill";
import { statusRole } from "@/components/statusHue";
import { currentSchoolOf, nextOutcomes } from "@/lib/placement";
import { Row, Screen, Section } from "@/components/kit";

interface TargetRow {
  id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Enrolling is the one event that closes high school recruiting for
// good (Dave, 2026-09-26). A Committed target names the school; without
// one (an athlete already in college before this org tracked them) the
// form asks, defaulting to their Current School. Shows exactly what
// closes before it happens.
export default async function EnrollAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name, status, detail").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();
  if (!nextOutcomes(athlete.status).includes("enroll")) notFound();

  const { data: targetRows } = await supabase.from("recruiting_targets").select("id, status, schools(name)").eq("athlete_id", id).eq("org_id", org.id);
  const targets = ((targetRows ?? []) as TargetRow[]).map((t) => ({ id: t.id, status: t.status, schoolName: unwrap(t.schools)?.name ?? "Unknown school" }));
  const committed = targets.find((t) => t.status === "Committed");
  const closing = targets.filter((t) => t.status !== "Committed" && t.status !== "Not Interested");

  // No Committed target: ask which school rather than enrolling them
  // nowhere. The athlete's own Current School is the default.
  let schoolChoice = null;
  if (!committed) {
    const { data: schoolRows } = await supabase.from("schools").select("id, name, division").order("name");
    schoolChoice = {
      currentSchool: currentSchoolOf(athlete.detail),
      schools: ((schoolRows ?? []) as { id: string; name: string; division: string }[]).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` })),
    };
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Screen title="Mark Enrolled" back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}>
      {committed && (
        <Row href={`/org/${slug}/board/${committed.id}`} kind="school" role={statusRole("Committed")} title={committed.schoolName} trailing={<StatusPill status="Committed" />} />
      )}

      {closing.length > 0 && (
        <Section label="Will Close" count={closing.length} role="place" kind="school">
          {closing.map((t) => (
            <Row key={t.id} href={`/org/${slug}/board/${t.id}`} kind="school" role={statusRole(t.status)} title={t.schoolName} trailing={<StatusPill status={t.status} />} />
          ))}
        </Section>
      )}

      <EnrollForm action={markEnrolled.bind(null, slug, id)} today={today} schoolChoice={schoolChoice} />
    </Screen>
  );
}
