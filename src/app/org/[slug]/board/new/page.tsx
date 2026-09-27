import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { isDirectoryEditor, requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createTarget } from "@/lib/actions/targets";
import { loadCoachSuggestionsBySchool } from "@/lib/data/coaches";
import { TargetForm } from "@/components/TargetForm";
import { EmptyState, LinkButton, Screen, TextLink } from "@/components/kit";

export default async function NewTargetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  // New School writes the shared directory, so it is offered only to a
  // directory editor (migration 0040), never to every owner.
  const canEditDirectory = await isDirectoryEditor(user);

  const supabase = await createClient();
  const [{ data: athleteRows }, { data: schoolRows }] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("schools").select("id, name, division").order("name"),
  ]);

  const athletes = (athleteRows ?? []).map((a) => ({ id: a.id, label: a.name }));
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));
  // The directory's coaches at every school, so Coach suggests the
  // picked school's staff without a round trip (Stage 4, B1).
  const coaches = await loadCoachSuggestionsBySchool(supabase);

  const action = createTarget.bind(null, slug);

  return (
    <Screen
      title="Add Target"
      back={{ href: `/org/${slug}/board`, label: "Targets" }}
      action={canEditDirectory ? <TextLink href={`/org/${slug}/schools/new`}>New School</TextLink> : undefined}
    >
      {athletes.length === 0 ? (
        <>
          <EmptyState kind="athlete" title="No Athletes on the Roster Yet" action={<LinkButton href={`/org/${slug}/roster/new`}>Add an Athlete</LinkButton>}
          />
        </>
      ) : schools.length === 0 ? (
        <>
          <EmptyState kind="school" title="No Schools on File Yet" action={canEditDirectory && <LinkButton href={`/org/${slug}/schools/new`}>Add the First School</LinkButton>}>
            {canEditDirectory ? "Schools are shared across every org." : "Schools are shared across every org and added by the organization that keeps the list."}
          </EmptyState>
        </>
      ) : (
        <TargetForm action={action} athletes={athletes} schools={schools} coaches={coaches} submitLabel="Add Target" />
      )}
    </Screen>
  );
}
