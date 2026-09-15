import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireOwner } from "@/lib/auth/guard";
import { createSchool } from "@/lib/actions/schools";
import { SchoolForm } from "@/components/SchoolForm";

// Owner-only: schools is shared reference data across every org, not
// scoped to this one, so this isn't "staff can manage their org's
// schools" - it's a deliberately narrow door into data every other org
// also reads. See docs/DECISIONS.md and src/lib/actions/schools.ts.
export default async function NewSchoolPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireOwner(org.id);

  const action = createSchool.bind(null, slug);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/board/new`} className="text-[13px] font-bold text-muted">
          &larr; Add target
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Add school</h1>
      <p className="mb-4 text-[12.5px] text-muted">Schools are shared across every org on the platform, not just this one.</p>
      <SchoolForm action={action} />
    </main>
  );
}
