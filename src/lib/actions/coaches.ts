"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCoachForm } from "@/lib/validation/coach";
import { requireNotViewing } from "@/lib/data/viewAs";

// The college coach directory (migration 0036) is shared by every org
// and has no write policy, like schools: a directory editor (an owner
// of an org with orgs.edits_shared_directory on, migration 0040) writes
// it through the service role behind requireDirectoryEditor() (crud
// F2), the same narrow door
// src/lib/actions/schools.ts opens for the school rows themselves. The
// coach's school is always the school row the action is bound to, and
// school_name is copied from that row (the column is NOT NULL and was
// loaded that way), never taken from the form.

export interface CoachActionState {
  errors: Record<string, string>;
}

const DUPLICATE = "That coach is already listed at this school.";

function revalidateCoaches(slug: string, schoolId: string) {
  revalidatePath(`/org/${slug}/schools/${schoolId}`);
  revalidatePath(`/org/${slug}/schools/${schoolId}/coaches`);
  revalidatePath(`/org/${slug}/board`);
}

async function schoolRow(admin: ReturnType<typeof createAdminClient>, schoolId: string): Promise<{ id: string; name: string } | null> {
  const { data } = await admin.from("schools").select("id, name").eq("id", schoolId).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

export async function createCoach(slug: string, schoolId: string, _prevState: CoachActionState, formData: FormData): Promise<CoachActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const parsed = parseCoachForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  const v = parsed.values;

  const admin = createAdminClient();
  const school = await schoolRow(admin, schoolId);
  if (!school) return { errors: { form: "That school is no longer on file." } };

  const { error } = await admin.from("college_coaches").insert({
    school_id: school.id,
    school_name: school.name,
    name: v.name,
    title: v.title ?? null,
    email: v.email ?? null,
    phone: v.phone ?? null,
    is_recruiting_coordinator: v.isRecruitingCoordinator,
  });
  if (error) return { errors: error.code === "23505" ? { name: DUPLICATE } : { form: error.message } };

  revalidateCoaches(slug, school.id);
  redirect(`/org/${slug}/schools/${school.id}/coaches`);
}

export async function updateCoach(slug: string, schoolId: string, coachId: string, _prevState: CoachActionState, formData: FormData): Promise<CoachActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const parsed = parseCoachForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };
  const v = parsed.values;

  const admin = createAdminClient();
  const school = await schoolRow(admin, schoolId);
  if (!school) return { errors: { form: "That school is no longer on file." } };

  // Scoped by the coach and the school together: an id from another
  // school's list matches nothing.
  const { data: updated, error } = await admin
    .from("college_coaches")
    .update({
      name: v.name,
      title: v.title ?? null,
      email: v.email ?? null,
      phone: v.phone ?? null,
      is_recruiting_coordinator: v.isRecruitingCoordinator,
      school_name: school.name,
      updated_at: new Date().toISOString(),
    })
    .eq("id", coachId)
    .eq("school_id", school.id)
    .select("id");
  if (error) return { errors: error.code === "23505" ? { name: DUPLICATE } : { form: error.message } };
  if (!updated || updated.length === 0) return { errors: { form: "That coach isn't listed at this school any more." } };

  revalidateCoaches(slug, school.id);
  redirect(`/org/${slug}/schools/${school.id}/coaches`);
}

export async function deleteCoach(slug: string, schoolId: string, coachId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireDirectoryEditor(org.id);

  const admin = createAdminClient();
  await admin.from("college_coaches").delete().eq("id", coachId).eq("school_id", schoolId);

  revalidateCoaches(slug, schoolId);
  redirect(`/org/${slug}/schools/${schoolId}/coaches`);
}
