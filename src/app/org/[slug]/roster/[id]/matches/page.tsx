// Every school on file, ranked for one athlete. docs/MATCHING_CONTRACT.md
// section 2: score high to low, the first reason on the second line,
// filters with none on by default, Add to Board on every row, conflicts
// at the bottom under their own rule saying what blocks each one.
//
// A screen reads stored rows; it never scores. The rows come from
// athlete_school_fits, written by whichever action last changed an
// input. The filters read school facts, not the score, so they are
// applied here in memory over the list the store returned.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { addMatchToBoard } from "@/lib/actions/matching";
import { loadFitsForAthlete } from "@/lib/data/fits";
import { MatchFilters, type MatchFilterValues } from "@/components/MatchFilters";
import { StatusPill } from "@/components/StatusPill";
import { PROGRAM_TIERS } from "@/lib/fit/contract";
import type { FitTag } from "@/lib/fit/types";
import { Body, Button, EmptyState, Form, Label, Notice, Row, Score, Screen, Section, Stack, TextLink } from "@/components/kit";

export const dynamic = "force-dynamic";

const TAG_TONE: Record<FitTag, "committed" | "ink" | "muted" | "danger"> = {
  Safety: "committed",
  Fit: "ink",
  Reach: "muted",
  Conflict: "danger",
  Unknown: "muted",
};

interface SchoolFacts {
  id: string;
  division: string;
  conference: string | null;
  state: string | null;
  program_tier: string | null;
  majors: string[] | null;
  sports_sponsored: string[] | null;
  financials: { athleticScholarship?: string; instateTotal?: number; outstateTotal?: number } | null;
  athletics: { playingTimeOutlook?: string } | null;
}

function pick(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

export default async function MatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();
  const [{ data: athlete }, fits, { data: schoolRows }, { data: targetRows }] = await Promise.all([
    supabase.from("athletes").select("id, name, sport, position, home_state").eq("id", id).eq("org_id", org.id).is("deleted_at", null).single(),
    loadFitsForAthlete(supabase, org.id, id),
    supabase.from("schools").select("id, division, conference, state, program_tier, majors, sports_sponsored, financials, athletics"),
    supabase.from("recruiting_targets").select("id, school_id, status").eq("athlete_id", id).eq("org_id", org.id),
  ]);
  if (!athlete) notFound();

  const facts = new Map(((schoolRows ?? []) as SchoolFacts[]).map((s) => [s.id, s]));
  const targetBySchool = new Map(((targetRows ?? []) as { id: string; school_id: string; status: string }[]).map((t) => [t.school_id, t]));

  const filters: MatchFilterValues = {
    division: pick(sp.division),
    state: pick(sp.state),
    conference: pick(sp.conference),
    major: pick(sp.major),
    cost: pick(sp.cost),
    aid: pick(sp.aid),
    outlook: pick(sp.outlook),
  };

  const sport = (athlete.sport ?? "").toLowerCase();
  const home = athlete.home_state ?? null;

  // Sport sponsored always applies: a school that lists sports and not
  // this one is out. A school with no list is unknown, and stays.
  const sponsors = (s: SchoolFacts | undefined) => {
    const list = (s?.sports_sponsored ?? []).map((x) => x.toLowerCase());
    return list.length === 0 || list.includes(sport);
  };
  const costFor = (s: SchoolFacts | undefined) => {
    const f = s?.financials ?? {};
    const inState = home && s?.state && home === s.state;
    return inState ? (f.instateTotal ?? f.outstateTotal) : (f.outstateTotal ?? f.instateTotal);
  };

  const all = fits.filter((f) => sponsors(facts.get(f.school_id)));
  const shown = all.filter((f) => {
    const s = facts.get(f.school_id);
    if (filters.division && s?.division !== filters.division) return false;
    if (filters.state && s?.state !== filters.state) return false;
    if (filters.conference && s?.conference !== filters.conference) return false;
    if (filters.major && !(s?.majors ?? []).some((m) => m.toLowerCase() === filters.major!.toLowerCase())) return false;
    if (filters.cost) {
      const c = costFor(s);
      if (c === undefined || c > Number(filters.cost)) return false;
    }
    if (filters.aid && (s?.financials?.athleticScholarship ?? "") !== filters.aid) return false;
    if (filters.outlook && (s?.athletics?.playingTimeOutlook ?? "") !== filters.outlook) return false;
    return true;
  });

  const ranked = shown.filter((f) => f.tag !== "Conflict");
  const conflicts = shown.filter((f) => f.tag === "Conflict");

  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const options = {
    divisions: uniq(all.map((f) => facts.get(f.school_id)?.division)),
    states: uniq(all.map((f) => facts.get(f.school_id)?.state)),
    conferences: uniq(all.map((f) => facts.get(f.school_id)?.conference)),
    majors: uniq(all.flatMap((f) => facts.get(f.school_id)?.majors ?? [])),
  };
  const filtering = Object.values(filters).some(Boolean);
  const tierLabel = (key: string | null | undefined) => PROGRAM_TIERS.find((t) => t.key === key)?.label;

  const matchRow = (f: (typeof fits)[number], dim: boolean) => {
    const s = facts.get(f.school_id);
    const target = targetBySchool.get(f.school_id);
    const line = dim ? (f.warnings[0] ?? f.reasons[0] ?? "Blocked") : f.partial ? (f.warnings[0] ?? "Partial score") : (f.reasons[0] ?? f.warnings[0] ?? "");
    const meta = [f.school.division, s?.state, tierLabel(s?.program_tier)].filter(Boolean).join(" · ");
    return (
      <Stack key={f.school_id} gap={2}>
        <Row
          href={`/org/${slug}/schools/${f.school_id}`}
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
        <div className="flex items-center justify-between gap-3">
          {target ? (
            <>
              <StatusPill status={target.status} />
              <TextLink href={`/org/${slug}/board/${target.id}`}>Open on Board</TextLink>
            </>
          ) : canEdit ? (
            <Form action={addMatchToBoard.bind(null, slug, id, f.school_id)}>
              <Button inline variant="secondary">
                Make a Target
              </Button>
            </Form>
          ) : (
            <Label>Not a target yet</Label>
          )}
        </div>
      </Stack>
    );
  };

  return (
    <Screen
      title="Matches"
      back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}
      lede={`${all.length} ${all.length === 1 ? "school" : "schools"} scored for ${athlete.name}${filtering ? ` · ${shown.length} match the filters` : ""}`}
    >
      {all.length === 0 ? (
        <EmptyState kind="target" title="No Matches Yet">
          {canEdit ? "Save the athlete once and every school on file is scored against them." : "Every school on file is scored once the record is saved."}
        </EmptyState>
      ) : (
        <>
          <MatchFilters values={filters} options={options} />

          <Section label="Ranked" count={ranked.length} role="place" kind="target">
            {ranked.length === 0 ? (
              <EmptyState kind="target" title="Nothing Matches These Filters">
                Loosen one and the list comes back.
              </EmptyState>
            ) : (
              ranked.map((f) => matchRow(f, false))
            )}
          </Section>

          {ranked.some((f) => f.partial) && (
            <Notice tone="info" title="Some Scores Are Partial">
              A dimension with no data on file is left out and the rest are reweighted. Add the missing numbers and the score fills in.
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
