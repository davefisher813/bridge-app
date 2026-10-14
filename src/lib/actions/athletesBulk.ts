"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { isEligibleAdvisor } from "@/lib/org/advisors";
import { setAthleteAdvisor } from "@/lib/actions/members";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { recomputeFitsForAthlete } from "@/lib/data/fits";
import { decodeAdvisorUndo, encodeAdvisorUndo, planAdvisorRestore } from "@/lib/data/undoPlan";
import { countOf, parseBulkIds } from "@/lib/bulk/ids";
import { bulkStatusDecision, isBulkStatus, SKIP_REASON_TEXT, type SkipReason } from "@/lib/bulk/rosterStatus";

// Bulk actions on the roster (Dave, 2026-10-13: "dozens of student
// athletes; one-at-a-time actions are too slow"). BulkSelect (the kit)
// owns the selection and the single confirmation; everything here owns
// the checks. Every action: an Admin first (requireRole, before any
// read or write), then the ids parsed, then every read and write scoped
// by org_id AND the ids, so an id from another org is simply not found.
// Each answers with a redirect back to the roster and a notice naming
// how many were applied and how many were skipped.
//
// Nothing here assigns anyone. It is the tool; the Admin picks the
// advisor in the sheet, confirms, and can Undo.

const q = (s: string) => encodeURIComponent(s);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function admin(slug: string) {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  return { org, user };
}

function revalidateRoster(slug: string, ids: string[]) {
  revalidatePath(`/org/${slug}/roster`);
  revalidatePath(`/org/${slug}/members`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}`);
  for (const id of ids) revalidatePath(`/org/${slug}/roster/${id}`);
}

const plural = (n: number) => countOf(n, "athlete");

// ── Assign Advisor ───────────────────────────────────────────────────
// One advisor, or Unassigned (the field is present and empty), for many
// athletes. The write, the per-athlete activity row (advisor_set or
// advisor_cleared, one for each athlete actually changed), the Admin-only
// eligibility rule and the 0039 trigger are setAthleteAdvisor's, the same
// code the single-athlete Advisor sheet runs. An athlete who already has
// that advisor is not touched and not logged. The redirect carries one
// Undo that puts every changed athlete's previous advisor back.
export async function bulkAssignAdvisor(slug: string, formData: FormData): Promise<void> {
  const { org } = await admin(slug);
  const back = `/org/${slug}/roster`;
  const parsed = parseBulkIds(formData);
  if (!parsed.ok) redirect(`${back}?error=${q(parsed.error)}`);
  if (!formData.has("advisorId")) redirect(`${back}?error=${q("Pick an advisor, or Unassigned.")}`);
  const advisorId = String(formData.get("advisorId") ?? "").trim() || null;
  if (advisorId && !UUID.test(advisorId)) redirect(`${back}?error=${q("Pick an Admin from the list.")}`);

  const supabase = await createClient();
  if (advisorId && !(await isEligibleAdvisor(supabase, org.id, advisorId))) redirect(`${back}?error=${q("Only an Admin can advise athletes.")}`);

  const { data } = await supabase.from("athletes").select("id, advisor_id").eq("org_id", org.id).in("id", parsed.ids).is("deleted_at", null);
  const found = (data ?? []) as { id: string; advisor_id: string | null }[];
  const changing = found.filter((a) => (a.advisor_id ?? null) !== advisorId);
  const unchanged = found.length - changing.length;
  const missing = parsed.ids.length - found.length;

  let applied = 0;
  if (changing.length > 0) {
    const r = await setAthleteAdvisor(slug, changing.map((a) => a.id), advisorId);
    if (!r.ok) redirect(`${back}?error=${q(r.error ?? "Could not change the advisors.")}`);
    applied = r.count ?? 0;
  }
  const skipped = unchanged + missing;
  const word = advisorId ? "now have this advisor" : "now have no advisor";
  const skippedText = skipped > 0 ? ` ${plural(skipped)} skipped: ${[unchanged ? `${unchanged} already ${advisorId ? "had them" : "had none"}` : "", missing ? `${missing} not on this roster` : ""].filter(Boolean).join(", ")}.` : "";
  const undo = applied > 0 ? `&undo=${encodeAdvisorUndo({ assigned: advisorId, entries: changing.map((a) => ({ athleteId: a.id, before: a.advisor_id ?? null })) })}` : "";
  redirect(`${back}?notice=${q(`${plural(applied)} ${word}.${skippedText}`)}${undo}`);
}

// One Undo for a bulk advisor change. Restores each athlete's previous
// advisor, but only while their advisor is still what the bulk action
// set (planAdvisorRestore), one activity row per athlete through
// setAthleteAdvisor. Like the single Undo, it offers no Undo of its own.
export async function undoBulkAdvisor(slug: string, formData: FormData): Promise<void> {
  const { org } = await admin(slug);
  const back = `/org/${slug}/roster`;
  const undo = decodeAdvisorUndo(formData.get("undo"));
  if (!undo) redirect(`${back}?error=${q("That Undo is not valid any more.")}`);

  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id, advisor_id").eq("org_id", org.id).in("id", undo.entries.map((e) => e.athleteId)).is("deleted_at", null);
  const current = new Map(((data ?? []) as { id: string; advisor_id: string | null }[]).map((a) => [a.id, a.advisor_id ?? null]));
  const plan = planAdvisorRestore(undo, current);

  let restored = 0;
  let failed = 0;
  let firstError = "";
  for (const g of plan.groups) {
    const r = await setAthleteAdvisor(slug, g.athleteIds, g.advisorId);
    if (r.ok) restored += r.count ?? 0;
    else {
      failed += g.athleteIds.length;
      firstError ||= r.error ?? "";
    }
  }
  const left = plan.kept.length + failed;
  const tail = left > 0 ? ` ${plural(left)} left as they are${plan.kept.length ? ", their advisor changed since" : ""}${failed ? `. ${firstError}` : ""}.` : "";
  redirect(`${back}?notice=${q(`Advisors restored for ${plural(restored)}.${tail}`)}`);
}

// ── Change Status ────────────────────────────────────────────────────
// Active or Inactive only (src/lib/bulk/rosterStatus.ts says why). An
// athlete in a flow that needs facts, already at the status, or placed by
// a committed target is skipped and counted, never changed. Fits follow
// as they do for a single edit: Inactive clears them, Active scores them.
// One athlete_status_changed row per athlete changed.
export async function bulkChangeStatus(slug: string, formData: FormData): Promise<void> {
  const { org, user } = await admin(slug);
  const back = `/org/${slug}/roster`;
  const parsed = parseBulkIds(formData);
  if (!parsed.ok) redirect(`${back}?error=${q(parsed.error)}`);
  const to = String(formData.get("status") ?? "").trim();
  if (!isBulkStatus(to)) redirect(`${back}?error=${q("Only Active and Inactive can be set here. The other statuses are set from the athlete's page, where they ask for the school, the date or the team.")}`);

  const supabase = await createClient();
  const [{ data }, { data: committed }] = await Promise.all([
    supabase.from("athletes").select("id, name, status").eq("org_id", org.id).in("id", parsed.ids).is("deleted_at", null),
    supabase.from("recruiting_targets").select("athlete_id").eq("org_id", org.id).eq("status", "Committed").in("athlete_id", parsed.ids),
  ]);
  const found = (data ?? []) as { id: string; name: string; status: string }[];
  const hasCommit = new Set(((committed ?? []) as { athlete_id: string }[]).map((t) => t.athlete_id));

  const skips: Partial<Record<SkipReason, number>> = {};
  const changing: { id: string; name: string; status: string }[] = [];
  for (const a of found) {
    const d = bulkStatusDecision(a.status, to, hasCommit.has(a.id));
    if (d.change) changing.push(a);
    else skips[d.reason] = (skips[d.reason] ?? 0) + 1;
  }
  const missing = parsed.ids.length - found.length;

  let applied: { id: string; name: string; status: string }[] = [];
  if (changing.length > 0) {
    // Scoped by org and ids, and by the statuses a bulk change may leave,
    // so a row that moved to a protected status since the read is not
    // overwritten.
    const { data: updated, error } = await supabase
      .from("athletes")
      .update({ status: to, updated_at: new Date().toISOString() })
      .eq("org_id", org.id)
      .in("id", changing.map((a) => a.id))
      .in("status", ["Active", "Inactive", "Transferring"])
      .select("id, name");
    if (error) redirect(`${back}?error=${q(error.message)}`);
    const done = new Set(((updated ?? []) as { id: string }[]).map((u) => u.id));
    applied = changing.filter((a) => done.has(a.id));
  }
  for (const a of applied) {
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      action: "athlete_status_changed",
      subjectType: "athlete",
      subjectId: a.id,
      athleteId: a.id,
      summary: activitySummary("athlete_status_changed", { name: a.name, from: a.status, to }),
    });
    // Inactive clears the stored fits, Active scores them again.
    await recomputeFitsForAthlete(supabase, org.id, a.id);
  }
  revalidateRoster(slug, applied.map((a) => a.id));

  const parts = [
    ...(Object.keys(skips) as SkipReason[]).map((r) => `${skips[r]} ${SKIP_REASON_TEXT[r]}`),
    ...(missing > 0 ? [`${missing} not on this roster`] : []),
    ...(changing.length - applied.length > 0 ? [`${changing.length - applied.length} changed since you looked`] : []),
  ];
  const skipped = parts.length === 0 ? 0 : parsed.ids.length - applied.length;
  const tail = skipped > 0 ? ` ${plural(skipped)} skipped: ${parts.join(", ")}.` : "";
  redirect(`${back}?notice=${q(`${plural(applied.length)} set to ${to}.${tail}`)}`);
}

// ── Export ───────────────────────────────────────────────────────────
// A download is a GET, so the sheet's confirm lands here and this sends
// the browser on to the export route with the ids (200 at most, parsed
// the same way). The route is Admin-only and org-scoped on its own; this
// check only keeps a non-Admin from being sent there.
export async function bulkExportAthletes(slug: string, formData: FormData): Promise<void> {
  await admin(slug);
  const parsed = parseBulkIds(formData);
  if (!parsed.ok) redirect(`/org/${slug}/roster?error=${q(parsed.error)}`);
  redirect(`/org/${slug}/roster/export?ids=${parsed.ids.join(",")}`);
}
