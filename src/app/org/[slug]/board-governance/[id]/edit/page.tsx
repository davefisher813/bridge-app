import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { removeBoard, updateBoard } from "@/lib/actions/governance";
import { BoardForm } from "@/components/GovernanceForms";
import { ConfirmButton, Form, Prose, Screen, Section } from "@/components/kit";
import { toBoard, type BoardRow } from "@/lib/data/governanceAdapters";
import { centsToDecimalString } from "@/lib/validation/gift";

export const dynamic = "force-dynamic";

// Edit Board (audit crud F11), prefilled. Remove sits at the bottom
// behind a confirm, and only while the board has no seats: its seats
// would go with it, and each one carries give/get history.
export default async function EditBoardPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);

  const supabase = await createClient();
  const [{ data: boardRow }, { data: seatRows }] = await Promise.all([
    supabase.from("boards").select("id, name, kind, sport, give_get_amount, min_seats, max_seats, description").eq("id", id).eq("org_id", org.id).maybeSingle(),
    supabase.from("board_members").select("id").eq("board_id", id).eq("org_id", org.id),
  ]);
  if (!boardRow) notFound();
  const row = boardRow as BoardRow & { description: string | null };
  const board = toBoard(row);
  const seats = (seatRows ?? []).length;

  return (
    <Screen title="Edit Board" back={{ href: `/org/${slug}/board-governance/${board.id}`, label: board.name }}>
      <BoardForm
        action={updateBoard.bind(null, slug, board.id)}
        submitLabel="Save Board"
        initial={{
          kind: board.kind,
          name: board.name,
          sport: board.sport,
          giveGet: centsToDecimalString(board.giveGetCents),
          minSeats: board.minSeats,
          maxSeats: board.maxSeats,
          description: row.description,
        }}
      />

      <Section label="Remove" role="danger" kind="blocked">
        {seats > 0 ? (
          <Prose>{`This board has ${seats} ${seats === 1 ? "seat" : "seats"}. Remove them first, or end each one as Emeritus or Resigned and keep the board.`}</Prose>
        ) : (
          <Form action={removeBoard.bind(null, slug, board.id)}>
            <ConfirmButton title={`Remove ${board.name}?`} body="The board goes. It has no seats, so no give/get history goes with it." confirmLabel="Remove">
              Remove Board
            </ConfirmButton>
          </Form>
        )}
      </Section>
    </Screen>
  );
}
