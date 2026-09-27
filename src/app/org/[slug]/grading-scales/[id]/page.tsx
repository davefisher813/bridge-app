import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { deleteGradingScale, saveGradingScale } from "@/lib/actions/gradingScales";
import { loadHighSchoolOptions } from "@/lib/data/lookups";
import { GradingScaleForm } from "@/components/GradingScaleForm";
import { bandsToRows } from "@/lib/validation/gradingScale";
import { gradingScaleNotes } from "@/lib/fit/ncaa/gradingScale";
import { parseBands } from "@/lib/data/ncaaAdapters";
import { ConfirmButton, Form, Notice, Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function EditGradingScalePage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ error?: string }> }) {
  const { slug, id } = await params;
  const { error } = (await searchParams) ?? {};
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
  const schools = (await loadHighSchoolOptions(supabase, org.id)).map((o) => ({ value: o.value, label: o.label }));

  return (
    <Screen
      title={scale.school_name}
      back={{ href: `/org/${slug}/grading-scales`, label: "Grading Scales" }}
    >
      {error && (
        <Notice tone="danger" title="Could Not Remove the Scale">
          {error}
        </Notice>
      )}
      {notes.map((n, i) => (
        <Notice key={i} tone="warning" title="Check This Table">
          {n}
        </Notice>
      ))}

      <GradingScaleForm
        action={action}
        submitLabel="Save and Recalculate"
        defaults={{
          schoolName: scale.school_name,
          rows: bandsToRows(bands),
          reportsWeightedGrades: scale.reports_weighted_grades,
          weightingIsClassRankOnly: scale.weighting_is_class_rank_only,
          weightBonus: Number.isFinite(bonus) ? bonus.toFixed(2) : "1.00",
          sourceNote: scale.source_note ?? "",
        }}
        schools={schools}
      />

      {/* A scale saved under the wrong school name stays in use until it
          is removed (crud F12). */}
      <Form action={deleteGradingScale.bind(null, slug, scale.id)}>
        <ConfirmButton
          title={`Remove the Scale for ${scale.school_name}?`}
          body="Athletes at this school go back to the shared scale, or to the assumed ten-point one, and their core GPAs recalculate."
          confirmLabel="Remove Scale"
        >
          Remove Scale
        </ConfirmButton>
      </Form>
    </Screen>
  );
}
