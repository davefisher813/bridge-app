"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { approvedListProblem } from "@/lib/fit/ncaa/approvedCourses";
import { parseApprovedListPaste } from "@/lib/fit/ncaa/approvedListPaste";

export interface ApprovedListActionState {
  errors: Record<string, string>;
}

// Same posture as saveGradingScale, and for the same reason. The shared
// `ncaa_approved_course_lists` is transcribed from the Eligibility
// Center's portal and is the same for every org with an athlete at that
// school, so a wrong row there rewrites eligibility verdicts everywhere
// and it stays service-role only. `org_approved_course_lists` has the
// blast radius of one org, which is the blast radius of everything else
// staff already type in. Ordinary RLS is the boundary, staff is the
// role. See migrations/0014 and docs/DECISIONS.md.
export async function saveApprovedList(
  slug: string,
  _prevState: ApprovedListActionState,
  formData: FormData,
): Promise<ApprovedListActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const schoolName = String(formData.get("schoolName") ?? "").trim();
  if (!schoolName) return { errors: { schoolName: "Which school is this list for?" } };

  const sourceNote = String(formData.get("sourceNote") ?? "").trim();
  if (!sourceNote) {
    return {
      errors: {
        sourceNote: "Say where this came from. A list transcribed from the portal and one a counselor emailed are different claims.",
      },
    };
  }

  const isComplete = formData.get("isComplete") === "on";
  const ceebCode = String(formData.get("ceebCode") ?? "").trim() || null;
  const retrievedOn = String(formData.get("retrievedOn") ?? "").trim() || null;

  // Rows arrive as parallel indexed fields, because the review screen
  // lets a person fix a subject the paste did not name before saving.
  const courses: Array<{ title: string; subject: string; maxCredit: number | null; weighted: boolean }> = [];
  let i = 0;
  while (formData.has(`title_${i}`)) {
    const title = String(formData.get(`title_${i}`) ?? "").trim();
    const subject = String(formData.get(`subject_${i}`) ?? "").trim();
    const creditRaw = String(formData.get(`credit_${i}`) ?? "").trim();
    if (title) {
      courses.push({
        title,
        subject,
        maxCredit: creditRaw === "" ? null : Number(creditRaw),
        weighted: formData.get(`weighted_${i}`) === "on",
      });
    }
    i++;
  }

  // The same check the pure module applies, so a list typed here and a
  // list read off a paste are held to one standard. In particular it
  // refuses to accept a handful of rows as a school's whole catalog,
  // which is what makes "complete" mean anything.
  const problem = approvedListProblem({ courses, isComplete });
  if (problem) return { errors: { form: `This list cannot be saved: ${problem}` } };

  const supabase = await createClient();

  const { data: list, error: listError } = await supabase
    .from("org_approved_course_lists")
    .upsert(
      {
        org_id: org.id,
        school_name: schoolName,
        ceeb_code: ceebCode,
        is_complete: isComplete,
        retrieved_on: retrievedOn,
        source_note: sourceNote,
        entered_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,school_name_key" },
    )
    .select("id")
    .single();

  if (listError || !list) return { errors: { form: listError?.message ?? "Could not save the list." } };

  // Replace rather than merge. A saved list is a snapshot of what the
  // portal said on a day, and merging an older copy into a newer one
  // produces a list that never existed at any school.
  const { error: clearError } = await supabase.from("org_approved_courses").delete().eq("list_id", list.id).eq("org_id", org.id);
  if (clearError) return { errors: { form: clearError.message } };

  const { error: insertError } = await supabase.from("org_approved_courses").insert(
    courses.map((c) => ({
      list_id: list.id,
      org_id: org.id,
      title: c.title,
      subject: c.subject,
      max_credit: c.maxCredit,
      weighted: c.weighted,
    })),
  );
  if (insertError) return { errors: { form: insertError.message } };

  revalidatePath(`/org/${slug}/approved-courses`);
  revalidatePath(`/org/${slug}/roster`);
  redirect(`/org/${slug}/approved-courses`);
}

// Parsing runs on the server so the review screen renders from the same
// function the tests cover, rather than a second copy in the browser.
export async function previewApprovedListPaste(text: string) {
  return parseApprovedListPaste(text);
}
