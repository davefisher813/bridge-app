import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { addBoardSeat } from "@/lib/actions/governance";
import { BoardSeatForm } from "@/components/GovernanceForms";
import { toBoard, type BoardRow } from "@/lib/data/governanceAdapters";
import type { BoardKind } from "@/lib/governance/giveGet";

export const dynamic = "force-dynamic";

// The core roles each tier carries, from the governance document. Sport
// boards name three explicitly; the others are an organization's own
// officers, so nothing is suggested rather than inventing titles.
const ROLE_SUGGESTIONS: Record<BoardKind, string[]> = {
  sport: ["Sport Director", "Board Chair", "Recruiting Lead"],
  executive: ["Chair", "Vice Chair", "Treasurer", "Secretary"],
  general: [],
  development: [],
  junior: [],
};

export default async function NewSeatPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: boardRow }, { data: donorRows }] = await Promise.all([
    supabase
      .from("boards")
      .select("id, name, kind, sport, give_get_amount, min_seats, max_seats")
      .eq("id", id)
      .eq("org_id", org.id)
      .maybeSingle(),
    supabase.from("donors").select("id, name").eq("org_id", org.id).is("deleted_at", null).order("name"),
  ]);

  if (!boardRow) notFound();
  const board = toBoard(boardRow as BoardRow);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/board-governance/${board.id}`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[14.5px] font-bold text-muted">
          &larr; {board.name}
        </Link>
      </div>
      <h1 className="mb-1 text-[22px] font-extrabold text-ink">Add a seat</h1>
      <p className="mb-5 text-[13.5px] leading-tight text-muted">{board.name}, up to {board.maxSeats} active seats.</p>

      <BoardSeatForm
        action={addBoardSeat.bind(null, slug, board.id)}
        donors={(donorRows ?? []) as Array<{ id: string; name: string }>}
        defaultCommitment={(board.giveGetCents / 100).toFixed(2)}
        today={new Date().toISOString().slice(0, 10)}
        roleSuggestions={ROLE_SUGGESTIONS[board.kind]}
      />
    </main>
  );
}
