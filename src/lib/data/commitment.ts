// Keeps athletes.status in step with the Targets board.
//
// A commitment is recorded on the board (a target moved to Committed),
// but the roster pill, the Today count and the member program read the
// athlete. Before this the two never met: an athlete committed on the
// board still read Active everywhere else (Dave, 2026-09-26).
//
// Only transitions move it, and only between Active and Committed: an
// Enrolled or Inactive athlete is never touched by a board edit, and an
// athlete someone set to Committed by hand is left alone until a target
// actually leaves Committed.

import type { SupabaseClient } from "@supabase/supabase-js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export async function syncCommitment(supabase: Client, orgId: string, athleteId: string, change: { before: string | null; after: string | null }): Promise<void> {
  const became = change.after === "Committed" && change.before !== "Committed";
  const left = change.before === "Committed" && change.after !== "Committed";
  if (!became && !left) return;

  const { data: athlete } = await supabase.from("athletes").select("status").eq("id", athleteId).eq("org_id", orgId).maybeSingle();
  const status = (athlete as { status: string } | null)?.status;
  if (!status) return;

  if (became && status === "Active") {
    await supabase.from("athletes").update({ status: "Committed", updated_at: new Date().toISOString() }).eq("id", athleteId).eq("org_id", orgId);
    return;
  }

  if (left && status === "Committed") {
    const { data: still } = await supabase.from("recruiting_targets").select("id").eq("org_id", orgId).eq("athlete_id", athleteId).eq("status", "Committed");
    if ((still ?? []).length === 0) {
      await supabase.from("athletes").update({ status: "Active", updated_at: new Date().toISOString() }).eq("id", athleteId).eq("org_id", orgId);
    }
  }
}
