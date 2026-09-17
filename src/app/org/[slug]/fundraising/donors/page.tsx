// The donor list, with every total derived from the gift rows.
//
// Dave's current BFFSA app keeps `total`, `last` and `init` as columns
// on the donor. Those are not columns here, on purpose: a stored
// lifetime total drifts the first time a gift is corrected or removed
// and nobody remembers to fix it by hand, and a wrong donor total that
// nobody can explain is worse than a sum.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { TINT } from "@/components/statusHue";
import { donorTotals, formatMoney, formatMoneyShort } from "@/lib/fundraising/rollup";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = {
  individual: "Individual",
  board_member: "Board member",
  corporate: "Corporate",
  foundation: "Foundation",
  other: "Other",
};

function PeopleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0111 0M16 6.2a3 3 0 010 5.6M18 19.5a5.4 5.4 0 00-2.2-4.3" strokeLinecap="round" />
    </svg>
  );
}

function shortDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function DonorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const today = new Date().toISOString().slice(0, 10);
  const fiscalYear = Number(today.slice(0, 4));

  const supabase = await createClient();
  const [{ data: donorRows }, { data: giftRows }, { data: pledgeRows }] = await Promise.all([
    supabase.from("donors").select("id, name, donor_type, email").eq("org_id", org.id).is("deleted_at", null).order("name"),
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
  ]);

  const donors = (donorRows ?? []) as Array<{ id: string; name: string; donor_type: string; email: string | null }>;
  const gifts = toGifts(giftRows as GiftRow[] | null);
  const pledges = toPledges(pledgeRows as PledgeRow[] | null);

  const rows = donors
    .map((d) => ({ donor: d, totals: donorTotals(d.id, gifts, pledges, fiscalYear) }))
    .sort((a, b) => b.totals.lifetimeCashCents - a.totals.lifetimeCashCents);

  const owing = rows.filter((r) => r.totals.outstandingPledgeCents > 0);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/fundraising`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Fundraising
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">Donors</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        {donors.length} {donors.length === 1 ? "supporter" : "supporters"}. Totals are calculated from the gifts, not typed in, so they
        cannot go stale.
      </p>

      {owing.length > 0 && (
        <>
          <div className="mb-2">
            <SectionHeader label="Owes a pledge" count={owing.length} role="target" />
          </div>
          <div className="mb-5 flex flex-col gap-2">
            {owing.map(({ donor, totals }) => (
              <RailCard key={donor.id} role="target">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-ink">{donor.name}</div>
                    <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                      Promised and not yet received. Not counted in anything raised.
                    </div>
                  </div>
                  <span className="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">
                    {formatMoney(totals.outstandingPledgeCents)}
                  </span>
                </div>
              </RailCard>
            ))}
          </div>
        </>
      )}

      <div className="mb-2">
        <SectionHeader label="All donors" count={donors.length} role="contact" />
      </div>

      {donors.length === 0 ? (
        <EmptyState icon={<PeopleIcon />} title="No donors yet">
          Add the people and organizations who give, and every gift recorded against them builds their history automatically.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map(({ donor, totals }) => (
            <RailCard key={donor.id} role="contact">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-bold text-ink">{donor.name}</div>
                  <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                    {totals.giftCount} {totals.giftCount === 1 ? "gift" : "gifts"}
                    {totals.firstGiftOn ? ` · first ${shortDate(totals.firstGiftOn)}` : ""}
                    {totals.lastGiftOn ? ` · last ${shortDate(totals.lastGiftOn)}` : ""}
                  </div>
                  <div className="mt-1.5">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${TINT.contact}`}>
                      {TYPE_LABEL[donor.donor_type] ?? donor.donor_type}
                    </span>
                  </div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div
                    className={`text-[13px] font-extrabold tabular-nums ${totals.lifetimeCashCents === 0 ? "text-muted" : "text-ink"}`}
                  >
                    {formatMoneyShort(totals.lifetimeCashCents)}
                  </div>
                  <div className="text-[10.5px] text-muted">
                    {totals.lifetimeInKindCents > 0 ? `${formatMoneyShort(totals.lifetimeInKindCents)} in kind` : "lifetime"}
                  </div>
                </div>
              </div>
            </RailCard>
          ))}
        </div>
      )}

      <div className="mt-4">
        <RailCard role="contact">
          <div className="text-[12.5px] leading-tight text-ink">
            A donor who has only given in kind shows nothing in cash and their goods beside it. Rolling the two together would tell a
            treasurer there is money that is not there.
          </div>
        </RailCard>
      </div>

      {canEdit && (
        <div className="mt-5">
          <Link
            href={`/org/${slug}/fundraising/donors/new`}
            className="block rounded-[8px] bg-solid-accent py-3 text-center text-[14px] font-bold text-solid-accent-on"
          >
            Add a donor
          </Link>
        </div>
      )}
    </main>
  );
}
