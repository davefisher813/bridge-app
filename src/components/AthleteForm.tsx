"use client";

import { useActionState, useState } from "react";
import { RECRUIT_TYPES, ATHLETE_STATUSES, ATHLETE_GOALS } from "@/lib/validation/athlete";
import { GRADE_KEYS, GRADE_MAX, GRADE_MIN, SOURCES, SPORTS, gradeLabel, sportSpec } from "@/lib/fit/contract";
import { metricsFor, positionGroupOf } from "@/lib/fit";
import type { AthleteActionState } from "@/lib/actions/athletes";
import type { RecruitType } from "@/lib/fit/types";
import type { CollegeOption, HighSchoolOption } from "@/lib/data/lookups";
import { pickUnique } from "@/lib/lookup/nameKey";
import { US_STATES } from "@/lib/lookup/states";
import { F1_VISA_STATUSES, NCAA_ELIGIBILITY_STATUSES, positionsOf } from "@/lib/lookup/picklists";
import { isClosedStatus, isPlacedStatus } from "@/lib/placement";
import { Button, CheckField, Field, Form, Grid2, Hidden, Label, LinkButton, Notice, SelectField, Stack, SuggestField, TextAreaField } from "@/components/kit";

type ServerAction = (prevState: AthleteActionState, formData: FormData) => Promise<AthleteActionState>;

export interface AthleteFormInitialValues {
  name?: string;
  sport?: string;
  position?: string;
  recruitType?: RecruitType;
  gpa?: number;
  gpaVerified?: boolean;
  status?: string;
  // The owner or staff member who checks in (migration 0039).
  advisorId?: string;
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
  highSchool?: string;
  highSchoolId?: string;
  // transfer detail
  currentSchool?: string;
  currentDivision?: string;
  collegeGpa?: number;
  creditHoursCompleted?: number;
  eligibilityYearsRemaining?: number;
  portalEntryDate?: string;
  transferCount?: number;
  degreeCompleted?: boolean;
  currentSchoolId?: string;
  // Corrections to a date Mark Enrolled or Mark Graduated already set
  // (audit crud F8). Only on Edit, only when the date is correctable.
  enrollmentDate?: string;
  graduatedOn?: string;
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

// `advisors` is the org's owners and staff (src/lib/data/staff.ts), the
// only people the database lets advise. A record whose advisor is no
// longer among them shows Nobody Yet, and saving clears it.
//
// `firstMetrics` puts a First Metrics section on the form (the Add
// screen): the sport's metrics, one date, one source, each number
// logged as a dated entry when the athlete is saved. The Edit screen
// leaves it out; the Metrics screen is the log there.
//
// `options` are the suggestion lists (src/lib/data/athleteFormOptions.ts).
// A pick fills Home State and Current Division only when they are blank,
// and never overwrites a value; the server does the same fill again, so
// a pick that never reached the client still counts (Stage 4).
//
// `editing` turns Notes into Add a Note: every note is a dated entry in
// the athlete's staff-only log, never one box rewritten on every save.
// `dates` shows the NCAA clock dates that may be corrected here; setting
// one the first time is Mark Enrolled's or Mark Graduated's job.
export interface AthleteFormOptionLists {
  highSchools: HighSchoolOption[];
  colleges: CollegeOption[];
  majors: string[];
  sourceDetails: string[];
}

// The statuses a hand edit on Edit can reach from where the athlete is
// now, by the rules updateAthlete enforces, so the dropdown never offers
// a choice the save would refuse. Committed is the Targets board's;
// Enrolled, Graduated and Drafted are Mark Enrolled, Mark Graduated and
// Mark Drafted on the athlete page; a placed athlete leaves through
// Reopen Recruiting, so Enrolled, Graduated and Drafted keep only
// themselves and Committed cannot jump to Transferring. The current
// status is always offered, so a save that changes something else
// never trips over it. src/laws/integrityLaws.test.ts holds the two
// sides together.
const HAND_EDIT_BLOCKED = ["Committed", "Enrolled", "Graduated", "Drafted"];

function handEditStatuses(current: string): string[] {
  const reachable = ATHLETE_STATUSES.filter((next) => {
    if (next === current) return true;
    if (HAND_EDIT_BLOCKED.includes(next)) return false;
    if (isClosedStatus(current)) return false;
    if (next === "Transferring" && isPlacedStatus(current)) return false;
    return true;
  });
  return (ATHLETE_STATUSES as readonly string[]).includes(current) ? reachable : [current, ...reachable];
}

const NO_OPTIONS: AthleteFormOptionLists = { highSchools: [], colleges: [], majors: [], sourceDetails: [] };

export function AthleteForm({
  action,
  initialValues = {},
  submitLabel,
  firstMetrics = false,
  advisors = [],
  options = NO_OPTIONS,
  editing = false,
  dates = { enrollment: false, graduated: false },
}: {
  action: ServerAction;
  initialValues?: AthleteFormInitialValues;
  submitLabel: string;
  firstMetrics?: boolean;
  advisors?: { id: string; name: string }[];
  options?: AthleteFormOptionLists;
  editing?: boolean;
  dates?: { enrollment: boolean; graduated: boolean };
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [recruitType, setRecruitType] = useState<RecruitType>((state.values.recruitType as RecruitType) || initialValues.recruitType || "hs");
  const [isInternational, setIsInternational] = useState<boolean>(
    state.values.isInternational !== undefined ? state.values.isInternational === "on" : !!initialValues.isInternational
  );

  const isTransfer = recruitType !== "hs";
  const f = (key: string) => field(state, initialValues, key);
  const err = (key: string) => state.errors[key];
  // Add offers every status; Edit only the ones a hand edit can reach
  // from the status on file (not whatever a refused save sent back).
  const statusOptions: readonly string[] = editing && initialValues.status ? handEditStatuses(initialValues.status) : ATHLETE_STATUSES;

  // The sport picks the IQ label and the position hint. A record whose
  // sport is not one the engine knows keeps its own word as an option,
  // so an edit never silently changes it.
  const [sport, setSport] = useState<string>(f("sport") || "Baseball");
  const [position, setPosition] = useState<string>(f("position"));
  const sportOptions = SPORTS.map((s) => s.label);
  if (sport && !sportOptions.includes(sport)) sportOptions.push(sport);
  const positions = sportSpec(sport)?.positions;
  // The metrics the engine scores for the position first, the rest of
  // the sport's after, docs/MATCHING_CONTRACT.md section 1.
  const metricList = firstMetrics ? metricsFor(sport, positionGroupOf(sport, position || undefined)) : { first: [], more: [] };
  const today = new Date().toISOString().slice(0, 10);

  // The fields a pick fills, held here so a pick can fill them.
  const [highSchool, setHighSchool] = useState<string>(f("highSchool"));
  const [highSchoolId, setHighSchoolId] = useState<string>(f("highSchoolId"));
  const [homeState, setHomeState] = useState<string>(f("homeState").toUpperCase());
  const [currentSchool, setCurrentSchool] = useState<string>(f("currentSchool"));
  const [currentSchoolId, setCurrentSchoolId] = useState<string>(f("currentSchoolId"));
  const [currentDivision, setCurrentDivision] = useState<string>(f("currentDivision"));

  // Home State is picked, not typed. A record holding something that is
  // not a state code keeps it as an option, so an edit never changes it.
  const stateOptions = US_STATES.map((s) => ({ value: s.code, label: s.name }));
  if (homeState && !stateOptions.some((s) => s.value === homeState)) stateOptions.push({ value: homeState, label: homeState });

  function pickHighSchool(value: string) {
    setHighSchool(value);
    const rows = options.highSchools.filter((o) => o.id).map((o) => ({ name: o.value, state: o.state, id: o.id as string }));
    const hit = pickUnique(rows, value, homeState);
    setHighSchoolId(hit?.id ?? "");
    if (hit?.state && !homeState) setHomeState(hit.state);
  }

  function pickCollege(value: string) {
    setCurrentSchool(value);
    const rows = options.colleges.map((c) => ({ name: c.value, state: c.state, id: c.id, division: c.division }));
    const hit = pickUnique(rows, value);
    setCurrentSchoolId(hit?.id ?? "");
    if (hit?.division && !currentDivision.trim()) setCurrentDivision(hit.division);
  }

  const duplicate = state.duplicate;

  return (
    <Form action={formAction} error={state.errors.form}>
      <Field name="name" label="Name" hint="For example, Jose Ulloa." defaultValue={f("name")} required error={err("name")} />
      <Grid2>
        <SelectField name="sport" label="Sport" value={sport} onChange={(e) => setSport(e.target.value)} error={err("sport")}>
          {sportOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
        <SuggestField name="position" label="Position" hint={positions ? `For example, ${positions}.` : undefined} value={position} onChange={(e) => setPosition(e.target.value)} suggestions={positionsOf(sport)} />
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
        <SelectField name="status" label="Status" defaultValue={f("status") || "Active"} error={err("status")}>
          {statusOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <CheckField name="gpaVerified" label="GPA Verified" defaultChecked={f("gpaVerified") === "on" || !!initialValues.gpaVerified} />
      <SelectField name="advisorId" label="Advisor" hint="Who checks in with this athlete. The family sees the name." defaultValue={advisors.some((a) => a.id === f("advisorId")) ? f("advisorId") : ""} error={err("advisorId")}>
        <option value="">Nobody Yet</option>
        {advisors.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </SelectField>

      {recruitType === "hs" ? (
        <Stack gap={3}>
          <Label caps>High school details</Label>
          <SuggestField
            name="highSchool"
            label="High School"
            hint="Pick from the list or type it. Picking one fills Home State when it is blank."
            maxLength={200}
            value={highSchool}
            onChange={(e) => pickHighSchool(e.target.value)}
            error={err("highSchool")}
            suggestions={options.highSchools}
          />
          <Hidden name="highSchoolId" value={highSchoolId} />
          <Grid2>
            <Field name="gradYear" label="Grad Year" hint="For example, 2027." type="number" inputMode="numeric" defaultValue={f("gradYear")} />
            <SuggestField name="desiredMajor" label="Desired Major" defaultValue={f("desiredMajor")} suggestions={options.majors} />
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
          <SuggestField
            name="currentSchool"
            label="Current School"
            hint="Pick from the list or type it. Picking one fills Current Division when it is blank."
            value={currentSchool}
            onChange={(e) => pickCollege(e.target.value)}
            required={isTransfer}
            error={err("currentSchool")}
            suggestions={options.colleges}
          />
          <Hidden name="currentSchoolId" value={currentSchoolId} />
          <Grid2>
            <Field name="currentDivision" label="Current Division" hint="For example, D1." value={currentDivision} onChange={(e) => setCurrentDivision(e.target.value)} />
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
          <SuggestField id="desiredMajorTransfer" name="desiredMajor" label="Desired Major" defaultValue={f("desiredMajor")} suggestions={options.majors} />
          {recruitType === "transfer_grad" && (
            <CheckField name="degreeCompleted" label="Degree Completed" defaultChecked={f("degreeCompleted") === "on" || !!initialValues.degreeCompleted} />
          )}
        </Stack>
      )}

      {(dates.enrollment || dates.graduated) && (
        // Corrections only (audit crud F8). The first time a date is set
        // is Mark Enrolled or Mark Graduated on the athlete page, which
        // also closes out recruiting; blank leaves the date as it is.
        <Stack gap={3}>
          <Label caps>NCAA clock dates</Label>
          <Grid2>
            {dates.enrollment && (
              <Field name="enrollmentDate" label="Enrollment Date" hint="First full-time enrollment. It starts the five-year clock." type="date" defaultValue={f("enrollmentDate")} error={err("enrollmentDate")} />
            )}
            {dates.graduated && <Field name="graduatedOn" label="Graduated On" type="date" defaultValue={f("graduatedOn")} error={err("graduatedOn")} />}
          </Grid2>
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
          <SelectField name="homeState" label="Home State" hint="Picks in-state cost." value={homeState} onChange={(e) => setHomeState(e.target.value)} error={err("homeState")}>
            <option value="">Not Set</option>
            {stateOptions.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </SelectField>
        </Grid2>
      </Stack>

      {/* Five grades on the 20 to 80 scouting scale. They blend into the
          athletic score by position group; blank means metrics alone. */}
      <Stack gap={3}>
        <Label caps>Staff assessment</Label>
        <Grid2>
          {GRADE_KEYS.map((k) => (
            <Field key={k} name={k} label={gradeLabel(k, sport)} type="number" min={GRADE_MIN} max={GRADE_MAX} step="5" inputMode="numeric" defaultValue={f(k)} error={err(k)} />
          ))}
        </Grid2>
        <Label>{`The ${GRADE_MIN} to ${GRADE_MAX} scale. 50 is average for the level; leave blank to score on metrics alone.`}</Label>
      </Stack>

      {firstMetrics && (
        <Stack gap={3}>
          <Label caps>First metrics</Label>
          <Label>{`Optional. Each number becomes a dated entry in the log${metricList.first.length ? ", the ones that score for the position first" : ""}. The best verified number is what scores.`}</Label>
          <Grid2>
            {[...metricList.first, ...metricList.more].map((m) => (
              <Field key={m.key} name={`metric_${m.key}`} label={m.label} hint={m.unit || undefined} type="number" step="any" min="0" inputMode="decimal" defaultValue={f(`metric_${m.key}`)} error={err(`metric_${m.key}`)} />
            ))}
          </Grid2>
          <Grid2>
            <Field name="metricsMeasuredOn" label="Measured On" type="date" defaultValue={f("metricsMeasuredOn") || today} error={err("metricsMeasuredOn")} />
            <SelectField name="metricsSource" label="Source" defaultValue={f("metricsSource") || "event"} error={err("metricsSource")}>
              {SOURCES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </SelectField>
          </Grid2>
          <SuggestField name="metricsSourceDetail" label="Event or Detail" hint="For example, PBR Connecticut or fall practice." maxLength={120} defaultValue={f("metricsSourceDetail")} suggestions={options.sourceDetails} />
        </Stack>
      )}

      <CheckField name="isInternational" label="International Athlete" checked={isInternational} onChange={(e) => setIsInternational(e.target.checked)} />

      {isInternational && (
        <Stack gap={3}>
          <Label caps>International</Label>
          <Grid2>
            <Field name="toeflScore" label="TOEFL" type="number" min="0" max="120" inputMode="numeric" defaultValue={f("toeflScore")} error={err("toeflScore")} />
            <Field name="ieltsScore" label="IELTS" type="number" step="0.5" min="0" max="9" inputMode="decimal" defaultValue={f("ieltsScore")} error={err("ieltsScore")} />
          </Grid2>
          <SuggestField name="f1VisaStatus" label="F-1 Visa Status" defaultValue={f("f1VisaStatus")} suggestions={F1_VISA_STATUSES} />
          <SuggestField name="ncaaEligibilityStatus" label="NCAA Eligibility Center Status" defaultValue={f("ncaaEligibilityStatus")} suggestions={NCAA_ELIGIBILITY_STATUSES} />
        </Stack>
      )}

      {/* Staff only, in their own table: a family login reads the athlete
          row, so a note never lives on it (migration 0040). */}
      <TextAreaField
        name="notes"
        label={editing ? "Add a Note" : "Notes"}
        hint="Staff only, never shown to the family. Each note is dated; blank adds nothing."
        maxLength={4000}
        defaultValue={f("notes")}
        error={err("notes")}
      />

      {duplicate && (
        // Same name already on this org's roster. Nothing is looked up
        // in any other org, and nothing is copied from the one found.
        <Stack gap={3}>
          <Notice tone="warning" title="Already on the Roster">
            {`${duplicate.name} is already here (${duplicate.meta}). Open that record, or add this one as a different athlete.`}
          </Notice>
          <Grid2>
            <LinkButton href={duplicate.href} variant="secondary">
              Open Theirs
            </LinkButton>
            <Button variant="secondary" name="confirmDuplicate" value="1" disabled={pending}>
              Add Anyway
            </Button>
          </Grid2>
        </Stack>
      )}

      <Button disabled={pending}>{pending ? "Saving..." : submitLabel}</Button>
    </Form>
  );
}
