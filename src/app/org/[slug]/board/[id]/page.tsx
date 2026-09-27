// One recruiting target: the school, the athlete, the fit score and what
// it is made of.
//
// This did not exist. Tapping a row on the board went straight to the
// edit form, so the only way to see why a school scored 68 was to open a
// form full of inputs. The score is the product's opinion and it was not
// readable anywhere.
//
// The score is computed here the same way the board computes it, from
// the same adapters, rather than passed through or stored. A stored
// score goes stale the moment a GPA or a school profile changes.
//
// A placed athlete (Committed, Enrolled, Graduated, Drafted) is not
// scored at all: the number would read as advice about a decision that
// is already made. Neither is an Inactive one: nothing is being looked
// for. Their status sits where the score would, and the breakdown is
// not built. Dave, 2026-09-26.

import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import {
  athleteRowToFitAthlete,
  communicationsToSignals,
  schoolRowToFitSchool,
  targetOfferToSignal,
  transferWindowRowToFit,
  visitsToVisitCount,
  type AthleteRow,
  type SchoolRow,
  type TransferWindowRow,
} from "@/lib/data/fitAdapters";
import { scoreFit } from "@/lib/fit/score";
import type { DimensionResult, FitResult } from "@/lib/fit/types";
import { closedSentence, isPlacedStatus, isScoredStatus, placedSentence, placementAthlete, placementOf } from "@/lib/placement";
import { Body, Figure, Label, LinkButton, Row, Screen, Section, Stack } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { StatusPill } from "@/components/StatusPill";
import { CoachRows } from "@/components/CoachRows";
import { loadCoachesForSchool } from "@/lib/data/coaches";
import type { RowKind } from "@/components/RowGlyph";
import { scoreRole } from "@/components/statusHue";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { call: "Call", text: "Text", email: "Email", visit: "Visit", other: "Contact" };

function unwrap<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// Which glyph each dimension wears. Four identical rows tell you nothing
// about which one is about grades and which is about money.
const DIM: Array<{ key: "academic" | "athletic" | "financial" | "eligibility"; label: string; kind: RowKind }> = [
  { key: "academic", label: "Academic", kind: "course" },
  { key: "athletic", label: "Athletic", kind: "target" },
  { key: "financial", label: "Financial", kind: "money" },
  { key: "eligibility", label: "Eligibility", kind: "checklist" },
];

export default async function TargetPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();

  const [{ data: target }, { data: windowRows }, { data: commRows }, { data: visitRows }] = await Promise.all([
    supabase
      .from("recruiting_targets")
      .select(
        "id, status, coach_name, offer_type, offer_scholarship_percent, athletes(id, org_id, recruit_type, name, sport, position, status, deleted_at, draft_team, draft_round, draft_year, gpa, gpa_verified, detail, measurables, is_international, toefl_score, ielts_score, f1_visa_status, ncaa_eligibility_status), schools(id, name, division, conference, sports_sponsored, academics, financials, athletics, conflicts, profile_date)",
      )
      .eq("id", id)
      .eq("org_id", org.id)
      .single(),
    supabase.from("transfer_windows").select("sport, division, season_year, window_label, opens_on, closes_on"),
    supabase.from("target_communications").select("target_id, kind, notes, occurred_on").eq("target_id", id).eq("org_id", org.id).order("occurred_on", { ascending: false }),
    supabase.from("target_visits").select("target_id, visit_type, impression, visit_date").eq("target_id", id).eq("org_id", org.id).order("visit_date", { ascending: false }),
  ]);

  if (!target) notFound();

  type PlacedAthleteRow = AthleteRow & { status: string; deleted_at?: string | null; draft_team: string | null; draft_round: number | null; draft_year: number | null };
  const athleteRow = unwrap((target as { athletes: PlacedAthleteRow | PlacedAthleteRow[] | null }).athletes);
  const schoolRow = unwrap((target as { schools: SchoolRow | SchoolRow[] | null }).schools);
  // A removed athlete's targets went with them (loadTarget says the same).
  if (!athleteRow || athleteRow.deleted_at || !schoolRow) notFound();

  const athlete = athleteRowToFitAthlete(athleteRow);
  const school = schoolRowToFitSchool(schoolRow);
  const coaches = await loadCoachesForSchool(supabase, school.id);
  const comms = (commRows ?? []) as Array<{ target_id: string; kind: string; notes: string | null; occurred_on: string | null }>;
  const visits = (visitRows ?? []) as Array<{ target_id: string; visit_type: string; impression: string | null; visit_date: string | null }>;

  const quiet = !isScoredStatus(athleteRow.status);

  // Where they ended up, read the same way the profile reads it, so the
  // sentence here names the same school. Only the Committed target is
  // needed for that; this target may be one of the others.
  let placedLine: string | null = null;
  if (quiet) {
    const { data: committedRows } = await supabase
      .from("recruiting_targets")
      .select("id, status, schools(name)")
      .eq("athlete_id", athlete.id)
      .eq("org_id", org.id)
      .eq("status", "Committed");
    const committed = ((committedRows ?? []) as Array<{ id: string; status: string; schools: { name: string } | { name: string }[] | null }>).map((t) => ({
      id: t.id,
      status: t.status,
      schoolName: unwrap(t.schools)?.name ?? null,
    }));
    const p = placementOf(placementAthlete(athleteRow), committed);
    placedLine = p ? placedSentence(p.state, p.name, p) : isPlacedStatus(athleteRow.status) ? placedSentence(athleteRow.status, null) : closedSentence(athleteRow.status, athlete.name);
  }

  const fit: FitResult | null = quiet
    ? null
    : scoreFit(athlete, school, {
        isPlaced: (target as { status: string }).status === "Committed",
        transferWindows: ((windowRows ?? []) as TransferWindowRow[]).map(transferWindowRowToFit),
        signals: {
          ...communicationsToSignals(comms.map((c) => ({ target_id: c.target_id, kind: c.kind }))),
          visitCount: visitsToVisitCount(visits.map((v) => ({ target_id: v.target_id }))),
          offer: targetOfferToSignal(target as { offer_type: string | null; offer_scholarship_percent: number | null }),
        },
      });

  const status = (target as { status: string }).status;
  const coachName = (target as { coach_name: string | null }).coach_name;

  return (
    <Screen
      title={school.name}
      back={{ href: `/org/${slug}/board`, label: "Targets" }}
      lede={`${school.division} · ${athlete.name}`}
      action={
        fit ? (
          <div className="text-right">
            <Figure tone={scoreRole(fit.score)}>{fit.score}</Figure>
            <Label>{fit.tag}</Label>
          </div>
        ) : (
          <StatusPill status={athleteRow.status} />
        )
      }
    >
      {/* The headline reason, before the breakdown. A score with no
          sentence attached is a number somebody has to take on faith. */}
      {placedLine && <Note>{placedLine}</Note>}
      {fit && fit.reasons.length > 0 && <Note>{fit.reasons[0]}</Note>}

      {fit && (
        <Section label="How the Score Is Built" role="contact" kind="target">
          {DIM.map(({ key, label, kind }) => {
            const d = fit[key] as DimensionResult | undefined;
            if (!d) return null;
            const role = d.veto ? "offer" : d.score >= 70 ? "committed" : d.score >= 40 ? "contact" : "target";
            const notes = d.reasons.length + d.warnings.length;
            // One reason shown and the rest behind a tap. The reasons ARE
            // the argument: a financial 42 is a number, and "average aid
            // covers only 18% of cost" is the sentence somebody acts on. A
            // veto is not a low score, it is an override, so it says so.
            return (
              <Row
                key={key}
                href={`/org/${slug}/board/${id}/dimensions/${key}`}
                kind={d.veto ? "warning" : kind}
                role={role}
                title={d.veto ? `${label} · overrides the blend` : label}
                meta={`${d.reasons[0] ?? d.warnings[0] ?? "No signal"}${notes > 1 ? ` · ${notes} notes` : ""}`}
                trailing={
                  <Body weight="bold" numeric>
                    {d.score}
                  </Body>
                }
                wrap
              />
            );
          })}
        </Section>
      )}

      {fit && fit.warnings.length > 0 && (
        <Section label="Worth Knowing" count={fit.warnings.length} role="offer" kind="warning">
          {fit.warnings.map((w) => (
            <Note key={w}>{w}</Note>
          ))}
        </Section>
      )}

      <Section label="Contact" count={comms.length + visits.length} role="people" kind="message">
        <Row
          href={`/org/${slug}/board/${id}/communications`}
          kind="people"
          role="people"
          title={coachName || "No coach on file"}
          meta={`${comms.length} ${comms.length === 1 ? "message" : "messages"} · ${visits.length} ${visits.length === 1 ? "visit" : "visits"}`}
        />
        {comms.slice(0, 5).map((c, i) => (
          <Row
            key={i}
            href={`/org/${slug}/board/${id}/communications`}
            kind="message"
            role="contact"
            title={KIND_LABEL[c.kind] ?? c.kind}
            meta={c.notes ?? undefined}
            trailing={c.occurred_on ? <Label numeric>{longDate(c.occurred_on)}</Label> : undefined}
          />
        ))}
        {/* Five is a preview. The count is what somebody reads and the
            gap since the last one is what they act on, and neither of
            those fits in a preview. */}
        {comms.length + visits.length > 0 && (
          <LinkButton href={`/org/${slug}/board/${id}/communications`} variant="secondary">
            The Whole Log
          </LinkButton>
        )}
      </Section>

      <CoachRows coaches={coaches} />

      <Stack>
        <LinkButton href={`/org/${slug}/roster/${athlete.id}`} variant="secondary">
          Open {athlete.name}
        </LinkButton>
        {canEdit && (
          <LinkButton href={`/org/${slug}/board/${id}/edit`} variant="secondary">
            Edit This Target
          </LinkButton>
        )}
      </Stack>

    </Screen>
  );
}
