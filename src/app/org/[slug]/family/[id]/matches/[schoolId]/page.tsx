import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { createClient } from "@/lib/supabase/server";
import { requireFamily, requireFamilyAthlete } from "@/lib/data/family";
import { loadFitsForAthlete, rowToFit } from "@/lib/data/fits";
import { StatusPill } from "@/components/StatusPill";
import { Body, Figure, Label, Row, Screen, Section, Stack, TextLink } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import type { RowKind } from "@/components/RowGlyph";
import { scoreRole } from "@/components/statusHue";
import type { DimensionResult } from "@/lib/fit/types";

export const dynamic = "force-dynamic";

// One match, in full, for a family: the score, the tag, the four
// dimensions and every reason and warning under them. Dave's pick
// (2026-09-21): the same reasoning staff see, because it was written
// for a family to read in the first place.

const DIM: Array<{ key: "academic" | "athletic" | "financial" | "eligibility"; label: string; kind: RowKind; asks: string }> = [
  { key: "academic", label: "Academic", kind: "course", asks: "Can they get in, and stay in." },
  { key: "athletic", label: "Athletic", kind: "target", asks: "Do the measurables reach this level of play." },
  { key: "financial", label: "Financial", kind: "money", asks: "What this actually costs the family." },
  { key: "eligibility", label: "Eligibility", kind: "checklist", asks: "Whether the NCAA lets them compete, and when." },
];

const CONFIDENCE_NOTE: Record<string, string> = {
  high: "Based on numbers specific to this school and this athlete.",
  medium: "Based on partial numbers. Some are a division default rather than this school's own.",
  low: "Mostly division defaults. A starting point, not a finding.",
  unknown: "Not enough on file to judge. A placeholder, not a measurement.",
};

export default async function FamilyMatchPage({ params }: { params: Promise<{ slug: string; id: string; schoolId: string }> }) {
  const { slug, id, schoolId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireFamily(org.id);
  const { athlete } = await requireFamilyAthlete(org.id, user.id, id);
  const base = `/org/${slug}/family`;

  const supabase = await createClient();
  const [fits, { data: targetRows }] = await Promise.all([
    loadFitsForAthlete(supabase, org.id, id),
    supabase.from("recruiting_targets").select("id, status").eq("athlete_id", id).eq("school_id", schoolId).eq("org_id", org.id),
  ]);
  const row = fits.find((f) => f.school_id === schoolId);
  if (!row) notFound();
  const fit = rowToFit(row);
  const target = ((targetRows ?? []) as { id: string; status: string }[])[0];

  return (
    <Screen
      title={row.school.name}
      back={{ href: `${base}/${id}/matches`, label: "Matches" }}
      lede={[row.school.division, row.school.conference, row.school.state].filter(Boolean).join(" · ")}
      action={
        <div className="text-right">
          <Figure tone={scoreRole(fit.score)}>{fit.score}</Figure>
          <Label>{fit.tag}</Label>
        </div>
      }
    >
      {fit.reasons.length > 0 && <Note>{fit.reasons[0]}</Note>}

      {target && (
        <Row href={`${base}/colleges/${target.id}`} kind="school" role="place" title="On the List" meta="Where things stand with this school" trailing={<StatusPill status={target.status} />} />
      )}

      <Section label="How the Score Is Built" role="contact" kind="target">
        {DIM.map(({ key, label, kind, asks }) => {
          const d = fit[key] as DimensionResult | undefined;
          if (!d) return null;
          const role = d.veto ? "offer" : d.score >= 70 ? "committed" : d.score >= 40 ? "contact" : "target";
          return (
            <Stack key={key} gap={2}>
              <Row
                kind={d.veto ? "warning" : kind}
                role={role}
                title={d.veto ? `${label} · sets the score by itself` : label}
                meta={asks}
                trailing={
                  <Body weight="bold" numeric>
                    {d.score}
                  </Body>
                }
                wrap
              />
              {d.reasons.map((r, i) => (
                <Note key={`r${i}`}>{r}</Note>
              ))}
              {d.warnings.map((w, i) => (
                <Note key={`w${i}`} title="Could Still Change">
                  {w}
                </Note>
              ))}
              <Label>{CONFIDENCE_NOTE[d.confidence] ?? "No confidence reported."}</Label>
            </Stack>
          );
        })}
      </Section>

      {fit.warnings.length > 0 && (
        <Section label="Worth Knowing" count={fit.warnings.length} role="offer" kind="warning">
          {fit.warnings.map((w) => (
            <Note key={w}>{w}</Note>
          ))}
        </Section>
      )}

      <TextLink href={`${base}/${id}`}>Back to {athlete.name}</TextLink>
    </Screen>
  );
}
