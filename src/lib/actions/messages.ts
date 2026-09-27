"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireFamilyAthlete } from "@/lib/data/family";
import { markThreadRead } from "@/lib/data/messages";
import { parseMessageForm } from "@/lib/validation/message";

// A message on an athlete's thread (migration 0039). The one thing a
// family login may write: a message on its own athlete's thread, as
// itself. Owners and staff write on any athlete in the org. A member
// writes nothing here and reads nothing here.
//
// The database holds the same line (the insert policy and the coherence
// trigger); this checks first so the answer is a page, not an error.

export interface MessageActionState {
  errors: Record<string, string>;
  // What was typed, handed back on a refusal so the form keeps it.
  body?: string;
}

// Same cross-org shape as the other actions' assertAthleteInOrg: RLS
// only sees the new row's own org_id.
async function athleteInOrg(orgId: string, athleteId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return !!data;
}

export async function sendMessage(slug: string, athleteId: string, _prevState: MessageActionState, formData: FormData): Promise<MessageActionState> {
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await getCurrentUser(org.id);
  if (!user) redirect("/login");

  if (user.role === "family") {
    // Not linked to this athlete is not found, the database's answer.
    await requireFamilyAthlete(org.id, user.id, athleteId);
  } else if (user.role === "owner" || user.role === "staff") {
    if (!(await athleteInOrg(org.id, athleteId))) return { errors: { form: "That athlete isn't on this org's roster." } };
  } else {
    redirect("/unauthorized");
  }

  const typed = String(formData.get("body") ?? "");
  const parsed = parseMessageForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors, body: typed };

  const supabase = await createClient();
  const { error } = await supabase.from("athlete_messages").insert({
    org_id: org.id,
    athlete_id: athleteId,
    author_id: user.id,
    body: parsed.values.body,
  });
  if (error) return { errors: { form: error.message }, body: typed };

  // Whoever wrote the last message has read the thread.
  await markThreadRead(supabase, org.id, athleteId, user.id);

  revalidatePath(`/org/${slug}/roster/${athleteId}/messages`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/family/${athleteId}/messages`);
  revalidatePath(`/org/${slug}/family/${athleteId}`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}`);
  return { errors: {} };
}
