"use server";

import { redirect } from "next/navigation";
import { setAthleteAdvisor } from "@/lib/actions/members";

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
  const r = await setAthleteAdvisor(slug, [athleteId], advisorId);
  const back = `/org/${slug}/roster/${athleteId}`;
  if (!r.ok) redirect(`${back}?error=${q(r.error ?? "Could not change the advisor.")}`);
  redirect(`${back}?notice=${q(advisorId ? "Advisor assigned." : "Advisor cleared.")}`);
}
