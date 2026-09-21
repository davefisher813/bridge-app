// Every school's NCAA approved-course list, and the schools still
// missing one.
//
// The "Needed now" section is the point, the same way it is on the
// grading-scales screen. A school with no list means every course at it
// stays unchecked, which means the core GPA for every athlete there
// reports itself as an estimate. Before this screen the only place that
// showed up was one line on one athlete's eligibility page.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, Label, Row, Screen, Section } from "@/components/kit";
import { normalizeSchoolKey } from "@/lib/fit/ncaa/approvedCourses";

export const dynamic = "force-dynamic";

interface ListRow {
  id: string;
  school_name: string;
  school_name_key: string;
  is_complete: boolean;
  source_note: string | null;
  ncaa_approved_courses?: { count: number }[];
  org_approved_courses?: { count: number }[];
}

export default async function ApprovedCoursesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();

  const [{ data: ownRows }, { data: courseRows }] = await Promise.all([
    supabase
      .from("org_approved_course_lists")
      .select("id, school_name, school_name_key, is_complete, source_note, org_approved_courses(count)")
      .eq("org_id", org.id)
      .order("school_name", { ascending: true }),
    // Which schools this org's athletes actually have courses at. A list
    // for a school nobody attends is not what this screen is for.
    supabase.from("athlete_courses").select("school_name").eq("org_id", org.id),
  ]);

  const own = (ownRows ?? []) as ListRow[];
  const attended = [
    ...new Map(
      (courseRows ?? [])
        .map((c) => (c as { school_name: string | null }).school_name)
        .filter((n): n is string => !!n && n.trim().length > 0)
        .map((n) => [normalizeSchoolKey(n), n.trim()]),
    ).entries(),
  ];

  // Shared portal lists for those schools, which beat an org's own.
  const { data: sharedRows } = attended.length
    ? await supabase
        .from("ncaa_approved_course_lists")
        .select("id, school_name, school_name_key, is_complete, source_note, ncaa_approved_courses(count)")
        .in(
          "school_name_key",
          attended.map(([k]) => k),
        )
    : { data: [] };
  const shared = (sharedRows ?? []) as ListRow[];

  const byKey = new Map<string, { row: ListRow; origin: "portal" | "org" }>();
  for (const r of own) byKey.set(r.school_name_key, { row: r, origin: "org" });
  for (const r of shared) byKey.set(r.school_name_key, { row: r, origin: "portal" });

  const missing = attended.filter(([key]) => !byKey.has(key));
  const onFile = [...byKey.values()].sort((a, b) => a.row.school_name.localeCompare(b.row.school_name));

  const countOf = (r: ListRow) => r.org_approved_courses?.[0]?.count ?? r.ncaa_approved_courses?.[0]?.count ?? 0;

  return (
    <Screen title="Approved Lists" back={{ href: `/org/${slug}/more`, label: "More" }} lede={`${onFile.length} on file`}>
      {missing.length > 0 && (
        <Section label="Needed Now" count={missing.length} role="offer" kind="warning">
          {missing.map(([key, name]) => (
            <Row
              key={key}
              href={canEdit ? `/org/${slug}/approved-courses/new?school=${encodeURIComponent(name)}` : undefined}
              kind="checklist"
              role="offer"
              title={name}
              meta="Every course here stays unchecked"
              trailing={canEdit ? <Label tone="accent">Add</Label> : undefined}
            />
          ))}
        </Section>
      )}

      <Section label="On File" count={onFile.length} role="committed" kind="checklist">
        {onFile.length === 0 ? (
          <EmptyState kind="checklist" title="No Approved Lists Yet">
            The Eligibility Center publishes one per high school. Without it a core GPA is an estimate.
          </EmptyState>
        ) : (
          onFile.map(({ row, origin }) => (
            <Row
              key={row.id}
              href={`/org/${slug}/approved-courses/${row.id}?origin=${origin}`}
              kind="checklist"
              role={row.is_complete ? "committed" : "target"}
              title={row.school_name}
              meta={`${countOf(row)} courses · ${row.is_complete ? "complete" : "partial"} · ${origin === "portal" ? "from the NCAA portal" : "entered here"}`}
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
