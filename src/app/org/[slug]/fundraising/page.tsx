// Fundraising for one org, for one fiscal year.
//
// Gated on orgs.modules.donor_fundraising, which is off by default, so
// Elite Squad never sees any of this. The gate is checked in the server
// actions too: a page that does not render is not the same thing as an
// endpoint that cannot be called.
//
// Two rules the screen keeps, both from src/lib/fundraising/rollup.ts,
// and both of which make a board report quietly wrong if they slip:
//
//   - A pledge is never inside a total, only beside it.
//   - An in-kind gift is support, never cash.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { DOT } from "@/components/statusHue";
import { campaignProgress, formatMoney, formatMoneyShort, summarize } from "@/lib/fundraising/rollup";
import { toBudgetLines, toGifts, toPledges, type BudgetRow, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";

export const dynamic = "force-dynamic";

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
    </svg>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[12px] bg-paper p-3.5">
      <div className="text-[10.5px] font-bold uppercase tracking-[0.03em] text-muted">{label}</div>
      <div className="mt-1 text-[24px] font-black leading-tight tabular-nums text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-[10.5px] leading-tight text-muted">{sub}</div>}
    </div>
  );
}

function Bar({ percent, role }: { percent: number; role: "committed" | "offer" | "target" }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${DOT[role]}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

// Green once it is on track, amber while it is behind, gray when nobody
// has set a target. Never red: the locked catalog keeps red for the
// primary action, and a category being behind is not an error.
function roleFor(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

export default async function FundraisingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug } = await params;
  const { year } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  // Not a 403: an org without the module has no fundraising screen at
  // all, the same way it has no board-governance screen.
  if (!org.modules.donor_fundraising) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const today = new Date().toISOString().slice(0, 10);
  const fiscalYear = Number(year) || Number(today.slice(0, 4));

  const supabase = await createClient();
  const [{ data: giftRows }, { data: pledgeRows }, { data: budgetRows }, { data: campaignRows }] = await Promise.all([
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
    supabase.from("fundraising_budget").select("fiscal_year, category, amount").eq("org_id", org.id),
    supabase.from("campaigns").select("id, name, kind, goal_amount, ends_on").eq("org_id", org.id).order("ends_on", { ascending: false }),
  ]);

  const gifts = toGifts(giftRows as GiftRow[] | null);
  const pledges = toPledges(pledgeRows as PledgeRow[] | null);
  const budget = toBudgetLines(budgetRows as BudgetRow[] | null);
  const campaigns = (campaignRows ?? []) as Array<{ id: string; name: string; kind: string; goal_amount: number | string | null }>;

  const s = summarize({ gifts, pledges, budget, fiscalYear, today });
  const budgetPercent = s.totalBudgetCents > 0 ? Math.round((s.totalCashCents / s.totalBudgetCents) * 100) : null;

  if (gifts.length === 0 && pledges.length === 0) {
    return (
      <main className="px-4 pt-2 pb-6">
        <h1 className="mb-1 text-[20px] font-extrabold text-ink">Fundraising</h1>
        <p className="mb-5 text-[12.5px] leading-tight text-muted">{fiscalYear}, against the board budget.</p>
        <EmptyState icon={<ChartIcon />} title="Nothing recorded yet">
          Record the first gift and this starts reporting against your categories. Totals are calculated from the gifts themselves, so
          nothing here can go stale.
        </EmptyState>
        {canEdit && (
          <div className="mt-5 flex flex-col gap-2">
            <Link
              href={`/org/${slug}/fundraising/gifts/new`}
              className="rounded-[8px] bg-solid-accent py-3 text-center text-[14px] font-bold text-solid-accent-on"
            >
              Record a gift
            </Link>
            <Link href={`/org/${slug}/fundraising/donors`} className="rounded-[8px] bg-paper py-3 text-center text-[14px] font-bold text-ink">
              Donors
            </Link>
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="px-4 pt-2 pb-6">
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Fundraising</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        {fiscalYear}, against the board budget. Cash received only.
      </p>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Tile label="Raised" value={formatMoneyShort(s.totalCashCents)} sub="cash in the door" />
        <Tile
          label="Budget"
          value={formatMoneyShort(s.totalBudgetCents)}
          sub={budgetPercent === null ? "no budget set" : `${budgetPercent}% of the year's target`}
        />
      </div>

      {/* Beside the total, never inside it. Summing a promise into
          "raised" overstates the year, and it is the easiest mistake in
          this whole feature to make. */}
      {s.outstandingPledgeCents > 0 && (
        <div className="mb-4">
          <RailCard role="offer">
            <div className="text-[13px] font-bold text-ink">{formatMoney(s.outstandingPledgeCents)} promised, not received</div>
            <div className="mt-1 text-[12px] leading-tight text-muted">
              Not counted in the {formatMoneyShort(s.totalCashCents)} above.
              {s.overduePledgeCents > 0 ? ` ${formatMoney(s.overduePledgeCents)} of it is past its due date.` : ""}
            </div>
          </RailCard>
        </div>
      )}

      <div className="mb-2">
        <SectionHeader label="By category" role="committed" />
      </div>
      <div className="flex flex-col gap-2">
        {s.byCategory.map((c) => {
          const role = roleFor(c.percentOfBudget);
          return (
            <RailCard key={c.category} role={role}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-ink">{c.label}</div>
                  <div className="mt-0.5 text-[11.5px] text-muted">
                    {formatMoneyShort(c.receivedCents)}
                    {c.budgetCents > 0 ? ` of ${formatMoneyShort(c.budgetCents)}` : " received, no budget set"}
                    {c.inKindCents > 0 ? ` · ${formatMoneyShort(c.inKindCents)} in kind` : ""}
                  </div>
                  <Bar percent={c.percentOfBudget ?? 0} role={role} />
                </div>
                <span className="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">
                  {c.percentOfBudget === null ? "no target" : `${c.percentOfBudget}%`}
                </span>
              </div>
            </RailCard>
          );
        })}
      </div>

      {/* Reported, and reported separately. A donated case of food is
          support and not something anyone can spend, and folding it into
          the cash figure tells a treasurer there is money that is not
          there. */}
      {s.totalInKindCents > 0 && (
        <>
          <div className="mb-2 mt-5">
            <SectionHeader label="In kind" role="place" />
          </div>
          <RailCard role="place">
            <div className="text-[13px] font-bold text-ink">{formatMoney(s.totalInKindCents)} donated in goods and services</div>
            <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
              Counted as support, never as cash. Total support for the year is {formatMoneyShort(s.totalSupportCents)}.
            </div>
          </RailCard>
        </>
      )}

      {campaigns.length > 0 && (
        <>
          <div className="mb-2 mt-5">
            <SectionHeader label="Campaigns" count={campaigns.length} role="visit" />
          </div>
          <div className="flex flex-col gap-2">
            {campaigns.map((c) => {
              const goalCents = c.goal_amount === null ? 0 : Math.round(Number(c.goal_amount) * 100);
              const p = campaignProgress(c.id, goalCents, gifts, pledges);
              const role = roleFor(p.percentOfGoal);
              return (
                <RailCard key={c.id} role={role}>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[13px] font-bold text-ink">{c.name}</div>
                      <span className="flex-shrink-0 text-[12px] font-extrabold tabular-nums text-ink">
                        {p.percentOfGoal === null ? "no goal" : `${p.percentOfGoal}%`}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted">
                      {formatMoneyShort(p.raisedCents)} raised
                      {goalCents > 0 ? ` of a ${formatMoneyShort(goalCents)} goal` : ""}
                      {p.pledgedCents > 0 ? ` · ${formatMoneyShort(p.pledgedCents)} pledged` : ""}
                    </div>
                    <Bar percent={p.percentOfGoal ?? 0} role={role} />
                  </div>
                </RailCard>
              );
            })}
          </div>
          <div className="mt-3">
            <RailCard role="contact">
              <div className="text-[12.5px] leading-tight text-ink">
                A campaign&apos;s percentage is cash raised against goal. Pledges are shown beside it and never inside it: a campaign with
                promises covering its goal has not met its goal.
              </div>
            </RailCard>
          </div>
        </>
      )}

      <div className="mb-2 mt-5">
        <SectionHeader label="This year" role="contact" />
      </div>
      <RailCard role="contact">
        <div className="text-[12.5px] leading-tight text-ink">
          {s.giftCount} {s.giftCount === 1 ? "gift" : "gifts"} from {s.donorCount} {s.donorCount === 1 ? "supporter" : "supporters"}.
        </div>
        <div className="mt-1 text-[11.5px] leading-tight text-muted">
          Anonymous gifts count in the total and not in the supporter number, so the figure means people.
        </div>
      </RailCard>

      {canEdit && (
        <div className="mt-5 flex flex-col gap-2">
          <Link
            href={`/org/${slug}/fundraising/gifts/new`}
            className="rounded-[8px] bg-solid-accent py-3 text-center text-[14px] font-bold text-solid-accent-on"
          >
            Record a gift
          </Link>
          <Link href={`/org/${slug}/fundraising/donors`} className="rounded-[8px] bg-paper py-3 text-center text-[14px] font-bold text-ink">
            Donors
          </Link>
          <Link href={`/org/${slug}/fundraising/grants`} className="rounded-[8px] bg-paper py-3 text-center text-[14px] font-bold text-ink">
            Grants
          </Link>
        </div>
      )}
    </main>
  );
}
