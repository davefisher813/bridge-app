import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { reopenRecruiting } from "@/lib/actions/reopen";
import { ReopenForm } from "@/components/ReopenForm";
import { StatusPill } from "@/components/StatusPill";
import { statusRole, stageKind } from "@/components/statusHue";
import { canReopen, currentSchoolOf } from "@/lib/placement";
import { RECRUIT_TYPES } from "@/lib/validation/athlete";
import { Notice, Row, Screen, Section } from "@/components/kit";

interface TargetRow {
  id: string;
  status: string;
  closed_from: string | null;
  schools: { name: string; division: string | null } | { name: string; division: string | null }[] | null;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

// Reopen Recruiting for an athlete who enrolled or graduated and is
// leaving: the schools the close-out shut come back as they were, the
// commitment becomes history, and the athlete is scored again as a
// transfer. Shows exactly what changes before it happens, the way Mark
// Enrolled does. A Committed athlete never lands here; withdrawing a
// commitment is one confirm on the profile.
export default async function ReopenRecruitingPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const { data: athlete } = await supabase.from("athletes").select("id, name, status, detail").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle();
  if (!athlete) notFound();
  if (!canReopen(athlete.status) || athlete.status === "Committed") notFound();

  const { data: targetRows } = await supabase.from("recruiting_targets").select("id, status, closed_from, schools(name, division)").eq("athlete_id", id).eq("org_id", org.id);
  const targets = ((targetRows ?? []) as TargetRow[]).map((t) => ({ id: t.id, status: t.status, closedFrom: t.closed_from, school: unwrap(t.schools) }));
  const committed = targets.find((t) => t.status === "Committed");
  const reopening = targets.filter((t) => t.status === "Not Interested" && !!t.closedFrom);

  const currentSchool = committed?.school?.name ?? currentSchoolOf(athlete.detail) ?? "";
  const placementHref = committed ? `/org/${slug}/board/${committed.id}` : `/org/${slug}/roster/${id}/edit`;
  const kinds = RECRUIT_TYPES.filter((r) => r.value !== "hs");

  return (
    <Screen title="Reopen Recruiting" back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}>
      <Row
        href={placementHref}
        kind={stageKind(athlete.status)}
        role={statusRole(athlete.status)}
        title={currentSchool || "School Not on File"}
        trailing={<StatusPill status={athlete.status} />}
      />

      {reopening.length > 0 ? (
        <Section label="Will Reopen" count={reopening.length} role="place" kind="school">
          {reopening.map((t) => (
            <Row
              key={t.id}
              href={`/org/${slug}/board/${t.id}`}
              kind="school"
              role={statusRole(t.closedFrom ?? "In Contact")}
              title={t.school?.name ?? "Unknown School"}
              meta={t.school?.division ?? undefined}
              trailing={<StatusPill status={t.closedFrom ?? "In Contact"} />}
            />
          ))}
        </Section>
      ) : (
        <Notice tone="info" title="No Schools Come Back">
          Nothing was closed by the close-out, so the list starts empty. Pick new targets from Matches once they are scored again.
        </Notice>
      )}

      {committed && (
        <Section label="Will Close" count={1} role="place" kind="school">
          <Row
            href={`/org/${slug}/board/${committed.id}`}
            kind="school"
            role={statusRole("Committed")}
            title={committed.school?.name ?? "Unknown School"}
            meta="The commitment becomes history, not a live target."
            trailing={<StatusPill status="Committed" />}
            wrap
          />
        </Section>
      )}

      <Notice tone="warning" title="The Record Becomes a Transfer Record">
        The high school detail (grad year, test scores, AP counts) is replaced by the transfer facts below. NCAA eligibility and the enrollment clock stay as they are.
      </Notice>

      <ReopenForm
        action={reopenRecruiting.bind(null, slug, id)}
        kinds={kinds}
        defaults={{ transferKind: athlete.status === "Graduated" ? "transfer_grad" : "transfer_4to4", currentSchool, transferCount: 1 }}
      />
    </Screen>
  );
}
