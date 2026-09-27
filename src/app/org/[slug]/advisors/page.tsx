import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/org/roleLabels";
import { loadAdvisorCounts, loadStaff } from "@/lib/data/staff";
import { Avatar, Chevron, EmptyState, Row, Screen, Section } from "@/components/kit";

// Advisors (Stage 5, Phase 3): every Admin and how many athletes each
// one advises, with the way into the person's page, where the bulk
// assignment lives. Only an athlete still being recruited counts, the
// same rule as the check-in reminders, and the lede says so. The
// unassigned count is a sentence in the lede rather than a row: the
// roster has no "no advisor" filter yet, and a row that goes nowhere
// would raise the clickable baseline.
export default async function AdvisorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [staff, counts] = await Promise.all([loadStaff(supabase, org.id), loadAdvisorCounts(supabase, org.id)]);

  const athletes = (n: number) => `${n} ${n === 1 ? "athlete" : "athletes"}`;
  const unassigned = counts.unassigned === 0 ? "Every one of them has an advisor." : `${athletes(counts.unassigned)} ${counts.unassigned === 1 ? "has" : "have"} no advisor yet.`;

  return (
    <Screen title="Advisors" back={{ href: `/org/${slug}/more`, label: "More" }} lede={`Active and Transferring athletes each Admin advises. ${unassigned}`}>
      <Section label="Admins" count={staff.length} role="people" kind="people">
        {staff.map((p) => (
          <Row key={p.id} href={`/org/${slug}/members/${p.id}`} leading={<Avatar name={p.name} />} title={p.name} meta={`${personLabel(p)} · ${athletes(counts.byAdvisor.get(p.id) ?? 0)}`} trailing={<Chevron />} wrap />
        ))}
        {staff.length === 0 && (
          <EmptyState kind="people" title="No Admins Yet">
            Which cannot be right, since you are reading this.
          </EmptyState>
        )}
      </Section>
    </Screen>
  );
}
