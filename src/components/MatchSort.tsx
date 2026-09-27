"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { SelectField } from "@/components/kit";
import { FIT_SORTS, type FitSort } from "@/lib/fit/rank";

// The sort on a matches list. docs/MATCHING_CONTRACT.md section 2,
// amended 2026-09-27: Best Fit (full before partial, each by score),
// Academic, Athletic, Financial, Net Cost, A to Z. The choice lives in
// the address (?sort=) so a sorted list can be shared and the server
// ranks it; the screen ranks through src/lib/fit/rank.ts and never
// sorts on its own. Whatever else is in the address (a search, a
// filter, how many rows are shown) stays there.
export function MatchSort({ value }: { value: FitSort }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const set = (key: string) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    // Best Fit is the default, so it needs no mark in the address.
    if (key && key !== "best") next.set("sort", key);
    else next.delete("sort");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <SelectField name="sort" label="Sort" value={value} onChange={(e) => set(e.target.value)}>
      {FIT_SORTS.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </SelectField>
  );
}
