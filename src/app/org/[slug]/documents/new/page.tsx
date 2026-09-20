import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { isStubbedModel } from "@/lib/actions/documents";
import { DocumentUploader } from "@/components/DocumentUploader";
import { Notice, Screen } from "@/components/kit";

export default async function NewDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const stubbed = await isStubbedModel();

  return (
    <Screen
      title="Add a Document"
      back={{ href: `/org/${slug}/documents`, label: "Documents" }}
      lede="A transcript, test scores, an offer letter. It gets read, matched to an athlete, and either applied or sent to review."
    >
      {stubbed && (
        <Notice tone="warning" title="Simulated Reading">
          No AI model is connected yet, so nothing is actually read off the page. The whole flow runs and the results are made up.
        </Notice>
      )}
      <DocumentUploader slug={slug} orgId={org.id} />
    </Screen>
  );
}
