// One supporter: their gifts, their pledges, and their totals.
//
// Every figure here is derived from the gifts, never stored on the donor
// row, so a lifetime total cannot drift from the gifts it is made of.
// That is the same reason the donors list computes rather than reads.

import { notFound } from "next/navigation";
import { longDate } from "@/lib/copy/dates";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { toGifts, toPledges, type GiftRow, type PledgeRow } from "@/lib/data/fundraisingAdapters";
import { donorTotals, formatMoney, formatMoneyShort, outstandingOn, CATEGORY_LABEL, type GiftCategory } from "@/lib/fundraising/rollup";
import { Avatar, Body, Chevron, ConfirmButton, EmptyState, Form, Hidden, LinkButton, Notice, Row, Screen, Section, Stat, StatRow } from "@/components/kit";
import { AdvisorSheet } from "@/components/AdvisorSheet";
import { loadAdvisorChoices } from "@/lib/org/advisors";
import { personLabel } from "@/lib/org/roleLabels";
import { setDonorSteward } from "@/lib/actions/fundraising";

export const dynamic = "force-dynamic";

const TYPE_LABEL: Record<string, string> = { individual: "Individual", corporate: "Corporate", foundation: "Foundation", board_member: "Board Member", other: "Other" };

export default async function DonorPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams?: Promise<{ notice?: string; error?: string; undo?: string }> }) {
  const { slug, id } = await params;
  const { notice, error, undo } = searchParams ? await searchParams : {};
  const undoTo = undo === "none" || (undo && /^[0-9a-f-]{36}$/i.test(undo)) ? undo : null;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.donor_fundraising) notFound();
  const user = await requireRole(org.id, STAFF_ROLES);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const fiscalYear = Number(new Date().toISOString().slice(0, 4));
  const supabase = await createClient();
  const [{ data: donor }, { data: giftRows }, { data: pledgeRows }, { data: seatRows }] = await Promise.all([
    // A removed donor is out of the address book (audit crud F10); their
    // gifts still count, and still show on the gift ledger.
    supabase.from("donors").select("id, name, donor_type, email, phone, steward_user_id").eq("id", id).eq("org_id", org.id).is("deleted_at", null).maybeSingle(),
    supabase
      .from("gifts")
      .select("id, amount, received_on, category, method, donor_id, campaign_id, pledge_id")
      .eq("org_id", org.id)
      .order("received_on", { ascending: false }),
    supabase.from("pledges").select("id, amount, promised_on, due_on, status, donor_id, campaign_id").eq("org_id", org.id),
    supabase.from("board_members").select("id, board_id, name, role_title, status, donor_id").eq("org_id", org.id).eq("donor_id", id),
  ]);

  if (!donor) notFound();
  // Who stewards them: an Admin of this org, picked here (Dave's standing
  // rule, 2026-10-06: every assignment is a setting an Admin can see,
  // change and undo).
  const admins = await loadAdvisorChoices(supabase, org.id);

  const allGifts = toGifts(giftRows as GiftRow[] | null);
  const allPledges = toPledges(pledgeRows as PledgeRow[] | null);
  const totals = donorTotals(id, allGifts, allPledges, fiscalYear);
  const gifts = allGifts.filter((g) => g.donorId === id);
  const pledges = allPledges.filter((p) => p.donorId === id);
  const seat = (seatRows ?? [])[0] as { id: string; board_id: string; name: string; role_title: string | null } | undefined;
  const d = donor as { name: string; donor_type: string; email: string | null; phone: string | null; steward_user_id: string | null };
  const steward = d.steward_user_id ? (admins.find((a) => a.id === d.steward_user_id) ?? null) : null;
  const stewardAction = setDonorSteward.bind(null, slug, id);
  const stewardSheet = canEdit ? (
    <AdvisorSheet
      action={stewardAction}
      field="stewardId"
      title="Steward"
      trigger={steward ? "Change" : "Assign"}
      searchLabel="Search Admins"
      currentId={steward?.id ?? null}
      clearLabel={steward ? "Clear Steward" : undefined}
      choices={admins.map((a) => ({ id: a.id, title: a.name, meta: `${personLabel(a)} · ${a.email}`, keywords: a.email }))}
      empty="Nobody here can steward yet. Invite an Admin under Members."
      confirm={`Make {choice} the steward for ${d.name}?${steward ? ` ${steward.name} stops stewarding them.` : ""}`}
      clearConfirm={`Clear the steward for ${d.name}? Nobody stewards them until someone is picked.`}
    />
  ) : undefined;

  return (
    <Screen
      title={d.name}
      back={{ href: `/org/${slug}/fundraising/donors`, label: "Donors" }}
      lede={`${TYPE_LABEL[d.donor_type] ?? d.donor_type.replace(/_/g, " ")}${d.email ? ` · ${d.email}` : ""}`}
    >
      {(notice || error) && <Notice tone={error ? "danger" : "success"} title={error ?? notice} />}
      {notice && undoTo && canEdit && (
        <Form action={stewardAction}>
          <Hidden name="stewardId" value={undoTo === "none" ? "" : undoTo} />
          <ConfirmButton tone="change" title="Undo the Steward Change?" body={undoTo === "none" ? `${d.name} goes back to having no steward.` : `${d.name} goes back to their previous steward.`} confirmLabel="Undo">
            Undo
          </ConfirmButton>
        </Form>
      )}

      <Section label="Steward" role="people" kind="people" action={steward ? stewardSheet : undefined}>
        {steward ? (
          <Row href={`/org/${slug}/members/${steward.id}`} leading={<Avatar name={steward.name} />} title={steward.name} meta={`${personLabel(steward)} · ${steward.email}`} trailing={<Chevron />} wrap />
        ) : (
          <EmptyState kind="people" title="No Steward" action={stewardSheet} />
        )}
      </Section>

      <StatRow>
        <Stat value={formatMoneyShort(totals.lifetimeCashCents)} label="Lifetime" role="committed" href={`/org/${slug}/fundraising/gifts`} />
        <Stat value={formatMoneyShort(totals.thisYearCashCents)} label="This Year" role="contact" href={`/org/${slug}/fundraising/gifts`} />
        <Stat value={String(totals.giftCount)} label="Gifts" href={`/org/${slug}/fundraising/gifts`} />
      </StatRow>

      {totals.lifetimeInKindCents > 0 && (
        <Row href={`/org/${slug}/fundraising/gifts?method=in_kind`} kind="grant" role="place" emphasis="bold" title={`${formatMoney(totals.lifetimeInKindCents)} in Kind`} meta="Support, not cash." />
      )}

      {/* A board member who gives is one person, not two records. This
          link is what stops give/get and the donor ledger reading as
          unrelated numbers. */}
      {seat && (
        <Row
          href={`/org/${slug}/board-governance/${seat.board_id}/seats/${seat.id}`}
          kind="people"
          role="people"
          emphasis="bold"
          title="Sits on a Board"
          meta={seat.role_title ?? seat.name}
          trailing={<Chevron />}
        />
      )}

      {pledges.length > 0 && (
        <Section label="Pledges" count={pledges.length} role="offer" kind="pledge">
          {pledges.map((p) => {
            const out = outstandingOn(p, allGifts);
            return (
              <Row
                key={p.id}
                href={canEdit ? `/org/${slug}/fundraising/pledges/${p.id}/edit` : `/org/${slug}/fundraising/pledges`}
                kind="pledge"
                role={out > 0 ? "offer" : "committed"}
                title={`${formatMoney(p.amountCents)} Promised`}
                meta={p.dueOn ? `due ${longDate(p.dueOn)}` : undefined}
                trailing={
                  <Body weight="bold" numeric>
                    {out === 0 ? "Paid" : `${formatMoney(out)} left`}
                  </Body>
                }
              />
            );
          })}
        </Section>
      )}

      <Section label="Gifts" count={gifts.length} role="committed" kind="money">
        {gifts.length === 0 ? (
          <EmptyState kind="money" title="No Gifts Yet" action={canEdit ? <LinkButton href={`/org/${slug}/fundraising/gifts/new`}>Record a Gift</LinkButton> : undefined}
          />
        ) : (
          gifts.map((g) => (
            <Row
              key={g.id}
              href={canEdit ? `/org/${slug}/fundraising/gifts/${g.id}/edit` : `/org/${slug}/fundraising/gifts?category=${g.category}`}
              kind={g.method === "in_kind" ? "grant" : "money"}
              role={g.method === "in_kind" ? "place" : "committed"}
              title={CATEGORY_LABEL[g.category as GiftCategory] ?? g.category}
              meta={`${longDate(g.receivedOn)} · ${g.method === "in_kind" ? "in kind" : g.method}`}
              trailing={
                <Body weight="bold" numeric>
                  {formatMoney(g.amountCents)}
                </Body>
              }
            />
          ))
        )}
      </Section>

      {canEdit && (
        <LinkButton href={`/org/${slug}/fundraising/donors/${id}/edit`} variant="secondary">
          Edit Donor
        </LinkButton>
      )}
    </Screen>
  );
}
