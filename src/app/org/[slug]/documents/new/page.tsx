import { RowGlyph } from "@/components/RowGlyph";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { isStubbedModel } from "@/lib/actions/documents";
import { DocumentUploader } from "@/components/DocumentUploader";

export default async function NewDocumentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const stubbed = await isStubbedModel();

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/documents`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Documents
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Add a document</h1>
      <p className="mb-5 text-[13.5px] text-muted">
        A transcript, test scores, an offer letter. It gets read, matched to an athlete, and either applied or sent to review.
      </p>

      {stubbed && (
        <div className="mb-5 flex items-start gap-3 rounded-[10px] bg-paper px-3.5 py-3">
          <span className="mt-[1px]"><RowGlyph kind="warning" role="time" /></span>
          <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-bold text-ink">Simulated reading</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            No AI model is connected yet, so nothing is actually read off the page. The whole flow runs and the results are made up.
          </div>
        </div>
          </div>
      )}

      <DocumentUploader slug={slug} />
    </main>
  );
}
