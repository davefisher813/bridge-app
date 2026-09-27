import type { ReactNode } from "react";
import { EmptyState, Row, Section } from "@/components/kit";
import { SearchField } from "@/components/SearchField";
import { SchoolFilters } from "@/components/SchoolFilters";
import type { DirectoryFilters, DirectoryGroup, DirectoryOptions } from "@/lib/data/schoolDirectory";

// The school directory list, shared by the staff, family and member
// screens. Search, the four filters, whatever the page puts above the
// list (staff: the schools it is recruiting at), then every school A
// to Z. `base` is the per-role href prefix, so a link on a family
// screen stays on the family side and a member's on the member side.
// Every row has an href, so nothing on the list is dead.

export function SchoolDirectory({
  base,
  viewer,
  filters,
  options,
  groups,
  total,
  listedAbove = false,
  children,
}: {
  base: string;
  viewer: "owner" | "staff" | "family" | "member";
  filters: DirectoryFilters;
  options: DirectoryOptions;
  groups: DirectoryGroup[];
  total: number;
  children?: ReactNode;
  // True when children already list some of the matches (the staff
  // page's recruiting section), so an empty A to Z is not "no matches".
  listedAbove?: boolean;
}) {
  const filtering = !!(filters.q || filters.division || filters.state || filters.conference || filters.major);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <SearchField initial={filters.q ?? ""} placeholder="A school, a state or a conference" />
      {total > 0 && <SchoolFilters values={filters} options={options} />}
      {children}
      {shown === 0 && listedAbove ? null : shown === 0 ? (
        <EmptyState kind="school" title={filtering ? "No School Matches" : "No Schools Yet"}>
          {filtering ? "Try part of the name, or clear the search and the filters." : viewer === "owner" ? "Add the first one below." : viewer === "staff" ? "The organization that keeps the shared directory adds schools, because the list is shared across every organization." : "The list fills in as schools are added."}
        </EmptyState>
      ) : (
        groups.map((g) => (
          <Section key={g.letter} label={g.letter} count={g.rows.length} role="place" kind="school">
            {g.rows.map((s) => (
              <Row key={s.id} href={`${base}/${s.id}`} kind="school" role="place" title={s.name} meta={[s.division ?? "No division", s.conference, s.location ?? s.state].filter(Boolean).join(" · ")} />
            ))}
          </Section>
        ))
      )}
    </>
  );
}
