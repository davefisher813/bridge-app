import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { saveGradingScale } from "@/lib/actions/gradingScales";
import { GradingScaleForm } from "@/components/GradingScaleForm";
import { bandsToRows } from "@/lib/validation/gradingScale";
import { TEN_POINT_STARTING_POINT } from "@/lib/fit/ncaa/gradingScale";
import { Screen } from "@/components/kit";

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
    <Screen
      title={school || "Add a Grading Scale"}
      back={{ href: `/org/${slug}/grading-scales`, label: "Grading Scales" }}
    >
      <GradingScaleForm
        action={action}
        submitLabel="Save and Recalculate"
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
    </Screen>
  );
}
