// Entering a school's NCAA approved-course list.
//
// Staff, not owner-only, and through the ordinary client rather than the
// service role, for the same reason the grading-scale entry screen is:
// this writes an org-scoped row, so a wrong list is wrong for one org.
// The shared portal table stays service-role only. See
// src/lib/actions/approvedCourses.ts and migrations/0014.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { saveApprovedList } from "@/lib/actions/approvedCourses";
import { ApprovedListForm } from "@/components/ApprovedListForm";

export default async function NewApprovedListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ school?: string }>;
}) {
  const { slug } = await params;
  const { school } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const schoolName = (school ?? "").trim();
  if (!schoolName) notFound();

  const action = saveApprovedList.bind(null, slug);

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link
          href={`/org/${slug}/approved-courses`}
          className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted"
        >
          &larr; Approved lists
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold leading-tight text-ink">{schoolName}</h1>
      <div className="mb-5 text-[12.5px] font-bold text-muted">Approved course list</div>

      <ApprovedListForm action={action} schoolName={schoolName} />
    </main>
  );
}
