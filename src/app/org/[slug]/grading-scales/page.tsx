// Every high school grading scale this org has on file, plus the schools
// that still need one.
//
// The "Needed now" section is the point of this screen. A school with no
// conversion table whose transcripts print numbers produces no core GPA
// at all for every athlete there, and before this existed the only place
// that showed up was one line on one athlete's eligibility page. This is
// the list of what is actually blocking the flagship feature.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { EmptyState, Label, LinkButton, Prose, Row, Screen, Section } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { parseBands } from "@/lib/data/ncaaAdapters";
import type { GradingBand } from "@/lib/fit/ncaa/gradingScale";

export const dynamic = "force-dynamic";

function summarize(bands: GradingBand[]): string {
  if (!bands.length) return "No bands entered";
  return [...bands]
    .sort((a, b) => b.min - a.min)
    .map((b) => `${b.letter} ${b.min}-${b.max}`)
    .join(" · ");
}

interface ScaleRow {
  id: string;
  school_name: string;
  bands: unknown;
  reports_weighted_grades: boolean;
  weight_bonus: number | string;
  source_note: string | null;
}

export default async function GradingScalesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const supabase = await createClient();

  const [{ data: ownRows }, { data: courseRows }] = await Promise.all([
    supabase
      .from("org_grading_scales")
      .select("id, school_name, bands, reports_weighted_grades, weight_bonus, source_note")
      .eq("org_id", org.id)
      .order("school_name", { ascending: true }),
    // Only the columns needed to decide which schools are blocked. A
    // course with a letter grade converts without any table, so a school
    // is only "needed" when something there is actually a number.
    supabase.from("athlete_courses").select("school_name, grade, athlete_id").eq("org_id", org.id),
  ]);

  const own = (ownRows ?? []) as ScaleRow[];

  // The shared verified table wins wherever it exists, so a school
  // covered by one is not blocked even with nothing entered here.
  const courseSchools = [
    ...new Set(
      (courseRows ?? [])
        .map((c) => (c.school_name ?? "").trim())
        .filter((s) => s.length > 0)
        .map((s) => s.toLowerCase()),
    ),
  ];
  const { data: sharedRows } = courseSchools.length
    ? await supabase.from("high_school_grading_scales").select("school_name, school_name_key").in("school_name_key", courseSchools)
    : { data: [] };

  const covered = new Set<string>([
    ...own.map((s) => s.school_name.trim().toLowerCase()),
    ...((sharedRows ?? []) as Array<{ school_name_key: string }>).map((s) => s.school_name_key),
  ]);

  // Schools with numeric grades and no table anywhere.
  const blocked = new Map<string, { name: string; athletes: Set<string>; courses: number }>();
  for (const c of courseRows ?? []) {
    const name = (c.school_name ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (covered.has(key)) continue;
    if (!/^\d{1,3}(\.\d+)?$/.test(String(c.grade ?? "").trim())) continue;
    const entry = blocked.get(key) ?? { name, athletes: new Set<string>(), courses: 0 };
    entry.athletes.add(String(c.athlete_id));
    entry.courses += 1;
    blocked.set(key, entry);
  }
  const blockedList = [...blocked.values()].sort((a, b) => b.courses - a.courses);

  return (
    <Screen
      title="Grading Scales"
      back={{ href: `/org/${slug}/more`, label: "More" }}
    >
      {blockedList.length > 0 && (
        <Section label="Needed Now" count={blockedList.length} role="offer" kind="warning">
          <Label>
            Transcripts here print numbers and no table is on file, so these core GPAs are running on the assumed ten-point scale until
            the real table is entered.
          </Label>
          {blockedList.map((b) => (
            <Row
              key={b.name}
              href={canEdit ? `/org/${slug}/grading-scales/new?school=${encodeURIComponent(b.name)}` : undefined}
              kind="warning"
              role="offer"
              title={b.name}
              meta={`${b.athletes.size} ${b.athletes.size === 1 ? "athlete" : "athletes"} · ${b.courses} ${b.courses === 1 ? "course" : "courses"} waiting`}
              trailing={canEdit ? <Label tone="accent">Add</Label> : undefined}
            />
          ))}
        </Section>
      )}

      <Section label="On File" count={own.length} role="committed" kind="scale">
        {own.length === 0 ? (
          <EmptyState kind="scale" title="No Grading Scales Yet">
            Enter one for any school whose transcripts print numbers instead of letters. Only this org uses what you enter here, so a
            mistake cannot change another organization&apos;s eligibility verdicts.
          </EmptyState>
        ) : (
          own.map((s) => {
            const bands = parseBands(s.bands);
            const bonus = Number(s.weight_bonus);
            return (
              <Row
                key={s.id}
                href={canEdit ? `/org/${slug}/grading-scales/${s.id}` : undefined}
                kind="scale"
                role="contact"
                title={s.school_name}
                meta={`${summarize(bands)} · ${s.reports_weighted_grades ? `weighted, adds ${Number.isFinite(bonus) ? bonus.toFixed(2) : "1.00"}` : "no weighted bonus"}${s.source_note ? ` · ${s.source_note}` : ""}`}
                wrap
              />
            );
          })
        )}
        <Note>
          Only this org uses these. Another organization with an athlete at the same school keeps its own, so a mistake here cannot change
          anyone else&apos;s eligibility verdict. A table confirmed with the school and shared across the platform still wins where one
          exists.
        </Note>
      </Section>

      {canEdit && <LinkButton href={`/org/${slug}/grading-scales/new`}>Add a School&apos;s Scale</LinkButton>}
      <Prose>Tap a scale to edit it. Changing one recalculates every athlete at that school.</Prose>
    </Screen>
  );
}
