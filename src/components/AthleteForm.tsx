"use client";

import { useActionState, useState } from "react";
import { RECRUIT_TYPES, ATHLETE_STATUSES, ATHLETE_GOALS } from "@/lib/validation/athlete";
import { GRADE_KEYS, GRADE_LABEL, GRADE_MAX, GRADE_MIN } from "@/lib/fit/contract";
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
  // matching (migration 0021)
  goal?: string;
  familyBudget?: number;
  homeState?: string;
  frame?: number;
  athleticism?: number;
  skill?: number;
  iq?: number;
  competitiveness?: number;
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
      <Field name="name" label="Name" hint="For example, Jose Ulloa." defaultValue={f("name")} required error={err("name")} />
      <Grid2>
        <Field name="sport" label="Sport" hint="For example, Baseball." defaultValue={f("sport")} required error={err("sport")} />
        <Field name="position" label="Position" hint="For example, RHP." defaultValue={f("position")} />
      </Grid2>
      <SelectField name="recruitType" label="Recruit Type" value={recruitType} onChange={(e) => setRecruitType(e.target.value as RecruitType)}>
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
      <CheckField name="gpaVerified" label="GPA Verified" defaultChecked={f("gpaVerified") === "on" || !!initialValues.gpaVerified} />

      {recruitType === "hs" ? (
        <Stack gap={3}>
          <Label caps>High school details</Label>
          <Grid2>
            <Field name="gradYear" label="Grad Year" hint="For example, 2027." type="number" inputMode="numeric" defaultValue={f("gradYear")} />
            <Field name="desiredMajor" label="Desired Major" defaultValue={f("desiredMajor")} />
          </Grid2>
          <Grid2>
            <Field name="satTotal" label="SAT Total" type="number" inputMode="numeric" defaultValue={f("satTotal")} error={err("satTotal")} />
            <Field name="actComposite" label="ACT Composite" type="number" inputMode="numeric" defaultValue={f("actComposite")} error={err("actComposite")} />
          </Grid2>
          <Grid2>
            <Field name="apCount" label="AP Courses" type="number" min="0" inputMode="numeric" defaultValue={f("apCount")} />
            <Field name="ibCount" label="IB Courses" type="number" min="0" inputMode="numeric" defaultValue={f("ibCount")} />
          </Grid2>
          <Grid2>
            <Field name="honorsCount" label="Honors Courses" type="number" min="0" inputMode="numeric" defaultValue={f("honorsCount")} />
            <Field name="dualCount" label="Dual Enrollment" type="number" min="0" inputMode="numeric" defaultValue={f("dualCount")} />
          </Grid2>
        </Stack>
      ) : (
        <Stack gap={3}>
          <Label caps>Transfer details</Label>
          <Field name="currentSchool" label="Current School" defaultValue={f("currentSchool")} required={isTransfer} error={err("currentSchool")} />
          <Grid2>
            <Field name="currentDivision" label="Current Division" hint="For example, D1." defaultValue={f("currentDivision")} />
            <Field name="collegeGpa" label="College GPA" type="number" step="0.01" min="0" max="4" inputMode="decimal" defaultValue={f("collegeGpa")} />
          </Grid2>
          <Grid2>
            <Field
              name="eligibilityYearsRemaining"
              label="Eligibility Years Left"
              type="number"
              step="0.5"
              min="0"
              max="5"
              inputMode="decimal"
              defaultValue={f("eligibilityYearsRemaining")}
              required={isTransfer}
              error={err("eligibilityYearsRemaining")}
            />
            <Field name="transferCount" label="Prior Transfers" type="number" min="0" inputMode="numeric" defaultValue={f("transferCount") || "0"} error={err("transferCount")} />
          </Grid2>
          <Grid2>
            <Field name="creditHoursCompleted" label="Credit Hours Completed" type="number" min="0" inputMode="numeric" defaultValue={f("creditHoursCompleted")} />
            <Field name="portalEntryDate" label="Portal Entry Date" type="date" defaultValue={f("portalEntryDate")} />
          </Grid2>
          <Field id="desiredMajorTransfer" name="desiredMajor" label="Desired Major" defaultValue={f("desiredMajor")} />
          {recruitType === "transfer_grad" && (
            <CheckField name="degreeCompleted" label="Degree Completed" defaultChecked={f("degreeCompleted") === "on" || !!initialValues.degreeCompleted} />
          )}
        </Stack>
      )}

      {/* docs/MATCHING_CONTRACT.md: the goal shifts the blend, the budget
          drives the money score, the home state picks in-state cost. */}
      <Stack gap={3}>
        <Label caps>Goal and money</Label>
        <SelectField name="goal" label="Goal" hint="Education First leans the score toward academics; Development First toward the program." defaultValue={f("goal") || "balanced"}>
          {ATHLETE_GOALS.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </SelectField>
        <Grid2>
          <Field name="familyBudget" label="Family Budget per Year" hint="Dollars, after aid." type="number" min="0" step="100" inputMode="numeric" defaultValue={f("familyBudget")} error={err("familyBudget")} />
          <Field name="homeState" label="Home State" hint="Two letters, like CT." maxLength={2} autoCapitalize="characters" defaultValue={f("homeState")} error={err("homeState")} />
        </Grid2>
      </Stack>

      {/* Five grades on the 20 to 80 scouting scale. They blend into the
          athletic score by position group; blank means metrics alone. */}
      <Stack gap={3}>
        <Label caps>Staff assessment</Label>
        <Grid2>
          {GRADE_KEYS.map((k) => (
            <Field key={k} name={k} label={GRADE_LABEL[k]} type="number" min={GRADE_MIN} max={GRADE_MAX} step="5" inputMode="numeric" defaultValue={f(k)} error={err(k)} />
          ))}
        </Grid2>
        <Label>{`The ${GRADE_MIN} to ${GRADE_MAX} scale. 50 is average for the level; leave blank to score on metrics alone.`}</Label>
      </Stack>

      <CheckField name="isInternational" label="International Athlete" checked={isInternational} onChange={(e) => setIsInternational(e.target.checked)} />

      {isInternational && (
        <Stack gap={3}>
          <Label caps>International</Label>
          <Grid2>
            <Field name="toeflScore" label="TOEFL" type="number" min="0" max="120" inputMode="numeric" defaultValue={f("toeflScore")} error={err("toeflScore")} />
            <Field name="ieltsScore" label="IELTS" type="number" step="0.5" min="0" max="9" inputMode="decimal" defaultValue={f("ieltsScore")} error={err("ieltsScore")} />
          </Grid2>
          <Field name="f1VisaStatus" label="F-1 Visa Status" defaultValue={f("f1VisaStatus")} />
          <Field name="ncaaEligibilityStatus" label="NCAA Eligibility Center Status" defaultValue={f("ncaaEligibilityStatus")} />
        </Stack>
      )}

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
