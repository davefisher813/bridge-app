"use client";

import { useActionState } from "react";
import { OUTLOOKS, SCHOLARSHIP_TYPES, SCHOOL_DIVISIONS } from "@/lib/validation/school";
import { PROGRAM_TIERS, SPORTS } from "@/lib/fit/contract";
import { US_STATES } from "@/lib/lookup/states";
import type { SchoolActionState } from "@/lib/actions/schools";
import { Button, Field, Form, Grid2, Label, LinkButton, Notice, SelectField, Stack, SuggestField, TextAreaField } from "@/components/kit";

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
  location?: string;
  sportsSponsored?: string;
  gpaMin?: number;
  gpaAvg?: number;
  satRange?: string;
  actRange?: string;
  majorsNote?: string;
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

// The sports the app scores, named in the hint so a sponsored sport is
// typed the way the engine matches it.
const SPORT_NAMES = SPORTS.map((s) => s.key).join(", ");

export function SchoolForm({
  action,
  initialValues = {},
  submitLabel,
  slug,
  conferences = [],
}: {
  action: ServerAction;
  initialValues?: SchoolFormInitialValues;
  submitLabel: string;
  // For the link to a school already on file under the same name.
  slug?: string;
  // Every conference already on file, so a new school's conference is
  // picked in the spelling the directory filter already uses.
  conferences?: string[];
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const err = (key: string) => state.errors[key];
  const v = (key: keyof SchoolFormInitialValues) => {
    const x = initialValues[key];
    return x === undefined || x === null ? "" : String(x);
  };

  return (
    <Form action={formAction} error={state.errors.form}>
      {state.duplicateOf && (
        <Notice tone="warning" title="Already on File">
          {`${state.duplicateOf.name} is in the directory. Edit that one so every organization keeps one row for it.`}
        </Notice>
      )}
      {state.duplicateOf && slug && (
        <LinkButton href={`/org/${slug}/schools/${state.duplicateOf.id}`} variant="secondary">
          Open the School on File
        </LinkButton>
      )}
      <Field name="name" label="School Name" hint="For example, Test University." defaultValue={v("name")} error={err("name")} required />
      <Grid2>
        <SelectField name="division" label="Division" error={err("division")} defaultValue={v("division") || "D1"}>
          {SCHOOL_DIVISIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
        <SelectField name="programTier" label="Program Tier" hint="Blank follows the division." defaultValue={v("programTier")} error={err("programTier")}>
          <option value="">From Division</option>
          {PROGRAM_TIERS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Grid2>
        <SuggestField id="school-conference" name="conference" label="Conference" suggestions={conferences} hint="Pick one on file or type a new one." defaultValue={v("conference")} />
        <SelectField name="state" label="State" defaultValue={v("state")} error={err("state")}>
          <option value="">Not Recorded</option>
          {/* A code already on the row that is not a US state (a
              Canadian province, say) stays selectable, so an edit never
              drops it silently. */}
          {v("state") && !US_STATES.some((s) => s.code === v("state").toUpperCase()) && <option value={v("state")}>{v("state")}</option>}
          {US_STATES.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Field name="location" label="Town" hint="City and state, like Hartford, CT." defaultValue={v("location")} error={err("location")} />
      <Field name="sportsSponsored" label="Sports Sponsored" hint={`Comma separated, in the app's words: ${SPORT_NAMES}.`} defaultValue={v("sportsSponsored")} />
      <Field name="majors" label="Majors Offered" hint="Comma separated." defaultValue={v("majors")} />

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
        <TextAreaField name="majorsNote" label="Programs of Interest" hint="What this school offers in the fields your athletes ask about." rows={2} maxLength={500} defaultValue={v("majorsNote")} error={err("majorsNote")} />
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
        <TextAreaField name="positionDepth" label="Depth Chart Notes" rows={3} defaultValue={v("positionDepth")} />
      </Stack>

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
