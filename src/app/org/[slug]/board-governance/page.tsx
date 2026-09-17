// Every board, and how close each is to the commitment its seats carry.
//
// Gated on orgs.modules.board_governance, off by default, so Elite Squad
// never sees any of it. The gate is checked in the actions too.
//
// The structure is Bridge's own: five tiers with a give/get amount each,
// sport boards starting at three seats and growing to five. See
// src/lib/governance/giveGet.ts for the rules, all of which are about
// not misleading a board chair.

import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { RailCard, SectionHeader, EmptyState } from "@/components/catalog";
import { DOT } from "@/components/statusHue";
import { formatMoneyShort } from "@/lib/fundraising/rollup";
import { BOARD_KIND_LABEL } from "@/lib/governance/giveGet";
import { loadGovernance } from "@/lib/data/governanceView";

export const dynamic = "force-dynamic";

function BankIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-7 w-7">
      <path d="M3 9.5L12 4l9 5.5M5 10v8M10 10v8M14 10v8M19 10v8M3 21h18" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Bar({ percent, role }: { percent: number; role: "committed" | "offer" | "target" }) {
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
      <div className={`h-full rounded-full ${DOT[role]}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

// Never red. A board behind on its give/get is behind, not broken, and
// the locked catalog keeps red for the primary action.
function roleFor(percent: number | null): "committed" | "offer" | "target" {
  if (percent === null) return "target";
  return percent >= 75 ? "committed" : "offer";
}

export default async function BoardGovernancePage({
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
  if (!org.modules.board_governance) notFound();

  const user = await requireRole(org.id, ["owner", "staff", "member"]);
  const canEdit = (STAFF_ROLES as string[]).includes(user.role);

  const fiscalYear = Number(year) || new Date().getFullYear();
  const view = await loadGovernance(org.id, fiscalYear);

  const totals = view.boards.reduce(
    (acc, b) => {
      const s = view.summaryByBoard.get(b.id);
      if (!s) return acc;
      return {
        committed: acc.committed + s.committedCents,
        raised: acc.raised + s.raisedCents,
        seats: acc.seats + s.seatsFilled,
        meeting: acc.meeting + s.membersMeeting,
      };
    },
    { committed: 0, raised: 0, seats: 0, meeting: 0 },
  );
  const overallPercent = totals.committed > 0 ? Math.round((totals.raised / totals.committed) * 100) : null;

  return (
    <main className="px-4 pt-2 pb-6">
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Board</h1>
      <p className="mb-5 text-[13.5px] leading-tight text-muted">
        {fiscalYear}. Each tier carries a give/get commitment, and progress is cash in the door, given or brought in.
      </p>

      {view.boards.length === 0 ? (
        <>
          <EmptyState icon={<BankIcon />} title="No boards yet">
            Add your tiers and the seats on them, and each member&apos;s give/get progress builds itself from the gifts already recorded.
          </EmptyState>
          {canEdit && (
            <div className="mt-5">
              <Link
                href={`/org/${slug}/board-governance/new`}
                className="block rounded-[8px] bg-solid-accent py-3 text-center text-[15px] font-bold text-solid-accent-on"
              >
                New board
              </Link>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <div className="rounded-[12px] bg-paper p-3.5">
              <div className="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">Committed</div>
              <div className="mt-1 text-[26px] font-black leading-tight tabular-nums text-ink">{formatMoneyShort(totals.committed)}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">
                across {totals.seats} active {totals.seats === 1 ? "seat" : "seats"}
              </div>
            </div>
            <div className="rounded-[12px] bg-paper p-3.5">
              <div className="text-[11.5px] font-bold uppercase tracking-[0.03em] text-muted">Delivered</div>
              <div className="mt-1 text-[26px] font-black leading-tight tabular-nums text-ink">{formatMoneyShort(totals.raised)}</div>
              <div className="mt-0.5 text-[11.5px] text-muted">
                {overallPercent === null ? "no commitments set" : `${overallPercent}%`} &middot; {totals.meeting} of {totals.seats} fully met
              </div>
            </div>
          </div>

          <div className="mb-4">
            <RailCard role="contact">
              <div className="text-[13.5px] leading-tight text-ink">
                Give/get counts both halves. A member meets their number by giving it or by bringing it in, and a gift is never counted
                twice when they did both.
              </div>
            </RailCard>
          </div>

          <div className="mb-2">
            <SectionHeader label="Boards" count={view.boards.length} role="committed" />
          </div>
          <div className="flex flex-col gap-2">
            {view.boards.map((b) => {
              const s = view.summaryByBoard.get(b.id)!;
              const role = roleFor(s.percent);
              return (
                <Link key={b.id} href={`/org/${slug}/board-governance/${b.id}`} className="block">
                  <RailCard role={role} kind="governance">
                    <div className="min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="text-[14.5px] font-bold text-ink">{b.name}</div>
                        <span className="flex-shrink-0 text-[13px] font-extrabold tabular-nums text-ink">
                          {s.percent === null ? "no target" : `${s.percent}%`}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-muted">
                        {formatMoneyShort(b.giveGetCents)} give/get &middot; {s.seatsFilled} of {b.maxSeats} seats
                      </div>
                      {s.belowMinimum && (
                        <div className="mt-0.5 text-[12.5px] leading-tight text-muted">
                          Below the floor of {b.minSeats} {b.minSeats === 1 ? "seat" : "seats"} for {BOARD_KIND_LABEL[b.kind].toLowerCase()}.
                        </div>
                      )}
                      <Bar percent={s.percent ?? 0} role={role} />
                    </div>
                  </RailCard>
                </Link>
              );
            })}
          </div>

          {canEdit && (
            <div className="mt-5">
              <Link
                href={`/org/${slug}/board-governance/new`}
                className="block rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink"
              >
                New board
              </Link>
            </div>
          )}

          {/* Organized by board above, and by who is behind here. The
              second is the question a chair asks first, and answering it
              from the board list means opening every board in turn. */}
          <div className="mt-2">
            <Link
              href={`/org/${slug}/board-governance/members`}
              className="block rounded-[8px] bg-paper py-3 text-center text-[15px] font-bold text-ink"
            >
              Every seat
            </Link>
          </div>
        </>
      )}
    </main>
  );
}
