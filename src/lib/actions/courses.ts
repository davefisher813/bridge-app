"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { courseColumns, parseCourseForm } from "@/lib/validation/course";
import { requireNotViewing } from "@/lib/data/viewAs";

// One transcript row at a time (audit crud F5). Until this, a misread
// grade could only be fixed by discarding the whole document, which
// undid everything it applied, and uploading it again. The NCAA core GPA
// and the eligibility verdict are computed from these rows, so a wrong
// one is a wrong answer, and staff can now correct, add or remove it.
//
// Staff only, like every write to athlete_courses (migration 0010). Every
// query is scoped by org and athlete as well as by the row's id, because
// RLS proves only that the row is this org's, not that it is this
// athlete's.

export interface CourseActionState {
  errors: Record<string, string>;
}

async function athleteInOrg(orgId: string, athleteId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return !!data;
}

// Everything that reads the course list: the transcript, the eligibility
// verdict and its approvals, the athlete page and the family view.
function revalidateCourses(slug: string, athleteId: string) {
  const base = `/org/${slug}/roster/${athleteId}`;
  revalidatePath(`${base}/transcript`);
  revalidatePath(`${base}/eligibility`);
  revalidatePath(`${base}/eligibility/approvals`);
  revalidatePath(base);
  revalidatePath(`/org/${slug}/family/${athleteId}`);
  revalidatePath(`/org/${slug}/family/${athleteId}/transcript`);
}

export async function addCourse(slug: string, athleteId: string, _prevState: CourseActionState, formData: FormData): Promise<CourseActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseCourseForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  if (!(await athleteInOrg(org.id, athleteId))) return { errors: { form: "That athlete isn't on this org's roster." } };

  const supabase = await createClient();
  const { error } = await supabase.from("athlete_courses").insert({
    org_id: org.id,
    athlete_id: athleteId,
    // Typed by hand, so no document owns it and discarding a document
    // never removes it.
    document_id: null,
    ...courseColumns(parsed.values),
  });
  if (error) return { errors: { form: `Could not add the course: ${error.message}` } };

  revalidateCourses(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}/transcript`);
}

export async function updateCourse(slug: string, athleteId: string, courseId: string, _prevState: CourseActionState, formData: FormData): Promise<CourseActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) return { errors: { form: "Org not found." } };
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseCourseForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("athlete_courses")
    .update(courseColumns(parsed.values))
    .eq("id", courseId)
    .eq("org_id", org.id)
    .eq("athlete_id", athleteId)
    .select("id");
  if (error) return { errors: { form: `Could not save the course: ${error.message}` } };
  // Zero rows is a course that is gone or not this athlete's. Saying so
  // beats a silent success that changed nothing.
  if (!data || (data as unknown[]).length === 0) return { errors: { form: "That course is no longer on this athlete's transcript." } };

  revalidateCourses(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}/transcript`);
}

// Posted by the Remove button, inside a ConfirmButton.
export async function deleteCourse(slug: string, athleteId: string, courseId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) return;
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  await supabase.from("athlete_courses").delete().eq("id", courseId).eq("org_id", org.id).eq("athlete_id", athleteId);

  revalidateCourses(slug, athleteId);
  redirect(`/org/${slug}/roster/${athleteId}/transcript`);
}
