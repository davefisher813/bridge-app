import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { saveGradingScale } from "@/lib/actions/gradingScales";
import { GradingScaleForm } from "@/components/GradingScaleForm";
import { bandsToRows } from "@/lib/validation/gradingScale";
import { gradingScaleNotes } from "@/lib/fit/ncaa/gradingScale";
import { parseBands } from "@/lib/data/ncaaAdapters";
import { RailCard } from "@/components/catalog";

export const dynamic = "force-dynamic";

export default async function EditGradingScalePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: scale } = await supabase
    .from("org_grading_scales")
    .select("id, school_name, bands, reports_weighted_grades, weighting_is_class_rank_only, weight_bonus, source_note")
    .eq("id", id)
    .eq("org_id", org.id)
    .single();

  if (!scale) notFound();

  const bands = parseBands(scale.bands);
  // Problems worth saying out loud that are not reasons to refuse the
  // table: a gap grades fall into, a top band that stops at 100. Shown
  // on the stored table rather than only at entry, because a scale
  // someone typed months ago is where these actually bite.
  const notes = gradingScaleNotes(bands);
  const bonus = Number(scale.weight_bonus);
  const action = saveGradingScale.bind(null, slug, scale.id);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/grading-scales`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Grading scales
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">{scale.school_name}</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        Changing this recalculates every athlete at this school in your org. Verdicts can move in either direction.
      </p>

      {notes.length > 0 && (
        <div className="mb-5 flex flex-col gap-2">
          {notes.map((n, i) => (
            <RailCard key={i} role="offer">
              <div className="text-[12.5px] leading-tight text-ink">{n}</div>
            </RailCard>
          ))}
        </div>
      )}

      <GradingScaleForm
        action={action}
        submitLabel="Save and recalculate"
        defaults={{
          schoolName: scale.school_name,
          rows: bandsToRows(bands),
          reportsWeightedGrades: scale.reports_weighted_grades,
          weightingIsClassRankOnly: scale.weighting_is_class_rank_only,
          weightBonus: Number.isFinite(bonus) ? bonus.toFixed(2) : "1.00",
          sourceNote: scale.source_note ?? "",
        }}
      />
    </main>
  );
}
