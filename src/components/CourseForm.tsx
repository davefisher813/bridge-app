"use client";

import { useActionState } from "react";
import type { CourseActionState } from "@/lib/actions/courses";
import { APPROVAL_CHOICES, APPROVAL_LABEL, COURSE_SUBJECT_LABEL, COURSE_SUBJECTS, type ApprovalChoice, type CourseSubject } from "@/lib/validation/course";
import { Button, CheckField, Field, Form, Grid2, SelectField, SuggestField, type Suggestion } from "@/components/kit";

// One transcript row, added or corrected by staff (audit crud F5). The
// grade, the term and the school suggest what is already on this
// athlete's transcript, so a fix is mostly picking rather than typing.

type ServerAction = (prevState: CourseActionState, formData: FormData) => Promise<CourseActionState>;

const EMPTY_STATE: CourseActionState = { errors: {} };

// The grades a transcript prints most. Anything else can be typed: a
// numeric grade, or a mark like P, W or CR.
const COMMON_GRADES = ["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "W"];

export interface CourseInitial {
  title: string;
  subject: CourseSubject;
  credit: number;
  grade: string;
  term: string | null;
  schoolName: string | null;
  weighted: boolean;
  approval: ApprovalChoice;
}

export function CourseForm({
  action,
  initial,
  terms,
  schools,
  submitLabel,
}: {
  action: ServerAction;
  initial?: CourseInitial;
  terms: string[];
  schools: Suggestion[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="title" label="Course" defaultValue={initial?.title ?? ""} maxLength={200} required error={state.errors.title} />
      <Grid2>
        <SelectField name="subject" label="Subject" defaultValue={initial?.subject ?? "english"} error={state.errors.subject}>
          {COURSE_SUBJECTS.map((s) => (
            <option key={s} value={s}>
              {COURSE_SUBJECT_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <SuggestField name="grade" label="Grade" defaultValue={initial?.grade ?? ""} maxLength={20} required suggestions={COMMON_GRADES} error={state.errors.grade} />
      </Grid2>
      <Grid2>
        <Field name="credit" label="Credit" type="number" inputMode="decimal" step="0.01" min="0" max="99.99" defaultValue={initial ? String(initial.credit) : "1"} required error={state.errors.credit} />
        <SuggestField name="term" label="Term" defaultValue={initial?.term ?? ""} maxLength={40} suggestions={terms} hint="As printed, like 25-26 S1." error={state.errors.term} />
      </Grid2>
      <SuggestField name="schoolName" label="School" defaultValue={initial?.schoolName ?? ""} maxLength={200} suggestions={schools} hint="The school that graded it. Its grading scale converts a numeric grade." error={state.errors.schoolName} />
      <SelectField name="approval" label="NCAA Approved" defaultValue={initial?.approval ?? "unchecked"} error={state.errors.approval}>
        {APPROVAL_CHOICES.map((a) => (
          <option key={a} value={a}>
            {APPROVAL_LABEL[a]}
          </option>
        ))}
      </SelectField>
      <CheckField name="weighted" label="Weighted" hint="Honors, AP, IB or advanced, by the course title." defaultChecked={initial?.weighted ?? false} />
      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
