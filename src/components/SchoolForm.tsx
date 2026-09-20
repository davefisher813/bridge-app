"use client";

import { useActionState } from "react";
import { OUTLOOKS, SCHOLARSHIP_TYPES, SCHOOL_DIVISIONS } from "@/lib/validation/school";
import { PROGRAM_TIERS } from "@/lib/fit/contract";
import type { SchoolActionState } from "@/lib/actions/schools";
import { Button, Field, Form, Grid2, Label, SelectField, Stack, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: SchoolActionState, formData: FormData) => Promise<SchoolActionState>;

const EMPTY_STATE: SchoolActionState = { errors: {} };

// Every shared fact on a school, the same fields the CSV template
// carries (docs/MATCHING_CONTRACT.md section 4). Owner-only: the row is
// read by every organization.
export interface SchoolFormInitialValues {
  name?: string;
  division?: string;
  programTier?: string;
  conference?: string;
  state?: string;
  sportsSponsored?: string;
  gpaMin?: number;
  gpaAvg?: number;
  satRange?: string;
  actRange?: string;
  athleticScholarship?: string;
  avgAthleticAid?: number;
  avgMeritAid?: number;
  avgNeedAid?: number;
  instateTotal?: number;
  outstateTotal?: number;
  rosterSpotsOpen?: number;
  playingTimeOutlook?: string;
  positionDepth?: string;
  majors?: string;
}

const AID_LABEL: Record<string, string> = { full: "Full Scholarships", partial: "Partial Scholarships", none: "No Athletic Aid" };
const OUTLOOK_LABEL: Record<string, string> = { realistic: "Realistic", competitive: "Competitive", difficult: "Difficult" };

export function SchoolForm({ action, initialValues = {}, submitLabel }: { action: ServerAction; initialValues?: SchoolFormInitialValues; submitLabel: string }) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const v = (key: keyof SchoolFormInitialValues) => {
    const x = initialValues[key];
    return x === undefined || x === null ? "" : String(x);
  };

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="School Name" hint="For example, Test University." defaultValue={v("name")} error={err("name")} required />
      <Grid2>
        <SelectField name="division" label="Division" error={err("division")} defaultValue={v("division") || "D1"}>
          {SCHOOL_DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
        <SelectField name="programTier" label="Program Tier" hint="Sets the athletic benchmarks. Blank follows the division." defaultValue={v("programTier")} error={err("programTier")}>
          <option value="">From Division</option>
          {PROGRAM_TIERS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Grid2>
        <Field name="conference" label="Conference" hint="For example, Ivy League." defaultValue={v("conference")} />
        <Field name="state" label="State" hint="Two letters, like CT." maxLength={2} autoCapitalize="characters" defaultValue={v("state")} error={err("state")} />
      </Grid2>
      <Field name="sportsSponsored" label="Sports Sponsored" hint="Comma separated." defaultValue={v("sportsSponsored")} />
      <Field name="majors" label="Majors Offered" hint="Comma separated. Filters the matches screen." defaultValue={v("majors")} />

      <Stack gap={3}>
        <Label caps>Academics</Label>
        <Grid2>
          <Field name="gpaMin" label="GPA Minimum" type="number" step="0.01" min="0" max="4" inputMode="decimal" defaultValue={v("gpaMin")} error={err("gpaMin")} />
          <Field name="gpaAvg" label="GPA Average" type="number" step="0.01" min="0" max="4" inputMode="decimal" defaultValue={v("gpaAvg")} error={err("gpaAvg")} />
        </Grid2>
        <Grid2>
          <Field name="satRange" label="SAT Range" hint="For example, 1150-1320." defaultValue={v("satRange")} />
          <Field name="actRange" label="ACT Range" hint="For example, 24-29." defaultValue={v("actRange")} />
        </Grid2>
      </Stack>

      <Stack gap={3}>
        <Label caps>Money</Label>
        <SelectField name="athleticScholarship" label="Athletic Scholarships" hint="A D3 school cannot offer any." defaultValue={v("athleticScholarship")} error={err("athleticScholarship")}>
          <option value="">Not Recorded</option>
          {SCHOLARSHIP_TYPES.map((t) => (
            <option key={t} value={t}>
              {AID_LABEL[t]}
            </option>
          ))}
        </SelectField>
        <Grid2>
          <Field name="instateTotal" label="Cost in State" hint="Dollars a year, before aid." type="number" min="0" step="100" inputMode="numeric" defaultValue={v("instateTotal")} error={err("instateTotal")} />
          <Field name="outstateTotal" label="Cost Out of State" hint="Dollars a year, before aid." type="number" min="0" step="100" inputMode="numeric" defaultValue={v("outstateTotal")} error={err("outstateTotal")} />
        </Grid2>
        <Grid2>
          <Field name="avgAthleticAid" label="Average Athletic Aid" type="number" min="0" step="100" inputMode="numeric" defaultValue={v("avgAthleticAid")} error={err("avgAthleticAid")} />
          <Field name="avgMeritAid" label="Average Merit Aid" type="number" min="0" step="100" inputMode="numeric" defaultValue={v("avgMeritAid")} error={err("avgMeritAid")} />
        </Grid2>
        <Field name="avgNeedAid" label="Average Need Aid" type="number" min="0" step="100" inputMode="numeric" defaultValue={v("avgNeedAid")} error={err("avgNeedAid")} />
      </Stack>

      <Stack gap={3}>
        <Label caps>Program</Label>
        <Grid2>
          <Field name="rosterSpotsOpen" label="Roster Spots Open" type="number" min="0" inputMode="numeric" defaultValue={v("rosterSpotsOpen")} error={err("rosterSpotsOpen")} />
          <SelectField name="playingTimeOutlook" label="Playing Time" defaultValue={v("playingTimeOutlook")} error={err("playingTimeOutlook")}>
            <option value="">Not Recorded</option>
            {OUTLOOKS.map((o) => (
              <option key={o} value={o}>
                {OUTLOOK_LABEL[o]}
              </option>
            ))}
          </SelectField>
        </Grid2>
        <TextAreaField name="positionDepth" label="Depth Chart Notes" hint="What the depth looks like at each position." rows={3} defaultValue={v("positionDepth")} />
      </Stack>

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
