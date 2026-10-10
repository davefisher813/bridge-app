import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { personLabel } from "@/lib/org/roleLabels";
import { loadAdvisorCounts, loadStaff } from "@/lib/data/staff";
import { photoUrl } from "@/lib/people/photo";
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
  const me = await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [staff, counts] = await Promise.all([loadStaff(supabase, org.id), loadAdvisorCounts(supabase, org.id)]);

  const athletes = (n: number) => `${n} ${n === 1 ? "athlete" : "athletes"}`;
  // Only athletes still being recruited are counted (placed ones, like
  // Committed or Enrolled, need no advisor), so the sentence says so and
  // the row opens exactly those athletes (Alfred's audit, 2026-10-10: the
  // bare "11 have no advisor" read as wrong next to 34 on the roster).
  const unassigned =
    counts.unassigned === 0
      ? "Every athlete still being recruited has an advisor."
      : `${athletes(counts.unassigned)} still being recruited ${counts.unassigned === 1 ? "has" : "have"} no advisor yet. Placed athletes are not counted.`;

  // The same split as Members: someone who has never signed in is
  // invited, not yet one of the Admins, so the two screens count alike.
  // The caller is always in, they are reading this.
  const active = staff.filter((p) => p.signedIn || p.id === me.id);
  const invited = staff.filter((p) => !(p.signedIn || p.id === me.id));
  // Two sign-ins can carry the same name (one person with a personal and
  // a work address, audit issue #1). Each is a real account, so neither
  // is hidden; the email tells them apart.
  const sameName = new Set(staff.filter((p, i) => staff.findIndex((q) => q.name === p.name) !== i).map((p) => p.name));
  const row = (p: (typeof staff)[number]) => (
    <Row key={p.id} href={`/org/${slug}/members/${p.id}`} leading={<Avatar name={p.name} photo={photoUrl(slug, p.id, p.photoPath)} />} title={p.name} meta={`${personLabel(p)} · ${athletes(counts.byAdvisor.get(p.id) ?? 0)}${sameName.has(p.name) && p.email ? ` · ${p.email}` : ""}`} trailing={<Chevron />} wrap />
  );

  return (
    <Screen title="Advisors" back={{ href: `/org/${slug}/more`, label: "More" }} lede={unassigned}>
      {counts.unassigned > 0 && (
        <Row href={`/org/${slug}/roster?advisor=none`} kind="athlete" role="time" title="No Advisor Yet" meta={`${athletes(counts.unassigned)} still being recruited`} trailing={<Chevron />} wrap />
      )}
      <Section label="Admins" count={active.length} role="people" kind="people">
        {active.map(row)}
        {active.length === 0 && (
          <EmptyState kind="people" title="No Admins Yet" />
        )}
      </Section>
      {invited.length > 0 && (
        <Section label="Invited" count={invited.length} role="time" kind="clock">
          {invited.map(row)}
        </Section>
      )}
    </Screen>
  );
}
