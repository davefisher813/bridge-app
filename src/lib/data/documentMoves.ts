// The rules for changing one stored document, shared by the single-document
// actions (src/lib/actions/documents.ts) and the bulk ones
// (documentsBulk.ts), so there is one copy of each rule and the bulk path
// can never be looser than the one-at-a-time path.
//
// Not a "use server" file: pure checks, plus a lookup that takes the
// caller's own Supabase client (RLS answers for the caller).

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCategory } from "@/lib/docai/categories";
import type { DocCategoryId } from "@/lib/docai/types";
import { AREA_COVERS, AREA_LABEL, readyGate, type ApproverMap } from "@/lib/documents/approvers";
import { isFileType, isReaderType, readerTypeOf } from "@/lib/documents/fileTypes";
import { isStaleProcessing } from "@/lib/vault/lifecycle";
import type { Lifecycle } from "@/lib/vault/lifecycle";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

// The two things the activity log may say about a document: what kind
// it is, as the category's label lower-cased for the middle of a
// sentence ("document" when nothing has said yet), and which athlete
// it was for, by name. Never a field that was read off it.
export function documentKind(category: DocCategoryId | null | undefined): string {
  return category ? getCategory(category).label.toLowerCase() : "document";
}

export async function orgAthleteName(client: Client, orgId: string, athleteId: string | null | undefined): Promise<{ id: string; name: string } | null> {
  if (!athleteId) return null;
  const { data } = await client.from("athletes").select("id, name").eq("id", athleteId).eq("org_id", orgId).is("deleted_at", null).maybeSingle();
  return (data as { id: string; name: string } | null) ?? null;
}

// ── Moving between states ────────────────────────────────────────────

export interface MovableDoc {
  lifecycle: string;
  lifecycle_changed_at: string | null;
  category: string | null;
  requested_category: string | null;
  filed_as: string | null;
}

export type MoveBlock = { kind: "approver" | "reading"; message: string };

// Why a document may not make this move now, or null. The approver gate
// (migration 0067, Doc AI piece 7): a type with a named approver is
// marked Ready by that person only; nobody named, any Admin. Then a
// document still being read stays put. The lifecycle table itself
// (src/lib/vault/lifecycle.ts) is checked by moveLifecycle.
export function moveBlock(doc: MovableDoc, to: Lifecycle, approvers: ApproverMap, userId: string): MoveBlock | null {
  if (to === "ready") {
    const gate = readyGate(readerTypeOf(doc), approvers, userId);
    if (gate.kind === "waiting") {
      return { kind: "approver", message: `Waiting on ${gate.approver.name} to approve. Only the ${AREA_LABEL[gate.area]} marks ${AREA_COVERS[gate.area].toLowerCase()} Ready.` };
    }
  }
  // Out of Processing only when the reading has plainly died.
  if (doc.lifecycle === "processing" && !isStaleProcessing(doc.lifecycle as Lifecycle, doc.lifecycle_changed_at)) {
    return { kind: "reading", message: "That document is still being read." };
  }
  return null;
}

// ── Setting the type ─────────────────────────────────────────────────

export interface TypableDoc {
  category: string | null;
  status: string;
  extracted: unknown;
  review_reason: string | null;
}

export function isSettableType(raw: string): boolean {
  return !raw || isFileType(raw) || isReaderType(raw);
}

// Why a document keeps the type it has, or null. A reading for a person
// (Other, Board Document, or No Type read as Other) can be re-typed, then
// read again as that type; a reading of an athlete's document keeps its
// type. A reading that failed with nothing read has no reading to keep,
// so it can be re-typed too.
export function typeBlock(doc: TypableDoc): string | null {
  const reference = !doc.category || doc.category === "other" || doc.category === "board_document";
  const failedUnread = doc.status === "failed" && !doc.extracted;
  if ((!reference && !failedUnread) || doc.status === "processing" || doc.status === "applied" || doc.status === "filed") {
    return "This document was read, so it keeps the type of its reading.";
  }
  return null;
}

// The update that sets (or, for "", clears) a type. The settled type goes
// with it, so Read Again reads the new one, and so do the athletes the
// old reading matched: nothing from it can be applied under the new type.
export function typePatch(raw: string, doc: Pick<TypableDoc, "review_reason">): Record<string, unknown> {
  const readerType = isReaderType(raw) ? raw : null;
  const fileType = !readerType && isFileType(raw) ? raw : null;
  return {
    requested_category: readerType,
    filed_as: fileType,
    category: null,
    candidates: [],
    ...(raw && doc.review_reason === "No type chosen." ? { review_reason: null } : {}),
    updated_at: new Date().toISOString(),
  };
}
