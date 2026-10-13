import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { FamilyDocumentForm } from "@/components/FamilyDocumentForm";
import { Screen } from "@/components/kit";

// The Athlete login sends a document for its own athlete, outside any
// assignment (Doc AI Piece 5, migration 0066). Only the Athlete login
// (requireFamily), and only for an athlete it is linked to
// (requireFamilyAthlete: another athlete's id is not found). The file is
// filed for an Admin, in Needs Review; nothing reads it from here.

export default async function FamilySendDocumentPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const { athlete } = await requireFamilyAthlete(org.id, user.id, id);

  return (
    <Screen title="Send a Document" back={{ href: `/org/${slug}/family/${id}`, label: athlete.name }} lede={`For ${athlete.name}. An Admin looks at it before anything on the record changes.`}>
      <FamilyDocumentForm slug={slug} orgId={org.id} athleteId={id} />
    </Screen>
  );
}
