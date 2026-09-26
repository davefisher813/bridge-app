"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Grid2, SelectField, Stack, TextLink } from "@/components/kit";
import type { DirectoryFilters, DirectoryOptions } from "@/lib/data/schoolDirectory";

// The filters on the school directory: Division, State, Conference and
// Major, each a dropdown of the values the data carries, none on by
// default. Every change goes to the address, so a filtered list can be
// shared and the server renders it. Whatever else is in the address
// stays there: a search (?q=) and a filter never clear each other.

const KEYS = ["division", "state", "conference", "major"] as const;

export function SchoolFilters({ values, options }: { values: DirectoryFilters; options: DirectoryOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: (typeof KEYS)[number], value: string) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const active = KEYS.some((k) => !!values[k]);
  // Clearing the filters keeps the search term.
  const clearHref = (() => {
    const next = new URLSearchParams(params?.toString() ?? "");
    for (const k of KEYS) next.delete(k);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  })();

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
        <SelectField name="state" label="State" value={values.state ?? ""} onChange={(e) => set("state", e.target.value)}>
          <option value="">Any State</option>
          {options.states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectField>
      </Grid2>
      <Grid2>
        <SelectField name="conference" label="Conference" value={values.conference ?? ""} onChange={(e) => set("conference", e.target.value)}>
          <option value="">Any Conference</option>
          {options.conferences.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </SelectField>
        <SelectField name="major" label="Major" value={values.major ?? ""} onChange={(e) => set("major", e.target.value)}>
          <option value="">Any Major</option>
          {options.majors.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </SelectField>
      </Grid2>
      {active && <TextLink href={clearHref}>Clear Filters</TextLink>}
    </Stack>
  );
}
