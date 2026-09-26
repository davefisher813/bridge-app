// Keeps athletes.status in step with the Targets board.
//
// A commitment is recorded on the board (a target moved to Committed),
// but the roster pill, the Today count and the member program read the
// athlete. Before this the two never met: an athlete committed on the
// board still read Active everywhere else (Dave, 2026-09-26).
//
// Only transitions move it, and only between Active (or Transferring)
// and Committed: an Enrolled or Inactive athlete is never touched by a
// board edit, and an athlete someone set to Committed by hand is left
// alone until a target actually leaves Committed.
//
// The scores follow: a commitment clears every stored fit (a placed
// athlete has no score anywhere), and a withdrawn one scores them again.

import type { SupabaseClient } from "@supabase/supabase-js";
import { clearFitsForAthlete, recomputeFitsForAthlete } from "@/lib/data/fits";
import { closeOpenTargets, restoreClosedTargets } from "@/lib/data/enrollment";
import { longDate } from "@/lib/copy/dates";
import { isScoredStatus } from "@/lib/placement";

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export async function syncCommitment(supabase: Client, orgId: string, athleteId: string, change: { before: string | null; after: string | null }): Promise<void> {
  const became = change.after === "Committed" && change.before !== "Committed";
  const left = change.before === "Committed" && change.after !== "Committed";
  if (!became && !left) return;

  const { data: athleteRow } = await supabase.from("athletes").select("name, status").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
  const athlete = athleteRow as { name: string; status: string } | null;
  if (!athlete) return;
  const today = longDate(new Date().toISOString().slice(0, 10));

  if (became && isScoredStatus(athlete.status)) {
    // The commitment ends recruiting everywhere else: every other open
    // target closes, so the board, Today and the follow-up list stop
    // treating them as live (Dave, 2026-09-26: Derek showed In Contact
    // at two schools after committing to a third).
    const { data: committedRow } = await supabase.from("recruiting_targets").select("schools(name)").eq("org_id", orgId).eq("athlete_id", athleteId).eq("status", "Committed").maybeSingle();
    const school = unwrap((committedRow as { schools: { name: string } | { name: string }[] | null } | null)?.schools ?? null)?.name;
    await closeOpenTargets(supabase, orgId, athleteId, `Closed automatically: ${athlete.name} committed to ${school ?? "a school"} on ${today}.`);
    await supabase.from("athletes").update({ status: "Committed", updated_at: new Date().toISOString() }).eq("id", athleteId).eq("org_id", orgId);
    await clearFitsForAthlete(supabase, orgId, athleteId);
    return;
  }

  if (left && athlete.status === "Committed") {
    const { data: still } = await supabase.from("recruiting_targets").select("id").eq("org_id", orgId).eq("athlete_id", athleteId).eq("status", "Committed");
    if ((still ?? []).length === 0) {
      await restoreClosedTargets(supabase, orgId, athleteId, `Reopened: commitment withdrawn on ${today}.`);
      await supabase.from("athletes").update({ status: "Active", updated_at: new Date().toISOString() }).eq("id", athleteId).eq("org_id", orgId);
      await recomputeFitsForAthlete(supabase, orgId, athleteId);
    }
  }
}
