"use client";

import { usePathname, useRouter } from "next/navigation";
import { Grid2, SelectField, Stack, TextLink } from "@/components/kit";

// The filters on the matches screen. docs/MATCHING_CONTRACT.md section
// 2: division, state, conference, major, cost ceiling, scholarship
// type, playing-time outlook, none on by default. Every change goes to
// the URL, so a filtered list can be shared and the server renders it.

export interface MatchFilterValues {
  division?: string;
  region?: string;
  state?: string;
  conference?: string;
  major?: string;
  cost?: string;
  aid?: string;
  outlook?: string;
}

export interface MatchFilterOptions {
  divisions: string[];
  regions: string[];
  states: string[];
  conferences: string[];
  majors: string[];
}

export const COST_CEILINGS = [20000, 30000, 40000, 50000, 60000, 75000];
export const AID_TYPES: { value: string; label: string }[] = [
  { value: "full", label: "Full Scholarships" },
  { value: "partial", label: "Partial Scholarships" },
  { value: "none", label: "No Athletic Aid" },
];
export const OUTLOOK_OPTIONS: { value: string; label: string }[] = [
  { value: "realistic", label: "Realistic" },
  { value: "competitive", label: "Competitive" },
  { value: "difficult", label: "Difficult" },
];

export function MatchFilters({ values, options }: { values: MatchFilterValues; options: MatchFilterOptions }) {
  const router = useRouter();
  const pathname = usePathname();

  const set = (key: keyof MatchFilterValues, value: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) if (v) next[k] = v;
    if (value) next[key] = value;
    else delete next[key];
    const qs = new URLSearchParams(next).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const active = Object.values(values).some(Boolean);

  return (
    <Stack gap={3}>
      <Grid2>
        <SelectField name="division" label="Division" value={values.division ?? ""} onChange={(e) => set("division", e.target.value)}>
          <option value="">Any Division</option>
          {options.divisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
        <SelectField name="region" label="Region" value={values.region ?? ""} onChange={(e) => set("region", e.target.value)}>
          <option value="">Any Region</option>
          {options.regions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </SelectField>
        <SelectField name="state" label="State" value={values.state ?? ""} onChange={(e) => set("state", e.target.value)}>
          <option value="">Any State</option>
          {options.states.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Grid2>
        <SelectField name="conference" label="Conference" value={values.conference ?? ""} onChange={(e) => set("conference", e.target.value)}>
          <option value="">Any Conference</option>
          {options.conferences.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
        <SelectField name="major" label="Major" value={values.major ?? ""} onChange={(e) => set("major", e.target.value)}>
          <option value="">Any Major</option>
          {options.majors.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Grid2>
        <SelectField name="cost" label="Cost Ceiling" hint="Cost of attendance before aid." value={values.cost ?? ""} onChange={(e) => set("cost", e.target.value)}>
          <option value="">Any Cost</option>
          {COST_CEILINGS.map((c) => (
            <option key={c} value={String(c)}>
              {`Under $${(c / 1000).toFixed(0)}k`}
            </option>
          ))}
        </SelectField>
        <SelectField name="aid" label="Scholarship Type" value={values.aid ?? ""} onChange={(e) => set("aid", e.target.value)}>
          <option value="">Any Type</option>
          {AID_TYPES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <SelectField name="outlook" label="Playing Time" value={values.outlook ?? ""} onChange={(e) => set("outlook", e.target.value)}>
        <option value="">Any Outlook</option>
        {OUTLOOK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </SelectField>
      {active && <TextLink href={pathname}>Clear Filters</TextLink>}
    </Stack>
  );
}
