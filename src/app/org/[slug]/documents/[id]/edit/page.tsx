import { notFound, redirect } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateExtracted } from "@/lib/actions/documents";
import { editableFields } from "@/lib/data/extractedEdit";
import { isStubReading } from "@/lib/data/readBy";
import { ExtractedEditForm } from "@/components/ExtractedEditForm";
import { Screen } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { DocCategoryId } from "@/lib/docai/types";

// Correcting a reading before it is applied (audit crud F5): a smudged
// GPA, a school the reader misspelled, a test total off by a digit. Only
// for a document waiting in review, and never for one the stand-in read,
// whose contents are invented however carefully they are corrected.

export const dynamic = "force-dynamic";

export default async function EditReadingPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase.from("documents").select("id, file_name, status, category, extracted, read_by").eq("id", id).eq("org_id", org.id).maybeSingle();
  if (!data) notFound();
  const doc = data as { id: string; file_name: string; status: string; category: DocCategoryId | null; extracted: Record<string, unknown> | null; read_by?: string | null };
  const back = `/org/${slug}/documents/${doc.id}`;
  // Nothing to correct: the review screen says why.
  if (doc.status !== "pending" || !doc.category || !doc.extracted || isStubReading(doc.read_by ?? null)) redirect(back);
  const fields = editableFields(doc.category, doc.extracted);
  if (fields.length === 0) redirect(back);

  return (
    <Screen title="Correct the Reading" back={{ href: back, label: "Document" }} lede={doc.file_name}>
      <ExtractedEditForm action={updateExtracted.bind(null, slug, doc.id)} fields={fields} />
    </Screen>
  );
}
