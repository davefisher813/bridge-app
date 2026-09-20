import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createBoard } from "@/lib/actions/governance";
import { BoardForm } from "@/components/GovernanceForms";
import { Screen } from "@/components/kit";

export default async function NewBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);

  return (
    <Screen
      title="New Board"
      back={{ href: `/org/${slug}/board-governance`, label: "Boards" }}
    >
      <BoardForm action={createBoard.bind(null, slug)} />
    </Screen>
  );
}
