// Editing this org's approved-course list for one school (crud F13). The
// list opens with every course on file as a row to keep, correct or
// remove, and the list's own fields filled in; saving replaces the list
// with what is on the screen. A portal list is shared and never opens
// here: the query is scoped to this org's own lists.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { saveApprovedList } from "@/lib/actions/approvedCourses";
import { ApprovedListForm } from "@/components/ApprovedListForm";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";
import { Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function EditApprovedListPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: list }, { data: courseRows }] = await Promise.all([
    supabase.from("org_approved_course_lists").select("id, school_name, ceeb_code, is_complete, retrieved_on, source_note").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("org_approved_courses").select("title, subject, max_credit, weighted").eq("list_id", id).eq("org_id", org.id).order("subject").order("title"),
  ]);
  if (!list) notFound();

  const existing = ((courseRows ?? []) as { title: string; subject: SubjectArea; max_credit: number | string | null; weighted: boolean }[]).map((c) => ({
    title: c.title,
    subject: c.subject,
    maxCredit: c.max_credit === null ? null : Number(c.max_credit),
    weighted: !!c.weighted,
  }));

  return (
    <Screen title={`Edit ${list.school_name}`} back={{ href: `/org/${slug}/approved-courses/${id}`, label: list.school_name }} lede="Approved course list">
      <ApprovedListForm
        action={saveApprovedList.bind(null, slug)}
        schoolName={list.school_name}
        existing={existing}
        defaults={{ ceebCode: list.ceeb_code, retrievedOn: list.retrieved_on, sourceNote: list.source_note, isComplete: list.is_complete }}
      />
    </Screen>
  );
}
