import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { createMeeting } from "@/lib/actions/meetings";
import { MeetingForm } from "@/components/MeetingForm";
import { Screen } from "@/components/kit";

export default async function NewMeetingPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);
  const supabase = await createClient();
  const { data } = await supabase.from("boards").select("id, name").eq("org_id", org.id).order("sort_order", { ascending: true });
  return (
    <Screen title="New Meeting" back={{ href: `/org/${slug}/board-governance/meetings`, label: "Meetings" }}>
      <MeetingForm action={createMeeting.bind(null, slug)} boards={(data ?? []) as { id: string; name: string }[]} />
    </Screen>
  );
}
