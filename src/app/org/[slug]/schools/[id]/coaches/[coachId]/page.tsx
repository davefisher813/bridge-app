// One coach in the shared directory, to correct or remove (crud F2). A
// wrong email or a coach who left is fixed here once, for every org.
// Directory editors only, through the service role behind
// requireDirectoryEditor().

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { deleteCoach, updateCoach } from "@/lib/actions/coaches";
import { CoachForm } from "@/components/CoachForm";
import { ConfirmButton, Form, Screen, TextLink } from "@/components/kit";

export const dynamic = "force-dynamic";

export default async function EditCoachPage({ params }: { params: Promise<{ slug: string; id: string; coachId: string }> }) {
  const { slug, id, coachId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireDirectoryEditor(org.id);

  const supabase = await createClient();
  const [{ data: school }, { data: coach }] = await Promise.all([
    supabase.from("schools").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("college_coaches").select("id, name, title, email, phone, is_recruiting_coordinator").eq("id", coachId).eq("school_id", id).maybeSingle(),
  ]);
  if (!school || !coach) notFound();

  return (
    <Screen
      title={coach.name}
      back={{ href: `/org/${slug}/schools/${id}/coaches`, label: "Coaches" }}
      action={coach.email ? <TextLink href={`mailto:${coach.email}`}>Email</TextLink> : undefined}
    >
      <CoachForm
        action={updateCoach.bind(null, slug, id, coachId)}
        submitLabel="Save Changes"
        initialValues={{
          name: coach.name,
          title: coach.title ?? undefined,
          email: coach.email ?? undefined,
          phone: coach.phone ?? undefined,
          isRecruitingCoordinator: !!coach.is_recruiting_coordinator,
        }}
      />
      <Form action={deleteCoach.bind(null, slug, id, coachId)}>
        <ConfirmButton title={`Remove ${coach.name}?`} body="They come off this school's coaches for every organization. Your own notes and contacts keep their names." confirmLabel="Remove">
          Remove Coach
        </ConfirmButton>
      </Form>
    </Screen>
  );
}
