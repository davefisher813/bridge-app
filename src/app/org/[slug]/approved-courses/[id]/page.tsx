// One school's approved list, read only.
//
// A portal list is shared reference data and cannot be edited from here
// at all. An org's own list can be replaced by entering it again, which
// is deliberate: a saved list is a snapshot of what the portal said on a
// day, and merging an old copy into a new one produces a list that never
// existed at any school.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { RailCard, SectionHeader } from "@/components/catalog";
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
  searchParams: Promise<{ origin?: string }>;
}) {
  const { slug, id } = await params;
  const { origin } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const fromPortal = origin === "portal";
  const supabase = await createClient();

  const listTable = fromPortal ? "ncaa_approved_course_lists" : "org_approved_course_lists";
  const courseTable = fromPortal ? "ncaa_approved_courses" : "org_approved_courses";

  const { data: list } = await supabase
    .from(listTable)
    .select("id, school_name, ceeb_code, is_complete, retrieved_on, source_note")
    .eq("id", id)
    .single();
  if (!list) notFound();

  const { data: courseRows } = await supabase
    .from(courseTable)
    .select("title, subject, max_credit, weighted")
    .eq("list_id", id)
    .order("subject", { ascending: true })
    .order("title", { ascending: true });

  const courses = (courseRows ?? []) as CourseRow[];
  const bySubject = new Map<SubjectArea, CourseRow[]>();
  for (const c of courses) {
    const g = bySubject.get(c.subject) ?? [];
    g.push(c);
    bySubject.set(c.subject, g);
  }

  return (
    <main className="px-4 pb-24 pt-2">
      <div className="mb-2">
        <Link
          href={`/org/${slug}/approved-courses`}
          className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted"
        >
          &larr; Approved lists
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold leading-tight text-ink">{list.school_name}</h1>
      <div className="mb-4 text-[12.5px] font-bold text-muted">
        {courses.length} courses{list.ceeb_code ? ` · CEEB ${list.ceeb_code}` : ""}
      </div>

      <div className="mb-5">
        <RailCard role={list.is_complete ? "committed" : "target"} kind={list.is_complete ? "check" : "note"}>
          <div className="text-[13px] font-bold leading-tight text-ink">{list.is_complete ? "Complete list" : "Partial list"}</div>
          <div className="mt-1 text-[12px] leading-tight text-muted">
            {list.is_complete
              ? "A course missing from it does not count toward the core GPA."
              : "It can confirm a course. It never rules one out."}
          </div>
          {list.source_note && <div className="mt-1.5 text-[11.5px] leading-tight text-muted">&quot;{list.source_note}&quot;</div>}
          {list.retrieved_on && <div className="mt-1 text-[11.5px] leading-tight text-muted">Read off the portal on {list.retrieved_on}</div>}
        </RailCard>
      </div>

      {[...bySubject.entries()].map(([subject, rows]) => (
        <div key={subject} className="mb-4">
          <div className="mb-2">
            <SectionHeader label={LABEL[subject]} count={rows.length} role="contact" kind="course" />
          </div>
          <div className="flex flex-col gap-2">
            {rows.map((c) => (
              <RailCard key={c.title} role="contact" kind="course">
                <div className="text-[13px] font-bold leading-tight text-ink">{c.title}</div>
                {(c.max_credit !== null || c.weighted) && (
                  <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                    {c.max_credit !== null && `capped at ${c.max_credit}`}
                    {c.max_credit !== null && c.weighted && " · "}
                    {c.weighted && "weighted"}
                  </div>
                )}
              </RailCard>
            ))}
          </div>
        </div>
      ))}

      {canEdit && !fromPortal && (
        <Link
          href={`/org/${slug}/approved-courses/new?school=${encodeURIComponent(list.school_name)}`}
          className="mt-2 flex min-h-[44px] items-center justify-center rounded-[8px] bg-paper text-[14px] font-bold text-ink"
        >
          Replace this list
        </Link>
      )}
      {fromPortal && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Transcribed from the Eligibility Center and shared across every organization, so it is not editable here.
        </p>
      )}
    </main>
  );
}
