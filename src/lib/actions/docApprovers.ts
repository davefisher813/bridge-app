"use server";

// Name, change or clear who signs documents off in one area (migration
// 0067, Doc AI piece 7). Organization Settings, Admins only.
//
// Dave's standing rule (2026-10-06): every authority decision is a
// setting an Admin sees, changes and undoes in the app. So the sheet on
// the settings screen confirms first (it names the person and the area),
// this action writes one row and one activity_log line, and the redirect
// carries whoever held the area before so the screen can offer Undo back
// to them.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { isEligibleAdvisor } from "@/lib/org/advisors";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { AREA_LABEL, isApproverArea } from "@/lib/documents/approvers";
import { requireNotViewing } from "@/lib/data/viewAs";

const q = (s: string) => encodeURIComponent(s);

export async function setDocApprover(slug: string, area: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireOwner(org.id);
  const back = `/org/${slug}/settings`;
  if (!isApproverArea(area)) redirect(`${back}?error=${q("Pick one of the three approver areas.")}`);
  const approverId = String(formData.get("approverId") ?? "").trim() || null;

  const supabase = await createClient();
  if (approverId && !(await isEligibleAdvisor(supabase, org.id, approverId))) redirect(`${back}?error=${q("Only an Admin of this organization can approve documents.")}`);

  const { data: row, error: readError } = await supabase.from("doc_approvers").select("user_id").eq("org_id", org.id).eq("area", area).maybeSingle();
  if (readError) redirect(`${back}?error=${q(`Could not read the approvers: ${readError.message}`)}`);
  const previous = (row as { user_id: string } | null)?.user_id ?? null;
  if (previous === approverId) redirect(back);

  const { error } = approverId
    ? await supabase.from("doc_approvers").upsert({ org_id: org.id, area, user_id: approverId, set_by: user.id, set_at: new Date().toISOString() }, { onConflict: "org_id,area" })
    : await supabase.from("doc_approvers").delete().eq("org_id", org.id).eq("area", area);
  if (error) redirect(`${back}?error=${q(`Could not change the ${AREA_LABEL[area]}: ${error.message}`)}`);

  let personName = "";
  if (approverId) {
    const { data: person } = await supabase.from("users").select("full_name, email").eq("id", approverId).maybeSingle();
    const p = person as { full_name: string | null; email: string | null } | null;
    personName = p?.full_name || p?.email || "";
  }
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    action: approverId ? "doc_approver_set" : "doc_approver_cleared",
    subjectType: "org",
    subjectId: org.id,
    summary: approverId ? activitySummary("doc_approver_set", { kind: area, person: personName }) : activitySummary("doc_approver_cleared", { kind: area }),
  });

  revalidatePath(back);
  revalidatePath(`/org/${slug}/documents`);
  redirect(`${back}?notice=${q(approverId ? `${AREA_LABEL[area]} Set.` : `${AREA_LABEL[area]} Cleared.`)}&undo=${previous ?? "none"}&area=${area}`);
}
