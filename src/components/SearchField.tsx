"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
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
  const box = useRef<HTMLDivElement>(null);
  // What the box holds right now, read from the box itself: a value put
  // there without a keystroke (autofill, a test driver, a paste handler)
  // never reaches the state, and Search then searched for nothing
  // (live test D10, 2026-10-16).
  const current = () => box.current?.querySelector("input")?.value ?? value;

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
    <div ref={box} className="flex items-end gap-3">
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
              apply(current());
            }
          }}
        />
      </div>
      <Button type="button" variant="secondary" inline onClick={() => apply(current())}>
        Search
      </Button>
    </div>
  );
}
