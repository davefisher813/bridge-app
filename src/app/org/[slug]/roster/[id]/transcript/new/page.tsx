import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { addCourse } from "@/lib/actions/courses";
import { loadCourseOptions } from "@/lib/data/courseOptions";
import { CourseForm } from "@/components/CourseForm";
import { Screen } from "@/components/kit";

// A course typed in by hand (audit crud F5): a row the reading missed, or
// a transcript nobody has uploaded. Staff only; the eligibility verdict
// is recomputed from the course list the next time it is opened.

export const dynamic = "force-dynamic";

export default async function NewCoursePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name, detail").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();
  const { terms, schools } = await loadCourseOptions(supabase, org.id, id);
  const highSchool = (athlete.detail as { highSchool?: string } | null)?.highSchool ?? null;

  return (
    <Screen title="Add a Course" back={{ href: `/org/${slug}/roster/${id}/transcript`, label: "Transcript" }} lede={athlete.name}>
      <CourseForm
        action={addCourse.bind(null, slug, id)}
        initial={{ title: "", subject: "english", credit: 1, grade: "", term: terms[0] ?? null, schoolName: highSchool, weighted: false, approval: "unchecked" }}
        terms={terms}
        schools={schools}
        submitLabel="Add Course"
      />
    </Screen>
  );
}
