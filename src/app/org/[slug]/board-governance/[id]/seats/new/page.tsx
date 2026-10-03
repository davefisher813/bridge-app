import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { addBoardSeat } from "@/lib/actions/governance";
import { BoardSeatForm, type SeatDonor } from "@/components/GovernanceForms";
import { Screen } from "@/components/kit";
import { toBoard, type BoardRow } from "@/lib/data/governanceAdapters";
import { SEAT_ROLE_SUGGESTIONS } from "@/lib/governance/seatRoles";

export const dynamic = "force-dynamic";

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
    supabase.from("donors").select("id, name, email, phone").eq("org_id", org.id).is("deleted_at", null).order("name"),
  ]);

  if (!boardRow) notFound();
  const board = toBoard(boardRow as BoardRow);

  return (
    <Screen title="Add Seat" back={{ href: `/org/${slug}/board-governance/${board.id}`, label: board.name }}>
      <BoardSeatForm
        action={addBoardSeat.bind(null, slug, board.id)}
        donors={(donorRows ?? []) as SeatDonor[]}
        defaultCommitment={(board.giveGetCents / 100).toFixed(2)}
        today={orgToday()}
        roleSuggestions={SEAT_ROLE_SUGGESTIONS[board.kind]}
      />
    </Screen>
  );
}
