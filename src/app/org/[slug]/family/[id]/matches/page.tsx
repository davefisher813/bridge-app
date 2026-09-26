import { closedSentence, isClosedStatus } from "@/lib/placement";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { loadFitsForAthlete } from "@/lib/data/fits";
import { StatusPill } from "@/components/StatusPill";
import { PROGRAM_TIERS } from "@/lib/fit/contract";
import type { FitTag } from "@/lib/fit/types";
import { Body, EmptyState, Label, LinkButton, Notice, Row, Score, Screen, Section, Stack } from "@/components/kit";

export const dynamic = "force-dynamic";

// Every school on file, ranked for one athlete, as the family reads it.
// Same stored rows the staff screen reads, no filters, no Add to Board:
// each row opens the full reasoning.

const TAG_TONE: Record<FitTag, "committed" | "ink" | "muted" | "danger"> = {
  Safety: "committed",
  Fit: "ink",
  Reach: "muted",
  Conflict: "danger",
  Unknown: "muted",
};

interface SchoolFacts {
  id: string;
  state: string | null;
  program_tier: string | null;
  sports_sponsored: string[] | null;
}

export default async function FamilyMatchesPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const { athlete } = await requireFamilyAthlete(org.id, user.id, id);
  const here = `/org/${slug}/family/${id}`;

  if (isClosedStatus(athlete.status)) {
    // Recruiting is over for this athlete; nothing left to rank
    // against. Dave, 2026-09-26.
    return (
      <Screen title={athlete.name} back={{ href: here, label: "Back" }}>
        <EmptyState kind="target" title={athlete.status} action={<LinkButton href={here}>Back to {athlete.name}</LinkButton>}>
          {closedSentence(athlete.status, athlete.name)}
        </EmptyState>
      </Screen>
    );
  }

  const supabase = await createClient();
  const [fits, { data: schoolRows }, { data: targetRows }] = await Promise.all([
    loadFitsForAthlete(supabase, org.id, id),
    supabase.from("schools").select("id, state, program_tier, sports_sponsored"),
    supabase.from("recruiting_targets").select("id, school_id, status").eq("athlete_id", id).eq("org_id", org.id),
  ]);

  const facts = new Map(((schoolRows ?? []) as SchoolFacts[]).map((s) => [s.id, s]));
  const targetBySchool = new Map(((targetRows ?? []) as { id: string; school_id: string; status: string }[]).map((t) => [t.school_id, t]));
  const sport = athlete.sport.toLowerCase();
  const sponsors = (s: SchoolFacts | undefined) => {
    const list = (s?.sports_sponsored ?? []).map((x) => x.toLowerCase());
    return list.length === 0 || list.includes(sport);
  };
  const all = fits.filter((f) => sponsors(facts.get(f.school_id)));
  const ranked = all.filter((f) => f.tag !== "Conflict");
  const conflicts = all.filter((f) => f.tag === "Conflict");
  const tierLabel = (key: string | null | undefined) => PROGRAM_TIERS.find((t) => t.key === key)?.label;

  const matchRow = (f: (typeof fits)[number], dim: boolean) => {
    const s = facts.get(f.school_id);
    const target = targetBySchool.get(f.school_id);
    const line = dim ? (f.warnings[0] ?? f.reasons[0] ?? "Blocked") : f.partial ? (f.warnings[0] ?? "Partial score") : (f.reasons[0] ?? f.warnings[0] ?? "");
    const meta = [f.school.division, s?.state, tierLabel(s?.program_tier)].filter(Boolean).join(" · ");
    return (
      <Stack key={f.school_id} gap={2}>
        <Row
          href={`${here}/matches/${f.school_id}`}
          kind="school"
          role={dim ? "danger" : f.tag === "Safety" ? "committed" : "place"}
          title={dim ? <Body tone="muted" weight="semibold">{f.school.name}</Body> : f.school.name}
          meta={`${meta} · ${line}`}
          wrap
          trailing={
            <>
              <Score score={f.score} />
              <Label tone={TAG_TONE[f.tag as FitTag] ?? "muted"}>{f.tag}</Label>
            </>
          }
        />
        {target && (
          <div className="flex items-center justify-between gap-3">
            <StatusPill status={target.status} />
            <Label>On the list</Label>
          </div>
        )}
      </Stack>
    );
  };

  return (
    <Screen title="Matches" back={{ href: here, label: athlete.name }} lede={`${all.length} ${all.length === 1 ? "school" : "schools"} scored for ${athlete.name}`}>
      {all.length === 0 ? (
        <EmptyState kind="target" title="No Matches Yet">
          Every school on file is scored once the record is complete.
        </EmptyState>
      ) : (
        <>
          <Section label="Ranked" count={ranked.length} role="place" kind="target">
            {ranked.map((f) => matchRow(f, false))}
          </Section>

          {ranked.some((f) => f.partial) && (
            <Notice tone="info" title="Some Scores Are Partial">
              A dimension with nothing on file is left out and the rest are reweighted. The score fills in once the missing numbers are logged.
            </Notice>
          )}

          {conflicts.length > 0 && (
            <Section label="Conflicts" count={conflicts.length} role="danger" kind="blocked">
              <Label>Each of these has something that blocks it. The line under the school says what.</Label>
              {conflicts.map((f) => matchRow(f, true))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
