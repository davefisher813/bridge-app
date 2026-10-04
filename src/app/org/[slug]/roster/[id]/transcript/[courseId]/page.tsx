import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { deleteCourse, updateCourse } from "@/lib/actions/courses";
import { loadCourseOptions } from "@/lib/data/courseOptions";
import { approvalChoiceOf, isCourseSubject } from "@/lib/validation/course";
import { CourseForm } from "@/components/CourseForm";
import { ConfirmButton, Form, Label, Screen, Section } from "@/components/kit";

// One transcript row, corrected by staff (audit crud F5). A misread grade
// used to mean discarding the whole document and uploading it again.
// Correcting it here keeps everything else the document applied.

export const dynamic = "force-dynamic";

interface CourseRow {
  id: string;
  title: string;
  subject: string;
  credit: number | string;
  grade: string;
  term: string | null;
  school_name: string | null;
  weighted: boolean;
  ncaa_approved: boolean | null;
  document_id: string | null;
}

export default async function CoursePage({ params }: { params: Promise<{ slug: string; id: string; courseId: string }> }) {
  const { slug, id, courseId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: athlete }, { data: courseData }] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase
      .from("athlete_courses")
      .select("id, title, subject, credit, grade, term, school_name, weighted, ncaa_approved, document_id")
      .eq("id", courseId)
      .eq("org_id", org.id)
      .eq("athlete_id", id)
      .maybeSingle(),
  ]);
  if (!athlete || !courseData) notFound();
  const course = courseData as CourseRow;
  const { terms, schools } = await loadCourseOptions(supabase, org.id, id);
  const transcriptHref = `/org/${slug}/roster/${id}/transcript`;

  return (
    <Screen title="Edit Course" back={{ href: transcriptHref, label: "Transcript" }} lede={`${athlete.name} · ${course.title}`}>
      <CourseForm
        action={updateCourse.bind(null, slug, id, course.id)}
        initial={{
          title: course.title,
          subject: isCourseSubject(course.subject) ? course.subject : "other_academic",
          credit: Number(course.credit),
          grade: course.grade,
          term: course.term,
          schoolName: course.school_name,
          weighted: course.weighted,
          approval: approvalChoiceOf(course.ncaa_approved),
        }}
        terms={terms}
        schools={schools}
        submitLabel="Save Course"
      />

      <Section label="Remove" role="danger" kind="blocked">
        <Form action={deleteCourse.bind(null, slug, id, course.id)}>
          <ConfirmButton title="Remove This Course?" body="It comes off the transcript, and the NCAA core GPA is worked out again without it." confirmLabel="Remove Course">
            Remove Course
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
