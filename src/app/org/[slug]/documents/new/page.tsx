import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { isStubbedModel } from "@/lib/actions/documents";
import { createClient } from "@/lib/supabase/server";
import { DocumentUploader } from "@/components/DocumentUploader";
import { Notice, Screen } from "@/components/kit";

// A real model call on a scanned transcript can run past a minute.
// The upload action runs under this page's limit on Vercel.
export const maxDuration = 300;

export default async function NewDocumentPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ athlete?: string }> }) {
  const { slug } = await params;
  const { athlete } = searchParams ? await searchParams : {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const stubbed = await isStubbedModel();
  // The roster for the optional athlete picker (migration 0058).
  const supabase = await createClient();
  const { data: athleteRows } = await supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name");
  const athletes = (athleteRows ?? []) as { id: string; name: string }[];

  return (
    <Screen
      title="Add a Document"
      back={{ href: `/org/${slug}/documents`, label: "Documents" }}
    >
      {stubbed && (
        <Notice tone="warning" title="Simulated Reading">
          No AI model is connected yet, so nothing is actually read off the page. The whole flow runs and the results are made up.
        </Notice>
      )}
      <DocumentUploader slug={slug} orgId={org.id} athletes={athletes} initialAthleteId={athletes.some((a) => a.id === athlete) ? athlete : undefined} />
    </Screen>
  );
}
