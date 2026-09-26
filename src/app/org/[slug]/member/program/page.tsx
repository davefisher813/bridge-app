import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireMember } from "@/lib/auth/guard";
import { classOf, loadProgram, programPlacementLine, wentToCollege, type ProgramAthlete } from "@/lib/data/member";
import { stageKind, statusRole } from "@/components/statusHue";
import { Avatar, Chip, EmptyState, Row, Screen, Section, Stat, StatRow } from "@/components/kit";

export const dynamic = "force-dynamic";

// The program, as a member sees it: each athlete as a name and where
// they stand. No grades, no numbers, no record to open (Dave's pick in
// the Board Access catalog, 2026-09-21). The stages come from the
// database's member_program(), which is the whole of what a member can
// read about an athlete.

function stageChip(a: ProgramAthlete) {
  if (a.stage === "Enrolled" || a.stage === "Graduated" || a.stage === "Drafted") return <Chip label={a.stage} kind={stageKind(a.stage)} role={statusRole(a.stage)} />;
  if (a.stage === "Committed") return <Chip label="Committed" kind={stageKind("Committed")} role="committed" />;
  if (a.stage === "Offers") return <Chip label={a.offers === 1 ? "1 Offer" : `${a.offers} Offers`} kind={stageKind("Offer")} role="offer" />;
  if (a.stage === "Targeting") return <Chip label="Targeting" kind={stageKind("Target")} role={statusRole("Target")} />;
  return <Chip label="No Targets" kind="info" />;
}

export default async function MemberProgramPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  await requireMember(org.id);
  const base = `/org/${slug}/member`;

  const program = await loadProgram(org.id);
  // Enrolled and Graduated athletes committed first, so they count here
  // too; a Drafted athlete went pro instead.
  const committed = program.filter(wentToCollege).length;
  const withOffers = program.filter((a) => a.stage === "Offers").length;
  const targeting = program.filter((a) => a.stage === "Targeting").length;

  return (
    <Screen title="Program" lede={`${program.length} ${program.length === 1 ? "athlete" : "athletes"}`}>
      <StatRow>
        <Stat value={committed} label="Committed" role="committed" kind={stageKind("Committed")} />
        <Stat value={withOffers} label="With Offers" role="offer" kind={stageKind("Offer")} />
        <Stat value={targeting} label="Targeting" role={statusRole("Target")} kind={stageKind("Target")} />
      </StatRow>

      <Section label="Athletes" count={program.length} role="people" kind="athlete">
        {program.length === 0 ? (
          <EmptyState kind="athlete" title="No Athletes Yet">
            {org.name} has not added anyone to the program.
          </EmptyState>
        ) : (
          program.map((a) => (
            <Row
              key={a.id}
              href={`${base}/program/${a.id}`}
              leading={<Avatar name={a.name} />}
              title={a.name}
              meta={`${classOf(a)}${a.position ? ` · ${a.position}` : ""}${programPlacementLine(a) ? ` · ${programPlacementLine(a)}` : ""}`}
              trailing={stageChip(a)}
              wrap
            />
          ))
        )}
      </Section>
    </Screen>
  );
}
