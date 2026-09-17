import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { saveGradingScale } from "@/lib/actions/gradingScales";
import { GradingScaleForm } from "@/components/GradingScaleForm";
import { bandsToRows } from "@/lib/validation/gradingScale";
import { TEN_POINT_STARTING_POINT } from "@/lib/fit/ncaa/gradingScale";

// Staff, not owner-only, and through the ordinary client rather than the
// service role. That is the difference from /schools/new: this writes an
// org-scoped row, so a wrong entry is wrong for one org. See
// src/lib/actions/gradingScales.ts for the full reasoning.
export default async function NewGradingScalePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ school?: string; returnTo?: string }>;
}) {
  const { slug } = await params;
  const { school, returnTo } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const action = saveGradingScale.bind(null, slug, null);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/grading-scales`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Grading scales
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">{school || "Add a grading scale"}</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        Copy the table exactly as the school publishes it. Do not adjust it to look like other schools: the whole reason this is stored
        per school is that schools differ.
      </p>

      <GradingScaleForm
        action={action}
        submitLabel="Save and recalculate"
        returnTo={returnTo}
        defaults={{
          schoolName: school ?? "",
          // Prefilled with the common ten-point table as a starting point
          // to correct, never as an answer. It is visible and editable,
          // so nothing is assumed silently.
          rows: bandsToRows(TEN_POINT_STARTING_POINT),
          reportsWeightedGrades: false,
          weightingIsClassRankOnly: false,
          weightBonus: "1.00",
          sourceNote: "",
        }}
      />
    </main>
  );
}
