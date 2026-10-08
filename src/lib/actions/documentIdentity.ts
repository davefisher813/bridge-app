"use server";

// Piece 2: a person says who a document is about. The app suggested;
// these are the only paths that set documents.subject_athlete_id
// (migration 0049). Admins of the document's own org only; a trigger
// holds the athlete to the same org whatever this code does.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { loadSuggestionRoster, NOT_AN_ATHLETE, suggestionFor } from "@/lib/data/documentSuggestions";
import { PROVISIONAL_TYPE_LABEL, type IdentityCandidate, type ProvisionalType } from "@/lib/docai/suggest";
import { checkVaultFile } from "@/lib/vault/format";
import type { DocCategoryId } from "@/lib/docai/types";

interface DocRow {
  id: string;
  file_name: string;
  format: string | null;
  original_paths: string[] | null;
  requested_category: DocCategoryId | null;
  suggested_type: string | null;
  identity_status: string | null;
  identity_candidates: IdentityCandidate[] | null;
  subject_athlete_id: string | null;
}

function kindOf(doc: DocRow): string {
  const t = doc.suggested_type as ProvisionalType | null;
  return t && t !== "other" && PROVISIONAL_TYPE_LABEL[t] ? PROVISIONAL_TYPE_LABEL[t].toLowerCase() : "document";
}

// What a document goes back to when a confirmation is taken back: the
// suggestion it had, never a guess made now.
function unconfirmedStatus(candidates: IdentityCandidate[]): "unmatched" | "proposed" | "ambiguous" {
  if (!candidates.length) return "unmatched";
  if (candidates.length === 1) return "proposed";
  return candidates[0]!.score - candidates[1]!.score < 0.15 ? "ambiguous" : "proposed";
}

async function load(slug: string, documentId: string) {
  const org = await getOrgBySlug(slug);
  if (!org) return null;
  const user = await requireRole(org.id, STAFF_ROLES);
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, file_name, format, original_paths, requested_category, suggested_type, identity_status, identity_candidates, subject_athlete_id")
    .eq("id", documentId)
    .eq("org_id", org.id)
    .maybeSingle();
  return { org, user, supabase, doc: (data as DocRow | null) ?? null };
}

function back(slug: string, documentId: string, error?: string): never {
  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(`/org/${slug}/documents/${documentId}`);
  redirect(error ? `/org/${slug}/documents/${documentId}?error=${encodeURIComponent(error)}` : `/org/${slug}/documents/${documentId}`);
}

// One form, three meanings: an athlete id confirms that athlete,
// NOT_AN_ATHLETE says it is about nobody, an empty value takes the
// confirmation back to the suggestion.
export async function setDocumentIdentity(slug: string, documentId: string, formData: FormData): Promise<void> {
  const ctx = await load(slug, documentId);
  if (!ctx) redirect("/");
  const { org, user, supabase, doc } = ctx;
  if (!doc) redirect(`/org/${slug}/documents?error=${encodeURIComponent("That document is already gone.")}`);
  const value = String(formData.get("athleteId") ?? "").trim();
  const now = new Date().toISOString();

  if (!value) {
    if (doc.identity_status !== "confirmed" && doc.identity_status !== "not_an_athlete") back(slug, documentId);
    const { error } = await supabase
      .from("documents")
      .update({ subject_athlete_id: null, identity_status: unconfirmedStatus(doc.identity_candidates ?? []), identity_confirmed_by: null, identity_confirmed_at: null })
      .eq("id", doc.id)
      .eq("org_id", org.id);
    if (error) back(slug, documentId, "That could not be changed. Try again.");
    await logActivity(supabase, {
      orgId: org.id,
      actorId: user.id,
      athleteId: doc.subject_athlete_id,
      action: "document_identity_cleared",
      subjectType: "document",
      subjectId: doc.id,
      summary: activitySummary("document_identity_cleared", { kind: kindOf(doc) }),
    });
    back(slug, documentId);
  }

  let athlete: { id: string; name: string } | null = null;
  if (value !== NOT_AN_ATHLETE) {
    const { data } = await supabase.from("athletes").select("id, name").eq("id", value).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
    athlete = (data as { id: string; name: string } | null) ?? null;
    if (!athlete) back(slug, documentId, "That athlete is not on this roster.");
  }

  const { error } = await supabase
    .from("documents")
    .update({
      subject_athlete_id: athlete?.id ?? null,
      identity_status: athlete ? "confirmed" : "not_an_athlete",
      identity_confirmed_by: user.id,
      identity_confirmed_at: now,
    })
    .eq("id", doc.id)
    .eq("org_id", org.id);
  if (error) back(slug, documentId, "That could not be saved. Try again.");

  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: athlete?.id ?? null,
    action: "document_identity_confirmed",
    subjectType: "document",
    subjectId: doc.id,
    summary: activitySummary("document_identity_confirmed", { name: athlete?.name ?? null, kind: kindOf(doc) }),
  });
  back(slug, documentId);
}

// For a document stored before Piece 2, or after the roster changed: run
// the suggestions again on the original file. A person's confirmation is
// never overwritten; only the suggestions beside it are refreshed.
export async function suggestDocumentAgain(slug: string, documentId: string): Promise<void> {
  const ctx = await load(slug, documentId);
  if (!ctx) redirect("/");
  const { org, user, supabase, doc } = ctx;
  if (!doc) redirect(`/org/${slug}/documents?error=${encodeURIComponent("That document is already gone.")}`);

  const path = doc.original_paths?.[0];
  let bytes: Uint8Array | null = null;
  let format = doc.format;
  if (path) {
    const { data: blob } = await supabase.storage.from("documents").download(path);
    if (blob) {
      bytes = new Uint8Array(await blob.arrayBuffer());
      const verdict = checkVaultFile(doc.file_name, bytes);
      if (verdict.ok) format = verdict.format;
    }
  }
  if (!format) back(slug, documentId, "The original file could not be read.");

  const roster = await loadSuggestionRoster(supabase, org.id);
  const s = suggestionFor({ fileName: doc.file_name, format: format as Parameters<typeof suggestionFor>[0]["format"], bytes, pickedType: doc.requested_category, roster, actorId: user.id });
  const decided = doc.identity_status === "confirmed" || doc.identity_status === "not_an_athlete";
  const { error } = await supabase
    .from("documents")
    .update({
      suggested_type: s.suggested_type,
      suggested_type_confidence: s.suggested_type_confidence,
      suggested_type_reasons: s.suggested_type_reasons,
      identity_candidates: s.identity_candidates,
      suggested_at: s.suggested_at,
      ...(decided ? {} : { identity_status: s.identity_status }),
    })
    .eq("id", doc.id)
    .eq("org_id", org.id);
  if (error) back(slug, documentId, "The suggestions could not be saved. Try again.");
  back(slug, documentId);
}
