import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser, STAFF_ROLES } from "@/lib/auth/guard";
import { getOrgBySlug } from "@/lib/org/membership";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCheckinPhotoFor } from "@/lib/checkinPhoto";

// A check-in's photo (migration 0056):
// /org/<slug>/roster/<athlete>/checkins/<checkin>/photo
//
// Staff only, like the check-in log itself (0039: the athletes are
// minors and the log never reaches a family login). The same 404
// whether the check-in, the photo or the access is missing. The bucket
// has no read policy; the service role reads it here, after the checks.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string; id: string; checkinId: string }> }) {
  const { slug, id, checkinId } = await params;
  const notFound = () => new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const org = await getOrgBySlug(slug);
  if (!org) return notFound();
  const viewer = await getCurrentUser(org.id);
  if (!viewer || !STAFF_ROLES.includes(viewer.role)) return notFound();

  const admin = createAdminClient();
  const { data } = await admin.from("athlete_checkins").select("photo_path").eq("id", checkinId).eq("org_id", org.id).eq("athlete_id", id).maybeSingle();
  const path = (data as { photo_path?: string | null } | null)?.photo_path ?? null;
  if (!path || !isCheckinPhotoFor(path, org.id, id)) return notFound();

  const { data: blob, error } = await admin.storage.from("checkin-photos").download(path);
  if (error || !blob) return notFound();

  return new NextResponse(blob, {
    status: 200,
    headers: {
      "Content-Type": "image/jpeg",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=86400",
    },
  });
}
