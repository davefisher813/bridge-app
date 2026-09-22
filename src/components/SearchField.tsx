"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Field } from "@/components/kit";

// A search box for a list. Typing narrows nothing until Search or
// Return, and the term lives in the address (?q=) so the list can be
// shared and the back button keeps it. Server-rendered lists read the
// term and filter; nothing here fetches.
export function SearchField({ initial = "", label = "Search", placeholder }: { initial?: string; label?: string; placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(initial);

  // Whatever else is in the address stays there: a screen can carry a
  // filter and a search at once, and neither clears the other.
  const apply = (term: string) => {
    const q = term.trim();
    const next = new URLSearchParams(params?.toString() ?? "");
    if (q) next.set("q", q);
    else next.delete("q");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="flex items-end gap-3">
      <div className="min-w-0 flex-1">
        <Field
          name="q"
          label={label}
          type="search"
          autoComplete="off"
          placeholder={placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply(value);
            }
          }}
        />
      </div>
      <Button type="button" variant="secondary" inline onClick={() => apply(value)}>
        Search
      </Button>
    </div>
  );
}
