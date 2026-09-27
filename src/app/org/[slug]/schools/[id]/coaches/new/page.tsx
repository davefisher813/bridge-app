// Add a coach to a school's listing in the shared directory. Directory
// editors only, like the school itself: every org's staff read this list.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireDirectoryEditor } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createCoach } from "@/lib/actions/coaches";
import { CoachForm } from "@/components/CoachForm";
import { Screen } from "@/components/kit";

export default async function NewCoachPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireDirectoryEditor(org.id);

  const supabase = await createClient();
  const { data: school } = await supabase.from("schools").select("id, name").eq("id", id).maybeSingle();
  if (!school) notFound();

  return (
    <Screen title="Add a Coach" back={{ href: `/org/${slug}/schools/${id}/coaches`, label: "Coaches" }} lede={`${school.name}. Shared with every organization.`}>
      <CoachForm action={createCoach.bind(null, slug, id)} submitLabel="Add Coach" />
    </Screen>
  );
}
