import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { markDrafted } from "@/lib/actions/enrollment";
import { DraftForm } from "@/components/DraftForm";
import { StatusPill } from "@/components/StatusPill";
import { statusRole } from "@/components/statusHue";
import { Row, Screen, Section } from "@/components/kit";

interface TargetRow {
  id: string;
  status: string;
  schools: { name: string } | { name: string }[] | null;
}

// Drafted (Dave, 2026-09-26): the team, round and year. Can follow any
// other status; on an athlete already Drafted it corrects the details.
export default async function DraftAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name, status, draft_team, draft_round, draft_year").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();
  const already = athlete.status === "Drafted";

  const { data: targetRows } = already ? { data: [] } : await supabase.from("recruiting_targets").select("id, status, schools(name)").eq("athlete_id", id).eq("org_id", org.id);
  const closing = ((targetRows ?? []) as TargetRow[])
    .filter((t) => t.status !== "Committed" && t.status !== "Not Interested")
    .map((t) => ({ id: t.id, status: t.status, schoolName: (Array.isArray(t.schools) ? t.schools[0] : t.schools)?.name ?? "Unknown school" }));

  return (
    <Screen title={already ? "Draft Details" : "Mark Drafted"} back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}>
      {closing.length > 0 && (
        <Section label="Will Close" count={closing.length} role="place" kind="school">
          {closing.map((t) => (
            <Row key={t.id} href={`/org/${slug}/board/${t.id}`} kind="school" role={statusRole(t.status)} title={t.schoolName} trailing={<StatusPill status={t.status} />} />
          ))}
        </Section>
      )}
      <DraftForm
        action={markDrafted.bind(null, slug, id)}
        initial={{ team: athlete.draft_team ?? undefined, round: athlete.draft_round ?? undefined, year: athlete.draft_year ?? new Date().getFullYear() }}
        submitLabel={already ? "Save Changes" : "Mark Drafted"}
      />
    </Screen>
  );
}
