import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createAssignment } from "@/lib/actions/assignments";
import { AssignmentForm } from "@/components/AssignmentForm";
import { Screen } from "@/components/kit";

export const dynamic = "force-dynamic";

// A new assignment for one athlete (migration 0046). Admins only.
export default async function NewAssignmentPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();

  return (
    <Screen title="New Assignment" back={{ href: `/org/${slug}/roster/${id}/assignments`, label: "Assignments" }} lede={athlete.name}>
      <AssignmentForm action={createAssignment.bind(null, slug, id)} />
    </Screen>
  );
}
