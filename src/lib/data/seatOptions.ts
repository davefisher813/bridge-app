// The seats a Brought In By field offers: every active board seat in the
// org, plus the one already on the record even if it has since stepped
// down, so saving does not quietly drop its credit. The same list the
// gift forms build. Empty when the Board module is off, which keeps the
// field off the form for an org with no boards.

import type { createClient } from "@/lib/supabase/server";
import type { BoardMemberOption } from "@/components/GiftForm";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function loadSeatOptions(supabase: Supabase, org: { id: string; modules: { board_governance?: boolean } }, keepId: string | null = null): Promise<BoardMemberOption[]> {
  if (!org.modules.board_governance) return [];
  const { data } = await supabase.from("board_members").select("id, name, status, boards(name)").eq("org_id", org.id).order("name");
  return ((data ?? []) as Array<{ id: string; name: string; status: string; boards: { name: string } | { name: string }[] | null }>)
    .filter((m) => m.status === "active" || m.id === keepId)
    .map((m) => {
      const board = Array.isArray(m.boards) ? m.boards[0] : m.boards;
      return { id: m.id, name: m.name, boardName: board?.name ?? "Board" };
    });
}
