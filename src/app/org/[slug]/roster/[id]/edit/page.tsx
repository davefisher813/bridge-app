import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateAthlete } from "@/lib/actions/athletes";
import { AthleteForm, type AthleteFormInitialValues } from "@/components/AthleteForm";
import { safeParseAthleteDetail } from "@/lib/fit/schema";
import { advisorOptionLabel, loadStaff } from "@/lib/data/staff";
import { loadAthleteFormOptions } from "@/lib/data/athleteFormOptions";
import type { RecruitType } from "@/lib/fit/types";
import { Screen } from "@/components/kit";

interface AthleteEditRow {
  id: string;
  name: string;
  sport: string;
  position: string | null;
  recruit_type: RecruitType;
  gpa: number | null;
  gpa_verified: boolean;
  status: string;
  advisor_id: string | null;
  is_international: boolean;
  toefl_score: number | null;
  ielts_score: number | null;
  f1_visa_status: string | null;
  ncaa_eligibility_status: string | null;
  detail: unknown;
  goal: string | null;
  family_budget_cents: number | null;
  home_state: string | null;
  grades: Record<string, number> | null;
  first_full_time_enrollment: string | null;
  graduated_on: string | null;
}

export default async function EditAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data }, staff, options] = await Promise.all([
    supabase
      .from("athletes")
      .select(
        "id, name, sport, position, recruit_type, gpa, gpa_verified, status, advisor_id, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status, detail, goal, family_budget_cents, home_state, grades, first_full_time_enrollment, graduated_on"
      )
      .eq("id", id)
      .eq("org_id", org.id)
      .is("deleted_at", null)
      .single(),
    loadStaff(supabase, org.id),
    loadAthleteFormOptions(supabase, org.id),
  ]);

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
    advisorId: athlete.advisor_id ?? undefined,
    isInternational: athlete.is_international,
    toeflScore: athlete.toefl_score ?? undefined,
    ieltsScore: athlete.ielts_score ?? undefined,
    f1VisaStatus: athlete.f1_visa_status ?? undefined,
    ncaaEligibilityStatus: athlete.ncaa_eligibility_status ?? undefined,
    goal: athlete.goal ?? undefined,
    familyBudget: athlete.family_budget_cents != null ? Math.round(athlete.family_budget_cents / 100) : undefined,
    homeState: athlete.home_state ?? undefined,
    frame: athlete.grades?.frame,
    athleticism: athlete.grades?.athleticism,
    skill: athlete.grades?.skill,
    iq: athlete.grades?.iq,
    competitiveness: athlete.grades?.competitiveness,
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
          highSchool: detail.highSchool,
          highSchoolId: detail.highSchoolId,
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
          currentSchoolId: detail.currentSchoolId,
        }
      : {}),
    enrollmentDate: athlete.first_full_time_enrollment ?? undefined,
    graduatedOn: athlete.graduated_on ?? undefined,
  };

  // The NCAA clock dates that may be corrected here (audit crud F8): the
  // enrollment date once it is set, or on a transfer, whose clock started
  // at another school; Graduated On once Mark Graduated set it. The same
  // rule as updateAthlete. Setting one the first time is the job of Mark
  // Enrolled and Mark Graduated, which also close out recruiting.
  const dates = { enrollment: !!athlete.first_full_time_enrollment || athlete.recruit_type !== "hs", graduated: !!athlete.graduated_on };

  const action = updateAthlete.bind(null, slug, athlete.id);

  return (
    <Screen title={`Edit ${athlete.name}`} back={{ href: `/org/${slug}/roster/${athlete.id}`, label: athlete.name }}>
      <AthleteForm action={action} initialValues={initialValues} submitLabel="Save Changes" advisors={staff.map((s) => ({ id: s.id, name: advisorOptionLabel(s) }))} options={options} editing dates={dates} />
    </Screen>
  );
}
