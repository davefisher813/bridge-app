// Linking a document to an athlete (migration 0058), under 0078.
//
// An unlinked document may be linked by any Admin of the org, even one who
// will not be able to open it afterwards: Postgres refuses a plain update
// that leaves a row the person can no longer read, so that one write goes
// through public.document_link_athlete. A document that already names an
// athlete is a different matter: moving or clearing it is a plain update,
// which the database allows only to someone entitled to both the old and
// the new athlete (in practice the Master Account). Before 0078 is on the
// database the function does not exist, and the plain update is used for
// both, as it always was.

import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<any, any, any>;

export type LinkResult =
  | { ok: true }
  // The person may not open the document, so may not change it.
  | { ok: false; reason: "locked" }
  // It already names an athlete, and moving it is not theirs to do.
  | { ok: false; reason: "has_athlete" }
  | { ok: false; reason: "failed"; message: string };

type Failure = { code?: string; message?: string } | null;

// PostgREST reports a function it does not know as PGRST202, Postgres as 42883.
export function isMissingFunction(error: Failure): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

async function plainUpdate(client: Client, orgId: string, documentId: string, athleteId: string | null): Promise<LinkResult> {
  const { data, error } = await client
    .from("documents")
    .update({ linked_athlete_id: athleteId, updated_at: new Date().toISOString() })
    .eq("id", documentId)
    .eq("org_id", orgId)
    .select("id");
  if (error) return error.code === "42501" ? { ok: false, reason: "has_athlete" } : { ok: false, reason: "failed", message: error.message ?? "" };
  // No row changed: it is not one this person can see, so it is locked to them.
  return Array.isArray(data) && data.length > 0 ? { ok: true } : { ok: false, reason: "locked" };
}

export async function linkDocument(
  client: Client,
  args: { orgId: string; documentId: string; currentAthleteId: string | null; athleteId: string | null }
): Promise<LinkResult> {
  const { orgId, documentId, currentAthleteId, athleteId } = args;
  if (currentAthleteId !== null || athleteId === null) return plainUpdate(client, orgId, documentId, athleteId);
  const { error } = await client.rpc("document_link_athlete", { p_doc: documentId, p_athlete: athleteId });
  if (!error) return { ok: true };
  if (isMissingFunction(error)) return plainUpdate(client, orgId, documentId, athleteId);
  const message = error.message ?? "";
  if (/locked/i.test(message)) return { ok: false, reason: "locked" };
  if (/already belongs/i.test(message)) return { ok: false, reason: "has_athlete" };
  return { ok: false, reason: "failed", message };
}

// What a refusal says, for the screen that asked.
export const LINK_REFUSALS = {
  locked: "This document is locked to you, so you cannot change it.",
  has_athlete: "It already names an athlete. Only the Master Account can move it to someone else.",
} as const;
