// Entering a school's NCAA approved-course list.
//
// Staff, not owner-only, and through the ordinary client rather than the
// service role, for the same reason the grading-scale entry screen is:
// this writes an org-scoped row, so a wrong list is wrong for one org.
// The shared portal table stays service-role only. See
// src/lib/actions/approvedCourses.ts and migrations/0014.
//
// Opened with no school (Add a List, or a caveat that names none), it
// asks Which School first instead of answering Not Found. When this org
// already has a list for the school, the list opens filled in, so a
// correction is an edit rather than eighty rows retyped. The CEEB code
// defaults to the one on file for the school: this org's list, the
// public high school directory, or the portal's own list.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { pickApprovedListSchool, saveApprovedList } from "@/lib/actions/approvedCourses";
import { loadHighSchoolOptions, resolveHighSchool } from "@/lib/data/lookups";
import { escapeIlike, nameKey } from "@/lib/lookup/nameKey";
import { ApprovedListForm } from "@/components/ApprovedListForm";
import type { SubjectArea } from "@/lib/fit/ncaa/coreGpa";
import { Button, Form, Screen, SuggestField, TextLink } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function NewApprovedListPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ school?: string }>;
}) {
  const { slug } = await params;
  const { school } = (await searchParams) ?? {};
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const schoolName = (school ?? "").trim();
  const back = { href: `/org/${slug}/approved-courses`, label: "Approved Lists" };

  if (!schoolName) {
    const options = (await loadHighSchoolOptions(supabase, org.id)).map((o) => ({ value: o.value, label: o.label }));
    return (
      <Screen title="Add a List" back={back}>
        <Form action={pickApprovedListSchool.bind(null, slug)}>
          <SuggestField id="list-school" name="school" label="Which School" suggestions={options} required />
          <Button>Continue</Button>
        </Form>
      </Screen>
    );
  }

  // This org's list for the school, if there is one, matched on the
  // name key the table is unique on.
  const { data: ownRows } = await supabase
    .from("org_approved_course_lists")
    .select("id, school_name, ceeb_code, is_complete, retrieved_on, source_note")
    .eq("org_id", org.id)
    .ilike("school_name", escapeIlike(schoolName));
  const own = ((ownRows ?? []) as { id: string; school_name: string; ceeb_code: string | null; is_complete: boolean; retrieved_on: string | null; source_note: string | null }[]).find(
    (l) => nameKey(l.school_name) === nameKey(schoolName),
  );

  const { data: courseRows } = own
    ? await supabase.from("org_approved_courses").select("title, subject, max_credit, weighted").eq("list_id", own.id).eq("org_id", org.id).order("subject").order("title")
    : { data: [] };
  const existing = ((courseRows ?? []) as { title: string; subject: SubjectArea; max_credit: number | string | null; weighted: boolean }[]).map((c) => ({
    title: c.title,
    subject: c.subject,
    maxCredit: c.max_credit === null ? null : Number(c.max_credit),
    weighted: !!c.weighted,
  }));

  // The CEEB code on file: this org's list first, then the public
  // directory (a unique match only), then the portal's list.
  let ceeb = own?.ceeb_code?.trim() || null;
  if (!ceeb) ceeb = (await resolveHighSchool(supabase, schoolName))?.ceeb_code?.trim() || null;
  if (!ceeb) {
    const { data: portal } = await supabase.from("ncaa_approved_course_lists").select("school_name, ceeb_code").ilike("school_name", escapeIlike(schoolName));
    ceeb = ((portal ?? []) as { school_name: string; ceeb_code: string | null }[]).find((l) => nameKey(l.school_name) === nameKey(schoolName))?.ceeb_code?.trim() || null;
  }

  const action = saveApprovedList.bind(null, slug);

  return (
    <Screen title={own?.school_name ?? schoolName} back={back} action={own ? <TextLink href={`/org/${slug}/approved-courses/${own.id}`}>View</TextLink> : undefined}>
      <ApprovedListForm
        key={own?.id ?? "new"}
        action={action}
        schoolName={own?.school_name ?? schoolName}
        existing={existing}
        defaults={{ ceebCode: ceeb, retrievedOn: own?.retrieved_on ?? null, sourceNote: own?.source_note ?? null, isComplete: own?.is_complete ?? false }}
      />
    </Screen>
  );
}
