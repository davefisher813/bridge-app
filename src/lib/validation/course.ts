import { z } from "zod";

// One row of an athlete's transcript (athlete_courses, migration 0008),
// typed or corrected by staff. The limits are the columns' own and the
// same ones a transcript applied from a document is clamped to
// (src/lib/actions/documents.ts), so a row typed here and a row read off
// a page can never disagree about what fits.

export const COURSE_SUBJECTS = ["english", "math", "science", "social_science", "other_academic", "non_academic"] as const;
export type CourseSubject = (typeof COURSE_SUBJECTS)[number];

export const COURSE_SUBJECT_LABEL: Record<CourseSubject, string> = {
  english: "English",
  math: "Math",
  science: "Science",
  social_science: "Social Science",
  other_academic: "Other Academic",
  non_academic: "Not Academic",
};

// athlete_courses.credit is numeric(4,2): 0.00 to 99.99.
export const MAX_COURSE_CREDIT = 99.99;
export const MAX_COURSE_TITLE = 200;
export const MAX_COURSE_GRADE = 20;
export const MAX_COURSE_TERM = 40;
export const MAX_COURSE_SCHOOL = 200;

export function isCourseSubject(v: unknown): v is CourseSubject {
  return typeof v === "string" && (COURSE_SUBJECTS as readonly string[]).includes(v);
}

// A credit that fits the column. Anything that is not a finite number is
// zero, the row that carries no weight, rather than a failed batch.
export function clampCredit(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_COURSE_CREDIT, Math.round(n * 100) / 100));
}

// NCAA approval as a staff member sets it by hand: unknown, yes or no.
export const APPROVAL_CHOICES = ["unchecked", "approved", "not_approved"] as const;
export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];

export const APPROVAL_LABEL: Record<ApprovalChoice, string> = {
  unchecked: "Not Checked",
  approved: "Approved",
  not_approved: "Not Approved",
};

export function approvalChoiceOf(v: boolean | null): ApprovalChoice {
  return v === true ? "approved" : v === false ? "not_approved" : "unchecked";
}

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v));

export const courseSchema = z.object({
  title: z.string().trim().min(1, "Give the course its title as printed.").max(MAX_COURSE_TITLE, `Keep the title under ${MAX_COURSE_TITLE} characters.`),
  subject: z.enum(COURSE_SUBJECTS, { errorMap: () => ({ message: "Pick a subject." }) }),
  credit: z.coerce
    .number({ invalid_type_error: "Credit is a number, like 1 or 0.5." })
    .finite("Credit is a number, like 1 or 0.5.")
    .min(0, "Credit can't be negative.")
    .max(MAX_COURSE_CREDIT, `Credit is at most ${MAX_COURSE_CREDIT}.`),
  grade: z.string().trim().min(1, "Type the grade as printed: a letter, a number, or a mark like P or W.").max(MAX_COURSE_GRADE, `Keep the grade under ${MAX_COURSE_GRADE} characters.`),
  term: z.string().trim().max(MAX_COURSE_TERM, `Keep the term under ${MAX_COURSE_TERM} characters.`).optional(),
  schoolName: z.string().trim().max(MAX_COURSE_SCHOOL, `Keep the school under ${MAX_COURSE_SCHOOL} characters.`).optional(),
  weighted: z.boolean(),
  approval: z.enum(APPROVAL_CHOICES, { errorMap: () => ({ message: "Pick whether the NCAA approves it." }) }),
});

export type CourseFormValues = z.infer<typeof courseSchema>;

export interface CourseFormResult {
  ok: boolean;
  values: CourseFormValues | null;
  errors: Record<string, string>;
}

export function parseCourseForm(formData: FormData): CourseFormResult {
  const input = {
    title: String(formData.get("title") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    credit: String(formData.get("credit") ?? "").trim() === "" ? Number.NaN : String(formData.get("credit")),
    grade: String(formData.get("grade") ?? ""),
    term: strOrUndef(formData.get("term")),
    schoolName: strOrUndef(formData.get("schoolName")),
    weighted: formData.get("weighted") === "on" || formData.get("weighted") === "true",
    approval: String(formData.get("approval") ?? "unchecked"),
  };
  const result = courseSchema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = String(issue.path[0]);
      if (!errors[key]) errors[key] = issue.message;
    }
    return { ok: false, values: null, errors };
  }
  return { ok: true, values: result.data, errors: {} };
}

// The columns a parsed form writes. approval_source says who settled the
// NCAA question: a hand-set answer is 'manual', and clearing it clears
// the source too, so a screen never claims a list decided something.
export function courseColumns(v: CourseFormValues): Record<string, unknown> {
  return {
    title: v.title,
    subject: v.subject,
    credit: clampCredit(v.credit),
    grade: v.grade,
    term: v.term ?? null,
    school_name: v.schoolName ?? null,
    weighted: v.weighted,
    ncaa_approved: v.approval === "approved" ? true : v.approval === "not_approved" ? false : null,
    approval_source: v.approval === "unchecked" ? null : "manual",
  };
}
