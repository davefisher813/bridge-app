// Every high school grading scale this org has on file, plus the schools
// that still need one.
//
// The "Needed now" section is the point of this screen. A school with no
// conversion table whose transcripts print numbers produces no core GPA
// at all for every athlete there, and before this existed the only place
// that showed up was one line on one athlete's eligibility page. This is
// the list of what is actually blocking the flagship feature.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { parseBands } from "@/lib/data/ncaaAdapters";
import type { GradingBand } from "@/lib/fit/ncaa/gradingScale";

export const dynamic = "force-dynamic";

function ScaleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
    </svg>
  );
}

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
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/more`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; More
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Grading scales</h1>
      <p className="mb-5 text-[13.5px] leading-tight text-muted">
        How each high school&apos;s numbers become letters. The NCAA converts a numeric grade using the school&apos;s own published table,
        never a generic curve, so an 85 is not automatically a B.
      </p>

      {blockedList.length > 0 && (
        <>
          <div className="mb-2">
            <SectionHeader label="Needed now" count={blockedList.length} role="offer" />
          </div>
          <p className="mb-3 text-[13px] leading-tight text-muted">
            Transcripts here print numbers and no table is on file, so these core GPAs are running on the assumed ten-point scale until
            the real table is entered.
          </p>
          <div className="flex flex-col gap-2">
            {blockedList.map((b) => {
              const body = (
                <RailCard role="offer" kind="warning">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-bold text-ink">{b.name}</div>
                      <div className="text-[12.5px] text-muted">
                        {b.athletes.size} {b.athletes.size === 1 ? "athlete" : "athletes"} &middot; {b.courses}{" "}
                        {b.courses === 1 ? "course" : "courses"} waiting
                      </div>
                    </div>
                    {canEdit && <span className="flex-shrink-0 text-[13px] font-extrabold text-tint-accent-on">Add</span>}
                  </div>
                </RailCard>
              );
              return canEdit ? (
                <Link key={b.name} href={`/org/${slug}/grading-scales/new?school=${encodeURIComponent(b.name)}`} className="block">
                  {body}
                </Link>
              ) : (
                <div key={b.name}>{body}</div>
              );
            })}
          </div>
        </>
      )}

      <div className={blockedList.length > 0 ? "mb-2 mt-5" : "mb-2"}>
        <SectionHeader label="On file" count={own.length} role="committed" />
      </div>

      {own.length === 0 ? (
        <EmptyState icon={<ScaleIcon />} title="No grading scales yet">
          Enter one for any school whose transcripts print numbers instead of letters. Only this org uses what you enter here, so a
          mistake cannot change another organization&apos;s eligibility verdicts.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {own.map((s) => {
            const bands = parseBands(s.bands);
            const bonus = Number(s.weight_bonus);
            const body = (
              <RailCard role="contact" kind="scale">
                <div className="min-w-0">
                  <div className="text-[14.5px] font-bold text-ink">{s.school_name}</div>
                  <div className="mt-0.5 text-[12.5px] leading-tight text-muted">{summarize(bands)}</div>
                  <div className="mt-1 text-[12.5px] leading-tight text-muted">
                    {s.reports_weighted_grades
                      ? `Weighted, adds ${Number.isFinite(bonus) ? bonus.toFixed(2) : "1.00"}`
                      : "No weighted bonus"}
                    {s.source_note ? ` · ${s.source_note}` : ""}
                  </div>
                </div>
              </RailCard>
            );
            return canEdit ? (
              <Link key={s.id} href={`/org/${slug}/grading-scales/${s.id}`} className="block">
                {body}
              </Link>
            ) : (
              <div key={s.id}>{body}</div>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        <RailCard role="contact" kind="scale">
          <div className="text-[13.5px] leading-tight text-ink">
            Only this org uses these. Another organization with an athlete at the same school keeps its own, so a mistake here cannot
            change anyone else&apos;s eligibility verdict. A table confirmed with the school and shared across the platform still wins
            where one exists.
          </div>
        </RailCard>
      </div>

      {canEdit && (
        <div className="mt-5">
          <Link
            href={`/org/${slug}/grading-scales/new`}
            className="block rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on"
          >
            Add a school&apos;s scale
          </Link>
        </div>
      )}
    </main>
  );
}
