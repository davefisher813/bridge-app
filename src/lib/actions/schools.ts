"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseSchoolForm, schoolColumnsFrom } from "@/lib/validation/school";
import { parseOrgSchoolNoteForm, parsePositionsOfNeed } from "@/lib/validation/orgSchoolNote";
import { parseSchoolsCsv, type ImportProblem } from "@/lib/schools/csv";
import { recomputeFitsForOrgSchool, recomputeFitsForSchools } from "@/lib/data/fits";

export interface SchoolActionState {
  errors: Record<string, string>;
}

// schools is shared reference data across every org (see the RLS comment
// in migrations/0001_core_schema.sql and docs/ARCHITECTURE.md) and has no
// INSERT policy at all - deliberately, so no org can silently corrupt
// another org's shared list through ordinary RLS-scoped writes. Rather
// than reopen that policy, these actions are the one deliberate,
// owner-gated door into it: requireOwner() is the actual authorization
// check (RLS can't help here, since the admin client bypasses it
// entirely), then the write goes through the service-role client. Any
// coach or staff-role user hitting this action directly still gets
// refused by requireOwner before the admin client is ever touched. See
// docs/DECISIONS.md. Every write recomputes the stored fits for every
// athlete in every org against the school (docs/MATCHING_CONTRACT.md).
export async function createSchool(slug: string, _prevState: SchoolActionState, formData: FormData): Promise<SchoolActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const parsed = parseSchoolForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const admin = createAdminClient();
  const { data: created, error } = await admin.from("schools").insert(schoolColumnsFrom(parsed.values)).select("id").single();
  if (error) return { errors: { form: error.message } };

  if (created?.id) await recomputeFitsForSchools(admin, [created.id]);

  revalidatePath(`/org/${slug}/schools`);
  revalidatePath(`/org/${slug}/board/new`);
  redirect(created?.id ? `/org/${slug}/schools/${created.id}` : `/org/${slug}/schools`);
}

export async function updateSchool(slug: string, schoolId: string, _prevState: SchoolActionState, formData: FormData): Promise<SchoolActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const parsed = parseSchoolForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const admin = createAdminClient();
  const { error } = await admin.from("schools").update(schoolColumnsFrom(parsed.values)).eq("id", schoolId);
  if (error) return { errors: { form: error.message } };

  await recomputeFitsForSchools(admin, [schoolId]);

  revalidatePath(`/org/${slug}/schools`);
  revalidatePath(`/org/${slug}/schools/${schoolId}`);
  revalidatePath(`/org/${slug}/board`);
  redirect(`/org/${slug}/schools/${schoolId}`);
}

// The org's private overlay on a shared school. Staff can write it
// (org_school_notes RLS), and it recomputes this org's fits against the
// school because positions of need move the score.
export async function saveOrgSchoolNote(slug: string, schoolId: string, _prevState: SchoolActionState, formData: FormData): Promise<SchoolActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const parsed = parseOrgSchoolNoteForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors };

  const supabase = await createClient();
  const { error } = await supabase.from("org_school_notes").upsert(
    {
      org_id: org.id,
      school_id: schoolId,
      coach_name: parsed.values.coachName ?? null,
      coach_email: parsed.values.coachEmail ?? null,
      positions_of_need: parsePositionsOfNeed(parsed.values.positionsOfNeed),
      notes: parsed.values.notes ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,school_id" },
  );
  if (error) return { errors: { form: error.message } };

  await recomputeFitsForOrgSchool(supabase, org.id, schoolId);

  revalidatePath(`/org/${slug}/schools/${schoolId}`);
  revalidatePath(`/org/${slug}/board`);
  redirect(`/org/${slug}/schools/${schoolId}`);
}

export interface ImportActionState {
  errors: Record<string, string>;
  problems: ImportProblem[];
  imported?: number;
}

// The CSV import. docs/MATCHING_CONTRACT.md section 4: rows with
// problems are listed and nothing half-imports. An existing school with
// the same name is updated, not duplicated; the coach fields land on
// this org's overlay, not the shared row.
export async function importSchools(slug: string, _prevState: ImportActionState, formData: FormData): Promise<ImportActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireOwner(org.id);

  const file = formData.get("file");
  if (!file || typeof file === "string" || file.size === 0) return { errors: { file: "Choose a CSV file first." }, problems: [] };
  const text = await file.text();
  const { rows, problems } = parseSchoolsCsv(text);
  if (problems.length > 0 || rows.length === 0) {
    return { errors: rows.length === 0 && problems.length === 0 ? { file: "The file has no school rows." } : {}, problems };
  }

  const admin = createAdminClient();
  const names = rows.map((r) => r.school.name);
  const { data: existingRows } = await admin.from("schools").select("id, name").in("name", names);
  const existingByName = new Map<string, string>();
  for (const e of (existingRows ?? []) as { id: string; name: string }[]) existingByName.set(e.name.toLowerCase(), e.id);

  const ids: string[] = [];
  for (const r of rows) {
    const s = r.school;
    const columns = {
      name: s.name,
      division: s.division,
      program_tier: s.program_tier,
      conference: s.conference,
      state: s.state,
      sports_sponsored: s.sports_sponsored,
      majors: s.majors,
      academics: s.academics,
      financials: s.financials,
      athletics: s.athletics,
      profile_date: new Date().toISOString(),
    };
    const existingId = existingByName.get(s.name.toLowerCase());
    let id = existingId;
    if (existingId) {
      const { error } = await admin.from("schools").update(columns).eq("id", existingId);
      if (error) return { errors: { form: error.message }, problems: [] };
    } else {
      const { data: created, error } = await admin.from("schools").insert(columns).select("id").single();
      if (error) return { errors: { form: error.message }, problems: [] };
      id = created?.id;
    }
    if (!id) continue;
    ids.push(id);
    const { error: noteError } = await admin.from("org_school_notes").upsert(
      {
        org_id: org.id,
        school_id: id,
        coach_name: r.overlay.coach_name || null,
        coach_email: r.overlay.coach_email || null,
        positions_of_need: r.overlay.positions_of_need,
        notes: r.overlay.notes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,school_id" },
    );
    if (noteError) return { errors: { form: noteError.message }, problems: [] };
  }

  await recomputeFitsForSchools(admin, ids);

  revalidatePath(`/org/${slug}/schools`);
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  redirect(`/org/${slug}/schools?imported=${ids.length}`);
}
