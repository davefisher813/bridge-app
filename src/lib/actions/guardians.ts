"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { RELATIONSHIPS } from "@/lib/copy/relationships";
import { labelForRole } from "@/lib/org/roleLabels";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { requireNotViewing } from "@/lib/data/viewAs";

// A family login's links to athletes (migration 0023, athlete_guardians),
// one at a time (audit crud F7). Before this the only fix for a parent
// linked to the wrong athlete was Remove Member, which dropped every link
// they had, their other child's included, and a re-invite.
//
// Owner and staff, the same people who send a family invite from an
// athlete's page. Every write goes through the caller's own client: row
// level security already lets staff insert, update and delete this org's
// rows (0023, athlete_guardians_insert/_update/_delete), and the
// coherence trigger refuses a link to another org's athlete or to someone
// who is not a member here. Each filter below names the org, the athlete
// and the person, so a row in another org, or on another athlete, is
// never touched.
//
// Each action is a plain form post: it reads an optional returnTo (a path
// inside this org only), then redirects there with a notice or an error,
// which is how a form on a server component reports back. The athlete
// page's family screen and the member page both post here.

const q = (s: string) => encodeURIComponent(s);

function returnPath(slug: string, formData: FormData | undefined, fallback: string): string {
  const raw = String(formData?.get("returnTo") ?? "");
  return raw.startsWith(`/org/${slug}/`) && !raw.includes("//") && !raw.includes("?") ? raw : fallback;
}

function revalidateLink(slug: string, athleteId: string, userId: string) {
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/roster/${athleteId}/family/${userId}`);
  revalidatePath(`/org/${slug}/members/${userId}`);
  revalidatePath(`/org/${slug}/members`);
  revalidatePath(`/org/${slug}/family`);
}

async function personName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string> {
  const { data } = await supabase.from("users").select("full_name, email").eq("id", userId).maybeSingle();
  const p = data as { full_name: string | null; email: string | null } | null;
  return p?.full_name?.trim() || p?.email?.trim() || "They";
}

// What the activity log (Stage 5, Phase 6) calls a person: the name their
// account carries, never the address, which personName above falls back to
// for a notice. Blank reads as "someone" in the template.
async function loggedName(supabase: Awaited<ReturnType<typeof createClient>>, userId: string): Promise<string | null> {
  const { data } = await supabase.from("users").select("full_name").eq("id", userId).maybeSingle();
  return (data as { full_name: string | null } | null)?.full_name?.trim() || null;
}

async function athleteName(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, athleteId: string): Promise<string | null> {
  const { data } = await supabase.from("athletes").select("name").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}

// Unlink one family login from one athlete. Their other links, their
// sign-in and their membership stay; only this athlete stops showing.
export async function unlinkGuardian(slug: string, athleteId: string, userId: string, formData?: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const back = returnPath(slug, formData, `/org/${slug}/roster/${athleteId}`);
  const { data: link } = await supabase.from("athlete_guardians").select("user_id").eq("org_id", org.id).eq("athlete_id", athleteId).eq("user_id", userId).maybeSingle();
  if (!link) redirect(`${back}?error=${q("That link is already gone.")}`);

  const [who, athlete, logged] = await Promise.all([personName(supabase, userId), athleteName(supabase, org.id, athleteId), loggedName(supabase, userId)]);
  const { error } = await supabase.from("athlete_guardians").delete().eq("org_id", org.id).eq("athlete_id", athleteId).eq("user_id", userId);
  if (error) redirect(`${back}?error=${q(`Could not unlink: ${error.message}`)}`);

  // The activity log (Stage 5, Phase 6): an unlink is a member removed
  // from one athlete. The name only, never the address.
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId,
    action: "member_removed",
    subjectType: "member",
    subjectId: userId,
    summary: activitySummary("member_removed", { name: logged ?? "", athlete }),
  });

  const { data: rest } = await supabase.from("athlete_guardians").select("athlete_id").eq("org_id", org.id).eq("user_id", userId);
  const left = (rest ?? []).length;
  const notice =
    left === 0
      ? `${who} no longer sees ${athlete ?? "that athlete"}. Their sign-in now shows nothing; an Admin can remove it under Members.`
      : `${who} no longer sees ${athlete ?? "that athlete"}.`;

  revalidateLink(slug, athleteId, userId);
  // The link's own screen is gone once the link is; land on the athlete.
  const landing = back.startsWith(`/org/${slug}/roster/${athleteId}/family/`) ? `/org/${slug}/roster/${athleteId}` : back;
  redirect(`${landing}?notice=${q(notice)}`);
}

// Who this login is to this athlete: parent, guardian, the athlete, other.
export async function updateGuardianRelationship(slug: string, athleteId: string, userId: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const back = returnPath(slug, formData, `/org/${slug}/roster/${athleteId}/family/${userId}`);
  const relationship = String(formData.get("relationship") ?? "").trim();
  if (!RELATIONSHIPS.some((r) => r.value === relationship)) redirect(`${back}?error=${q("Pick who they are from the list.")}`);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("athlete_guardians")
    .update({ relationship })
    .eq("org_id", org.id)
    .eq("athlete_id", athleteId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) redirect(`${back}?error=${q(`Could not save: ${error.message}`)}`);
  if (!data || data.length === 0) redirect(`${back}?error=${q("That link is gone.")}`);

  revalidateLink(slug, athleteId, userId);
  redirect(`${back}?notice=${q("Saved.")}`);
}

// Link a family login already in this org to another of its athletes: a
// parent with a second child, without a second invite. Only a family
// login: staff and members see athletes through their role, not links.
export async function linkGuardian(slug: string, userId: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);

  const athleteId = String(formData.get("athleteId") ?? "").trim();
  const relationshipRaw = String(formData.get("relationship") ?? "").trim();
  const relationship = RELATIONSHIPS.some((r) => r.value === relationshipRaw) ? relationshipRaw : "parent";
  const fromAthlete = String(formData.get("fromAthleteId") ?? "").trim();
  const back = returnPath(slug, formData, fromAthlete ? `/org/${slug}/roster/${fromAthlete}/family/${userId}` : `/org/${slug}/members/${userId}`);
  if (!athleteId) redirect(`${back}?error=${q("Pick an athlete.")}`);

  const supabase = await createClient();
  const { data: membership } = await supabase.from("org_members").select("role").eq("org_id", org.id).eq("user_id", userId).maybeSingle();
  if ((membership as { role: string } | null)?.role !== "family") redirect(`${back}?error=${q("Only an athlete login is linked to athletes.")}`);

  const athlete = await athleteName(supabase, org.id, athleteId);
  if (!athlete) redirect(`${back}?error=${q("That athlete is not on this organization's roster.")}`);

  const { data: existing } = await supabase.from("athlete_guardians").select("user_id").eq("org_id", org.id).eq("athlete_id", athleteId).eq("user_id", userId).maybeSingle();
  const who = await personName(supabase, userId);
  if (existing) redirect(`${back}?error=${q(`${who} already sees ${athlete}.`)}`);

  const { error } = await supabase.from("athlete_guardians").insert({ org_id: org.id, athlete_id: athleteId, user_id: userId, relationship });
  if (error) redirect(`${back}?error=${q(`Could not link: ${error.message}`)}`);

  // The activity log (Stage 5, Phase 6): a link is an Athlete login
  // invited to one more athlete. The name only, never the address.
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId,
    action: "member_invited",
    subjectType: "member",
    subjectId: userId,
    summary: activitySummary("member_invited", { name: await loggedName(supabase, userId), role: labelForRole("family"), athlete }),
  });

  revalidateLink(slug, athleteId, userId);
  if (fromAthlete) revalidateLink(slug, fromAthlete, userId);
  redirect(`${back}?notice=${q(`${who} now sees ${athlete} as well.`)}`);
}
