import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateAthlete } from "@/lib/actions/athletes";
import { AthleteForm, type AthleteFormInitialValues } from "@/components/AthleteForm";
import { safeParseAthleteDetail } from "@/lib/fit/schema";
import type { RecruitType } from "@/lib/fit/types";

interface AthleteEditRow {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  recruit_type: RecruitType;
  gpa: number | null;
  gpa_verified: boolean;
  status: string;
  is_international: boolean;
  toefl_score: number | null;
  ielts_score: number | null;
  f1_visa_status: string | null;
  ncaa_eligibility_status: string | null;
  detail: unknown;
}

export default async function EditAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data } = await supabase
    .from("athletes")
    .select(
      "id, name, sport, position, recruit_type, gpa, gpa_verified, status, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status, detail"
    )
    .eq("id", id)
    .eq("org_id", org.id)
    .is("deleted_at", null)
    .single();

  if (!data) notFound();
  const athlete = data as AthleteEditRow;

  const detailParsed = safeParseAthleteDetail(athlete.detail);
  const detail = detailParsed.success ? detailParsed.data : null;

  const initialValues: AthleteFormInitialValues = {
    name: athlete.name,
    sport: athlete.sport,
    position: athlete.position ?? undefined,
    recruitType: athlete.recruit_type,
    gpa: athlete.gpa ?? undefined,
    gpaVerified: athlete.gpa_verified,
    status: athlete.status,
    isInternational: athlete.is_international,
    toeflScore: athlete.toefl_score ?? undefined,
    ieltsScore: athlete.ielts_score ?? undefined,
    f1VisaStatus: athlete.f1_visa_status ?? undefined,
    ncaaEligibilityStatus: athlete.ncaa_eligibility_status ?? undefined,
    ...(detail?.kind === "hs"
      ? {
          gradYear: detail.gradYear,
          apCount: detail.apCount,
          ibCount: detail.ibCount,
          honorsCount: detail.honorsCount,
          dualCount: detail.dualCount,
          satTotal: detail.satTotal,
          actComposite: detail.actComposite,
          desiredMajor: detail.desiredMajor,
        }
      : {}),
    ...(detail?.kind === "transfer"
      ? {
          currentSchool: detail.currentSchool,
          currentDivision: detail.currentDivision,
          collegeGpa: detail.collegeGpa,
          creditHoursCompleted: detail.creditHoursCompleted,
          eligibilityYearsRemaining: detail.eligibilityYearsRemaining,
          portalEntryDate: detail.portalEntryDate,
          transferCount: detail.transferCount,
          degreeCompleted: detail.degreeCompleted,
          desiredMajor: detail.desiredMajor,
        }
      : {}),
  };

  const action = updateAthlete.bind(null, slug, athlete.id);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4 flex items-center gap-3">
        <Link href={`/org/${slug}/roster`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; Athletes
        </Link>
      </div>
      <h1 className="mb-4 text-[22px] font-extrabold text-ink">Edit {athlete.name}</h1>
      <AthleteForm action={action} initialValues={initialValues} submitLabel="Save changes" />
    </main>
  );
}
