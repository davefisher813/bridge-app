import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { StatusPill } from "@/components/StatusPill";
import { Body, Card, EmptyState, Label, Meter, Row, Screen, Section, Stack, Stat, StatRow, TextLink } from "@/components/kit";
import { statusRole } from "@/components/statusHue";
import { formatMoneyShort, summarize } from "@/lib/fundraising/rollup";
import { toBudgetLines, toGifts, toPledges, type BudgetRow, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";

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

  // Only queried when the module is on. An org without fundraising does
  // not pay for three queries it will never render, and Elite Squad
  // never touches the tables at all.
  let fundraising: ReturnType<typeof summarize> | null = null;
  if (org.modules.donor_fundraising) {
    const todayIso = new Date().toISOString().slice(0, 10);
    const [{ data: giftRows }, { data: pledgeRows }, { data: budgetRows }] = await Promise.all([
      supabase
        .from("gifts")
        .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
        .eq("org_id", org.id),
      supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
      supabase.from("fundraising_budget").select("fiscal_year, category, amount").eq("org_id", org.id),
    ]);
    const gifts = toGifts(giftRows as GiftRow[] | null);
    const pledges = toPledges(pledgeRows as PledgeRow[] | null);
    // Null rather than a summary of nothing, so the screen shows an
    // empty state instead of a confident "$0 raised".
    if (gifts.length > 0 || pledges.length > 0) {
      fundraising = summarize({
        gifts,
        pledges,
        budget: toBudgetLines(budgetRows as BudgetRow[] | null),
        fiscalYear: Number(todayIso.slice(0, 4)),
        today: todayIso,
      });
    }
  }

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
    <Screen title={`Good morning, ${firstName}.`}>
      <Stack gap={3}>
        <StatRow>
          <Stat value={athleteCount ?? 0} label="Athletes" kind="athlete" />
          <Stat value={inContactCount} label="In contact" role="contact" kind="stage_contact" />
          <Stat value={committedCount} label="Committed" role="committed" kind="stage_committed" />
        </StatRow>
        {totalTargets > 0 && (
          <Meter
            parts={[
              { role: "contact", fraction: inContactCount / totalTargets },
              { role: "committed", fraction: committedCount / totalTargets },
            ]}
          />
        )}
      </Stack>

      <Section label="Needs follow-up" count={needsFollowUp.length} action={needsFollowUp.length > 0 ? <TextLink href={`/org/${slug}/board`}>View board</TextLink> : undefined}>
        {needsFollowUp.length === 0 ? (
          <EmptyState kind="check" role="committed" title="Nothing needs a follow-up">
            Every open target has been touched recently.
          </EmptyState>
        ) : (
          needsFollowUp.map((t) => (
            <Row
              key={t.id}
              href={`/org/${slug}/board/${t.id}`}
              kind="school"
              role={statusRole(t.status)}
              title={t.athleteName}
              meta={`${t.schoolName} · no update in ${t.days} ${t.days === 1 ? "day" : "days"}`}
              trailing={<StatusPill status={t.status} />}
            />
          ))
        )}
      </Section>

      <Section label="Upcoming" count={upcomingVisits.length + upcomingWindows.length} role="visit" kind="clock">
        {upcomingVisits.length === 0 && upcomingWindows.length === 0 ? (
          <EmptyState kind="clock" title="Nothing scheduled">
            No visits or portal windows in the next 60 days.
          </EmptyState>
        ) : (
          <>
            {upcomingVisits.map((v) => (
              <Row
                key={v.id}
                href={`/org/${slug}/board/${v.id}`}
                kind="visit"
                role="visit"
                title={`Visit · ${v.schoolName}`}
                meta={`${new Date(v.visitDate).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · ${v.athleteName}`}
              />
            ))}
            {upcomingWindows.map((w) => (
              <Row
                key={`${w.sport}-${w.division}-${w.window_label}`}
                kind="clock"
                role="time"
                title="Transfer portal opens"
                meta={`${w.sport} ${w.division} · ${w.window_label} · in ${daysUntil(w.opens_on)} days`}
              />
            ))}
          </>
        )}
      </Section>

      {org.modules.donor_fundraising && (
        <Section label="Program overview" role="committed" kind="money">
          {fundraising === null ? (
            <EmptyState kind="money" title="Nothing recorded yet">
              Record the first gift and this starts reporting against your categories.
            </EmptyState>
          ) : (
            <Card href={`/org/${slug}/fundraising`}>
              <Body weight="semibold">{formatMoneyShort(fundraising.totalCashCents)} raised this year</Body>
              <Label>
                {fundraising.totalBudgetCents > 0
                  ? `${Math.round((fundraising.totalCashCents / fundraising.totalBudgetCents) * 100)}% of the year's target`
                  : "No budget set for the year"}
                {fundraising.outstandingPledgeCents > 0 ? ` · ${formatMoneyShort(fundraising.outstandingPledgeCents)} promised and not received` : ""}
              </Label>
            </Card>
          )}
        </Section>
      )}
    </Screen>
  );
}
