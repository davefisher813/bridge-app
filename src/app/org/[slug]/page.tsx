import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { EmptyState, RailCard, SectionHeader, StatTile } from "@/components/catalog";
import { statusHue } from "@/components/statusHue";

function ClearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.5l2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <path d="M4 20V10M10 20V5M16 20v-7M22 20H2" strokeLinecap="round" />
    </svg>
  );
}

// The Today screen. Per Dave (2026-09): this is an org/recruiting
// management tool, not a life-management app - so no "add a task" /
// "add an event" widgets here. What's here instead is what he said
// he'd actually check every morning: pipeline snapshot, who needs a
// follow-up, and what's coming up. Every number below comes from a
// real query; nothing is a placeholder stat. See docs/DECISIONS.md.

interface TargetRow {
  id: string;
  status: string;
  updated_at: string;
  visit_date: string | null;
  athletes: { name: string } | { name: string }[] | null;
  schools: { name: string } | { name: string }[] | null;
}

interface TransferWindowRow {
  sport: string;
  division: string;
  window_label: string;
  opens_on: string;
  closes_on: string;
}

function unwrap<T>(v: T | T[] | null): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

function daysSince(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

const OPEN_STATUSES = ["Target", "In Contact", "Visit", "Offer"];

export default async function TodayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  const user = await requireRole(org.id, ["owner", "staff", "member"]);

  const supabase = await createClient();

  const [{ count: athleteCount }, { data: targets }, { data: windowRows }] = await Promise.all([
    supabase.from("athletes").select("id", { count: "exact", head: true }).eq("org_id", org.id).is("deleted_at", null),
    supabase
      .from("recruiting_targets")
      .select("id, status, updated_at, visit_date, athletes(name), schools(name)")
      .eq("org_id", org.id),
    supabase.from("transfer_windows").select("sport, division, window_label, opens_on, closes_on"),
  ]);

  const rows = (targets ?? []) as TargetRow[];
  const inContactCount = rows.filter((r) => r.status === "In Contact").length;
  const committedCount = rows.filter((r) => r.status === "Committed").length;
  const totalTargets = rows.length;

  const needsFollowUp = rows
    .filter((r) => OPEN_STATUSES.includes(r.status))
    .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
    .slice(0, 4)
    .map((r) => ({
      id: r.id,
      status: r.status,
      athleteName: unwrap(r.athletes)?.name ?? "Unknown athlete",
      schoolName: unwrap(r.schools)?.name ?? "Unknown school",
      days: daysSince(r.updated_at),
    }));

  const upcomingVisits = rows
    .filter((r) => r.visit_date && new Date(r.visit_date) >= new Date(new Date().toDateString()))
    .sort((a, b) => new Date(a.visit_date!).getTime() - new Date(b.visit_date!).getTime())
    .slice(0, 3)
    .map((r) => ({
      id: r.id,
      athleteName: unwrap(r.athletes)?.name ?? "Unknown athlete",
      schoolName: unwrap(r.schools)?.name ?? "Unknown school",
      visitDate: r.visit_date as string,
    }));

  const today = new Date();
  const in60Days = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
  const upcomingWindows = ((windowRows ?? []) as TransferWindowRow[])
    .filter((w) => new Date(w.opens_on) >= today && new Date(w.opens_on) <= in60Days)
    .sort((a, b) => new Date(a.opens_on).getTime() - new Date(b.opens_on).getTime())
    .slice(0, 2);

  const firstName = (user.full_name || user.email).split(" ")[0] || user.email;

  return (
    <main className="px-4 pt-2">
      <h1 className="mb-4 text-[26px] font-black leading-tight text-ink">
        Good morning,
        <br />
        {firstName}.
      </h1>

      {/* ST1: tinted tiles, each in the hue of what it counts. */}
      <div className="flex gap-2">
        <StatTile value={athleteCount ?? 0} label="Athletes" />
        <StatTile value={inContactCount} label="In contact" hue="info" />
        <StatTile value={committedCount} label="Committed" hue="accent" />
      </div>
      {totalTargets > 0 && (
        <div className="mt-2 flex h-1 overflow-hidden rounded-full bg-line">
          <div className="bg-info" style={{ width: `${(inContactCount / totalTargets) * 100}%` }} />
          <div className="bg-accent" style={{ width: `${(committedCount / totalTargets) * 100}%` }} />
        </div>
      )}

      <div className="mb-2 mt-6">
        <SectionHeader label="Needs follow-up" count={needsFollowUp.length} />
      </div>
      {needsFollowUp.length === 0 ? (
        <EmptyState icon={<ClearIcon />} title="Nothing needs a follow-up">
          Every open target has been touched recently.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {needsFollowUp.map((t) => (
            <RailCard key={t.id} hue={statusHue(t.status)}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[14px] font-bold text-ink">{t.athleteName}</div>
                  <div className="text-[11.5px] text-muted">
                    {t.schoolName} &middot; no update in {t.days} {t.days === 1 ? "day" : "days"}
                  </div>
                </div>
                <StatusPill status={t.status} />
              </div>
            </RailCard>
          ))}
          <a href={`/org/${slug}/board`} className="mt-1 self-end text-[12px] font-bold text-accent">
            View board &rarr;
          </a>
        </div>
      )}

      <div className="mb-2 mt-6">
        <SectionHeader label="Upcoming" count={upcomingVisits.length + upcomingWindows.length} />
      </div>
      {upcomingVisits.length === 0 && upcomingWindows.length === 0 ? (
        <EmptyState icon={<CalendarIcon />} title="Nothing scheduled">
          No visits or portal windows in the next 60 days.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {upcomingVisits.map((v) => (
            <RailCard key={v.id} hue="info">
              <div className="text-[14px] font-bold text-ink">Visit &middot; {v.schoolName}</div>
              <div className="text-[11.5px] text-muted">
                {new Date(v.visitDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} &middot;{" "}
                {v.athleteName}
              </div>
            </RailCard>
          ))}
          {upcomingWindows.map((w) => (
            <RailCard key={`${w.sport}-${w.division}-${w.window_label}`}>
              <div className="text-[14px] font-bold text-ink">Transfer portal opens</div>
              <div className="text-[11.5px] text-muted">
                {w.sport} {w.division} &middot; {w.window_label} &middot; in {daysUntil(w.opens_on)} days
              </div>
            </RailCard>
          ))}
        </div>
      )}

      {org.modules.donor_fundraising && (
        <>
          <div className="mb-2 mt-6">
            <SectionHeader label="Program overview" />
          </div>
          <EmptyState icon={<ChartIcon />} title="Fundraising tracking is coming soon">
            No donation data is wired up yet.
          </EmptyState>
        </>
      )}
    </main>
  );
}
