// The donor list, with every total derived from the gift rows.
//
// Dave's current BFFSA app keeps `total`, `last` and `init` as columns
// on the donor. Those are not columns here, on purpose: a stored
// lifetime total drifts the first time a gift is corrected or removed
// and nobody remembers to fix it by hand, and a wrong donor total that
// nobody can explain is worse than a sum.

import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { AddButton, Body, EmptyState, Label, LinkButton, Row, Screen, Section } from "@/components/kit";
import { Note } from "@/components/EligibilityVerdict";
import { SearchField } from "@/components/SearchField";
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

function shortDate(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

export default async function DonorsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const q = (searchParams ? (await searchParams).q : "")?.trim().toLowerCase() ?? "";
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();

  const user = await requireRole(org.id, STAFF_ROLES);
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

  const all = donors
    .map((d) => ({ donor: d, totals: donorTotals(d.id, gifts, pledges, fiscalYear) }))
    .sort((a, b) => b.totals.lifetimeCashCents - a.totals.lifetimeCashCents);

  // Name, type or email. Filtered here so the list, the count and the
  // empty state agree with each other.
  const rows = q ? all.filter(({ donor }) => `${donor.name} ${TYPE_LABEL[donor.donor_type] ?? donor.donor_type} ${donor.email ?? ""}`.toLowerCase().includes(q)) : all;

  const owing = rows.filter((r) => r.totals.outstandingPledgeCents > 0);

  return (
    <Screen
      title="Donors"
      back={{ href: `/org/${slug}/fundraising`, label: "Fundraising" }} lede={`${donors.length} ${donors.length === 1 ? "supporter" : "supporters"}`}
      action={canEdit ? <AddButton href={`/org/${slug}/fundraising/donors/new`} label="Add" /> : undefined}
    >
      {owing.length > 0 && (
        <Section label="Owes a Pledge" count={owing.length} role="offer" kind="pledge">
          {owing.map(({ donor, totals }) => (
            <Row
              key={donor.id}
              href={`/org/${slug}/fundraising/donors/${donor.id}`}
              kind="pledge"
              role="offer"
              title={donor.name}
              meta="Promised and not yet received. Not counted in anything raised."
              wrap
              trailing={
                <Body weight="bold" numeric>
                  {formatMoney(totals.outstandingPledgeCents)}
                </Body>
              }
            />
          ))}
        </Section>
      )}

      {(all.length > 5 || q) && <SearchField initial={q} placeholder="A name, a type or an address" />}

      <Section label="All Donors" count={rows.length} role="contact" kind="donor">
        {rows.length === 0 ? (
          <EmptyState kind="donor" title={q ? "Nobody Matches" : "No Donors Yet"}>
            {q ? "Try a shorter name, or clear the search." : "Add the people and organizations who give, and every gift recorded against them builds their history automatically."}
          </EmptyState>
        ) : (
          rows.map(({ donor, totals }) => (
            <Row
              key={donor.id}
              href={`/org/${slug}/fundraising/donors/${donor.id}`}
              kind="donor"
              role="contact"
              title={donor.name}
              meta={[
                TYPE_LABEL[donor.donor_type] ?? donor.donor_type,
                `${totals.giftCount} ${totals.giftCount === 1 ? "gift" : "gifts"}`,
                totals.firstGiftOn ? `first ${shortDate(totals.firstGiftOn)}` : null,
                totals.lastGiftOn ? `last ${shortDate(totals.lastGiftOn)}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              trailing={
                <>
                  <Body weight="bold" numeric tone={totals.lifetimeCashCents === 0 ? "muted" : "ink"}>
                    {formatMoneyShort(totals.lifetimeCashCents)}
                  </Body>
                  <Label numeric>{totals.lifetimeInKindCents > 0 ? `${formatMoneyShort(totals.lifetimeInKindCents)} in kind` : "lifetime"}</Label>
                </>
              }
            />
          ))
        )}
      </Section>

      <Note>
        A donor who has only given in kind shows nothing in cash and their goods beside it. Rolling the two together would tell a treasurer
        there is money that is not there.
      </Note>

      {canEdit && <LinkButton href={`/org/${slug}/fundraising/donors/new`}>Add Donor</LinkButton>}
    </Screen>
  );
}
