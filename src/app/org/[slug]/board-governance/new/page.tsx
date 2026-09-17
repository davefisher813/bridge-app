import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createBoard } from "@/lib/actions/governance";
import { BoardForm } from "@/components/GovernanceForms";

export default async function NewBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);

  return (
    <main className="px-4 pt-2 pb-6">
      <div className="mb-4">
        <Link href={`/org/${slug}/board-governance`} className="-my-2 inline-flex min-h-[44px] items-center py-2 pr-3 text-[13px] font-bold text-muted">
          &larr; Board
        </Link>
      </div>
      <h1 className="mb-1 text-[20px] font-extrabold text-ink">New board</h1>
      <p className="mb-5 text-[12.5px] leading-tight text-muted">
        Pick a tier and the amounts prefill from your governance document. Everything is editable.
      </p>
      <BoardForm action={createBoard.bind(null, slug)} />
    </main>
  );
}
