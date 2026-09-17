import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { RailCard, SectionHeader } from "@/components/catalog";
import { DOT, TINT } from "@/components/statusHue";
import { formatMoney, formatMoneyShort } from "@/lib/fundraising/rollup";
import { BOARD_KIND_PURPOSE, type SeatStatus } from "@/lib/governance/giveGet";
import { loadGovernance } from "@/lib/data/governanceView";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<SeatStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  emeritus: "Emeritus",
  resigned: "Resigned",
};

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

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { slug, id } = await params;
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

  const summary = view.summaryByBoard.get(board.id)!;
  const members = view.membersByBoard.get(board.id) ?? [];
  // Active first, since they are the ones carrying a live commitment.
  const ordered = [...members].sort((a, b) => {
    const rank = (s: SeatStatus) => (s === "active" ? 0 : s === "prospect" ? 1 : 2);
    return rank(a.status) - rank(b.status) || a.name.localeCompare(b.name);
  });

  const role = roleFor(summary.percent);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/board-governance`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Board
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">{board.name}</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        {formatMoneyShort(board.giveGetCents)} give/get per seat. {BOARD_KIND_PURPOSE[board.kind]}
      </p>

      <div className="mb-4">
        <RailCard role={role}>
          <div className="min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[13px] font-bold text-ink">
                {formatMoneyShort(summary.raisedCents)} of {formatMoneyShort(summary.committedCents)}
              </div>
              <span className="flex-shrink-0 text-[12px] font-extrabold tabular-nums text-ink">
                {summary.percent === null ? "no target" : `${summary.percent}%`}
              </span>
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted">
              {summary.seatsFilled} {summary.seatsFilled === 1 ? "seat" : "seats"} filled &middot; {summary.seatsOpen} open &middot;{" "}
              {summary.membersMeeting} of {summary.seatsFilled} fully met
            </div>
            <Bar percent={summary.percent ?? 0} role={role} />
          </div>
        </RailCard>
      </div>

      {summary.belowMinimum && (
        <div className="mb-4">
          <RailCard role="target">
            <div className="text-[12.5px] leading-tight text-ink">
              Below the floor of {board.minSeats} {board.minSeats === 1 ? "seat" : "seats"}.
            </div>
          </RailCard>
        </div>
      )}

      <div className="mb-2">
        <SectionHeader label="Seats" count={ordered.length} role="contact" />
      </div>
      <div className="flex flex-col gap-2">
        {ordered.map((m) => {
          const p = view.progressByMember.get(m.id);
          const memberRole = m.status === "active" ? roleFor(p?.percent ?? null) : "target";
          return (
            <RailCard key={m.id} role={memberRole}>
              <div className="min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-ink">{m.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-muted">{m.roleTitle ?? "No role set"}</div>
                  </div>
                  {m.status === "active" ? (
                    <span className="flex-shrink-0 text-[12px] font-extrabold tabular-nums text-ink">
                      {p?.percent === null || p === undefined ? "no target" : `${p.percent}%`}
                    </span>
                  ) : (
                    <span className={`inline-flex flex-shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${TINT.low}`}>
                      {STATUS_LABEL[m.status]}
                    </span>
                  )}
                </div>

                {m.status === "active" && p && (
                  <>
                    <div className="mt-1.5 text-[11.5px] text-muted">
                      {formatMoneyShort(p.givenCents)} given &middot; {formatMoneyShort(p.raisedCents)} brought in
                      {m.donorId === null ? " · no donor record linked" : ""}
                    </div>
                    {/* Beside the progress, never inside it. A promise
                        does not discharge a commitment. */}
                    {p.pledgedCents > 0 && (
                      <div className="mt-0.5 text-[11.5px] leading-tight text-muted">
                        {formatMoney(p.pledgedCents)} pledged, not yet received.
                      </div>
                    )}
                    <Bar percent={p.percent ?? 0} role={memberRole} />
                  </>
                )}
              </div>
            </RailCard>
          );
        })}
      </div>

      {ordered.length === 0 && (
        <RailCard role="target">
          <div className="text-[12.5px] leading-tight text-ink">No seats on this board yet.</div>
        </RailCard>
      )}

      <div className="mt-4">
        <RailCard role="contact">
          <div className="text-[12.5px] leading-tight text-ink">
            Only an active seat counts toward the board&apos;s total. A prospect has not joined and an emeritus member is not on the hook,
            so counting either would make the board look further behind than it is.
          </div>
        </RailCard>
      </div>

      {canEdit && !summary.atCapacity && (
        <div className="mt-5">
          <Link
            href={`/org/${slug}/board-governance/${board.id}/seats/new`}
            className="block rounded-[8px] bg-solid-accent py-3 text-center text-[14px] font-bold text-solid-accent-on"
          >
            Add a seat
          </Link>
        </div>
      )}

      {canEdit && summary.atCapacity && (
        <div className="mt-5">
          <RailCard role="offer">
            <div className="text-[12.5px] leading-tight text-ink">
              This board is full at {board.maxSeats} active seats. Raise the cap to add another.
            </div>
          </RailCard>
        </div>
      )}
    </main>
  );
}
