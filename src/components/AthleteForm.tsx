"use client";

import { useActionState, useState } from "react";
import { RECRUIT_TYPES, ATHLETE_STATUSES } from "@/lib/validation/athlete";
import type { AthleteActionState } from "@/lib/actions/athletes";
import type { RecruitType } from "@/lib/fit/types";

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

function field(state: AthleteActionState, initial: AthleteFormInitialValues, key: string): string {
  const fromState = state.values[key];
  if (fromState !== undefined) return String(fromState);
  const fromInitial = (initial as Record<string, unknown>)[key];
  return fromInitial === undefined || fromInitial === null ? "" : String(fromInitial);
}

const inputClass =
  "w-full rounded-[12px] border border-line bg-bg px-3 py-2.5 text-[14px] text-ink placeholder:text-muted focus:border-accent focus:outline-none";
const labelClass = "mb-1.5 block text-[12px] font-bold text-muted";
const errorClass = "mt-1 text-[11.5px] font-semibold text-danger";

export function AthleteForm({
  action,
  initialValues = {},
  submitLabel,
}: {
  action: ServerAction;
  initialValues?: AthleteFormInitialValues;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);
  const [recruitType, setRecruitType] = useState<RecruitType>(
    (state.values.recruitType as RecruitType) || initialValues.recruitType || "hs"
  );
  const [isInternational, setIsInternational] = useState<boolean>(
    state.values.isInternational !== undefined ? state.values.isInternational === "on" : !!initialValues.isInternational
  );

  const isTransfer = recruitType !== "hs";
  const f = (key: string) => field(state, initialValues, key);
  const err = (key: string) => state.errors[key];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.errors.form && (
        <div className="rounded-[12px] border border-danger/40 bg-danger/10 px-3 py-2.5 text-[13px] font-semibold text-danger">
          {state.errors.form}
        </div>
      )}

      <div>
        <label className={labelClass} htmlFor="name">
          Name
        </label>
        <input className={inputClass} id="name" name="name" defaultValue={f("name")} placeholder="Jose Ulloa" required />
        {err("name") && <p className={errorClass}>{err("name")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="sport">
            Sport
          </label>
          <input className={inputClass} id="sport" name="sport" defaultValue={f("sport")} placeholder="Baseball" required />
          {err("sport") && <p className={errorClass}>{err("sport")}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="position">
            Position
          </label>
          <input className={inputClass} id="position" name="position" defaultValue={f("position")} placeholder="RHP" />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="recruitType">
          Recruit type
        </label>
        <select
          className={inputClass}
          id="recruitType"
          name="recruitType"
          value={recruitType}
          onChange={(e) => setRecruitType(e.target.value as RecruitType)}
        >
          {RECRUIT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="gpa">
            GPA
          </label>
          <input className={inputClass} id="gpa" name="gpa" type="number" step="0.01" min="0" max="4" defaultValue={f("gpa")} />
          {err("gpa") && <p className={errorClass}>{err("gpa")}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="status">
            Status
          </label>
          <select className={inputClass} id="status" name="status" defaultValue={f("status") || "Active"}>
            {ATHLETE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <input type="checkbox" name="gpaVerified" defaultChecked={f("gpaVerified") === "on" || !!initialValues.gpaVerified} className="h-4 w-4" />
        GPA verified
      </label>

      {recruitType === "hs" ? (
        <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-bg/50 p-3.5">
          <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted">High school details</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="gradYear">
                Grad year
              </label>
              <input className={inputClass} id="gradYear" name="gradYear" type="number" defaultValue={f("gradYear")} placeholder="2027" />
            </div>
            <div>
              <label className={labelClass} htmlFor="desiredMajor">
                Desired major
              </label>
              <input className={inputClass} id="desiredMajor" name="desiredMajor" defaultValue={f("desiredMajor")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="satTotal">
                SAT total
              </label>
              <input className={inputClass} id="satTotal" name="satTotal" type="number" defaultValue={f("satTotal")} />
              {err("satTotal") && <p className={errorClass}>{err("satTotal")}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="actComposite">
                ACT composite
              </label>
              <input className={inputClass} id="actComposite" name="actComposite" type="number" defaultValue={f("actComposite")} />
              {err("actComposite") && <p className={errorClass}>{err("actComposite")}</p>}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <label className={labelClass} htmlFor="apCount">
                AP
              </label>
              <input className={inputClass} id="apCount" name="apCount" type="number" min="0" defaultValue={f("apCount")} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ibCount">
                IB
              </label>
              <input className={inputClass} id="ibCount" name="ibCount" type="number" min="0" defaultValue={f("ibCount")} />
            </div>
            <div>
              <label className={labelClass} htmlFor="honorsCount">
                Honors
              </label>
              <input className={inputClass} id="honorsCount" name="honorsCount" type="number" min="0" defaultValue={f("honorsCount")} />
            </div>
            <div>
              <label className={labelClass} htmlFor="dualCount">
                Dual enroll
              </label>
              <input className={inputClass} id="dualCount" name="dualCount" type="number" min="0" defaultValue={f("dualCount")} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-bg/50 p-3.5">
          <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-muted">Transfer details</div>
          <div>
            <label className={labelClass} htmlFor="currentSchool">
              Current school
            </label>
            <input className={inputClass} id="currentSchool" name="currentSchool" defaultValue={f("currentSchool")} required={isTransfer} />
            {err("currentSchool") && <p className={errorClass}>{err("currentSchool")}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="currentDivision">
                Current division
              </label>
              <input className={inputClass} id="currentDivision" name="currentDivision" defaultValue={f("currentDivision")} placeholder="D1" />
            </div>
            <div>
              <label className={labelClass} htmlFor="collegeGpa">
                College GPA
              </label>
              <input className={inputClass} id="collegeGpa" name="collegeGpa" type="number" step="0.01" min="0" max="4" defaultValue={f("collegeGpa")} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="eligibilityYearsRemaining">
                Eligibility years left
              </label>
              <input
                className={inputClass}
                id="eligibilityYearsRemaining"
                name="eligibilityYearsRemaining"
                type="number"
                step="0.5"
                min="0"
                max="5"
                defaultValue={f("eligibilityYearsRemaining")}
                required={isTransfer}
              />
              {err("eligibilityYearsRemaining") && <p className={errorClass}>{err("eligibilityYearsRemaining")}</p>}
            </div>
            <div>
              <label className={labelClass} htmlFor="transferCount">
                Prior transfers
              </label>
              <input className={inputClass} id="transferCount" name="transferCount" type="number" min="0" defaultValue={f("transferCount") || "0"} />
              {err("transferCount") && <p className={errorClass}>{err("transferCount")}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="creditHoursCompleted">
                Credit hours completed
              </label>
              <input className={inputClass} id="creditHoursCompleted" name="creditHoursCompleted" type="number" min="0" defaultValue={f("creditHoursCompleted")} />
            </div>
            <div>
              <label className={labelClass} htmlFor="portalEntryDate">
                Portal entry date
              </label>
              <input className={inputClass} id="portalEntryDate" name="portalEntryDate" type="date" defaultValue={f("portalEntryDate")} />
            </div>
          </div>
          <div>
            <label className={labelClass} htmlFor="desiredMajorTransfer">
              Desired major
            </label>
            <input className={inputClass} id="desiredMajorTransfer" name="desiredMajor" defaultValue={f("desiredMajor")} />
          </div>
          {recruitType === "transfer_grad" && (
            <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
              <input type="checkbox" name="degreeCompleted" defaultChecked={f("degreeCompleted") === "on" || !!initialValues.degreeCompleted} className="h-4 w-4" />
              Degree completed
            </label>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink">
        <input
          type="checkbox"
          name="isInternational"
          checked={isInternational}
          onChange={(e) => setIsInternational(e.target.checked)}
          className="h-4 w-4"
        />
        International athlete
      </label>

      {isInternational && (
        <div className="grid grid-cols-2 gap-3 rounded-[16px] border border-line bg-bg/50 p-3.5">
          <div>
            <label className={labelClass} htmlFor="toeflScore">
              TOEFL
            </label>
            <input className={inputClass} id="toeflScore" name="toeflScore" type="number" min="0" max="120" defaultValue={f("toeflScore")} />
            {err("toeflScore") && <p className={errorClass}>{err("toeflScore")}</p>}
          </div>
          <div>
            <label className={labelClass} htmlFor="ieltsScore">
              IELTS
            </label>
            <input className={inputClass} id="ieltsScore" name="ieltsScore" type="number" step="0.5" min="0" max="9" defaultValue={f("ieltsScore")} />
            {err("ieltsScore") && <p className={errorClass}>{err("ieltsScore")}</p>}
          </div>
          <div>
            <label className={labelClass} htmlFor="f1VisaStatus">
              F-1 visa status
            </label>
            <input className={inputClass} id="f1VisaStatus" name="f1VisaStatus" defaultValue={f("f1VisaStatus")} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ncaaEligibilityStatus">
              NCAA eligibility status
            </label>
            <input className={inputClass} id="ncaaEligibilityStatus" name="ncaaEligibilityStatus" defaultValue={f("ncaaEligibilityStatus")} />
          </div>
        </div>
      )}

      <button type="submit" disabled={pending} className="mt-1 rounded-full bg-accent py-3 text-center text-[14px] font-bold text-white disabled:opacity-60">
        {pending ? "Saving..." : submitLabel}
      </button>
    </form>
  );
}
