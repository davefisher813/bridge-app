// Locked documents (migration 0078, Dave 2026-11-03: "show as locked").
//
// An Admin who cannot open a document's file still sees that the document
// exists, so Needs Review, Ready and Archived keep their counts. The
// database returns only what the review workflow needs: id, org_id,
// status, lifecycle and created_at (public.documents_locked). The name,
// type, athlete and everything else are never sent, so there is nothing
// here to hide on the screen.
//
// Before 0078 is on the database the function does not exist, and nothing
// is locked: the call answers with no rows. A failed call also answers
// with no rows; a locked document is one the person could not open anyway.

import type { SupabaseClient } from "@supabase/supabase-js";

type Client = SupabaseClient<any, any, any>;

export interface LockedDoc {
  id: string;
  status: string;
  lifecycle: string;
  created_at: string;
}

// The one title a locked document has, on its row and on its page.
export const LOCKED_TITLE = "Locked Document";

// Who can open one, by role name (Tony, 2026-11-03: the organization's
// labels, never a person). The Master Account is the label the members
// screens already use.
export const LOCKED_OPENERS = "the athlete it belongs to, that athlete's advisor and the Master Account";

export async function loadLockedDocuments(client: Pick<Client, "rpc">, orgId: string): Promise<LockedDoc[]> {
  try {
    const { data, error } = await client.rpc("documents_locked", { p_org: orgId });
    if (error || !Array.isArray(data)) return [];
    return (data as LockedDoc[]).filter((d) => typeof d?.id === "string");
  } catch {
    return [];
  }
}

export async function lockedDocumentById(client: Pick<Client, "rpc">, orgId: string, documentId: string): Promise<LockedDoc | null> {
  return (await loadLockedDocuments(client, orgId)).find((d) => d.id === documentId) ?? null;
}
