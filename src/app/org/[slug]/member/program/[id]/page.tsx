import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireMember } from "@/lib/auth/guard";
import { classOf, loadProgram, loadProgramSchools } from "@/lib/data/member";
import { StatusPill } from "@/components/StatusPill";
import { EmptyState, Row, Screen, Section } from "@/components/kit";

export const dynamic = "force-dynamic";

// One athlete, as a member sees them: the schools and where each
// stands (Dave's pick, 2026-09-21). Not the calls, the notes, the
// visits, the offer terms or the coach's contact, which stay with staff.

export default async function MemberAthletePage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireMember(org.id);
  const base = `/org/${slug}/member`;

  const [program, schools] = await Promise.all([loadProgram(org.id), loadProgramSchools(org.id, id)]);
  const athlete = program.find((a) => a.id === id);
  if (!athlete) notFound();

  return (
    <Screen title={athlete.name} back={{ href: `${base}/program`, label: "Program" }} lede={`${athlete.sport}${athlete.position ? ` · ${athlete.position}` : ""} · ${classOf(athlete)}`}>
      <Section label="Schools" count={schools.length} role="place" kind="school">
        {schools.length === 0 ? (
          <EmptyState kind="school" title="No Target Schools Yet">
            {org.name} has not named a school for {athlete.name} yet.
          </EmptyState>
        ) : (
          schools.map((s) => <Row key={s.targetId} kind="school" role="place" title={s.schoolName} meta={s.division} trailing={<StatusPill status={s.status} />} wrap />)
        )}
      </Section>
    </Screen>
  );
}
