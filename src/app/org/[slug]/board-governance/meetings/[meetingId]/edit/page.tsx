import { notFound } from "next/navigation";
import { getOrgBySlug } from "@/lib/org/membership";
import { requireRole, STAFF_ROLES } from "@/lib/auth/guard";
import { createClient } from "@/lib/supabase/server";
import { updateMeeting } from "@/lib/actions/meetings";
import { MeetingForm } from "@/components/MeetingForm";
import { Screen } from "@/components/kit";

export default async function EditMeetingPage({ params }: { params: Promise<{ slug: string; meetingId: string }> }) {
  const { slug, meetingId } = await params;
  const org = await getOrgBySlug(slug);
  if (!org) notFound();
  if (!org.modules.board_governance) notFound();
  await requireRole(org.id, STAFF_ROLES);
  const supabase = await createClient();
  const [{ data: m }, { data: boards }] = await Promise.all([
    supabase.from("board_meetings").select("id, title, meets_on, board_id, location, notes").eq("id", meetingId).eq("org_id", org.id).maybeSingle(),
    supabase.from("boards").select("id, name").eq("org_id", org.id).order("sort_order", { ascending: true }),
  ]);
  if (!m) notFound();
  const meeting = m as { title: string; meets_on: string; board_id: string | null; location: string | null; notes: string | null };
  return (
    <Screen title="Edit Meeting" back={{ href: `/org/${slug}/board-governance/meetings/${meetingId}`, label: "Meeting" }}>
      <MeetingForm
        action={updateMeeting.bind(null, slug, meetingId)}
        boards={(boards ?? []) as { id: string; name: string }[]}
        initial={{ title: meeting.title, meetsOn: meeting.meets_on, boardId: meeting.board_id, location: meeting.location, notes: meeting.notes }}
        submitLabel="Save Meeting"
      />
    </Screen>
  );
}
