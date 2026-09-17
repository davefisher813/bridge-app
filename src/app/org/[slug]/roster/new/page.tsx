import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createAthlete } from "@/lib/actions/athletes";
import { AthleteForm } from "@/components/AthleteForm";

export default async function NewAthletePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const action = createAthlete.bind(null, slug);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/roster`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Athletes
        </Link>
      </div>
      <h1 className="mb-4 text-[20px] font-extrabold text-ink">Add athlete</h1>
      <AthleteForm action={action} submitLabel="Add athlete" />
    </main>
  );
}
