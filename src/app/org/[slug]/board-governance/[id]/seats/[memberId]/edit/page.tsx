import { orgToday } from "@/lib/datetime/today";
import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removeBoardSeat, updateBoardSeat } from "@/lib/actions/governance";
import { BoardSeatForm, type SeatDonor } from "@/components/GovernanceForms";
import { ConfirmButton, Form, Prose, Screen, Section } from "@/components/kit";
import { toBoard, type BoardRow } from "@/lib/data/governanceAdapters";
import { centsToDecimalString } from "@/lib/validation/gift";
import { SEAT_ROLE_SUGGESTIONS } from "@/lib/governance/seatRoles";
import { toCents } from "@/lib/fundraising/rollup";

export const dynamic = "force-dynamic";

interface SeatRow {
  id: string;
  name: string;
  donor_id: string | null;
  role_title: string | null;
  status: string;
  term_start: string | null;
  term_end: string | null;
  commitment_amount: number | string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

// Edit Seat (audit crud F11), prefilled, status and term end included, so
// a departed member is ended in place. Remove is for a seat that should
// never have existed, behind a confirm that says what goes with it.
export default async function EditSeatPage({ params }: { params: Promise<{ slug: string; id: string; memberId: string }> }) {
  const { slug, id, memberId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: boardRow }, { data: seatRow }, { data: donorRows }] = await Promise.all([
    supabase.from("boards").select("id, name, kind, sport, give_get_amount, min_seats, max_seats").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase
      .from("board_members")
      .select("id, name, donor_id, role_title, status, term_start, term_end, commitment_amount, email, phone, notes")
      .eq("id", memberId)
      .eq("board_id", id)
      .eq("org_id", org.id)
      .maybeSingle(),
    supabase.from("donors").select("id, name, email, phone").eq("org_id", org.id).is("deleted_at", null).order("name"),
  ]);
  if (!boardRow || !seatRow) notFound();
  const board = toBoard(boardRow as BoardRow);
  const seat = seatRow as SeatRow;
  const back = `/org/${slug}/board-governance/${board.id}/seats/${seat.id}`;

  return (
    <Screen title="Edit Seat" back={{ href: back, label: seat.name }} lede={board.name}>
      <BoardSeatForm
        action={updateBoardSeat.bind(null, slug, board.id, seat.id)}
        donors={(donorRows ?? []) as SeatDonor[]}
        defaultCommitment={centsToDecimalString(board.giveGetCents)}
        today={orgToday()}
        roleSuggestions={SEAT_ROLE_SUGGESTIONS[board.kind]}
        submitLabel="Save Seat"
        initial={{
          name: seat.name,
          roleTitle: seat.role_title,
          status: seat.status,
          commitment: centsToDecimalString(toCents(seat.commitment_amount)),
          donorId: seat.donor_id,
          termStart: seat.term_start,
          termEnd: seat.term_end,
          email: seat.email,
          phone: seat.phone,
          notes: seat.notes,
        }}
      />

      <Section label="Remove" role="danger" kind="blocked">
        <Form action={removeBoardSeat.bind(null, slug, board.id, seat.id)}>
          <ConfirmButton
            title={`Remove ${seat.name}'s Seat?`}
            body="The seat goes, and gifts credited to it as brought in lose that credit. Their donor record and their own gifts stay."
            confirmLabel="Remove"
          >
            Remove Seat
          </ConfirmButton>
        </Form>
      </Section>
    </Screen>
  );
}
