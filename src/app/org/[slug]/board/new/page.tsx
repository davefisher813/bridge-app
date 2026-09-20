import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createTarget } from "@/lib/actions/targets";
import { TargetForm } from "@/components/TargetForm";
import { EmptyState, LinkButton, Screen, TextLink } from "@/components/kit";

export default async function NewTargetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const isOwner = user.role === "owner";

  const supabase = await createClient();
  const [{ data: athleteRows }, { data: schoolRows }] = await Promise.all([
    supabase.from("athletes").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase.from("schools").select("id, name, division").order("name"),
  ]);

  const athletes = (athleteRows ?? []).map((a) => ({ id: a.id, label: a.name }));
  const schools = (schoolRows ?? []).map((s) => ({ id: s.id, label: `${s.name} (${s.division})` }));

  const action = createTarget.bind(null, slug);

  return (
    <Screen
      title="Add Target"
      back={{ href: `/org/${slug}/board`, label: "Board" }}
      action={isOwner ? <TextLink href={`/org/${slug}/schools/new`}>New School</TextLink> : undefined}
    >
      {athletes.length === 0 ? (
        <>
          <EmptyState kind="athlete" title="No Athletes on the Roster Yet" action={<LinkButton href={`/org/${slug}/roster/new`}>Add an Athlete</LinkButton>}>
            A target is one athlete pointed at one school, so the athlete comes first.
          </EmptyState>
        </>
      ) : schools.length === 0 ? (
        <>
          <EmptyState kind="school" title="No Schools on File Yet" action={isOwner && <LinkButton href={`/org/${slug}/schools/new`}>Add the First School</LinkButton>}>
            Schools are shared across every org, so only an owner can add one.{isOwner ? "" : " Ask an owner to add one."}
          </EmptyState>
        </>
      ) : (
        <TargetForm action={action} athletes={athletes} schools={schools} submitLabel="Add Target" />
      )}
    </Screen>
  );
}
