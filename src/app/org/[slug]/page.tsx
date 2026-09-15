import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";

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

      <div className="rounded-[20px] border border-line bg-paper p-4">
        <div className="grid grid-cols-3">
          <div>
            <div className="text-[22px] font-extrabold tabular-nums text-ink">{athleteCount ?? 0}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-muted">Athletes</div>
          </div>
          <div className="border-l border-line pl-3">
            <div className="text-[22px] font-extrabold tabular-nums text-info">{inContactCount}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-muted">In contact</div>
          </div>
          <div className="border-l border-line pl-3">
            <div className="text-[22px] font-extrabold tabular-nums text-accent">{committedCount}</div>
            <div className="mt-0.5 text-[11px] font-semibold text-muted">Committed</div>
          </div>
        </div>
        {totalTargets > 0 && (
          <div className="mt-3 flex h-1 overflow-hidden rounded-full bg-line">
            <div className="bg-info" style={{ width: `${(inContactCount / totalTargets) * 100}%` }} />
            <div className="bg-accent" style={{ width: `${(committedCount / totalTargets) * 100}%` }} />
          </div>
        )}
      </div>

      <div className="mb-2 mt-5 flex items-baseline justify-between">
        <h2 className="text-[15px] font-extrabold text-ink">Needs follow-up</h2>
        <a href={`/org/${slug}/board`} className="text-[12px] font-bold text-accent">
          View board &rarr;
        </a>
      </div>
      {needsFollowUp.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-paper px-4 py-6 text-center text-[13px] text-muted">
          Nothing open needs a follow-up right now.
        </div>
      ) : (
        <div className="rounded-[20px] border border-line bg-paper">
          {needsFollowUp.map((t, i) => (
            <div key={t.id} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
              <div>
                <div className="text-[14px] font-bold text-ink">{t.athleteName}</div>
                <div className="text-[11.5px] text-muted">
                  {t.schoolName} &middot; no update in {t.days} {t.days === 1 ? "day" : "days"}
                </div>
              </div>
              <StatusPill status={t.status} />
            </div>
          ))}
        </div>
      )}

      <div className="mb-2 mt-5 flex items-baseline justify-between">
        <h2 className="text-[15px] font-extrabold text-ink">Upcoming</h2>
      </div>
      {upcomingVisits.length === 0 && upcomingWindows.length === 0 ? (
        <div className="rounded-[20px] border border-line bg-paper px-4 py-6 text-center text-[13px] text-muted">
          Nothing scheduled in the next 60 days.
        </div>
      ) : (
        <div className="rounded-[20px] border border-line bg-paper">
          {upcomingVisits.map((v, i) => (
            <div key={v.id} className={`flex items-center justify-between px-4 py-3 ${i > 0 ? "border-t border-line" : ""}`}>
              <div>
                <div className="text-[14px] font-bold text-ink">
                  Visit &middot; {v.schoolName}
                </div>
                <div className="text-[11.5px] text-muted">
                  {new Date(v.visitDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} &middot;{" "}
                  {v.athleteName}
                </div>
              </div>
            </div>
          ))}
          {upcomingWindows.map((w, i) => (
            <div
              key={`${w.sport}-${w.division}-${w.window_label}`}
              className={`flex items-center justify-between px-4 py-3 ${i > 0 || upcomingVisits.length > 0 ? "border-t border-line" : ""}`}
            >
              <div>
                <div className="text-[14px] font-bold text-ink">Transfer portal opens</div>
                <div className="text-[11.5px] text-muted">
                  {w.sport} {w.division} &middot; {w.window_label} &middot; in {daysUntil(w.opens_on)} days
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {org.modules.donor_fundraising && (
        <>
          <div className="mb-2 mt-5 flex items-baseline justify-between">
            <h2 className="text-[15px] font-extrabold text-ink">Program overview</h2>
          </div>
          <div className="rounded-[20px] border border-line bg-paper px-4 py-6 text-center text-[13px] text-muted">
            Fundraising tracking is coming soon &mdash; no donation data is wired up yet.
          </div>
        </>
      )}
    </main>
  );
}
