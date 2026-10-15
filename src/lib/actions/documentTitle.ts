"use server";

// A document's title (migration 0069, data cleanup 2026-10-13). The file
// name is part of the original record and never changes; the title is
// what the document is, set by an Admin, shown in its place. Blank puts
// the file name back. Logged, never with the title itself (the log says
// what kind of document, as every document entry does).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { getCategory } from "@/lib/docai/categories";
import type { DocCategoryId } from "@/lib/docai/types";
import { activitySummary, logActivity } from "@/lib/data/activity";
import { parseDocumentTitle } from "@/lib/documents/title";
import { requireNotViewing } from "@/lib/data/viewAs";

export async function renameDocument(slug: string, documentId: string, formData: FormData): Promise<void> {
  await requireNotViewing();
  const org = await getOrgBySlug(slug);
  if (!org) redirect("/unauthorized");
  const user = await requireRole(org.id, STAFF_ROLES);
  const back = `/org/${slug}/documents/${documentId}`;

  const parsed = parseDocumentTitle(formData.get("title"));
  if (!parsed.ok) redirect(`${back}?error=${encodeURIComponent(parsed.error)}`);

  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("id, category, requested_category, linked_athlete_id").eq("id", documentId).eq("org_id", org.id).maybeSingle();
  const doc = data as { category: DocCategoryId | null; requested_category: DocCategoryId | null; linked_athlete_id: string | null } | null;
  if (!doc) redirect(`/org/${slug}/documents?error=${encodeURIComponent("That document is not in this organization.")}`);

  const { error } = await supabase.from("documents").update({ title: parsed.title }).eq("id", documentId).eq("org_id", org.id);
  if (error) redirect(`${back}?error=${encodeURIComponent(`Could not save the title: ${error.message}`)}`);

  const category = doc.category ?? doc.requested_category;
  await logActivity(supabase, {
    orgId: org.id,
    actorId: user.id,
    athleteId: doc.linked_athlete_id,
    action: "document_renamed",
    subjectType: "document",
    subjectId: documentId,
    summary: activitySummary("document_renamed", { kind: category ? getCategory(category).label.toLowerCase() : "document" }),
  });

  revalidatePath(`/org/${slug}/documents`);
  revalidatePath(back);
  if (doc.linked_athlete_id) revalidatePath(`/org/${slug}/roster/${doc.linked_athlete_id}`);
  redirect(`${back}?notice=${encodeURIComponent(parsed.title ? "Title saved." : "Title cleared. The file name shows instead.")}`);
}
