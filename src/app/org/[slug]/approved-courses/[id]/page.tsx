// One school's approved list.
//
// A portal list is shared reference data and cannot be edited from here
// at all. An org's own list opens in its edit screen with every course
// on it (crud F13), and saving replaces the whole list with what is on
// that screen: a saved list is a snapshot of what the portal said on a
// day, and merging an old copy into a new one produces a list that never
// existed at any school. Remove List takes it off entirely.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { ConfirmButton, Form, LinkButton, Notice, Prose, Row, Screen, Section } from "@/components/kit";
import { deleteApprovedList } from "@/lib/actions/approvedCourses";
import { Note } from "@/components/EligibilityVerdict";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";

export const dynamic = "force-dynamic";

const LABEL: Record<SubjectArea, string> = {
  english: "English",
  math: "Math",
  science: "Science",
  social_science: "Social science",
  other_academic: "Other academic",
};

interface CourseRow {
  title: string;
  subject: SubjectArea;
  max_credit: number | string | null;
  weighted: boolean;
}

export default async function ApprovedListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams?: Promise<{ origin?: string; error?: string }>;
}) {
  const { slug, id } = await params;
  const { origin, error } = (await searchParams) ?? {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const fromPortal = origin === "portal";
  const supabase = await createClient();

  // Two literal branches rather than a table name in a variable. A
  // dynamic .from() is invisible to the table audit in
  // src/laws/dataLaws.test.ts, which is the check that catches a table
  // being written and never read: exactly how the org grading scales
  // sat dead for a release.
  const LIST_COLUMNS = "id, school_name, ceeb_code, is_complete, retrieved_on, source_note";
  const COURSE_COLUMNS = "title, subject, max_credit, weighted";

  const { data: list } = fromPortal
    ? await supabase.from("ncaa_approved_course_lists").select(LIST_COLUMNS).eq("id", id).single()
    : await supabase.from("org_approved_course_lists").select(LIST_COLUMNS).eq("id", id).eq("org_id", org.id).single();
  if (!list) notFound();

  const { data: courseRows } = fromPortal
    ? await supabase.from("ncaa_approved_courses").select(COURSE_COLUMNS).eq("list_id", id).order("subject").order("title")
    : await supabase.from("org_approved_courses").select(COURSE_COLUMNS).eq("list_id", id).eq("org_id", org.id).order("subject").order("title");

  const courses = (courseRows ?? []) as CourseRow[];
  const bySubject = new Map<SubjectArea, CourseRow[]>();
  for (const c of courses) {
    const g = bySubject.get(c.subject) ?? [];
    g.push(c);
    bySubject.set(c.subject, g);
  }

  return (
    <Screen
      title={list.school_name}
      back={{ href: `/org/${slug}/approved-courses`, label: "Approved Lists" }}
      lede={`${courses.length} ${courses.length === 1 ? "course" : "courses"}${list.ceeb_code ? ` · CEEB ${list.ceeb_code}` : ""}`}
    >
      {error && (
        <Notice tone="danger" title="Could Not Remove the List">
          {error}
        </Notice>
      )}
      <Note title={list.is_complete ? "Complete list" : "Partial list"}>
        {list.is_complete ? "A course missing from it does not count toward the core GPA." : "It can confirm a course. It never rules one out."}
        {list.source_note ? ` "${list.source_note}."` : ""}
        {list.retrieved_on ? ` Read off the portal on ${list.retrieved_on}.` : ""}
      </Note>

      {[...bySubject.entries()].map(([subject, rows]) => (
        <Section key={subject} label={LABEL[subject]} count={rows.length} role="contact" kind="course">
          {rows.map((c) => (
            <Row
              key={c.title}
              kind="course"
              role="contact"
              title={c.title}
              meta={[c.max_credit !== null ? `capped at ${c.max_credit}` : null, c.weighted ? "weighted" : null].filter(Boolean).join(" · ") || undefined}
            />
          ))}
        </Section>
      ))}

      {canEdit && !fromPortal && (
        <LinkButton href={`/org/${slug}/approved-courses/${id}/edit`} variant="secondary">
          Edit This List
        </LinkButton>
      )}
      {canEdit && !fromPortal && (
        <Form action={deleteApprovedList.bind(null, slug, id)}>
          <ConfirmButton
            title={`Remove the List for ${list.school_name}?`}
            body="Its courses stop being confirmed as approved, and every athlete at this school recalculates."
            confirmLabel="Remove List"
          >
            Remove List
          </ConfirmButton>
        </Form>
      )}
      {fromPortal && <Prose>From the Eligibility Center, shared across every organization, so it is not editable here.</Prose>}
    </Screen>
  );
}
