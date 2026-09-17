// One board seat: its give/get and the gifts behind the number.
//
// The board page prints a percentage per seat and nothing underneath it.
// A member who is told they are at 40% and cannot see which gifts got
// them there has no way to spot a missing one, and the person who has to
// answer for it is the board chair.
//
// So this screen shows every gift attached to the seat, including the
// ones that did not count, each saying why. A list filtered down to the
// counted gifts leaves a member asking where their January cheque went;
// an unfiltered list with no marking does not add up to the percentage
// above it. creditedGifts() in the pure module does the marking, and a
// test pins the counted rows to the same total giveGetProgress reports.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { Chip, RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { RowGlyph, type RowKind } from "@/components/RowGlyph";
import { DOT } from "@/components/statusHue";
import { formatMoney, formatMoneyShort, CATEGORY_LABEL, METHOD_LABEL } from "@/lib/fundraising/rollup";
import { creditedGifts, type SeatStatus } from "@/lib/governance/giveGet";
import { loadGovernance } from "@/lib/data/governanceView";

export const dynamic = "force-dynamic";

// The glyph each seat status wears, since the pills no longer carry a
// fill. Prospect is a target because that is what it is: somebody the
// chair is recruiting.
const SEAT_KIND: Record<SeatStatus, RowKind> = {
  prospect: "stage_target",
  active: "check",
  emeritus: "clock",
  resigned: "stage_none",
};

const STATUS_LABEL: Record<SeatStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  emeritus: "Emeritus",
  resigned: "Resigned",
};

const EXCLUSION_NOTE: Record<"in_kind" | "outside_period", string> = {
  in_kind: "In kind, so it does not count toward a cash commitment",
  outside_period: "Outside this year, so it counts toward the year it was received",
};

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function Bar({ percent, role }: { percent: number; role: "committed" | "offer" | "target" }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${DOT[role]}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

function roleFor(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[12px] bg-paper p-3.5">
      <div className="text-[11px] font-bold uppercase tracking-[0.04em] text-muted">{label}</div>
      <div className="mt-1 text-[20px] font-extrabold tabular-nums leading-tight text-ink">{value}</div>
      <div className="mt-0.5 text-[11.5px] leading-tight text-muted">{sub}</div>
    </div>
  );
}

export default async function SeatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string; memberId: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug, id, memberId } = await params;
  const { year } = await searchParams;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const fiscalYear = Number(year) || new Date().getFullYear();
  const view = await loadGovernance(org.id, fiscalYear);

  const board = view.boards.find((b) => b.id === id);
  if (!board) notFound();

  const member = (view.membersByBoard.get(board.id) ?? []).find((m) => m.id === memberId);
  if (!member) notFound();

  const p = view.progressByMember.get(member.id)!;
  const credited = creditedGifts({
    member,
    gifts: view.gifts,
    pledges: view.pledges,
    solicitedBy: view.solicitedBy,
    pledgeSolicitedBy: view.pledgeSolicitedBy,
    periodStart: view.periodStart,
    periodEnd: view.periodEnd,
  });

  const role = member.status === "active" ? roleFor(p.percent) : "target";
  const countedCount = credited.filter((c) => c.counted).length;

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link
          href={`/org/${slug}/board-governance/${board.id}`}
          className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted"
        >
          &larr; {board.name}
        </Link>
      </div>

      <h1 className="mb-1 text-[22px] font-extrabold leading-tight text-ink">{member.name}</h1>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[13.5px] font-bold text-muted">
        <span>{member.roleTitle ?? "No role set"}</span>
        <Chip label={STATUS_LABEL[member.status]} kind={SEAT_KIND[member.status]} role={member.status === "active" ? "committed" : "neutral"} />
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Tile label="Given" value={formatMoneyShort(p.givenCents)} sub="their own money" />
        <Tile label="Brought in" value={formatMoneyShort(p.raisedCents)} sub="credited to this seat" />
      </div>

      {/* Only an active seat carries a live commitment, so only an
          active seat gets a progress bar. A prospect shown at 0% reads
          as somebody who is behind rather than somebody who has not
          joined. */}
      {member.status === "active" ? (
        <div className="mb-5">
          <RailCard role={role} kind="money">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[14.5px] font-bold text-ink">
                {p.commitmentCents === 0
                  ? "No commitment on this seat"
                  : p.met
                    ? `Commitment met: ${formatMoney(p.totalCents)} of ${formatMoney(p.commitmentCents)}`
                    : `${formatMoney(p.remainingCents)} still to go`}
              </div>
              <span className="flex-shrink-0 text-[14.5px] font-extrabold tabular-nums text-ink">
                {p.percent === null ? "no target" : `${p.percent}%`}
              </span>
            </div>
            {p.commitmentCents > 0 && (
              <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
                {formatMoney(p.totalCents)} of {formatMoney(p.commitmentCents)} for {fiscalYear}. Giving and bringing in both count.
              </div>
            )}
            {p.commitmentCents > 0 && <Bar percent={p.percent ?? 0} role={role} />}
            {/* Beside the progress, never inside it. A promise does not
                discharge a commitment. */}
            {p.pledgedCents > 0 && (
              <div className="mt-2 text-[12.5px] leading-tight text-muted">
                {formatMoney(p.pledgedCents)} promised and not yet received. Not counted above.
              </div>
            )}
          </RailCard>
        </div>
      ) : (
        <div className="mb-5">
          <RailCard role="target">
            <div className="text-[13.5px] leading-tight text-ink">
              {member.status === "prospect"
                ? "A prospect has not taken the seat yet, so no commitment is running and nothing counts against this year."
                : "This seat is no longer active, so it carries no commitment for this year."}
            </div>
          </RailCard>
        </div>
      )}

      {member.donorId === null && (
        <div className="mb-5">
          <RailCard role="offer" kind="warning">
            <div className="text-[14.5px] font-bold text-ink">No donor record linked</div>
            <div className="mt-1 text-[12.5px] leading-tight text-muted">
              Their own giving cannot be found without one, so only gifts they are credited with bringing in are counted here.
            </div>
          </RailCard>
        </div>
      )}

      {(member.termStart || member.termEnd) && (
        <>
          <div className="mb-2">
            <SectionHeader label="Term" role="time" kind="clock" />
          </div>
          <div className="mb-5">
            <RailCard role="time" kind="clock">
              <div className="text-[14.5px] font-bold text-ink">
                {member.termStart ? shortDate(member.termStart) : "Start not set"} to{" "}
                {member.termEnd ? shortDate(member.termEnd) : "open ended"}
              </div>
            </RailCard>
          </div>
        </>
      )}

      <div className="mb-2">
        <SectionHeader label="Gifts on this seat" count={credited.length} role="committed" kind="money" />
      </div>
      {credited.length === 0 ? (
        <EmptyState icon={<RowGlyph kind="money" role="neutral" className="h-7 w-7" />} title="Nothing credited yet">
          No gift is recorded against this seat. A gift counts here when this member is the donor, or when they are credited with bringing it
          in on the gift itself.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {credited.map((c) => {
            const donorName = c.gift.donorId ? (view.donorNames.get(c.gift.donorId) ?? "Unknown donor") : "Anonymous";
            const rowRole = !c.counted ? "target" : c.credit === "given" ? "committed" : "visit";
            const inner = (
              <RailCard role={rowRole} kind={c.credit === "given" ? "money" : "people"}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14.5px] font-bold text-ink">{c.credit === "given" ? "Given" : "Brought in"}</div>
                    <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
                      {donorName} &middot; {shortDate(c.gift.receivedOn)} &middot; {CATEGORY_LABEL[c.gift.category] ?? c.gift.category}
                      {c.gift.method ? ` · ${METHOD_LABEL[c.gift.method] ?? c.gift.method}` : ""}
                    </div>
                    {/* Said on the row rather than in a footnote. The
                        alternative is a member counting the list by hand
                        and getting a different number from the one at
                        the top of the screen. */}
                    {!c.counted && c.excludedBecause && (
                      <div className="mt-1 text-[12.5px] font-bold leading-tight text-muted">
                        Not counted. {EXCLUSION_NOTE[c.excludedBecause]}.
                      </div>
                    )}
                  </div>
                  <span
                    className={`flex-shrink-0 text-[15px] font-extrabold tabular-nums ${c.counted ? "text-ink" : "text-muted"}`}
                  >
                    {formatMoney(c.gift.amountCents)}
                  </span>
                </div>
              </RailCard>
            );
            return c.gift.donorId ? (
              <Link key={c.gift.id} href={`/org/${slug}/fundraising/donors/${c.gift.donorId}`} className="block">
                {inner}
              </Link>
            ) : (
              <div key={c.gift.id}>{inner}</div>
            );
          })}
        </div>
      )}

      {credited.length > countedCount && (
        <div className="mt-3">
          <RailCard role="contact">
            <div className="text-[13.5px] leading-tight text-ink">
              {countedCount} of {credited.length} of these count toward {fiscalYear}. The rest are shown so nothing looks lost, and are
              marked with the reason.
            </div>
          </RailCard>
        </div>
      )}

      {canEdit && member.donorId && (
        <div className="mt-5">
          <Link
            href={`/org/${slug}/fundraising/donors/${member.donorId}`}
            className="block rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink"
          >
            Their donor record
          </Link>
        </div>
      )}
    </main>
  );
}
