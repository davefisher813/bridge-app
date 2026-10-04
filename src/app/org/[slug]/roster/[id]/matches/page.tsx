// Every school on file, ranked for one athlete. docs/MATCHING_CONTRACT.md
// section 2, amended 2026-09-27: fully scored first, then partial, each
// by score (src/lib/fit/rank.ts); a search by school name and a sort at
// the top; the filters, none on by default; a compact row with the
// target action inside it; 25 rows then Show More; conflicts at the
// bottom under their own rule saying what blocks each one.
//
// A screen reads stored rows; it never scores and never orders on its
// own. The rows come from athlete_school_fits, written by whichever
// action last changed an input, and every list here goes through
// rankFits with the sort the address carries. The filters read school
// facts, not the score, so they are applied here in memory over the
// list the store returned.

import { closedSentence, isScoredStatus } from "@/lib/placement";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { addMatchToBoard } from "@/lib/actions/matching";
import { loadFitsForAthlete, type LoadedFit } from "@/lib/data/fits";
import { parseFitSort, partialLabelFor, rankFits, FIT_SORTS, type FitSort } from "@/lib/fit/rank";
import { MatchFilters, type MatchFilterValues } from "@/components/MatchFilters";
import { MatchSort } from "@/components/MatchSort";
import { SearchField } from "@/components/SearchField";
import { StatusPill } from "@/components/StatusPill";
import { SCHOOL_DIVISIONS } from "@/lib/validation/school";
import { regionOf } from "@/lib/fit/regions";
import { Body, Button, EmptyState, Form, Inline, Label, LinkButton, Notice, Row, Screen, Section, TextLink } from "@/components/kit";

export const dynamic = "force-dynamic";

// How many ranked rows show before Show More. Dave, 2026-09-27.
const PAGE = 25;

interface SchoolFacts {
  id: string;
  division: string;
  conference: string | null;
  state: string | null;
  majors: string[] | null;
  sports_sponsored: string[] | null;
  financials: { athleticScholarship?: string; instateTotal?: number; outstateTotal?: number } | null;
  athletics: { playingTimeOutlook?: string } | null;
}

function pick(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s.trim() : undefined;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

// The one fact the chosen sort adds to a row, so a list sorted by net
// cost shows the net cost it was sorted by, and one sorted by a
// dimension shows that dimension's score.
function sortFact(f: LoadedFit, sort: FitSort): string | undefined {
  if (sort === "net_cost") return typeof f.net_cost === "number" ? `${money(f.net_cost)} net` : "No cost on file";
  if (sort === "academic" || sort === "athletic" || sort === "financial") {
    const d = f.dimensions?.[sort] as { score?: number; confidence?: string } | undefined;
    const label = FIT_SORTS.find((s) => s.key === sort)?.label ?? sort;
    return d && typeof d.score === "number" && d.confidence !== "unknown" ? `${label} ${d.score}` : `${label} not scored`;
  }
  return undefined;
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
    supabase.from("athletes").select("id, name, sport, position, home_state, status").eq("id", id).eq("org_id", org.id).is("deleted_at", null).single(),
    loadFitsForAthlete(supabase, org.id, id),
    supabase.from("schools").select("id, division, conference, state, majors, sports_sponsored, financials, athletics"),
    supabase.from("recruiting_targets").select("id, school_id, status").eq("athlete_id", id).eq("org_id", org.id),
  ]);
  if (!athlete) notFound();

  if (!isScoredStatus(athlete.status)) {
    // Only an athlete who is actively recruiting is scored. Placed or
    // inactive, there is nothing to rank against, and the profile hides
    // Matches for the same reason. Dave, 2026-09-26.
    return (
      <Screen title={athlete.name} back={{ href: `/org/${slug}/roster/${id}`, label: "Back" }}>
        <EmptyState kind="target" title={athlete.status} action={<LinkButton href={`/org/${slug}/roster/${id}`}>Back to Athlete</LinkButton>}>
          {closedSentence(athlete.status, athlete.name)}
        </EmptyState>
      </Screen>
    );
  }

  const facts = new Map(((schoolRows ?? []) as SchoolFacts[]).map((s) => [s.id, s]));
  const targetBySchool = new Map(((targetRows ?? []) as { id: string; school_id: string; status: string }[]).map((t) => [t.school_id, t]));

  const filters: MatchFilterValues = {
    division: pick(sp.division),
    region: pick(sp.region),
    state: pick(sp.state),
    conference: pick(sp.conference),
    major: pick(sp.major),
    cost: pick(sp.cost),
    aid: pick(sp.aid),
    outlook: pick(sp.outlook),
  };
  const q = pick(sp.q);
  const sort = parseFitSort(sp.sort);
  // How many ranked rows to show: 25, or what the address asks for
  // after Show More, never fewer than 25 and never past the list.
  const asked = Number(pick(sp.show));
  const cap = Number.isFinite(asked) && asked > PAGE ? Math.min(Math.floor(asked), 10000) : PAGE;

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
  // The search runs over every school, by name, before the filters.
  const term = q?.toLowerCase();
  const shown = all.filter((f) => {
    if (term && !f.school.name.toLowerCase().includes(term)) return false;
    const s = facts.get(f.school_id);
    if (filters.division && s?.division !== filters.division) return false;
    if (filters.region && regionOf(s?.state) !== filters.region) return false;
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

  // One ranking rule, whatever order the rows arrived in.
  const ranked = rankFits(
    shown.filter((f) => f.tag !== "Conflict"),
    sort,
  );
  const conflicts = rankFits(
    shown.filter((f) => f.tag === "Conflict"),
    sort,
  );
  const visible = ranked.slice(0, cap);
  const more = ranked.length - visible.length;

  // Divisions keep the NCAA order (SCHOOL_DIVISIONS), so JUCO and NAIA
  // land where a coach expects them; the rest sort A to Z.
  const divisionIndex = (d: string) => {
    const i = (SCHOOL_DIVISIONS as readonly string[]).indexOf(d);
    return i === -1 ? SCHOOL_DIVISIONS.length : i;
  };
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
  const options = {
    divisions: uniq(all.map((f) => facts.get(f.school_id)?.division)).sort((a, b) => divisionIndex(a) - divisionIndex(b) || a.localeCompare(b)),
    regions: uniq(all.map((f) => regionOf(facts.get(f.school_id)?.state))),
    states: uniq(all.map((f) => facts.get(f.school_id)?.state)),
    conferences: uniq(all.map((f) => facts.get(f.school_id)?.conference)),
    majors: uniq(all.flatMap((f) => facts.get(f.school_id)?.majors ?? [])),
  };
  const filtering = Object.values(filters).some(Boolean);
  const narrowed = filtering || !!q;
  const narrowedBy = q && filtering ? "the search and filters" : q ? "the search" : "the filters";

  // Show More keeps everything else in the address and asks for one
  // more page.
  const moreHref = (() => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const s = pick(v);
      if (s && k !== "show") next.set(k, s);
    }
    next.set("show", String(cap + PAGE));
    return `/org/${slug}/roster/${id}/matches?${next.toString()}`;
  })();

  // The compact row: the school, then one meta line. A full score leads
  // with the division and says its score and tag; a partial score leads
  // with what it is, in plain words ("Partial · 1 of 3 scored"). The
  // target action sits at the right end of the row, outside its link.
  const matchRow = (f: LoadedFit, dim: boolean) => {
    const target = targetBySchool.get(f.school_id);
    const extra = sortFact(f, sort);
    const meta = dim
      ? [f.school.division, f.warnings[0] ?? f.reasons[0] ?? "Blocked"].filter(Boolean).join(" · ")
      : [f.school.division, f.partial ? partialLabelFor(f) : undefined, String(f.score), f.tag, extra].filter(Boolean).join(" · ");
    return (
      <Row
        key={f.school_id}
        href={`/org/${slug}/schools/${f.school_id}`}
        kind="school"
        role={dim ? "danger" : f.tag === "Safety" ? "committed" : "place"}
        title={dim ? <Body tone="muted" weight="semibold">{f.school.name}</Body> : f.school.name}
        meta={meta}
        wrap={dim}
        trailingAction={
          target ? (
            <TextLink href={`/org/${slug}/board/${target.id}`}>
              <StatusPill status={target.status} />
            </TextLink>
          ) : canEdit ? (
            <Form action={addMatchToBoard.bind(null, slug, id, f.school_id)}>
              <Button inline variant="secondary">
                Add Target
              </Button>
            </Form>
          ) : (
            <Label>Not a Target</Label>
          )
        }
      />
    );
  };

  return (
    <Screen
      title="Matches"
      back={{ href: `/org/${slug}/roster/${id}`, label: athlete.name }}
      lede={`${all.length} ${all.length === 1 ? "school" : "schools"} scored for ${athlete.name}${narrowed ? ` · ${shown.length} ${shown.length === 1 ? "matches" : "match"} ${narrowedBy}` : ""}`}
    >
      {all.length === 0 ? (
        <EmptyState kind="target" title="No Matches Yet">
          {canEdit ? "Save the athlete once and every school on file is scored against them." : "Every school on file is scored once the record is saved."}
        </EmptyState>
      ) : (
        <>
          <SearchField initial={q ?? ""} placeholder="A school name" />
          <MatchSort value={sort} />
          <MatchFilters values={filters} options={options} />

          <Section label="Ranked" count={ranked.length} role="place" kind="target">
            {ranked.length === 0 ? (
              <EmptyState kind="target" title={q ? "No School Matches" : "Nothing Matches These Filters"} />
            ) : (
              visible.map((f) => matchRow(f, false))
            )}
            {more > 0 && (
              <Inline>
                <Label>{`Showing ${visible.length} of ${ranked.length}`}</Label>
                <TextLink href={moreHref}>Show More</TextLink>
              </Inline>
            )}
          </Section>

          {ranked.some((f) => f.partial) && (
            <Notice tone="info" title="Some Scores Are Partial">
              A dimension with no data on file is left out and the rest are reweighted. Add the missing numbers and the score fills in.
            </Notice>
          )}

          {conflicts.length > 0 && (
            <Section label="Conflicts" count={conflicts.length} role="danger" kind="blocked">
              {conflicts.map((f) => matchRow(f, true))}
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}
