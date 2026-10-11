import { formatMetricValue } from "@/lib/fit/metrics";

// Athlete Info on the athlete page (Dave, 2026-10-11: the page showed a
// name and a sport and nowhere to read the rest of the record). Every
// field the athlete record carries, in a fixed order, and only the ones
// with a value: an empty field is left out, never shown as a blank row.
// Pure, so a law can hand it a record and read the rows back.

export interface InfoRow {
  label: string;
  value: string;
}

export interface AthleteRecord {
  recruit_type?: string | null;
  sport?: string | null;
  position?: string | null;
  status?: string | null;
  gpa?: number | string | null;
  gpa_verified?: boolean | null;
  detail?: unknown;
  date_of_birth?: string | null;
  home_state?: string | null;
  is_international?: boolean | null;
  toefl_score?: number | null;
  ielts_score?: number | string | null;
  f1_visa_status?: string | null;
  ncaa_eligibility_status?: string | null;
  intended_enrollment?: string | null;
  first_full_time_enrollment?: string | null;
  graduated_on?: string | null;
  draft_team?: string | null;
  draft_round?: number | null;
  draft_year?: number | null;
  goal?: string | null;
  family_budget_cents?: number | null;
}

export interface InfoExtras {
  // The status a person reads (a Committed target makes an athlete
  // Committed even when the stored status still says otherwise).
  status?: string | null;
  advisorName?: string | null;
  recruitTypeLabel?: string | null;
  goalLabel?: string | null;
  // The newest logged value of each metric, by metric key.
  latestMetrics?: Map<string, number>;
  date: (iso: string) => string;
}

const present = (v: unknown): boolean => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");
const text = (v: unknown): string => String(v).trim();
const num = (v: unknown, decimals: number): string => Number(v).toFixed(decimals);

export function athleteInfoRows(a: AthleteRecord, x: InfoExtras): InfoRow[] {
  const d = (a.detail && typeof a.detail === "object" ? a.detail : {}) as Record<string, unknown>;
  const rows: [string, unknown, ((v: unknown) => string)?][] = [
    ["Status", x.status ?? a.status],
    ["Advised By", x.advisorName],
    ["Sport", a.sport],
    ["Position", a.position],
    ["Level", x.recruitTypeLabel ?? a.recruit_type],
    ["Class", d.gradYear, (v) => `Class of ${v}`],
    ["High School", d.highSchool],
    ["Current School", d.currentSchool],
    ["Current Division", d.currentDivision],
    ["Height", x.latestMetrics?.get("heightIn"), (v) => formatMetricValue("heightIn", Number(v))],
    ["Weight", x.latestMetrics?.get("weightLb"), (v) => formatMetricValue("weightLb", Number(v))],
    ["School GPA", a.gpa, (v) => `${num(v, 2)}${a.gpa_verified ? " (verified)" : ""}`],
    ["College GPA", d.collegeGpa, (v) => num(v, 2)],
    ["SAT", d.satTotal],
    ["ACT", d.actComposite],
    ["AP Courses", d.apCount],
    ["IB Courses", d.ibCount],
    ["Honors Courses", d.honorsCount],
    ["Dual Enrollment Courses", d.dualCount],
    ["Credit Hours Completed", d.creditHoursCompleted],
    ["Desired Major", d.desiredMajor],
    ["Eligibility Years Left", d.eligibilityYearsRemaining],
    ["Transfers So Far", d.transferCount],
    ["Portal Entry", d.portalEntryDate, (v) => x.date(String(v))],
    ["Degree Completed", d.degreeCompleted, (v) => (v ? "Yes" : "No")],
    ["NCAA Status", a.ncaa_eligibility_status],
    ["Date of Birth", a.date_of_birth, (v) => x.date(String(v))],
    ["Home State", a.home_state],
    ["International", a.is_international ? true : null, () => "Yes"],
    ["TOEFL", a.toefl_score],
    ["IELTS", a.ielts_score],
    ["F-1 Visa", a.f1_visa_status],
    ["Intended Enrollment", a.intended_enrollment, (v) => x.date(String(v))],
    ["First Full-Time Enrollment", a.first_full_time_enrollment, (v) => x.date(String(v))],
    ["Graduated", a.graduated_on, (v) => x.date(String(v))],
    ["Drafted By", a.draft_team],
    ["Draft Round", a.draft_round],
    ["Draft Year", a.draft_year],
    ["Recruiting Goal", x.goalLabel],
    ["Family Budget", a.family_budget_cents, (v) => `$${Math.round(Number(v) / 100).toLocaleString("en-US")} a year`],
  ];
  return rows.filter(([, v]) => present(v)).map(([label, v, fmt]) => ({ label, value: fmt ? fmt(v) : text(v) }));
}
