// The year a give/get or fundraising screen counts (Oct 13: Bridge's
// gifts were all 2024 and 2025, so a board that only ever showed the
// current year read $0 with no way to see last year's real figures).
// The year before is always offered; the year after only up to now.

import { Inline, LinkButton } from "@/components/kit";

export function YearSwitch({ year, current, hrefFor }: { year: number; current: number; hrefFor: (year: number) => string }) {
  return (
    <Inline gap={2}>
      <LinkButton inline variant="secondary" href={hrefFor(year - 1)}>
        {`Show ${year - 1}`}
      </LinkButton>
      {year < current && (
        <LinkButton inline variant="secondary" href={hrefFor(year + 1)}>
          {`Show ${year + 1}`}
        </LinkButton>
      )}
    </Inline>
  );
}
