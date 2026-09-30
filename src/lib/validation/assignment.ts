import { z } from "zod";
import { ASSIGNMENT_CATEGORIES, ASSIGNMENT_KINDS, ASSIGNMENT_TEXT_MAX, ASSIGNMENT_TITLE_MAX, REVIEW_DECISIONS, type ReviewDecision } from "@/lib/data/assignments";

// The forms of migration 0046's assignments: an Admin's new assignment,
// an Admin's review, and the note an Athlete login sends with a
// submission. The database holds the same limits; these say so first.

const strOrUndef = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v));

function failed(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) errors[String(issue.path[0] ?? "form")] = issue.message;
  return errors;
}

export const assignmentSchema = z.object({
  title: z.string().trim().min(1, "Give it a title.").max(ASSIGNMENT_TITLE_MAX, `Keep the title under ${ASSIGNMENT_TITLE_MAX} characters.`),
  instructions: z.string().trim().max(ASSIGNMENT_TEXT_MAX, "Keep the instructions under 4,000 characters.").optional(),
  category: z.enum(ASSIGNMENT_CATEGORIES, { errorMap: () => ({ message: "Pick a category." }) }),
  kind: z.enum(ASSIGNMENT_KINDS, { errorMap: () => ({ message: "Pick what you are asking for." }) }),
  // A real calendar day. A date in the past is allowed: it is how an
  // Admin records work that was already due.
  dueOn: z.string().date("Pick a real date.").optional(),
});

export type AssignmentFormValues = z.infer<typeof assignmentSchema>;

export interface AssignmentFormResult {
  ok: boolean;
  values: AssignmentFormValues | null;
  errors: Record<string, string>;
}

export function parseAssignmentForm(formData: FormData): AssignmentFormResult {
  const input = {
    title: String(formData.get("title") ?? ""),
    instructions: strOrUndef(formData.get("instructions")),
    category: String(formData.get("category") || "other"),
    kind: String(formData.get("kind") || "other"),
    dueOn: strOrUndef(formData.get("dueOn")),
  };
  const result = assignmentSchema.safeParse(input);
  if (!result.success) return { ok: false, values: null, errors: failed(result.error) };
  return { ok: true, values: result.data, errors: {} };
}

// A review: Complete needs nothing (a comment is optional), Needs
// Revision needs the comment that says what to change.
export interface ReviewResult {
  ok: boolean;
  decision: ReviewDecision | null;
  comment: string | null;
  errors: Record<string, string>;
}

export function parseReview(decision: string, comment: string | null | undefined): ReviewResult {
  if (!(REVIEW_DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, decision: null, comment: null, errors: { form: "Choose Complete or Needs Revision." } };
  }
  const text = (comment ?? "").trim();
  if (text.length > ASSIGNMENT_TEXT_MAX) {
    return { ok: false, decision: decision as ReviewDecision, comment: text, errors: { comment: "Keep the comment under 4,000 characters." } };
  }
  if (decision === "needs_revision" && !text) {
    return { ok: false, decision: "needs_revision", comment: null, errors: { comment: "Say what needs to change." } };
  }
  return { ok: true, decision: decision as ReviewDecision, comment: text || null, errors: {} };
}

// The note a family sends with a submission.
export const submissionNoteSchema = z.string().trim().max(ASSIGNMENT_TEXT_MAX, "Keep the note under 4,000 characters.");

export function parseSubmissionNote(value: FormDataEntryValue | null): { ok: boolean; note: string | null; errors: Record<string, string> } {
  const result = submissionNoteSchema.safeParse(String(value ?? ""));
  if (!result.success) return { ok: false, note: null, errors: { note: result.error.issues[0]?.message ?? "Keep the note shorter." } };
  return { ok: true, note: result.data || null, errors: {} };
}
