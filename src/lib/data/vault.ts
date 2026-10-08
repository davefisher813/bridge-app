// The vault's one way to move a document between its five states.
//
// Every action that changes a document's lifecycle goes through
// moveLifecycle, so there is one place that checks the move against the
// table in src/lib/vault/lifecycle.ts, one conditional write that two
// taps cannot both win, and one activity-log row per move saying who and
// when (the database stamps the time and, for an ordinary session, the
// actor). The database trigger in migration 0048 refuses the same moves,
// so a bug here is caught there.
//
// Not a "use server" file: it takes the caller's Supabase client, so it
// can be tested against the fake one and never becomes a public endpoint.

import type { SupabaseClient } from "@supabase/supabase-js";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { canMove, isLifecycle, transitionFor, type Lifecycle, type Mover } from "@/lib/vault/lifecycle";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export type MoveResult = { ok: true; from: Lifecycle } | { ok: false; error: string };

export interface MoveArgs {
  orgId: string;
  documentId: string;
  to: Lifecycle;
  by: Mover;
  actorId: string;
  // What the log line says the document is ("transcript", or "document").
  kind: string;
  // The athlete the document is filed to, when it is, for the log line.
  athlete?: { id: string; name: string } | null;
  // Written in the same update: the line a Needs Review row shows.
  reviewReason?: string | null;
  // The state the caller read. When given, the move happens only from it.
  expectedFrom?: Lifecycle;
}

export async function moveLifecycle(client: Client, args: MoveArgs): Promise<MoveResult> {
  const { data } = await client.from("documents").select("lifecycle").eq("id", args.documentId).eq("org_id", args.orgId).maybeSingle();
  const current = (data as { lifecycle?: unknown } | null)?.lifecycle;
  if (!isLifecycle(current)) return { ok: false, error: "Document not found." };
  const from = args.expectedFrom ?? current;
  if (!canMove(from, args.to, args.by)) {
    return { ok: false, error: `A document cannot go from ${from.replace("_", " ")} to ${args.to.replace("_", " ")}.` };
  }
  const t = transitionFor(from, args.to)!;

  // Conditional on the state it was read in, so a second tap, or a second
  // person, finds it already moved and changes nothing.
  const patch: Record<string, unknown> = { lifecycle: args.to, updated_at: new Date().toISOString() };
  if (args.reviewReason !== undefined) patch.review_reason = args.reviewReason;
  const { data: moved, error } = await client
    .from("documents")
    .update(patch)
    .eq("id", args.documentId)
    .eq("org_id", args.orgId)
    .eq("lifecycle", from)
    .select("id");
  if (error) return { ok: false, error: `Could not move the document: ${error.message}` };
  if (!moved || (moved as unknown[]).length === 0) return { ok: false, error: "That document was just changed by someone else. Reload and look again." };

  await logActivity(client, {
    orgId: args.orgId,
    actorId: args.actorId,
    athleteId: args.athlete?.id ?? null,
    action: t.action,
    subjectType: "document",
    subjectId: args.documentId,
    summary: activitySummary(t.action, { name: args.athlete?.name ?? null, kind: args.kind }),
  });
  return { ok: true, from };
}
