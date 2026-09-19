// Entering a school's NCAA approved-course list.
//
// Staff, not owner-only, and through the ordinary client rather than the
// service role, for the same reason the grading-scale entry screen is:
// this writes an org-scoped row, so a wrong list is wrong for one org.
// The shared portal table stays service-role only. See
// src/lib/actions/approvedCourses.ts and migrations/0014.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { saveApprovedList } from "@/lib/actions/approvedCourses";
import { ApprovedListForm } from "@/components/ApprovedListForm";
import { Screen } from "@/components/kit";

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
    <Screen title={schoolName} back={{ href: `/org/${slug}/approved-courses`, label: "Approved Lists" }} lede="Approved course list">
      <ApprovedListForm action={action} schoolName={schoolName} />
    </Screen>
  );
}
