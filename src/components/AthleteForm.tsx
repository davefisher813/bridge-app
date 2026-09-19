"use client";

import { useActionState, useState } from "react";
import { RECRUIT_TYPES, ATHLETE_STATUSES } from "@/lib/validation/athlete";
import type { AthleteActionState } from "@/lib/actions/athletes";
import type { RecruitType } from "@/lib/fit/types";
import { Button, CheckField, Field, Form, Grid2, Label, SelectField, Stack } from "@/components/kit";

type ServerAction = (prevState: AthleteActionState, formData: FormData) => Promise<AthleteActionState>;

export interface AthleteFormInitialValues {
  name?: string;
  sport?: string;
  position?: string;
  recruitType?: RecruitType;
  gpa?: number;
  gpaVerified?: boolean;
  status?: string;
  isInternational?: boolean;
  toeflScore?: number;
  ieltsScore?: number;
  f1VisaStatus?: string;
  ncaaEligibilityStatus?: string;
  // hs detail
  gradYear?: number;
  apCount?: number;
  ibCount?: number;
  honorsCount?: number;
  dualCount?: number;
  satTotal?: number;
  actComposite?: number;
  desiredMajor?: string;
  // transfer detail
  currentSchool?: string;
  currentDivision?: string;
  collegeGpa?: number;
  creditHoursCompleted?: number;
  eligibilityYearsRemaining?: number;
  portalEntryDate?: string;
  transferCount?: number;
  degreeCompleted?: boolean;
}

const EMPTY_STATE: AthleteActionState = { errors: {}, values: {} };

// What a field shows: what the server sent back after a failed submit,
// else what the record holds, else nothing.
function field(state: AthleteActionState, initial: AthleteFormInitialValues, key: string): string {
  const fromState = state.values[key];
  if (fromState !== undefined) return String(fromState);
  const fromInitial = (initial as Record<string, unknown>)[key];
  return fromInitial === undefined || fromInitial === null ? "" : String(fromInitial);
}

export function AthleteForm({ action, initialValues = {}, submitLabel }: { action: ServerAction; initialValues?: AthleteFormInitialValues; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [recruitType, setRecruitType] = useState<RecruitType>((state.values.recruitType as RecruitType) || initialValues.recruitType || "hs");
  const [isInternational, setIsInternational] = useState<boolean>(
    state.values.isInternational !== undefined ? state.values.isInternational === "on" : !!initialValues.isInternational
  );

  const isTransfer = recruitType !== "hs";
  const f = (key: string) => field(state, initialValues, key);
  const err = (key: string) => state.errors[key];

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" defaultValue={f("name")} placeholder="Jose Ulloa" required error={err("name")} />
      <Grid2>
        <Field name="sport" label="Sport" defaultValue={f("sport")} placeholder="Baseball" required error={err("sport")} />
        <Field name="position" label="Position" defaultValue={f("position")} placeholder="RHP" />
      </Grid2>
      <SelectField name="recruitType" label="Recruit type" value={recruitType} onChange={(e) => setRecruitType(e.target.value as RecruitType)}>
        {RECRUIT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </SelectField>
      <Grid2>
        <Field name="gpa" label="GPA" type="number" step="0.01" min="0" max="4" inputMode="decimal" defaultValue={f("gpa")} error={err("gpa")} />
        <SelectField name="status" label="Status" defaultValue={f("status") || "Active"}>
          {ATHLETE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <CheckField name="gpaVerified" label="GPA verified" defaultChecked={f("gpaVerified") === "on" || !!initialValues.gpaVerified} />

      {recruitType === "hs" ? (
        <Stack gap={3}>
          <Label caps>High school details</Label>
          <Grid2>
            <Field name="gradYear" label="Grad year" type="number" inputMode="numeric" defaultValue={f("gradYear")} placeholder="2027" />
            <Field name="desiredMajor" label="Desired major" defaultValue={f("desiredMajor")} />
          </Grid2>
          <Grid2>
            <Field name="satTotal" label="SAT total" type="number" inputMode="numeric" defaultValue={f("satTotal")} error={err("satTotal")} />
            <Field name="actComposite" label="ACT composite" type="number" inputMode="numeric" defaultValue={f("actComposite")} error={err("actComposite")} />
          </Grid2>
          <Grid2>
            <Field name="apCount" label="AP courses" type="number" min="0" inputMode="numeric" defaultValue={f("apCount")} />
            <Field name="ibCount" label="IB courses" type="number" min="0" inputMode="numeric" defaultValue={f("ibCount")} />
          </Grid2>
          <Grid2>
            <Field name="honorsCount" label="Honors courses" type="number" min="0" inputMode="numeric" defaultValue={f("honorsCount")} />
            <Field name="dualCount" label="Dual enrollment" type="number" min="0" inputMode="numeric" defaultValue={f("dualCount")} />
          </Grid2>
        </Stack>
      ) : (
        <Stack gap={3}>
          <Label caps>Transfer details</Label>
          <Field name="currentSchool" label="Current school" defaultValue={f("currentSchool")} required={isTransfer} error={err("currentSchool")} />
          <Grid2>
            <Field name="currentDivision" label="Current division" defaultValue={f("currentDivision")} placeholder="D1" />
            <Field name="collegeGpa" label="College GPA" type="number" step="0.01" min="0" max="4" inputMode="decimal" defaultValue={f("collegeGpa")} />
          </Grid2>
          <Grid2>
            <Field
              name="eligibilityYearsRemaining"
              label="Eligibility years left"
              type="number"
              step="0.5"
              min="0"
              max="5"
              inputMode="decimal"
              defaultValue={f("eligibilityYearsRemaining")}
              required={isTransfer}
              error={err("eligibilityYearsRemaining")}
            />
            <Field name="transferCount" label="Prior transfers" type="number" min="0" inputMode="numeric" defaultValue={f("transferCount") || "0"} error={err("transferCount")} />
          </Grid2>
          <Grid2>
            <Field name="creditHoursCompleted" label="Credit hours completed" type="number" min="0" inputMode="numeric" defaultValue={f("creditHoursCompleted")} />
            <Field name="portalEntryDate" label="Portal entry date" type="date" defaultValue={f("portalEntryDate")} />
          </Grid2>
          <Field id="desiredMajorTransfer" name="desiredMajor" label="Desired major" defaultValue={f("desiredMajor")} />
          {recruitType === "transfer_grad" && (
            <CheckField name="degreeCompleted" label="Degree completed" defaultChecked={f("degreeCompleted") === "on" || !!initialValues.degreeCompleted} />
          )}
        </Stack>
      )}

      <CheckField name="isInternational" label="International athlete" checked={isInternational} onChange={(e) => setIsInternational(e.target.checked)} />

      {isInternational && (
        <Stack gap={3}>
          <Label caps>International</Label>
          <Grid2>
            <Field name="toeflScore" label="TOEFL" type="number" min="0" max="120" inputMode="numeric" defaultValue={f("toeflScore")} error={err("toeflScore")} />
            <Field name="ieltsScore" label="IELTS" type="number" step="0.5" min="0" max="9" inputMode="decimal" defaultValue={f("ieltsScore")} error={err("ieltsScore")} />
          </Grid2>
          <Field name="f1VisaStatus" label="F-1 visa status" defaultValue={f("f1VisaStatus")} />
          <Field name="ncaaEligibilityStatus" label="NCAA Eligibility Center status" defaultValue={f("ncaaEligibilityStatus")} />
        </Stack>
      )}

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
