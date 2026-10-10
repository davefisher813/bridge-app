"use server";

import { redirect } from "next/navigation";
import { setAthleteAdvisor } from "@/lib/actions/members";
import { createClient } from "@/lib/supabase/server";

// Assign, change or clear an athlete's advisor from the athlete page
// (Stage 5, Phase 2). The Advisor sheet posts one field, advisorId: an
// Admin's id assigns or changes, an empty value clears. Everything else
// (the Admin guard, which is the same one as editing the athlete; the
// one eligibility rule in src/lib/org/advisors.ts; the athlete being
// this org's) is setAthleteAdvisor's, so the member page and this page
// cannot drift apart. The answer is a redirect back to the profile with
// a notice or an error in the query string.

const q = (s: string) => encodeURIComponent(s);

export async function setAdvisorFromAthleteForm(slug: string, athleteId: string, formData: FormData): Promise<void> {
  const advisorId = String(formData.get("advisorId") ?? "").trim() || null;
  // Who advised before, read first, so the notice can offer Undo (Dave's
  // standing rule: every authority change can be undone in the app).
  // RLS answers: a caller who may not see the athlete reads nothing, and
  // setAthleteAdvisor refuses them below anyway.
  const supabase = await createClient();
  const { data: before } = await supabase.from("athletes").select("advisor_id").eq("id", athleteId).maybeSingle();
  const previous = (before as { advisor_id: string | null } | null)?.advisor_id ?? null;
  const r = await setAthleteAdvisor(slug, [athleteId], advisorId);
  const back = `/org/${slug}/roster/${athleteId}`;
  if (!r.ok) redirect(`${back}?error=${q(r.error ?? "Could not change the advisor.")}`);
  const undo = previous === advisorId ? "" : `&undo=${previous ?? "none"}`;
  redirect(`${back}?notice=${q(advisorId ? "Advisor assigned." : "Advisor cleared.")}${undo}`);
}
