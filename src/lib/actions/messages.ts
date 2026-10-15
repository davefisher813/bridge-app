"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireFamilyAthlete } from "@/lib/data/family";
import { markThreadRead } from "@/lib/data/messages";
import { parseMessageForm } from "@/lib/validation/message";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { requireNotViewing } from "@/lib/data/viewAs";

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

// Same cross-org shape as the other actions' loadOrgAthlete: RLS only
// sees the new row's own org_id. The name comes back for the log line.
async function loadOrgAthlete(orgId: string, athleteId: string): Promise<{ id: string; name: string } | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("athletes").select("id, name").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

function revalidateThread(slug: string, athleteId: string) {
  revalidatePath(`/org/${slug}/roster/${athleteId}/messages`);
  revalidatePath(`/org/${slug}/roster/${athleteId}`);
  revalidatePath(`/org/${slug}/family/${athleteId}/messages`);
  revalidatePath(`/org/${slug}/family/${athleteId}`);
  revalidatePath(`/org/${slug}/mine`);
  revalidatePath(`/org/${slug}`);
}

export async function sendMessage(slug: string, athleteId: string, _prevState: MessageActionState, formData: FormData): Promise<MessageActionState> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await getCurrentUser(org.id);
  if (!user) redirect("/login");

  // The athlete's name, for the Admin's log line; a family login's line
  // is written by SQL and names nobody.
  let athleteName: string | null = null;
  if (user.role === "family") {
    // Not linked to this athlete is not found, the database's answer.
    await requireFamilyAthlete(org.id, user.id, athleteId);
  } else if (user.role === "owner" || user.role === "staff") {
    const athlete = await loadOrgAthlete(org.id, athleteId);
    if (!athlete) return { errors: { form: "That athlete isn't on this org's roster." } };
    athleteName = athlete.name;
  } else {
    redirect("/unauthorized");
  }

  const typed = String(formData.get("body") ?? "");
  const parsed = parseMessageForm(formData);
  if (!parsed.ok || !parsed.values) return { errors: parsed.errors, body: typed };

  const supabase = await createClient();
  const { data: created, error } = await supabase
    .from("athlete_messages")
    .insert({
      org_id: org.id,
      athlete_id: athleteId,
      author_id: user.id,
      body: parsed.values.body,
    })
    .select("id")
    .maybeSingle();
  if (error) return { errors: { form: error.message }, body: typed };

  // Whoever wrote the last message has read the thread.
  await markThreadRead(supabase, org.id, athleteId, user.id);

  // The log line says a message was sent, never what it said. A family
  // login has no right to write the log itself, so the database's
  // log_family_message (migration 0044) writes its fixed line; the only
  // thing handed to it is the athlete's id. A failed log line is warned
  // about and the message stands.
  if (user.role === "family") {
    const { error: logError } = await supabase.rpc("log_family_message", { p_athlete: athleteId });
    if (logError) console.warn(`activity_log: message_sent was not recorded: ${logError.message}`);
  } else {
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId,
      action: "message_sent",
      subjectType: "message",
      subjectId: (created as { id?: string } | null)?.id ?? null,
      summary: activitySummary("message_sent", { name: athleteName }),
    });
  }

  revalidateThread(slug, athleteId);
  return { errors: {} };
}

// Remove a message from a thread (audit crud F9): one sent to the wrong
// family, or one that should not stay in front of a minor's family.
// Owner and staff only; a family login and a member are sent away, and
// the database refuses them too (migration 0039). Scoped to the org and
// the athlete, so another org's or another thread's message id removes
// nothing. Posted by the Remove button on a message, behind a confirm.
export async function deleteMessage(slug: string, athleteId: string, messageId: string): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  await supabase.from("athlete_messages").delete().eq("id", messageId).eq("org_id", org.id).eq("athlete_id", athleteId);

  revalidateThread(slug, athleteId);
}
