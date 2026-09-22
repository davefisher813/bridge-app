"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import { Button, Field } from "@/components/kit";

// A search box for a list. Typing narrows nothing until Search or
// Return, and the term lives in the address (?q=) so the list can be
// shared and the back button keeps it. Server-rendered lists read the
// term and filter; nothing here fetches.
export function SearchField({ initial = "", label = "Search", placeholder }: { initial?: string; label?: string; placeholder?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState(initial);

  const apply = (term: string) => {
    const q = term.trim();
    router.replace(q ? `${pathname}?q=${encodeURIComponent(q)}` : pathname);
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
