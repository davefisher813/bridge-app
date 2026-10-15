"use server";

// Bulk actions on the Targets board (Dave, 2026-10-13). Each one is
// STAFF only, takes the selection as repeated `ids`, reads the targets
// scoped by id AND org (a foreign id is simply not found and counted as
// skipped), applies the single-target rules from targets.ts, writes one
// activity_log row per target changed, and redirects with a notice that
// names the counts. The rules that decide what is skipped live in
// src/lib/bulk/targets.ts.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { parseBulkIds } from "@/lib/bulk/ids";
import { bulkNotice, isBulkStatus, removeSkipReason, statusSkipReason } from "@/lib/bulk/targets";
import { recomputeFitsForAthlete } from "@/lib/data/fits";
import { syncCommitment } from "@/lib/data/commitment";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { requireNotViewing } from "@/lib/data/viewAs";

interface BulkTarget {
  id: string;
  status: string;
  athleteId: string;
  athleteName: string;
  athleteStatus: string;
  schoolName: string;
}

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

// The selected targets that are this org's and whose athlete is still on
// the roster. Anything else is not returned, so it is never written.
async function loadBulkTargets(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, ids: string[]): Promise<BulkTarget[]> {
  const { data } = await supabase
    .from("recruiting_targets")
    .select("id, status, athlete_id, athletes(name, status, deleted_at), schools(name)")
    .eq("org_id", orgId)
    .in("id", ids);
  const out: BulkTarget[] = [];
  for (const r of (data ?? []) as {
    id: string;
    status: string;
    athlete_id: string;
    athletes: { name: string; status: string; deleted_at: string | null } | { name: string; status: string; deleted_at: string | null }[] | null;
    schools: { name: string } | { name: string }[] | null;
  }[]) {
    const a = one(r.athletes);
    if (!a || a.deleted_at) continue;
    out.push({ id: r.id, status: r.status, athleteId: r.athlete_id, athleteName: a.name, athleteStatus: a.status, schoolName: one(r.schools)?.name ?? "" });
  }
  return out;
}

function revalidateBoard(slug: string, athleteIds: Iterable<string>) {
  revalidatePath(`/org/${slug}/board`);
  revalidatePath(`/org/${slug}`);
  revalidatePath(`/org/${slug}/roster`);
  for (const id of athleteIds) revalidatePath(`/org/${slug}/roster/${id}`);
}

export async function bulkChangeTargetStatus(slug: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  const back = `/org/${slug}/board`;

  const parsed = parseBulkIds(formData);
  if (!parsed.ok) redirect(`${back}?error=${encodeURIComponent(parsed.error)}`);
  const to = String(formData.get("status") ?? "");
  if (!isBulkStatus(to)) redirect(`${back}?error=${encodeURIComponent("Pick a status that can be set for several targets at once.")}`);

  const supabase = await createClient();
  const found = await loadBulkTargets(supabase, org.id, parsed.ids);
  let done = 0;
  const touched = new Set<string>();

  for (const t of found) {
    if (statusSkipReason(t, to)) continue;
    const { error } = await supabase
      .from("recruiting_targets")
      // A status picked by hand is nobody's close-out any more (the
      // single edit clears closed_from the same way).
      .update({ status: to, closed_from: null, updated_at: new Date().toISOString() })
      .eq("id", t.id)
      .eq("org_id", org.id);
    if (error) continue;
    done += 1;
    touched.add(t.athleteId);
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId: t.athleteId,
      action: "target_status_changed",
      subjectType: "target",
      subjectId: t.id,
      summary: activitySummary("target_status_changed", { name: t.athleteName, school: t.schoolName, from: t.status, to }),
    });
  }

  // Stored fits read the target's stage, so each athlete is rescored once.
  for (const athleteId of touched) await recomputeFitsForAthlete(supabase, org.id, athleteId);

  revalidateBoard(slug, touched);
  redirect(`${back}?notice=${encodeURIComponent(bulkNotice("updated", done, parsed.ids.length - done))}`);
}

// Remove From Targets, the bulk of deleteTarget. No Undo: the single
// removal has none (the target's contact log and visits go with it), and
// the sheet says so.
export async function bulkRemoveTargets(slug: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  const back = `/org/${slug}/board`;

  const parsed = parseBulkIds(formData);
  if (!parsed.ok) redirect(`${back}?error=${encodeURIComponent(parsed.error)}`);

  const supabase = await createClient();
  const found = await loadBulkTargets(supabase, org.id, parsed.ids);
  let done = 0;
  const touched = new Set<string>();

  for (const t of found) {
    if (removeSkipReason(t)) continue;
    await supabase.from("target_communications").delete().eq("target_id", t.id).eq("org_id", org.id);
    await supabase.from("target_visits").delete().eq("target_id", t.id).eq("org_id", org.id);
    const { error } = await supabase.from("recruiting_targets").delete().eq("id", t.id).eq("org_id", org.id);
    if (error) continue;
    done += 1;
    touched.add(t.athleteId);
    await syncCommitment(supabase, org.id, t.athleteId, { before: t.status, after: null });
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId: t.athleteId,
      action: "target_removed",
      subjectType: "target",
      subjectId: t.id,
      summary: activitySummary("target_removed", { name: t.athleteName, school: t.schoolName }),
    });
  }

  for (const athleteId of touched) await recomputeFitsForAthlete(supabase, org.id, athleteId);

  revalidateBoard(slug, touched);
  redirect(`${back}?notice=${encodeURIComponent(bulkNotice("removed", done, parsed.ids.length - done))}`);
}
