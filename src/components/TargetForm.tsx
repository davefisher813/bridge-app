"use client";

import { useActionState, useState } from "react";
import { OFFER_TYPES, TARGET_STATUSES } from "@/lib/validation/target";
import type { TargetActionState } from "@/lib/actions/targets";
import { Button, Field, Form, Grid2, SelectField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: TargetActionState, formData: FormData) => Promise<TargetActionState>;

export interface TargetFormOption {
  id: string;
  label: string;
}

export interface TargetFormInitialValues {
  athleteId?: string;
  schoolId?: string;
  status?: string;
  coachName?: string;
  notes?: string;
  visitDate?: string;
  offerType?: string;
  offerScholarshipPercent?: number;
}

const OFFER_TYPE_LABEL: Record<(typeof OFFER_TYPES)[number], string> = {
  scholarship: "Scholarship",
  written: "Written (non-scholarship)",
  verbal: "Verbal",
  preferred_walk_on: "Preferred walk-on",
  admission_only: "Admission only",
  walk_on: "Walk-on",
};

const EMPTY_STATE: TargetActionState = { errors: {} };

export function TargetForm({
  action,
  athletes,
  schools,
  initialValues = {},
  submitLabel,
}: {
  action: ServerAction;
  athletes: TargetFormOption[];
  schools: TargetFormOption[];
  initialValues?: TargetFormInitialValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const [offerType, setOfferType] = useState<string>(initialValues.offerType ?? "");

  return (
    <Form action={formAction} error={state.errors.form}>
      <SelectField name="athleteId" label="Athlete" error={err("athleteId")} defaultValue={initialValues.athleteId ?? ""} required>
        <option value="" disabled>
          Select an athlete
        </option>
        {athletes.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </SelectField>

      <SelectField name="schoolId" label="School" error={err("schoolId")} defaultValue={initialValues.schoolId ?? ""} required>
        <option value="" disabled>
          Select a school
        </option>
        {schools.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </SelectField>

      <Grid2>
        <SelectField name="status" label="Status" defaultValue={initialValues.status ?? "Target"}>
          {TARGET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
        <Field name="coachName" label="Coach" defaultValue={initialValues.coachName ?? ""} placeholder="T. Reilly" />
      </Grid2>

      <Field name="visitDate" label="Visit date" type="date" defaultValue={initialValues.visitDate ?? ""} hint="Shows up on Today once set." />

      <SelectField
        name="offerType"
        label="Offer"
        value={offerType}
        onChange={(e) => setOfferType(e.target.value)}
        hint="Separate from status. This is the actual offer on file, not the pipeline stage."
      >
        <option value="">No offer yet</option>
        {OFFER_TYPES.map((t) => (
          <option key={t} value={t}>
            {OFFER_TYPE_LABEL[t]}
          </option>
        ))}
      </SelectField>

      {offerType === "scholarship" && (
        <Field
          name="offerScholarshipPercent"
          label="Scholarship percent"
          type="number"
          min="0"
          max="100"
          inputMode="numeric"
          error={err("offerScholarshipPercent")}
          defaultValue={initialValues.offerScholarshipPercent ?? ""}
        />
      )}

      <TextAreaField name="notes" label="Notes" defaultValue={initialValues.notes ?? ""} />

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
